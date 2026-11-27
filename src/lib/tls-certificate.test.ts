import { test } from "node:test";
import assert from "node:assert/strict";
import type { PeerCertificate } from "node:tls";
import { toTlsCertificate } from "./tls-certificate";

function peer(overrides: Record<string, unknown>): PeerCertificate {
  return {
    valid_to: "Feb  1 12:00:00 2027 GMT",
    fingerprint256: "AB:CD",
    issuer: { O: "Let's Encrypt", CN: "R3" },
    ...overrides,
  } as unknown as PeerCertificate;
}

test("toTlsCertificate converts the expiry date to ISO UTC", () => {
  assert.deepEqual(toTlsCertificate({ peer: peer({}), host: "example.com" }), {
    host: "example.com",
    validTo: "2027-02-01T12:00:00.000Z",
    fingerprint256: "AB:CD",
    issuer: "Let's Encrypt",
  });
});

test("toTlsCertificate falls back to issuer CN, then null", () => {
  const byCn = toTlsCertificate({
    peer: peer({ issuer: { CN: "Own CA" } }),
    host: "h",
  });
  assert.equal(byCn?.issuer, "Own CA");
  const none = toTlsCertificate({ peer: peer({ issuer: {} }), host: "h" });
  assert.equal(none?.issuer, null);
});

test("toTlsCertificate returns undefined for an empty or broken certificate", () => {
  assert.equal(
    toTlsCertificate({ peer: peer({ valid_to: "" }), host: "h" }),
    undefined,
  );
  assert.equal(
    toTlsCertificate({ peer: peer({ valid_to: "garbage" }), host: "h" }),
    undefined,
  );
  assert.equal(
    toTlsCertificate({ peer: peer({ fingerprint256: undefined }), host: "h" }),
    undefined,
  );
});
