import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { fitToApiLimits } from "./metrics-limits";
import type { NodeMetricsBody } from "../types/node-metrics.types";

const body: NodeMetricsBody = {
  intervalMs: 500,
  concurrency: 5_000,
  activeJobs: 2,
  slotUtilization: 1.0000001,
  idlePolls: 3,
  jobsDone: 40_000_000,
  jobsFailed: 0,
  submitThrottled: 0,
  submitGaveUp: 0,
  cpu: { scope: "host", usage: 1.4, cores: 4, throttledPeriods: null },
  memory: {
    scope: "host",
    usedBytes: 10,
    limitBytes: null,
    processRssBytes: 5,
  },
  loadAverage: { scope: "host", oneMinute: 1, cores: 0 },
};

describe("fitToApiLimits", () => {
  it("brings out-of-range values inside the bounds the backend accepts", () => {
    const fitted = fitToApiLimits(body);
    assert.equal(fitted.intervalMs, 1_000);
    assert.equal(fitted.concurrency, 1_024);
    assert.equal(fitted.slotUtilization, 1);
    assert.equal(fitted.jobsDone, 10_000_000);
    assert.equal(fitted.cpu.usage, 1);
    assert.equal(fitted.loadAverage.cores, 1);
  });

  it("keeps nulls and in-range values untouched", () => {
    const fitted = fitToApiLimits(body);
    assert.equal(fitted.cpu.throttledPeriods, null);
    assert.equal(fitted.memory.limitBytes, null);
    assert.equal(fitted.activeJobs, 2);
    assert.equal(fitted.memory.usedBytes, 10);
  });

  it("replaces NaN with the lower bound", () => {
    const fitted = fitToApiLimits({ ...body, idlePolls: Number.NaN });
    assert.equal(fitted.idlePolls, 0);
  });
});
