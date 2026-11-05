import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { SystemSampler, type SystemProbe } from "./system-sampler";
import type { CgroupReader } from "../types/node-metrics.types";

function probe(overrides: Partial<SystemProbe> = {}): SystemProbe & {
  advance(ms: number): void;
} {
  let current = 0;
  return {
    availableParallelism: () => 4,
    cpuCount: () => 16,
    loadAverage: () => 2.5,
    totalMemory: () => 1000,
    freeMemory: () => 400,
    hostCpuTimes: () => ({ busy: 0, total: 0 }),
    processRss: () => 50,
    now: () => current,
    advance: (ms) => {
      current += ms;
    },
    ...overrides,
  };
}

function cgroup(overrides: Partial<CgroupReader> = {}): CgroupReader {
  return {
    readCpuStat: () => null,
    readCpuMax: () => null,
    readMemoryCurrent: () => null,
    readMemoryMax: () => null,
    readInactiveFile: () => null,
    ...overrides,
  };
}

describe("SystemSampler", () => {
  it("uses cgroup counters and quota when available", () => {
    let usageUsec = 0;
    let throttled = 0;
    const system = probe();
    const sampler = new SystemSampler(
      cgroup({
        readCpuStat: () => ({ usageUsec, throttledPeriods: throttled }),
        readCpuMax: () => 2,
        readMemoryCurrent: () => 100,
        readMemoryMax: () => 400,
        readInactiveFile: () => 30,
      }),
      system,
    );
    system.advance(10_000);
    usageUsec = 10_000_000;
    throttled = 5;

    const metrics = sampler.sample();
    assert.deepEqual(metrics.cpu, {
      scope: "container",
      usage: 0.5,
      cores: 2,
      throttledPeriods: 5,
    });
    assert.deepEqual(metrics.memory, {
      scope: "container",
      usedBytes: 70,
      limitBytes: 400,
      processRssBytes: 50,
    });
    assert.deepEqual(metrics.loadAverage, {
      scope: "host",
      oneMinute: 2.5,
      cores: 16,
    });
  });

  it("falls back to host figures when cgroup is not readable", () => {
    let times = { busy: 0, total: 0 };
    const system = probe({ hostCpuTimes: () => times });
    const sampler = new SystemSampler(cgroup(), system);
    system.advance(1_000);
    times = { busy: 25, total: 100 };

    const metrics = sampler.sample();
    assert.equal(metrics.cpu.scope, "host");
    assert.equal(metrics.cpu.usage, 0.25);
    assert.equal(metrics.cpu.throttledPeriods, null);
    assert.deepEqual(metrics.memory, {
      scope: "host",
      usedBytes: 600,
      limitBytes: 1000,
      processRssBytes: 50,
    });
  });

  it("never reports negative memory when inactive file exceeds usage", () => {
    const sampler = new SystemSampler(
      cgroup({ readMemoryCurrent: () => 10, readInactiveFile: () => 50 }),
      probe(),
    );
    assert.equal(sampler.sample().memory.usedBytes, 0);
  });

  it("reports unknown throttling when nr_throttled is absent", () => {
    let usageUsec = 0;
    const system = probe();
    const sampler = new SystemSampler(
      cgroup({
        readCpuStat: () => ({ usageUsec, throttledPeriods: null }),
      }),
      system,
    );
    system.advance(1_000);
    usageUsec = 500_000;
    assert.equal(sampler.sample().cpu.throttledPeriods, null);
  });

  it("uses available parallelism when the container has no CPU quota", () => {
    let usageUsec = 0;
    const system = probe();
    const sampler = new SystemSampler(
      cgroup({ readCpuStat: () => ({ usageUsec, throttledPeriods: 0 }) }),
      system,
    );
    system.advance(1_000);
    usageUsec = 1_000_000;

    assert.equal(sampler.sample().cpu.cores, 4);
    assert.equal(sampler.sample().cpu.usage, 0);
  });
});
