import ipaddr from "ipaddr.js";

const BLOCKED_RANGES = new Set([
  "private", // RFC1918
  "loopback",
  "linkLocal", // includes the AWS/GCP IMDS endpoint 169.254.169.254
  "uniqueLocal", // IPv6 ULA, fc00::/7
  "carrierGradeNat", // RFC6598
  "unspecified", // 0.0.0.0, ::
  "reserved", // TEST-NET blocks and other non-routable reservations
  "broadcast",
  "multicast",
]);

/**
 * Returns true if the IP is private, loopback, reserved, or otherwise
 * non-routable on the public internet. Used to block SSRF in check handlers
 * that connect to a user-supplied host (ssl.v1, ping.v1, dns.v1 server).
 */
export function isPrivateIp(ip: string): boolean {
  if (ip === "localhost") return true;
  if (!ipaddr.isValid(ip)) return true;
  return BLOCKED_RANGES.has(ipaddr.process(ip).range());
}
