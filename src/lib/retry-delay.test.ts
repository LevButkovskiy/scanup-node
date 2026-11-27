import { test } from "node:test";
import assert from "node:assert/strict";
import { ApiResponseError } from "../api-client";
import { retryDelayMs } from "./retry-delay";

test("waits for Retry-After when it is longer than the backoff", () => {
  const error = new ApiResponseError("HTTP 429", 429, 45_000);
  assert.equal(retryDelayMs(error, 10_000), 45_000);
});

test("keeps the backoff when Retry-After is shorter", () => {
  const error = new ApiResponseError("HTTP 429", 429, 2_000);
  assert.equal(retryDelayMs(error, 10_000), 10_000);
});

test("keeps the backoff for an API error without Retry-After", () => {
  const error = new ApiResponseError("HTTP 502", 502);
  assert.equal(retryDelayMs(error, 10_000), 10_000);
});

test("keeps the backoff for a network error", () => {
  assert.equal(retryDelayMs(new TypeError("fetch failed"), 10_000), 10_000);
});
