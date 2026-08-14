export interface HttpPingPayloadV1 {
  url: string;
  method?: "GET" | "HEAD";
  timeoutMs: number;
  headers?: Record<string, string>;
}

export interface HttpPingResult {
  statusCode: number;
  responseTimeMs: number;
}
