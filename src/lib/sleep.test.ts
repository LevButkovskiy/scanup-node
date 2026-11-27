import { test } from "node:test";
import assert from "node:assert/strict";
import { sleep } from "./sleep";

test("resolves early when the signal aborts", async () => {
  const controller = new AbortController();
  const startedAt = Date.now();
  const sleeping = sleep(60_000, controller.signal);
  controller.abort();
  await sleeping;
  assert.ok(Date.now() - startedAt < 1_000);
});

test("resolves at once on an already aborted signal", async () => {
  await sleep(60_000, AbortSignal.abort());
});

test("waits the given time without a signal", async () => {
  const startedAt = Date.now();
  await sleep(20);
  assert.ok(Date.now() - startedAt >= 15);
});
