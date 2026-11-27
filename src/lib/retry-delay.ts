import { ApiResponseError } from "../api-client";

export function retryDelayMs(error: unknown, errorBackoffMs: number): number {
  const retryAfterMs =
    error instanceof ApiResponseError ? (error.retryAfterMs ?? 0) : 0;
  return Math.max(errorBackoffMs, retryAfterMs);
}
