import assert from "node:assert/strict";
import dnsPromises from "node:dns/promises";
import { afterEach, describe, it, mock } from "node:test";
import type {
  IcmpPingRunOptions,
  PingProbe,
  PingResponse,
} from "../types/icmp-ping.types";
import {
  isIcmpPingAvailable,
  parseIcmpPingPayload,
  runIcmpPing,
  toIcmpPingResult,
} from "./icmp-ping";

const BLOCK_PRIVATE: IcmpPingRunOptions = { allowPrivateTargets: false };
const ALLOW_PRIVATE: IcmpPingRunOptions = { allowPrivateTargets: true };

function response(overrides: Partial<PingResponse>): PingResponse {
  return {
    inputHost: "1.1.1.1",
    host: "1.1.1.1",
    numeric_host: "1.1.1.1",
    alive: true,
    output: "",
    time: 10,
    times: [],
    min: "10.100",
    max: "15.300",
    avg: "12.500",
    stddev: "2.000",
    packetLoss: "0.000",
    ...overrides,
  } as PingResponse;
}

function fakeProbe(result: PingResponse | Error) {
  const calls: Parameters<PingProbe>[] = [];
  const probe = (async (...args: Parameters<PingProbe>) => {
    calls.push(args);
    if (result instanceof Error) throw result;
    return result;
  }) as PingProbe;
  return { probe, calls };
}

describe("parseIcmpPingPayload", () => {
  it("fills in the timeout and packet count", () => {
    assert.deepEqual(parseIcmpPingPayload({ host: "1.1.1.1" }), {
      host: "1.1.1.1",
      timeoutMs: 10_000,
      packets: 3,
    });
  });

  it("keeps values sent by the backend", () => {
    assert.deepEqual(
      parseIcmpPingPayload({ host: "a.com", timeoutMs: 5_000, packets: 3 }),
      { host: "a.com", timeoutMs: 5_000, packets: 3 },
    );
  });

  it("rejects an empty host", () => {
    assert.throws(() => parseIcmpPingPayload({ host: "" }), /host is missing/);
    assert.throws(() => parseIcmpPingPayload({}), /host is missing/);
  });
});

describe("toIcmpPingResult", () => {
  it("reads counts from the iputils summary and loss as a number", () => {
    const result = toIcmpPingResult(
      "1.1.1.1",
      response({
        output:
          "3 packets transmitted, 2 received, 33.3333% packet loss, time 2003ms",
        packetLoss: "33.333" as unknown as number,
      }),
      3,
    );
    assert.deepEqual(result, {
      ip: "1.1.1.1",
      packetsSent: 3,
      packetsReceived: 2,
      packetLoss: 33.333,
      rttMinMs: 10.1,
      rttAvgMs: 12.5,
      rttMaxMs: 15.3,
    });
  });

  it("reports a dead host as zero replies without RTT", () => {
    const result = toIcmpPingResult(
      "1.1.1.1",
      response({
        alive: false,
        output: "3 packets transmitted, 0 received, 100% packet loss",
        packetLoss: "100.000" as unknown as number,
        min: "unknown",
        avg: "unknown",
        max: "unknown",
      }),
      3,
    );
    assert.deepEqual(result, {
      ip: "1.1.1.1",
      packetsSent: 3,
      packetsReceived: 0,
      packetLoss: 100,
    });
  });

  it("falls back to alive when the summary and loss are unknown", () => {
    const result = toIcmpPingResult(
      "1.1.1.1",
      response({
        output: "",
        packetLoss: "unknown" as unknown as number,
      }),
      3,
    );
    assert.equal(result.packetsSent, 3);
    assert.equal(result.packetsReceived, 1);
    assert.ok(Math.abs(result.packetLoss - 66.667) < 0.01);
  });
});

describe("runIcmpPing", () => {
  it("sends exactly the packet count and fits the reply wait into the timeout", async () => {
    const { probe, calls } = fakeProbe(
      response({ output: "3 packets transmitted, 3 received, 0% packet loss" }),
    );
    const result = await runIcmpPing(
      { host: "1.1.1.1", timeoutMs: 4_500, packets: 3 },
      BLOCK_PRIVATE,
      probe,
    );
    assert.equal((result as { packetsReceived: number }).packetsReceived, 3);
    assert.deepEqual(calls[0], [
      "1.1.1.1",
      { min_reply: 3, timeout: 3, numeric: true },
    ]);
  });

  it("fails when the ping binary cannot be started", async () => {
    const { probe } = fakeProbe(new Error("spawn ping ENOENT"));
    await assert.rejects(
      runIcmpPing(
        { host: "1.1.1.1", timeoutMs: 10_000, packets: 3 },
        BLOCK_PRIVATE,
        probe,
      ),
      /ENOENT/,
    );
  });

  it("fails instead of reporting down when ping cannot run", async () => {
    const { probe } = fakeProbe(
      response({
        alive: false,
        output: "ping: socket: Operation not permitted",
      }),
    );
    await assert.rejects(
      runIcmpPing(
        { host: "1.1.1.1", timeoutMs: 10_000, packets: 3 },
        BLOCK_PRIVATE,
        probe,
      ),
      /ping exec failed/,
    );
  });
});

describe("runIcmpPing private targets", () => {
  afterEach(() => mock.restoreAll());

  for (const host of ["127.0.0.1", "10.0.0.1", "::1"]) {
    it(`blocks ${host} before sending packets`, async () => {
      const { probe, calls } = fakeProbe(response({}));
      const result = await runIcmpPing(
        { host, timeoutMs: 10_000, packets: 3 },
        BLOCK_PRIVATE,
        probe,
      );
      assert.deepEqual(result, { error: "Private address is not allowed" });
      assert.equal(calls.length, 0);
    });
  }

  it("blocks a name that resolves to a private address", async () => {
    mock.method(dnsPromises, "resolve4", async () => ["192.168.1.10"]);
    const { probe, calls } = fakeProbe(response({}));
    const result = await runIcmpPing(
      { host: "router.example.com", timeoutMs: 10_000, packets: 3 },
      BLOCK_PRIVATE,
      probe,
    );
    assert.deepEqual(result, { error: "Private address is not allowed" });
    assert.equal(calls.length, 0);
  });

  it("pings private addresses when the node allows private targets", async () => {
    mock.method(dnsPromises, "resolve4", async () => ["192.168.1.10"]);
    const { probe, calls } = fakeProbe(
      response({ output: "3 packets transmitted, 3 received, 0% packet loss" }),
    );
    await runIcmpPing(
      { host: "10.0.0.1", timeoutMs: 10_000, packets: 3 },
      ALLOW_PRIVATE,
      probe,
    );
    const result = await runIcmpPing(
      { host: "router.example.com", timeoutMs: 10_000, packets: 3 },
      ALLOW_PRIVATE,
      probe,
    );
    assert.equal((result as { ip: string }).ip, "192.168.1.10");
    assert.deepEqual(
      calls.map(([target]) => target),
      ["10.0.0.1", "192.168.1.10"],
    );
  });
});

describe("isIcmpPingAvailable", () => {
  it("is true when loopback answers", async () => {
    const { probe } = fakeProbe(
      response({ output: "1 packets transmitted, 1 received" }),
    );
    assert.equal(await isIcmpPingAvailable(probe), true);
  });

  it("is false when ping is not permitted", async () => {
    const { probe } = fakeProbe(
      response({
        alive: false,
        output: "ping: socket: Operation not permitted",
      }),
    );
    assert.equal(await isIcmpPingAvailable(probe), false);
  });

  it("is false when the ping binary is missing", async () => {
    const { probe } = fakeProbe(new Error("spawn ping ENOENT"));
    assert.equal(await isIcmpPingAvailable(probe), false);
  });
});

describe("runIcmpPing name resolution", () => {
  afterEach(() => mock.restoreAll());

  function failResolve(code: string): void {
    mock.method(dnsPromises, "resolve4", async () => {
      throw Object.assign(new Error(`queryA ${code} example.com`), { code });
    });
  }

  for (const code of ["ENOTFOUND", "ENODATA"]) {
    it(`reports ${code} as a target error`, async () => {
      failResolve(code);
      const { probe, calls } = fakeProbe(response({}));
      const result = await runIcmpPing(
        { host: "example.com", timeoutMs: 10_000, packets: 3 },
        BLOCK_PRIVATE,
        probe,
      );
      assert.deepEqual(result, {
        error: "Cannot resolve example.com to an IPv4 address",
      });
      assert.equal(calls.length, 0);
    });
  }

  for (const code of ["ETIMEOUT", "ESERVFAIL", "ECONNREFUSED", "EAI_AGAIN"]) {
    it(`fails on the node's own DNS error ${code}`, async () => {
      failResolve(code);
      const { probe, calls } = fakeProbe(response({}));
      await assert.rejects(
        runIcmpPing(
          { host: "example.com", timeoutMs: 10_000, packets: 3 },
          BLOCK_PRIVATE,
          probe,
        ),
        (error: Error) =>
          error.message === "Cannot resolve example.com to an IPv4 address" &&
          (error.cause as NodeJS.ErrnoException).code === code,
      );
      assert.equal(calls.length, 0);
    });
  }

  it("pings the resolved address", async () => {
    mock.method(dnsPromises, "resolve4", async () => ["93.184.216.34"]);
    const { probe, calls } = fakeProbe(
      response({ output: "3 packets transmitted, 3 received, 0% packet loss" }),
    );
    const result = await runIcmpPing(
      { host: "example.com", timeoutMs: 10_000, packets: 3 },
      BLOCK_PRIVATE,
      probe,
    );
    assert.equal((result as { ip: string }).ip, "93.184.216.34");
    assert.equal(calls[0]?.[0], "93.184.216.34");
  });
});
