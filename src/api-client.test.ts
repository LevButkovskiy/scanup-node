import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, describe, it } from "node:test";
import {
  ApiClient,
  ApiResponseError,
  NodeTokenRejectedError,
} from "./api-client";
import type { NodeConfig } from "./config";

function clientFor(apiUrl: string): ApiClient {
  return new ApiClient({ apiUrl, nodeToken: "token" } as NodeConfig);
}

describe("ApiClient.submitResult", () => {
  let server: Server;
  let apiUrl: string;

  before(async () => {
    server = createServer((request, response) => {
      const status = Number(request.url?.split("/")[3]);
      if (status === 429) response.setHeader("Retry-After-node", "2");
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
