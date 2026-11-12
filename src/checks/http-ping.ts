import {
  Agent,
  buildConnector,
  fetch,
  type RequestInit,
  type Response,
} from "undici";
import { errorMessage } from "../lib/error-message";
import {
  errorCode,
  errorKind,
  isNodeSideError,
  TOO_MANY_REDIRECTS_CODE,
} from "../lib/network-error";
import {
  BLOCKED_CODE,
  blockedAddressError,
  codedError,
  guardedLookup,
  isPrivateIpLiteral,
} from "../lib/public-address-guard";
import { sleep } from "../lib/sleep";
import type {
  HttpPingPayloadV1,
  HttpPingResult,
  HttpPingResultV2,
  HttpPingRunOptions,
} from "../types/http-ping.types";

const MAX_REDIRECTS = 5;
const DNS_RETRY_DELAY_MS = 200;
const TEMPORARY_DNS_FAILURE_CODE = "EAI_AGAIN";

const dispatchers = new Map<string, Agent>();

function publicOnlyConnector(timeoutMs: number): buildConnector.connector {
  const connect = buildConnector({ timeout: timeoutMs, lookup: guardedLookup });
  return (options, callback) => {
    if (isPrivateIpLiteral(options.hostname)) {
      callback(blockedAddressError(), null);
      return;
    }
    connect(options, callback);
  };
}

function dispatcherFor(timeoutMs: number, allowPrivateTargets: boolean): Agent {
  const key = `${timeoutMs}:${allowPrivateTargets}`;
  let dispatcher = dispatchers.get(key);
  if (!dispatcher) {
    dispatcher = new Agent({
      connect: allowPrivateTargets
        ? { timeout: timeoutMs }
        : publicOnlyConnector(timeoutMs),
      headersTimeout: 0,
      bodyTimeout: 0,
    });
    dispatchers.set(key, dispatcher);
  }
  return dispatcher;
}

function isBlockedByGuard(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const { code, cause, errors } = error as {
    code?: unknown;
    cause?: unknown;
    errors?: unknown;
  };
  if (code === BLOCKED_CODE) return true;
  if (Array.isArray(errors) && errors.some(isBlockedByGuard)) return true;
  return isBlockedByGuard(cause);
}

function isTemporaryDnsFailure(error: unknown): boolean {
  return (
    error instanceof Error &&
    error.cause instanceof Error &&
    (error.cause as NodeJS.ErrnoException).code === TEMPORARY_DNS_FAILURE_CODE
  );
}

async function fetchWithDnsRetry(
  url: URL,
  init: RequestInit,
  timeoutMs: number,
  allowPrivateTargets: boolean,
): Promise<Response> {
  const requestInit = {
    ...init,
    dispatcher: dispatcherFor(timeoutMs, allowPrivateTargets),
  };
  try {
    return await fetchOnce(url, requestInit);
  } catch (error) {
    if (!isTemporaryDnsFailure(error) || init.signal?.aborted) throw error;
    await sleep(DNS_RETRY_DELAY_MS);
    return fetchOnce(url, requestInit);
  }
}

async function fetchOnce(url: URL, init: RequestInit): Promise<Response> {
  try {
    return await fetch(url, init);
  } catch (error) {
    if (isBlockedByGuard(error)) throw blockedAddressError();
    throw error;
  }
}

export function parseHttpPingPayload(
  payload: Record<string, unknown>,
): HttpPingPayloadV1 {
  const url = payload.url;
  if (typeof url !== "string" || url.length === 0) {
    throw new Error("http_ping payload: url is missing");
  }

  const timeoutMs =
    typeof payload.timeoutMs === "number" &&
    Number.isFinite(payload.timeoutMs) &&
    payload.timeoutMs > 0
      ? payload.timeoutMs
      : 10_000;

  const method =
    payload.method === "GET" || payload.method === "HEAD"
      ? payload.method
      : undefined;

  const headers = parseHeaders(payload.headers);

  return { url, timeoutMs, method, headers };
}

function parseHeaders(raw: unknown): Record<string, string> | undefined {
  if (typeof raw !== "object" || raw === null) return undefined;

  const headers: Record<string, string> = {};
  for (const [name, value] of Object.entries(raw)) {
    if (typeof value === "string") headers[name] = value;
  }
  return Object.keys(headers).length > 0 ? headers : undefined;
}
export async function runHttpPing(
  payload: HttpPingPayloadV1,
  { allowPrivateTargets }: HttpPingRunOptions,
): Promise<HttpPingResult> {
  const startedAt = performance.now();
  const signal = AbortSignal.timeout(payload.timeoutMs);

  let currentUrl = new URL(payload.url);
  let headers = payload.headers ?? {};
  let response: Response;
  let redirectCount = 0;

  for (;;) {
    response = await fetchWithDnsRetry(
      currentUrl,
      {
        method: payload.method ?? "GET",
        headers,
        redirect: "manual",
        signal,
      },
      payload.timeoutMs,
      allowPrivateTargets,
    );

    const isRedirect = response.status >= 300 && response.status < 400;
    const location = response.headers.get("location");
    if (!isRedirect || !location) break;

    await response.body?.cancel();

    if (redirectCount >= MAX_REDIRECTS) {
      throw codedError("Too many redirects", TOO_MANY_REDIRECTS_CODE);
    }
    redirectCount++;

    const nextUrl = new URL(location, currentUrl);
    const crossHost =
      nextUrl.hostname !== currentUrl.hostname ||
      nextUrl.port !== currentUrl.port;
    const insecureDowngrade =
      currentUrl.protocol === "https:" && nextUrl.protocol === "http:";
    if (crossHost || insecureDowngrade) {
      headers = {};
    }
    currentUrl = nextUrl;
  }

  const responseTimeMs = Math.round(performance.now() - startedAt);

  // Тело не нужно — освобождаем соединение, не дожидаясь загрузки
  await response.body?.cancel();

  return { statusCode: response.status, responseTimeMs };
}

export async function runHttpPingV2(
  payload: HttpPingPayloadV1,
  options: HttpPingRunOptions,
): Promise<HttpPingResultV2> {
  const startedAt = performance.now();
  try {
    return await runHttpPing(payload, options);
  } catch (error) {
    if (isNodeSideError(error)) throw error;
    const code = errorCode(error);
    return {
      statusCode: null,
      responseTimeMs: Math.round(performance.now() - startedAt),
      error: {
        kind: errorKind(error, code),
        code,
        message: errorMessage(error),
      },
    };
  }
}
