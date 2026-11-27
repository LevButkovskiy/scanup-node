import type { TLSSocket } from "node:tls";
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
import { toTlsCertificate } from "../lib/tls-certificate";
import type {
  HttpPingPayloadV1,
  HttpPingResult,
  HttpPingResultV2,
  HttpPingTestRunOptions,
  HttpPingTlsCertificate,
} from "../types/http-ping.types";

const MAX_REDIRECTS = 5;
const DNS_RETRY_DELAY_MS = 200;
const TEMPORARY_DNS_FAILURE_CODE = "EAI_AGAIN";

interface CertificateRecorder {
  certificate?: HttpPingTlsCertificate;
}

function recordingConnector(
  connect: buildConnector.connector,
  recorder: CertificateRecorder,
  rejectPrivateLiterals: boolean,
): buildConnector.connector {
  return (options, callback) => {
    if (rejectPrivateLiterals && isPrivateIpLiteral(options.hostname)) {
      callback(blockedAddressError(), null);
      return;
    }
    connect(options, (error, socket) => {
      if (
        !error &&
        !recorder.certificate &&
        socket &&
        "getPeerCertificate" in socket
      ) {
        recorder.certificate = toTlsCertificate({
          peer: (socket as TLSSocket).getPeerCertificate(),
          host: options.servername ?? options.hostname,
        });
      }
      callback(error as Error, socket as never);
    });
  };
}

function createAgent(
  timeoutMs: number,
  { allowPrivateTargets, tlsCa }: HttpPingTestRunOptions,
  recorder: CertificateRecorder,
): Agent {
  const connect = buildConnector({
    timeout: timeoutMs,
    ca: tlsCa,
    ...(allowPrivateTargets ? {} : { lookup: guardedLookup }),
  });
  return new Agent({
    connect: recordingConnector(connect, recorder, !allowPrivateTargets),
    headersTimeout: 0,
    bodyTimeout: 0,
  });
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
  dispatcher: Agent,
): Promise<Response> {
  const requestInit = { ...init, dispatcher };
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
async function executeHttpPing(
  payload: HttpPingPayloadV1,
  dispatcher: Agent,
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
      dispatcher,
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

export async function runHttpPing(
  payload: HttpPingPayloadV1,
  options: HttpPingTestRunOptions,
): Promise<HttpPingResult> {
  const agent = createAgent(payload.timeoutMs, options, {});
  try {
    return await executeHttpPing(payload, agent);
  } finally {
    await agent.destroy();
  }
}

export async function runHttpPingV2(
  payload: HttpPingPayloadV1,
  options: HttpPingTestRunOptions,
): Promise<HttpPingResultV2> {
  const startedAt = performance.now();
  const recorder: CertificateRecorder = {};
  const agent = createAgent(payload.timeoutMs, options, recorder);
  try {
    const result = await executeHttpPing(payload, agent);
    return recorder.certificate
      ? { ...result, tls: recorder.certificate }
      : result;
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
      ...(recorder.certificate ? { tls: recorder.certificate } : {}),
    };
  } finally {
    await agent.destroy();
  }
}
