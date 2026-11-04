import type { WorkerMetrics } from "../types/node-metrics.types";

export type JobOutcome = "done" | "failed";

export class WorkerLoadTracker {
  private activeJobs = 0;
  private busyMs = 0;
  private lastChangeAt: number;
  private intervalStartedAt: number;
  private idlePolls = 0;
  private jobsDone = 0;
  private jobsFailed = 0;
  private submitThrottled = 0;
  private submitGaveUp = 0;

  constructor(
    private readonly concurrency: number,
    private readonly now: () => number = Date.now,
  ) {
    this.lastChangeAt = this.now();
    this.intervalStartedAt = this.lastChangeAt;
  }

  jobStarted(): void {
    this.accumulateBusyTime();
    this.activeJobs += 1;
  }

  jobFinished(): void {
    this.accumulateBusyTime();
    this.activeJobs = Math.max(this.activeJobs - 1, 0);
  }

  idlePoll(): void {
    this.idlePolls += 1;
  }

  delivered(outcome: JobOutcome): void {
    if (outcome === "done") this.jobsDone += 1;
    else this.jobsFailed += 1;
  }

  gaveUp(): void {
    this.submitGaveUp += 1;
  }

  throttled(): void {
    this.submitThrottled += 1;
  }

  snapshotAndReset(): WorkerMetrics {
    this.accumulateBusyTime();
    const now = this.lastChangeAt;
    const intervalMs = Math.max(now - this.intervalStartedAt, 1);
    const snapshot: WorkerMetrics = {
      intervalMs,
      concurrency: this.concurrency,
      activeJobs: this.activeJobs,
      slotUtilization: Math.min(
        this.busyMs / (this.concurrency * intervalMs),
        1,
      ),
      idlePolls: this.idlePolls,
      jobsDone: this.jobsDone,
      jobsFailed: this.jobsFailed,
      submitThrottled: this.submitThrottled,
      submitGaveUp: this.submitGaveUp,
    };
    this.busyMs = 0;
    this.idlePolls = 0;
    this.jobsDone = 0;
    this.jobsFailed = 0;
    this.submitThrottled = 0;
    this.submitGaveUp = 0;
    this.intervalStartedAt = now;
    return snapshot;
  }

  private accumulateBusyTime(): void {
    const now = this.now();
    this.busyMs += this.activeJobs * (now - this.lastChangeAt);
    this.lastChangeAt = now;
  }
}
