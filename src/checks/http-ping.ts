import type {
  HttpPingPayloadV1,
  HttpPingResult,
} from "../types/http-ping.types";

const MAX_REDIRECTS = 5;

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
): Promise<HttpPingResult> {
  const startedAt = performance.now();
  const signal = AbortSignal.timeout(payload.timeoutMs);

  let currentUrl = new URL(payload.url);
  let headers = payload.headers ?? {};
  let response: Response;
  let redirectCount = 0;

  for (;;) {
    response = await fetch(currentUrl, {
      method: payload.method ?? "GET",
      headers,
      redirect: "manual",
      signal,
    });

    const isRedirect = response.status >= 300 && response.status < 400;
    const location = response.headers.get("location");
    if (!isRedirect || !location) break;

    await response.body?.cancel();

    if (redirectCount >= MAX_REDIRECTS) {
      throw new Error("Too many redirects");
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
