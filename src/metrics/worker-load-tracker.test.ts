import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { WorkerLoadTracker } from "./worker-load-tracker";

function clock(start = 0) {
  let current = start;
  return {
    now: () => current,
    advance: (ms: number) => {
      current += ms;
    },
  };
}

describe("WorkerLoadTracker", () => {
  it("computes slot utilization from busy time of all workers", () => {
    const time = clock();
    const tracker = new WorkerLoadTracker(4, time.now);
    tracker.jobStarted();
    tracker.jobStarted();
    time.advance(5_000);
    tracker.jobFinished();
    time.advance(5_000);
    tracker.jobFinished();

    const snapshot = tracker.snapshotAndReset();
    assert.equal(snapshot.intervalMs, 10_000);
    assert.equal(snapshot.slotUtilization, 15_000 / 40_000);
    assert.equal(snapshot.activeJobs, 0);
    assert.equal(snapshot.concurrency, 4);
  });

  it("counts a job that spans the interval boundary in both intervals", () => {
    const time = clock();
    const tracker = new WorkerLoadTracker(1, time.now);
    tracker.jobStarted();
    time.advance(1_000);
    const first = tracker.snapshotAndReset();
    time.advance(1_000);
    const second = tracker.snapshotAndReset();

    assert.equal(first.slotUtilization, 1);
    assert.equal(first.activeJobs, 1);
    assert.equal(second.slotUtilization, 1);
  });

  it("counts outcomes and resets counters after a snapshot", () => {
    const time = clock();
    const tracker = new WorkerLoadTracker(2, time.now);
    tracker.idlePoll();
    tracker.delivered("done");
    tracker.delivered("done");
    tracker.delivered("failed");
    tracker.throttled();
    tracker.gaveUp();
    time.advance(1_000);

    const first = tracker.snapshotAndReset();
    assert.deepEqual(
      [
        first.idlePolls,
        first.jobsDone,
        first.jobsFailed,
        first.submitThrottled,
        first.submitGaveUp,
      ],
      [1, 2, 1, 1, 1],
    );

    time.advance(1_000);
    const second = tracker.snapshotAndReset();
    assert.equal(second.jobsDone, 0);
    assert.equal(second.submitThrottled, 0);
  });
});
