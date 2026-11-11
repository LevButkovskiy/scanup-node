import { test } from "node:test";
import assert from "node:assert/strict";
import { errorKind, isNodeSideError } from "./network-error";

function coded(code: string): NodeJS.ErrnoException {
  const error: NodeJS.ErrnoException = new Error(code);
  error.code = code;
  return error;
}

function fetchFailed(cause: unknown): Error {
  return new TypeError("fetch failed", { cause });
}

for (const code of ["ENETUNREACH", "EAI_AGAIN", "EMFILE", "EADDRNOTAVAIL"]) {
  test(`${code} is a failure of the node`, () => {
    assert.equal(isNodeSideError(fetchFailed(coded(code))), true);
  });
}

for (const code of [
  "ECONNREFUSED",
  "ECONNRESET",
  "EHOSTUNREACH",
  "ENOTFOUND",
  "UND_ERR_CONNECT_TIMEOUT",
  "EBLOCKED",
]) {
  test(`${code} is a failure of the site`, () => {
    assert.equal(isNodeSideError(fetchFailed(coded(code))), false);
  });
}

test("a timeout is a failure of the site", () => {
  assert.equal(
    isNodeSideError(new DOMException("timed out", "TimeoutError")),
    false,
  );
});

test("no IPv6 route plus a refused IPv4 is a failure of the site", () => {
  const aggregate = new AggregateError([
    coded("ENETUNREACH"),
    coded("ECONNREFUSED"),
  ]);
  assert.equal(isNodeSideError(fetchFailed(aggregate)), false);
});

test("no route on every address is a failure of the node", () => {
  const aggregate = Object.assign(
    new AggregateError([coded("ENETUNREACH"), coded("ENETUNREACH")]),
    { code: "ENETUNREACH" },
  );
  assert.equal(isNodeSideError(fetchFailed(aggregate)), true);
});

test("TLS codes are classified as tls", () => {
  assert.equal(errorKind(coded("x"), "ERR_TLS_CERT_ALTNAME_INVALID"), "tls");
  assert.equal(errorKind(coded("x"), "CERT_HAS_EXPIRED"), "tls");
});
