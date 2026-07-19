// Проверка http_ping (schemaVersion v1). Нода сообщает только факты —
// statusCode и время ответа, либо сетевую ошибку/таймаут. Решение
// up/down принимает backend. Прочие поля wire-payload'а (probeId,
// expectedStatusCodes) — внутренние детали backend'а: нода их не
// интерпретирует, поэтому их нет в этом типе.

export interface HttpPingPayloadV1 {
  url: string;
  method?: "GET" | "HEAD";
  timeoutMs: number;
}

export interface HttpPingResult {
  statusCode: number;
  responseTimeMs: number;
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

  return { url, timeoutMs, method };
}

export async function runHttpPing(
  payload: HttpPingPayloadV1,
): Promise<HttpPingResult> {
  const startedAt = performance.now();
  const response = await fetch(payload.url, {
    method: payload.method ?? "GET",
    redirect: "follow",
    signal: AbortSignal.timeout(payload.timeoutMs),
  });
  const responseTimeMs = Math.round(performance.now() - startedAt);

  // Тело не нужно — освобождаем соединение, не дожидаясь загрузки
  await response.body?.cancel();

  return { statusCode: response.status, responseTimeMs };
}
