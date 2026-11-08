import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { runPing } from "./ping";

describe("runPing", () => {
  for (const host of ["127.0.0.1", "10.0.0.1", "::1"]) {
    it(`always blocks ${host}`, async () => {
      await assert.rejects(
        runPing({ host }),
        /Ping to private IP addresses is not allowed/,
      );
    });
  }
});
