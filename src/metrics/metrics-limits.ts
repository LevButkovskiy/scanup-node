import type { NodeMetricsBody } from "../types/node-metrics.types";

const MIN_INTERVAL_MS = 1_000;
const MAX_INTERVAL_MS = 3_600_000;
const MAX_WORKERS = 1_024;
const MAX_COUNTER = 10_000_000;
const MAX_LOAD_AVERAGE = 100_000;

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(Math.max(value, min), max);
}

function clampInt(value: number, min: number, max: number): number {
  return Math.round(clamp(value, min, max));
}

export function fitToApiLimits(body: NodeMetricsBody): NodeMetricsBody {
  const { cpu, memory, loadAverage } = body;
  return {
    intervalMs: clampInt(body.intervalMs, MIN_INTERVAL_MS, MAX_INTERVAL_MS),
    concurrency: clampInt(body.concurrency, 1, MAX_WORKERS),
    activeJobs: clampInt(body.activeJobs, 0, MAX_WORKERS),
    slotUtilization: clamp(body.slotUtilization, 0, 1),
    idlePolls: clampInt(body.idlePolls, 0, MAX_COUNTER),
    jobsDone: clampInt(body.jobsDone, 0, MAX_COUNTER),
    jobsFailed: clampInt(body.jobsFailed, 0, MAX_COUNTER),
    submitThrottled: clampInt(body.submitThrottled, 0, MAX_COUNTER),
    submitGaveUp: clampInt(body.submitGaveUp, 0, MAX_COUNTER),
    cpu: {
      scope: cpu.scope,
      usage: clamp(cpu.usage, 0, 1),
      cores: clamp(cpu.cores, 0, MAX_WORKERS),
      throttledPeriods:
        cpu.throttledPeriods === null
          ? null
          : clampInt(cpu.throttledPeriods, 0, MAX_COUNTER),
    },
    memory: {
      scope: memory.scope,
      usedBytes: clampInt(memory.usedBytes, 0, Number.MAX_SAFE_INTEGER),
      limitBytes:
        memory.limitBytes === null
          ? null
          : clampInt(memory.limitBytes, 0, Number.MAX_SAFE_INTEGER),
      processRssBytes: clampInt(
        memory.processRssBytes,
        0,
        Number.MAX_SAFE_INTEGER,
      ),
    },
    loadAverage: {
      scope: loadAverage.scope,
      oneMinute: clamp(loadAverage.oneMinute, 0, MAX_LOAD_AVERAGE),
      cores: clampInt(loadAverage.cores, 1, MAX_WORKERS),
    },
  };
}
