import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, describe, it } from "node:test";
import {
  ApiClient,
  ApiResponseError,
  NodeRevokedError,
  NodeTokenRejectedError,
} from "./api-client";
import type { NodeConfig } from "./config";

function clientFor(apiUrl: string): ApiClient {
  return new ApiClient({ apiUrl, nodeToken: "token" } as NodeConfig);
}

describe("ApiClient.submitResult", () => {
  const RETRY_AFTER_HEADERS: Record<string, Record<string, string>> = {
    "429": { "Retry-After-node": "2" },
    "429-plain": { "Retry-After": "30" },
    "429-both": { "Retry-After-node": "2", "Retry-After": "30" },
    "429-empty-node": { "Retry-After-node": "", "Retry-After": "30" },
  };
  let server: Server;
  let apiUrl: string;

  before(async () => {
    server = createServer((request, response) => {
      const jobId = request.url?.split("/")[3] ?? "";
      const status = Number(jobId.split("-")[0]);
      for (const [name, value] of Object.entries(
        RETRY_AFTER_HEADERS[jobId] ?? {},
      )) {
        response.setHeader(name, value);
      }
      response.statusCode = status;
      response.end("{}");
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    apiUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  after(() => {
    server.close();
  });

  it("throws ApiResponseError with the status on 502", async () => {
    await assert.rejects(
      clientFor(apiUrl).submitResult("502", { status: "done" }),
      (error: unknown) =>
        error instanceof ApiResponseError &&
        error.status === 502 &&
        error.retryAfterMs === undefined,
    );
  });

  it("throws NodeTokenRejectedError on 401", async () => {
    await assert.rejects(
      clientFor(apiUrl).submitResult("401", { status: "done" }),
      NodeTokenRejectedError,
    );
  });

  it("exposes Retry-After-node as retryAfterMs on 429", async () => {
    await assert.rejects(
      clientFor(apiUrl).submitResult("429", { status: "done" }),
      (error: unknown) =>
        error instanceof ApiResponseError &&
        error.status === 429 &&
        error.retryAfterMs === 2000,
    );
  });

  it("falls back to Retry-After on 429 without Retry-After-node", async () => {
    await assert.rejects(
      clientFor(apiUrl).submitResult("429-plain", { status: "done" }),
      (error: unknown) =>
        error instanceof ApiResponseError &&
        error.status === 429 &&
        error.retryAfterMs === 30_000,
    );
  });

  it("prefers Retry-After-node over Retry-After on 429", async () => {
    await assert.rejects(
      clientFor(apiUrl).submitResult("429-both", { status: "done" }),
      (error: unknown) =>
        error instanceof ApiResponseError && error.retryAfterMs === 2000,
    );
  });

  it("falls back to Retry-After when Retry-After-node is empty", async () => {
    await assert.rejects(
      clientFor(apiUrl).submitResult("429-empty-node", { status: "done" }),
      (error: unknown) =>
        error instanceof ApiResponseError && error.retryAfterMs === 30_000,
    );
  });

  it("does not throw ApiResponseError when the server is unreachable", async () => {
    const unusedPort = await new Promise<number>((resolve) => {
      const probe = createServer().listen(0, "127.0.0.1", () => {
        const { port } = probe.address() as AddressInfo;
        probe.close(() => resolve(port));
      });
    });
    await assert.rejects(
      clientFor(`http://127.0.0.1:${unusedPort}`).submitResult("1", {
        status: "done",
      }),
      (error: unknown) =>
        error instanceof Error && !(error instanceof ApiResponseError),
    );
  });
});

describe("ApiClient on 401", () => {
  const BODIES: Record<string, string> = {
    "/revoked/nodes/heartbeat": JSON.stringify({
      statusCode: 401,
      code: "NODE_REVOKED",
      message: "x",
    }),
    "/unknown/nodes/heartbeat": JSON.stringify({
      statusCode: 401,
      code: "UNAUTHORIZED",
      message: "x",
    }),
    "/proxy/nodes/heartbeat": "<html>401</html>",
  };
  let server: Server;
  let apiUrl: string;

  before(async () => {
    server = createServer((request, response) => {
      response.statusCode = 401;
      response.end(BODIES[request.url ?? ""] ?? "");
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    apiUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  after(() => {
    server.close();
  });

  const heartbeat = (prefix: string): Promise<void> =>
    clientFor(`${apiUrl}/${prefix}`).heartbeat({
      version: "1.10.0",
      capabilities: [],
    });

  it("throws NodeRevokedError on NODE_REVOKED, still a rejected token", async () => {
    await assert.rejects(
      heartbeat("revoked"),
      (error: unknown) =>
        error instanceof NodeRevokedError &&
        error instanceof NodeTokenRejectedError,
    );
  });

  it("throws a plain NodeTokenRejectedError on UNAUTHORIZED", async () => {
    await assert.rejects(
      heartbeat("unknown"),
      (error: unknown) =>
        error instanceof NodeTokenRejectedError &&
        !(error instanceof NodeRevokedError),
    );
  });

  it("throws a plain NodeTokenRejectedError on a non-JSON body", async () => {
    await assert.rejects(
      heartbeat("proxy"),
      (error: unknown) =>
        error instanceof NodeTokenRejectedError &&
        !(error instanceof NodeRevokedError),
    );
  });
});
