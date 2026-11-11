import { test } from "node:test";
import assert from "node:assert/strict";
import { capabilitiesOf } from "./tool-capabilities";

test("announces every version of a capability in one entry", () => {
  assert.deepEqual(
    capabilitiesOf([
      { capability: "http_ping", version: "v1" },
      { capability: "http_ping", version: "v2" },
      { capability: "icmp_ping", version: "v1" },
    ]),
    [
      { type: "http_ping", schemaVersions: ["v1", "v2"] },
      { type: "icmp_ping", schemaVersions: ["v1"] },
    ],
  );
});
