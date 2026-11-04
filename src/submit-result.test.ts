import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ApiResponseError,
  NodeTokenRejectedError,
  type SubmitResultBody,
} from "./api-client";
import { submitResultWithRetry, type SubmitRetryPolicy } from "./submit-result";

const fastPolicy: SubmitRetryPolicy = {
  windowMs: 500,
  attemptTimeoutMs: 0,
  baseDelayMs: 1,
  maxDelayMs: 4,
};

const doneBody: SubmitResultBody = { status: "done", result: { ok: true } };
const failedBody: SubmitResultBody = {
  status: "failed",
  error: "site check error",
};

type Step = "ok" | Error;

function fakeApi(steps: Step[]) {
  const calls: SubmitResultBody[] = [];
  return {
    calls,
    api: {
      async submitResult(_jobId: string, body: SubmitResultBody) {
        calls.push(body);
        const step = steps[Math.min(calls.length, steps.length) - 1];
        if (step instanceof Error) throw step;
      },
    },
  };
}

function httpError(status: number, retryAfterMs?: number): ApiResponseError {
  return new ApiResponseError(`HTTP ${status}`, status, retryAfterMs);
}

function run(
  steps: Step[],
  body: SubmitResultBody = doneBody,
  signal = new AbortController().signal,
  policy = fastPolicy,
  onThrottled?: () => void,
) {
  const fake = fakeApi(steps);
  const outcome = submitResultWithRetry({
    api: fake.api,
    jobId: "job-1",
    body,
    signal,
    policy,
    onThrottled,
  });
  return { ...fake, outcome };
}

describe("submitResultWithRetry", () => {
  it("delivers on the first attempt", async () => {
    const { calls, outcome } = run(["ok"]);
    assert.equal(await outcome, "delivered");
    assert.equal(calls.length, 1);
  });

  it("retries 5xx and never sends a failed status", async () => {
    const { calls, outcome } = run([httpError(502), httpError(500), "ok"]);
    assert.equal(await outcome, "delivered");
    assert.equal(calls.length, 3);
    assert.ok(calls.every((body) => body.status === "done"));
  });

  it("reports every 429 through onThrottled and still retries", async () => {
    let throttled = 0;
    const { outcome } = run(
      [httpError(429), httpError(429), httpError(502), "ok"],
      doneBody,
      new AbortController().signal,
      fastPolicy,
      () => {
        throttled += 1;
      },
    );
    assert.equal(await outcome, "delivered");
    assert.equal(throttled, 2);
  });

  it("retries network errors and timeouts", async () => {
    const dnsError = new TypeError("fetch failed", {
      cause: new Error("getaddrinfo EAI_AGAIN api.scanup.ru"),
    });
    const timeout = new DOMException("timed out", "TimeoutError");
    const { calls, outcome } = run([dnsError, timeout, "ok"]);
    assert.equal(await outcome, "delivered");
    assert.equal(calls.length, 3);
    assert.ok(calls.every((body) => body.status === "done"));
  });

  it("gives up after the window without sending anything else", async () => {
    const { calls, outcome } = run([httpError(503)]);
    assert.equal(await outcome, "gave_up");
    assert.ok(calls.length > 1);
    assert.ok(calls.every((body) => body === doneBody));
  });

  it("rethrows a rejected token without retrying", async () => {
    const { calls, outcome } = run([new NodeTokenRejectedError()]);
    await assert.rejects(outcome, NodeTokenRejectedError);
    assert.equal(calls.length, 1);
  });

  it("does not retry other 4xx", async () => {
    for (const status of [400, 404, 413]) {
      const { calls, outcome } = run([httpError(status)]);
      assert.equal(await outcome, "gave_up");
      assert.equal(calls.length, 1);
    }
  });

  it("waits at least Retry-After on 429", async () => {
    const startedAt = Date.now();
    const { calls, outcome } = run([httpError(429, 80), "ok"]);
    assert.equal(await outcome, "delivered");
    assert.equal(calls.length, 2);
    assert.ok(Date.now() - startedAt >= 75);
  });

  it("does not start an attempt that would end past the window", async () => {
    const { calls, outcome } = run([httpError(429, 10_000)]);
    assert.equal(await outcome, "gave_up");
    assert.equal(calls.length, 1);
  });

  it("does not start an attempt whose timeout would end past the window", async () => {
    const { calls, outcome } = run(
      [httpError(502)],
      doneBody,
      new AbortController().signal,
      { ...fastPolicy, attemptTimeoutMs: fastPolicy.windowMs },
    );
    assert.equal(await outcome, "gave_up");
    assert.equal(calls.length, 1);
  });

  it("keeps the original failed body across retries", async () => {
    const { calls, outcome } = run([httpError(502), "ok"], failedBody);
    assert.equal(await outcome, "delivered");
    assert.deepEqual(calls, [failedBody, failedBody]);
  });

  it("stops waiting when shutdown aborts the pause", async () => {
    const controller = new AbortController();
    const slowPolicy: SubmitRetryPolicy = {
      windowMs: 60_000,
      attemptTimeoutMs: 0,
      baseDelayMs: 30_000,
      maxDelayMs: 30_000,
    };
    const { calls, outcome } = run(
      [httpError(502)],
      doneBody,
      controller.signal,
      slowPolicy,
    );
    setTimeout(() => controller.abort(), 20);
    const startedAt = Date.now();
    assert.equal(await outcome, "gave_up");
    assert.equal(calls.length, 1);
    assert.ok(Date.now() - startedAt < 1_000);
  });
});
