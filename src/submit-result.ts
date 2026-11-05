import { setTimeout as delay } from "node:timers/promises";
import {
  ApiResponseError,
  NodeTokenRejectedError,
  SUBMIT_TIMEOUT_MS,
  type ApiClient,
  type SubmitResultBody,
} from "./api-client";
import { errorMessage } from "./lib/error-message";
import { log } from "./lib/log";

export interface SubmitRetryPolicy {
  windowMs: number;
  attemptTimeoutMs: number;
  baseDelayMs: number;
  maxDelayMs: number;
}

export const SUBMIT_RETRY_POLICY: SubmitRetryPolicy = {
  windowMs: 60_000,
  attemptTimeoutMs: SUBMIT_TIMEOUT_MS,
  baseDelayMs: 1_000,
  maxDelayMs: 15_000,
};

export type SubmitOutcome = "delivered" | "gave_up";

export interface SubmitResultWithRetryOptions {
  api: Pick<ApiClient, "submitResult">;
  jobId: string;
  body: SubmitResultBody;
  signal: AbortSignal;
  policy?: SubmitRetryPolicy;
  onThrottled?: () => void;
}

const TOO_MANY_REQUESTS = 429;
const SERVER_ERROR_FROM = 500;

function isRetryable(error: unknown): boolean {
  if (!(error instanceof ApiResponseError)) return true;
  return (
    error.status >= SERVER_ERROR_FROM || error.status === TOO_MANY_REQUESTS
  );
}

function pauseBeforeRetry(
  failedAttempts: number,
  error: unknown,
  policy: SubmitRetryPolicy,
): number {
  const backoff = Math.min(
    policy.baseDelayMs * 2 ** (failedAttempts - 1),
    policy.maxDelayMs,
  );
  const retryAfterMs =
    error instanceof ApiResponseError ? (error.retryAfterMs ?? 0) : 0;
  return Math.max(backoff, retryAfterMs);
}

function giveUp(
  jobId: string,
  attempts: number,
  message: string,
): SubmitOutcome {
  log(
    `job ${jobId}: result not delivered after ${attempts} attempts (${message})`,
  );
  return "gave_up";
}

export async function submitResultWithRetry(
  options: SubmitResultWithRetryOptions,
): Promise<SubmitOutcome> {
  const {
    api,
    jobId,
    body,
    signal,
    policy = SUBMIT_RETRY_POLICY,
    onThrottled,
  } = options;
  const deadline = Date.now() + policy.windowMs;

  for (let attempt = 1; ; attempt++) {
    try {
      await api.submitResult(jobId, body);
      return "delivered";
    } catch (error) {
      if (error instanceof NodeTokenRejectedError) throw error;
      if (
        error instanceof ApiResponseError &&
        error.status === TOO_MANY_REQUESTS
      ) {
        onThrottled?.();
      }
      const message = errorMessage(error);
      const pauseMs = pauseBeforeRetry(attempt, error, policy);
      const canRetry =
        isRetryable(error) &&
        !signal.aborted &&
        Date.now() + pauseMs + policy.attemptTimeoutMs <= deadline;
      if (!canRetry) return giveUp(jobId, attempt, message);
      log(
        `job ${jobId}: result submit failed (${message}), retry in ${pauseMs / 1000}s`,
      );
      try {
        await delay(pauseMs, undefined, { signal });
      } catch {
        return giveUp(jobId, attempt, message);
      }
    }
  }
}
