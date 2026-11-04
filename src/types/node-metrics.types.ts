export type MetricsScope = "container" | "host";

export interface CpuMetrics {
  scope: MetricsScope;
  usage: number;
  cores: number;
  throttledPeriods: number | null;
}

export interface MemoryMetrics {
  scope: MetricsScope;
  usedBytes: number;
  limitBytes: number | null;
  processRssBytes: number;
}

export interface LoadAverageMetrics {
  scope: "host";
  oneMinute: number;
  cores: number;
}

export interface SystemMetrics {
  cpu: CpuMetrics;
  memory: MemoryMetrics;
  loadAverage: LoadAverageMetrics;
}

export interface WorkerMetrics {
  intervalMs: number;
  concurrency: number;
  activeJobs: number;
  slotUtilization: number;
  idlePolls: number;
  jobsDone: number;
  jobsFailed: number;
  submitThrottled: number;
  submitGaveUp: number;
}

export interface NodeMetricsBody extends WorkerMetrics, SystemMetrics {}

export interface CpuStatSample {
  usageUsec: number;
  throttledPeriods: number | null;
}

export interface CgroupReader {
  readCpuStat(): CpuStatSample | null;
  readCpuMax(): number | null;
  readMemoryCurrent(): number | null;
  readInactiveFile(): number | null;
  readMemoryMax(): number | null;
}
