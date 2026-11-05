import os from "node:os";
import { createCgroupReader } from "./cgroup";
import type {
  CgroupReader,
  CpuMetrics,
  CpuStatSample,
  LoadAverageMetrics,
  MemoryMetrics,
  SystemMetrics,
} from "../types/node-metrics.types";

const MICROSECONDS_PER_MILLISECOND = 1000;

export interface HostCpuTimes {
  busy: number;
  total: number;
}

export interface SystemProbe {
  availableParallelism(): number;
  cpuCount(): number;
  loadAverage(): number;
  totalMemory(): number;
  freeMemory(): number;
  hostCpuTimes(): HostCpuTimes;
  processRss(): number;
  now(): number;
}

export const nodeSystemProbe: SystemProbe = {
  availableParallelism: () => os.availableParallelism(),
  cpuCount: () => os.cpus().length,
  loadAverage: () => os.loadavg()[0] ?? 0,
  totalMemory: () => os.totalmem(),
  freeMemory: () => os.freemem(),
  hostCpuTimes: () => {
    let busy = 0;
    let total = 0;
    for (const { times } of os.cpus()) {
      const all = times.user + times.nice + times.sys + times.idle + times.irq;
      total += all;
      busy += all - times.idle;
    }
    return { busy, total };
  },
  processRss: () => process.memoryUsage.rss(),
  now: () => Date.now(),
};

function clampShare(value: number): number {
  if (!Number.isFinite(value) || value < 0) return 0;
  return Math.min(value, 1);
}

export class SystemSampler {
  private lastCgroupCpu: CpuStatSample | null;
  private lastHostCpu: HostCpuTimes;
  private lastSampleAt: number;

  constructor(
    private readonly cgroup: CgroupReader = createCgroupReader(),
    private readonly probe: SystemProbe = nodeSystemProbe,
  ) {
    this.lastCgroupCpu = cgroup.readCpuStat();
    this.lastHostCpu = probe.hostCpuTimes();
    this.lastSampleAt = probe.now();
  }

  sample(): SystemMetrics {
    const now = this.probe.now();
    const elapsedMs = Math.max(now - this.lastSampleAt, 1);
    const cpu = this.sampleCpu(elapsedMs);
    this.lastSampleAt = now;
    return {
      cpu,
      memory: this.sampleMemory(),
      loadAverage: this.sampleLoadAverage(),
    };
  }

  private sampleCpu(elapsedMs: number): CpuMetrics {
    const current = this.cgroup.readCpuStat();
    const previous = this.lastCgroupCpu;
    this.lastCgroupCpu = current;
    const hostCpu = this.probe.hostCpuTimes();
    const previousHost = this.lastHostCpu;
    this.lastHostCpu = hostCpu;

    if (current && previous) {
      const cores =
        this.cgroup.readCpuMax() ?? this.probe.availableParallelism();
      const usedMs =
        (current.usageUsec - previous.usageUsec) / MICROSECONDS_PER_MILLISECOND;
      return {
        scope: "container",
        usage: clampShare(usedMs / (elapsedMs * cores)),
        cores,
        throttledPeriods:
          current.throttledPeriods !== null &&
          previous.throttledPeriods !== null
            ? Math.max(current.throttledPeriods - previous.throttledPeriods, 0)
            : null,
      };
    }

    const totalDelta = hostCpu.total - previousHost.total;
    return {
      scope: "host",
      usage:
        totalDelta > 0
          ? clampShare((hostCpu.busy - previousHost.busy) / totalDelta)
          : 0,
      cores: this.probe.cpuCount(),
      throttledPeriods: null,
    };
  }

  private sampleMemory(): MemoryMetrics {
    const processRssBytes = this.probe.processRss();
    const current = this.cgroup.readMemoryCurrent();
    if (current !== null) {
      return {
        scope: "container",
        usedBytes: Math.max(current - (this.cgroup.readInactiveFile() ?? 0), 0),
        limitBytes: this.cgroup.readMemoryMax(),
        processRssBytes,
      };
    }
    const total = this.probe.totalMemory();
    return {
      scope: "host",
      usedBytes: total - this.probe.freeMemory(),
      limitBytes: total,
      processRssBytes,
    };
  }

  private sampleLoadAverage(): LoadAverageMetrics {
    return {
      scope: "host",
      oneMinute: this.probe.loadAverage(),
      cores: this.probe.cpuCount(),
    };
  }
}
