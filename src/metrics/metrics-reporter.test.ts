import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ApiResponseError, NodeTokenRejectedError } from "../api-client";
import { MetricsReporter } from "./metrics-reporter";
import type { NodeMetricsBody } from "../types/node-metrics.types";
import { WorkerLoadTracker } from "./worker-load-tracker";

const sampler = {
  sample: () => ({
    cpu: { scope: "host" as const, usage: 0, cores: 1, throttledPeriods: null },
    memory: {
      scope: "host" as const,
      usedBytes: 1,
      limitBytes: 2,
      processRssBytes: 1,
    },
    loadAverage: { scope: "host" as const, oneMinute: 0, cores: 1 },
  }),
};

function reporterWith(sendMetrics: (body: NodeMetricsBody) => Promise<void>) {
  const state = { rejected: 0 };
  const reporter = new MetricsReporter({
    api: { sendMetrics },
    tracker: new WorkerLoadTracker(2),
    sampler,
    onTokenRejected: () => {
      state.rejected += 1;
    },
  });
  return { reporter, state };
}

describe("MetricsReporter", () => {
  it("sends worker and system metrics in one body", async () => {
    const sent: NodeMetricsBody[] = [];
    const { reporter } = reporterWith(async (body) => {
      sent.push(body);
    });
    await reporter.report();
    assert.equal(sent.length, 1);
    assert.equal(sent[0]?.concurrency, 2);
    assert.equal(sent[0]?.cpu.scope, "host");
  });

  it("swallows a 404 from an old backend", async () => {
    let calls = 0;
    const { reporter, state } = reporterWith(async () => {
      calls += 1;
      throw new ApiResponseError("POST /nodes/metrics failed: HTTP 404", 404);
    });
    await reporter.report();
    await reporter.report();
    assert.equal(calls, 2);
    assert.equal(state.rejected, 0);
  });

  it("swallows network errors", async () => {
    const { reporter } = reporterWith(async () => {
      throw new TypeError("fetch failed");
    });
    await reporter.report();
  });

  it("stops the node when the token is rejected", async () => {
    const { reporter, state } = reporterWith(async () => {
      throw new NodeTokenRejectedError();
    });
    await reporter.report();
    assert.equal(state.rejected, 1);
  });

  it("logs each kind of failure once and a 404 does not hide a later network error", async () => {
    const outcomes: Error[] = [
      new ApiResponseError("HTTP 404", 404),
      new ApiResponseError("HTTP 404", 404),
      new TypeError("fetch failed"),
      new TypeError("fetch failed"),
    ];
    const { reporter } = reporterWith(async () => {
      throw outcomes.shift();
    });
    const lines: string[] = [];
    const original = console.log;
    console.log = (line: string) => lines.push(line);
    try {
      for (let i = 0; i < 4; i += 1) await reporter.report();
    } finally {
      console.log = original;
    }
    assert.equal(lines.length, 2);
    assert.match(lines[0] ?? "", /not accepted/);
    assert.match(lines[1] ?? "", /report failed/);
  });
});
