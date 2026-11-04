export interface HttpCheckPayloadV1 {
  url: string;
  timeoutMs: number;
}

export type HttpCheckErrorKind =
  | "dns"
  | "refused"
  | "reset"
  | "unreachable"
  | "timeout"
  | "tls"
  | "redirects"
  | "blocked"
  | "other";

export interface HttpCheckError {
  kind: HttpCheckErrorKind;
  code: string | null;
  message: string;
}

export interface HttpCheckRedirect {
  url: string;
  statusCode: number;
}

export interface HttpCheckTimings {
  dns?: number;
  connect?: number;
  tls?: number;
  ttfb?: number;
}

export interface HttpCheckResult {
  finalUrl: string;
  statusCode: number | null;
  responseTimeMs: number;
  redirects: HttpCheckRedirect[];
  timings?: HttpCheckTimings;
  error?: HttpCheckError;
}

export interface HttpHopResult {
  statusCode: number;
  location: string | null;
  timings: HttpCheckTimings;
}
