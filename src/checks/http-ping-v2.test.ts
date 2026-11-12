import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import dns from "node:dns";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { errorMessage } from "../lib/error-message";
import { runHttpPing, runHttpPingV2 } from "./http-ping";

const originalLookup = dns.lookup;
const local = { allowPrivateTargets: true };
const strict = { allowPrivateTargets: false };

afterEach(() => {
  dns.lookup = originalLookup;
});

function failDnsWith(code: string): void {
  dns.lookup = ((host: string, _options: unknown, cb: Function) => {
    const error: NodeJS.ErrnoException = new Error(
      `getaddrinfo ${code} ${host}`,
    );
    error.code = code;
    cb(error);
  }) as unknown as typeof dns.lookup;
}

function listen(
  handler: http.RequestListener,
): Promise<{ server: http.Server; port: number }> {
  return new Promise((resolve) => {
    const server = http.createServer(handler);
    server.listen(0, "127.0.0.1", () =>
      resolve({ server, port: (server.address() as AddressInfo).port }),
    );
  });
}

async function closedPort(): Promise<number> {
  const { server, port } = await listen(() => {});
  await new Promise((resolve) => server.close(resolve));
  return port;
}

test("http_ping v2 reports a refused connection as a site error", async () => {
  const port = await closedPort();
  const result = await runHttpPingV2(
    { url: `http://127.0.0.1:${port}/`, timeoutMs: 3000 },
    local,
  );
  assert.equal(result.statusCode, null);
  assert.equal(result.error?.kind, "refused");
  assert.match(result.error?.message ?? "", /ECONNREFUSED/);
});

test("http_ping v2 reports a timeout as a site error", async () => {
  const { server, port } = await listen(() => {});
  try {
    const result = await runHttpPingV2(
      { url: `http://127.0.0.1:${port}/`, timeoutMs: 300 },
      local,
    );
    assert.equal(result.error?.kind, "timeout");
    assert.equal(result.error?.message, "Request timed out");
  } finally {
    server.closeAllConnections();
    server.close();
  }
});

test("http_ping v2 reports endless redirects as a site error", async () => {
  const { server, port } = await listen((_req, res) =>
    res.writeHead(302, { location: "/again" }).end(),
  );
  try {
    const result = await runHttpPingV2(
      { url: `http://127.0.0.1:${port}/`, timeoutMs: 3000 },
      local,
    );
    assert.equal(result.error?.kind, "redirects");
    assert.equal(result.error?.message, "Too many redirects");
  } finally {
    server.close();
  }
});

test("http_ping v2 reports a private target as a blocked site", async () => {
  const result = await runHttpPingV2(
    { url: "http://127.0.0.1:59999/", timeoutMs: 3000 },
    strict,
  );
  assert.equal(result.error?.kind, "blocked");
});

test("http_ping v2 reports a missing name as a site error", async () => {
  failDnsWith("ENOTFOUND");
  const result = await runHttpPingV2(
    { url: "http://missing.example.com/", timeoutMs: 3000 },
    strict,
  );
  assert.equal(result.error?.kind, "dns");
  assert.equal(result.error?.code, "ENOTFOUND");
});

test("http_ping v2 throws when the resolver of the node fails", async () => {
  failDnsWith("EAI_AGAIN");
  await assert.rejects(
    runHttpPingV2({ url: "http://example.com/", timeoutMs: 3000 }, strict),
    (error: unknown) => /EAI_AGAIN/.test(errorMessage(error)),
  );
});

test("http_ping v2 returns the status code of an answering site", async () => {
  const { server, port } = await listen((_req, res) =>
    res.writeHead(503).end(),
  );
  try {
    const result = await runHttpPingV2(
      { url: `http://127.0.0.1:${port}/`, timeoutMs: 3000 },
      local,
    );
    assert.equal(result.statusCode, 503);
    assert.equal(result.error, undefined);
  } finally {
    server.close();
  }
});

test("http_ping v1 still throws on a refused connection", async () => {
  const port = await closedPort();
  await assert.rejects(
    runHttpPing({ url: `http://127.0.0.1:${port}/`, timeoutMs: 3000 }, local),
    (error: unknown) => /ECONNREFUSED/.test(errorMessage(error)),
  );
});

test("http_ping v1 still throws on a missing name", async () => {
  failDnsWith("ENOTFOUND");
  await assert.rejects(
    runHttpPing(
      { url: "http://missing.example.com/", timeoutMs: 3000 },
      strict,
    ),
    (error: unknown) => /ENOTFOUND/.test(errorMessage(error)),
  );
});
