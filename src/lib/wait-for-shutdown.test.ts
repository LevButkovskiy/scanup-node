import assert from "node:assert/strict";
import { describe, it, mock } from "node:test";
import { waitForShutdown } from "./wait-for-shutdown";

describe("waitForShutdown", () => {
  it("resolves at once when the signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    let reminders = 0;
    await waitForShutdown({
      signal: controller.signal,
      remindEveryMs: 10,
      remind: () => {
        reminders += 1;
      },
    });
    assert.equal(reminders, 0);
  });

  it("reminds on every interval until the signal is aborted", async () => {
    mock.timers.enable({ apis: ["setInterval"] });
    try {
      const controller = new AbortController();
      let reminders = 0;
      let resolved = false;
      const waiting = waitForShutdown({
        signal: controller.signal,
        remindEveryMs: 1_000,
        remind: () => {
          reminders += 1;
        },
      }).then(() => {
        resolved = true;
      });

      mock.timers.tick(3_000);
      await Promise.resolve();
      assert.equal(reminders, 3);
      assert.equal(resolved, false);

      controller.abort();
      await waiting;
      mock.timers.tick(5_000);
      assert.equal(reminders, 3);
      assert.equal(resolved, true);
    } finally {
      mock.timers.reset();
    }
  });
});
