import type { HttpCheckError } from "./http-check.types";

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

export interface HttpPingTlsCertificate {
  host: string;
  validTo: string;
  fingerprint256: string;
  issuer: string | null;
}

export interface HttpPingResultV2 {
  statusCode: number | null;
  responseTimeMs: number;
  error?: HttpCheckError;
  tls?: HttpPingTlsCertificate;
}

export interface HttpPingRunOptions {
  allowPrivateTargets: boolean;
}

export interface HttpPingTestRunOptions extends HttpPingRunOptions {
  tlsCa?: string;
}
