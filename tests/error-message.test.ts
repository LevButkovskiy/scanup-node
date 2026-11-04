import { test } from "node:test";
import assert from "node:assert/strict";
import { errorMessage } from "../src/lib/error-message.ts";

function connectError(message: string, code: string): Error {
  return Object.assign(new Error(message), { code });
}

function undiciFetchFailed(attempts: Error[]): TypeError {
  return new TypeError("fetch failed", {
    cause: new AggregateError(attempts, ""),
  });
}

test("joins every attempt of an AggregateError cause", () => {
  const error = undiciFetchFailed([
    connectError("connect ETIMEDOUT 142.250.74.46:443", "ETIMEDOUT"),
    connectError(
      "connect ENETUNREACH [2a00:1450:4010:c0e::64]:443",
      "ENETUNREACH",
    ),
  ]);
  assert.equal(
    errorMessage(error),
    "fetch failed: connect ETIMEDOUT 142.250.74.46:443; connect ENETUNREACH [2a00:1450:4010:c0e::64]:443",
  );
});

test("falls back to code for nested errors without message", () => {
  const error = undiciFetchFailed([
    connectError("", "ETIMEDOUT"),
    connectError("connect ENETUNREACH ::1:443", "ENETUNREACH"),
  ]);
  assert.equal(
    errorMessage(error),
    "fetch failed: ETIMEDOUT; connect ENETUNREACH ::1:443",
  );
});

test("never ends with a colon when nothing has text", () => {
  assert.equal(
    errorMessage(undiciFetchFailed([new Error("")])),
    "fetch failed",
  );
  assert.equal(errorMessage(undiciFetchFailed([])), "fetch failed");
});

test("cause with errors array that is not an AggregateError", () => {
  const error = new Error("boom", {
    cause: { errors: [new Error("a"), new Error("b")] },
  });
  assert.equal(errorMessage(error), "boom: a; b");
});

test("AggregateError itself with empty message", () => {
  const error = new AggregateError(
    [new Error("first"), new Error("second")],
    "",
  );
  assert.equal(errorMessage(error), "first; second");
});

test("empty AggregateError without anything falls back to name", () => {
  assert.equal(errorMessage(new AggregateError([], "")), "AggregateError");
});

test("plain cause", () => {
  const error = new Error("outer", { cause: new Error("inner") });
  assert.equal(errorMessage(error), "outer: inner");
});

test("plain cause with empty message does not leave a colon", () => {
  const error = new Error("outer", { cause: new Error("") });
  assert.equal(errorMessage(error), "outer");
});

test("error without cause", () => {
  assert.equal(errorMessage(new Error("plain")), "plain");
});

test("TimeoutError", () => {
  assert.equal(
    errorMessage(new DOMException("t", "TimeoutError")),
    "Request timed out",
  );
});

test("non-Error values", () => {
  assert.equal(errorMessage("text"), "text");
  assert.equal(errorMessage(42), "42");
  assert.equal(errorMessage(undefined), "undefined");
});

test("real fetch to a closed dual-stack port", async (t) => {
  let caught: unknown;
  try {
    await fetch("http://localhost:8/", { signal: AbortSignal.timeout(3000) });
  } catch (error) {
    caught = error;
  }
  const message = errorMessage(caught);
  t.diagnostic(message);
  assert.ok(message.startsWith("fetch failed: connect ECONNREFUSED"));
  assert.ok(!message.endsWith(": "));
  assert.ok(!message.endsWith(":"));
});
