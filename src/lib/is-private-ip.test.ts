import { test } from "node:test";
import assert from "node:assert/strict";
import { isPrivateIp } from "./is-private-ip";

for (const ip of [
  "::7f00:1",
  "::a00:1",
  "::a9fe:a9fe",
  "::808:808",
  "::1",
  "::",
]) {
  test(`isPrivateIp blocks ${ip}`, () => {
    assert.equal(isPrivateIp(ip), true);
  });
}

test("isPrivateIp keeps public addresses", () => {
  assert.equal(isPrivateIp("8.8.8.8"), false);
  assert.equal(isPrivateIp("2606:4700:4700::1111"), false);
});
