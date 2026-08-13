export interface HttpPingPayloadV1 {
  url: string;
  method?: "GET" | "HEAD";
  timeoutMs: number;
}

export interface HttpPingResult {
  statusCode: number;
  responseTimeMs: number;
}
