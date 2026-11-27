import type { PeerCertificate } from "node:tls";
import type { HttpPingTlsCertificate } from "../types/http-ping.types";

export interface ToTlsCertificateOptions {
  peer: PeerCertificate;
  host: string;
}

export function toTlsCertificate({
  peer,
  host,
}: ToTlsCertificateOptions): HttpPingTlsCertificate | undefined {
  const validTo = new Date(peer.valid_to);
  if (!peer.valid_to || Number.isNaN(validTo.getTime())) return undefined;
  if (!peer.fingerprint256) return undefined;
  return {
    host,
    validTo: validTo.toISOString(),
    fingerprint256: peer.fingerprint256,
    issuer: firstValue(peer.issuer?.O) ?? firstValue(peer.issuer?.CN) ?? null,
  };
}

function firstValue(value: string | string[] | undefined): string | undefined {
  const first = Array.isArray(value) ? value[0] : value;
  return first || undefined;
}
