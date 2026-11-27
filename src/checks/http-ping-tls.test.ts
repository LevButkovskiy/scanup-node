import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import http from "node:http";
import https from "node:https";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { X509Certificate } from "node:crypto";
import { runHttpPingV2 } from "./http-ping";

const fixtures = join(process.cwd(), "tests", "fixtures");
const cert = readFileSync(join(fixtures, "localhost.cert.pem"), "utf8");
const key = readFileSync(join(fixtures, "localhost.key.pem"), "utf8");

function listen(server: http.Server | https.Server): Promise<number> {
  return new Promise((resolve) =>
    server.listen(0, "127.0.0.1", () =>
      resolve((server.address() as AddressInfo).port),
    ),
  );
}

test("http_ping v2 reports the certificate of a trusted https site", async () => {
  const server = https.createServer({ cert, key }, (_req, res) =>
    res.writeHead(200).end(),
  );
  const port = await listen(server);
  try {
    const result = await runHttpPingV2(
      { url: `https://localhost:${port}/`, timeoutMs: 3000 },
      { allowPrivateTargets: true, tlsCa: cert },
    );
    const expected = new X509Certificate(cert);
    assert.equal(result.statusCode, 200);
    assert.equal(result.tls?.host, "localhost");
    assert.equal(result.tls?.validTo, new Date(expected.validTo).toISOString());
    assert.equal(result.tls?.fingerprint256, expected.fingerprint256);
  } finally {
    server.close();
  }
});

test("http_ping v2 keeps the certificate when the site answers 500", async () => {
  const server = https.createServer({ cert, key }, (_req, res) =>
    res.writeHead(500).end(),
  );
  const port = await listen(server);
  try {
    const result = await runHttpPingV2(
      { url: `https://localhost:${port}/`, timeoutMs: 3000 },
      { allowPrivateTargets: true, tlsCa: cert },
    );
    assert.equal(result.statusCode, 500);
    assert.ok(result.tls);
  } finally {
    server.close();
  }
});

test("http_ping v2 keeps the certificate when the site times out", async () => {
  const server = https.createServer({ cert, key }, () => {});
  const port = await listen(server);
  try {
    const result = await runHttpPingV2(
      { url: `https://localhost:${port}/`, timeoutMs: 500 },
      { allowPrivateTargets: true, tlsCa: cert },
    );
    assert.equal(result.statusCode, null);
    assert.ok(result.error);
    assert.ok(result.tls);
  } finally {
    server.closeAllConnections();
    server.close();
  }
});

test("http_ping v2 gives no certificate for an untrusted site", async () => {
  const server = https.createServer({ cert, key }, (_req, res) =>
    res.writeHead(200).end(),
  );
  const port = await listen(server);
  try {
    const result = await runHttpPingV2(
      { url: `https://localhost:${port}/`, timeoutMs: 3000 },
      { allowPrivateTargets: true },
    );
    assert.equal(result.statusCode, null);
    assert.equal(result.error?.kind, "tls");
    assert.equal(result.tls, undefined);
  } finally {
    server.close();
  }
});

test("http_ping v2 gives no certificate for plain http", async () => {
  const server = http.createServer((_req, res) => res.writeHead(200).end());
  const port = await listen(server);
  try {
    const result = await runHttpPingV2(
      { url: `http://127.0.0.1:${port}/`, timeoutMs: 3000 },
      { allowPrivateTargets: true },
    );
    assert.equal(result.statusCode, 200);
    assert.equal(result.tls, undefined);
  } finally {
    server.close();
  }
});
