import dns from "node:dns";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import { isPrivateIp } from "../lib/is-private-ip";
import { readPackageVersion } from "../lib/version";
import type {
  HttpCheckError,
  HttpCheckErrorKind,
  HttpCheckPayloadV1,
  HttpCheckRedirect,
  HttpCheckResult,
  HttpHopResult,
} from "../types/http-check.types";

const MAX_REDIRECTS = 5;
const DEFAULT_TIMEOUT_MS = 10_000;
const MAX_URL_LENGTH = 2048;
const BLOCKED_CODE = "EBLOCKED";
const TOO_MANY_REDIRECTS_CODE = "TOO_MANY_REDIRECTS";
const NODE_SIDE_ERROR_CODES = new Set([
  "EAI_AGAIN",
  "EAI_FAIL",
  "ENETUNREACH",
  "ENETDOWN",
  "EMFILE",
  "ENFILE",
  "ENOBUFS",
  "ENOMEM",
  "EADDRNOTAVAIL",
]);
const TLS_CODE_PATTERN =
  /CERT|SELF_SIGNED|UNABLE_TO_VERIFY|ERR_TLS|ERR_SSL|EPROTO|HOSTNAME_MISMATCH/;
const USER_AGENT = `ScanUpBot/${readPackageVersion()} (+https://scanup.ru/tools/check)`;

function codedError(message: string, code: string): NodeJS.ErrnoException {
  const error: NodeJS.ErrnoException = new Error(message);
  error.code = code;
  return error;
}

function guardedLookup(
  hostname: string,
  options: dns.LookupOptions,
  callback: (
    error: NodeJS.ErrnoException | null,
    address: string | dns.LookupAddress[],
    family?: number,
  ) => void,
): void {
  dns.lookup(hostname, options, (error, address, family) => {
    if (error) return callback(error, address);
    const addresses: string[] = Array.isArray(address)
      ? address.map((entry) => entry.address)
      : [address];
    if (addresses.some(isPrivateIp)) {
      return callback(
        codedError(`${hostname} resolves to a private address`, BLOCKED_CODE),
        address,
      );
    }
    callback(null, address, family);
  });
}

function assertPublicHost(url: URL): void {
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (net.isIP(host) !== 0 && isPrivateIp(host)) {
    throw codedError("Private address is not allowed", BLOCKED_CODE);
  }
}

function roundedTimings(raw: Record<string, number>): HttpHopResult["timings"] {
  return Object.fromEntries(
    Object.entries(raw).map(([name, value]) => [name, Math.round(value)]),
  );
}

function requestHop(url: URL, signal: AbortSignal): Promise<HttpHopResult> {
  return new Promise((resolve, reject) => {
    assertPublicHost(url);
    const startedAt = performance.now();
    const marks: Record<string, number> = {};
    const transport = url.protocol === "https:" ? https : http;

    const request = transport.request(
      url,
      {
        method: "GET",
        signal,
        lookup: guardedLookup,
        headers: { "user-agent": USER_AGENT, accept: "*/*" },
      },
      (response) => {
        marks.ttfb = performance.now() - startedAt;
        response.destroy();
        resolve({
          statusCode: response.statusCode ?? 0,
          location: response.headers.location ?? null,
          timings: roundedTimings(marks),
        });
      },
    );

    request.on("socket", (socket) => {
      socket.once("lookup", () => {
        marks.dns = performance.now() - startedAt;
      });
      socket.once("connect", () => {
        marks.connect = performance.now() - startedAt;
      });
      socket.once("secureConnect", () => {
        marks.tls = performance.now() - startedAt;
      });
    });
    request.on("error", reject);
    request.end();
  });
}

function errorCode(error: unknown): string | null {
  const candidate = error as {
    code?: unknown;
    cause?: { code?: unknown };
    name?: unknown;
  } | null;
  const code = candidate?.code ?? candidate?.cause?.code;
  return typeof code === "string" ? code : null;
}

function errorKind(error: unknown, code: string | null): HttpCheckErrorKind {
  const name = (error as { name?: unknown } | null)?.name;
  if (name === "TimeoutError" || name === "AbortError") return "timeout";
  if (code === BLOCKED_CODE) return "blocked";
  if (code === "ENOTFOUND" || code === "ENODATA") return "dns";
  if (code === "ECONNREFUSED") return "refused";
  if (code === "ECONNRESET" || code === "EPIPE") return "reset";
  if (code === "EHOSTUNREACH") return "unreachable";
  if (code === TOO_MANY_REDIRECTS_CODE) return "redirects";
  if (code && TLS_CODE_PATTERN.test(code)) return "tls";
  return "other";
}

function describeError(error: unknown): HttpCheckError {
  const code = errorCode(error);
  const message = error instanceof Error ? error.message : String(error);
  return { kind: errorKind(error, code), code, message };
}

export function parseHttpCheckPayload(
  payload: Record<string, unknown>,
): HttpCheckPayloadV1 {
  const url = payload.url;
  if (
    typeof url !== "string" ||
    url.length === 0 ||
    url.length > MAX_URL_LENGTH
  ) {
    throw new Error("http_check payload: url is missing or too long");
  }

  const parsed = new URL(url);
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("http_check payload: url must be http or https");
  }

  const timeoutMs =
    typeof payload.timeoutMs === "number" &&
    Number.isFinite(payload.timeoutMs) &&
    payload.timeoutMs > 0
      ? Math.min(payload.timeoutMs, DEFAULT_TIMEOUT_MS)
      : DEFAULT_TIMEOUT_MS;

  return { url, timeoutMs };
}

export async function runHttpCheck(
  payload: HttpCheckPayloadV1,
): Promise<HttpCheckResult> {
  const startedAt = performance.now();
  const signal = AbortSignal.timeout(payload.timeoutMs);
  const redirects: HttpCheckRedirect[] = [];
  let currentUrl = new URL(payload.url);

  try {
    for (;;) {
      const hop = await requestHop(currentUrl, signal);
      const isRedirect =
        hop.statusCode >= 300 && hop.statusCode < 400 && hop.location;
      if (!isRedirect) {
        return {
          finalUrl: currentUrl.href,
          statusCode: hop.statusCode,
          responseTimeMs: Math.round(performance.now() - startedAt),
          redirects,
          timings: hop.timings,
        };
      }

      redirects.push({ url: currentUrl.href, statusCode: hop.statusCode });
      if (redirects.length > MAX_REDIRECTS) {
        throw codedError("Too many redirects", TOO_MANY_REDIRECTS_CODE);
      }

      currentUrl = new URL(hop.location as string, currentUrl);
      if (currentUrl.protocol !== "http:" && currentUrl.protocol !== "https:") {
        throw codedError("Redirect to a non-http scheme", BLOCKED_CODE);
      }
    }
  } catch (error) {
    const code = errorCode(error);
    if (code && NODE_SIDE_ERROR_CODES.has(code)) throw error;
    return {
      finalUrl: currentUrl.href,
      statusCode: null,
      responseTimeMs: Math.round(performance.now() - startedAt),
      redirects,
      error: describeError(error),
    };
  }
}
