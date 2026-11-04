import ipaddr from "ipaddr.js";

const NAT64_PREFIX_PARTS = [0x64, 0xff9b, 0, 0, 0, 0];

function ipv4FromParts(high: number, low: number): string {
  return [high >> 8, high & 0xff, low >> 8, low & 0xff].join(".");
}

function embeddedIpv4Addresses(address: ipaddr.IPv6): string[] {
  const part = (index: number): number => address.parts[index] ?? 0;
  switch (address.range()) {
    case "rfc6052":
      return NAT64_PREFIX_PARTS.every((value, index) => part(index) === value)
        ? [ipv4FromParts(part(6), part(7))]
        : [];
    case "6to4":
      return [ipv4FromParts(part(1), part(2))];
    case "teredo":
      return [
        ipv4FromParts(part(2), part(3)),
        ipv4FromParts(~part(6) & 0xffff, ~part(7) & 0xffff),
      ];
    default:
      return [];
  }
}

/**
 * Returns true if the IP is private, loopback, reserved, or otherwise
 * non-routable on the public internet. Used to block SSRF in check handlers
 * that connect to a user-supplied host (ssl.v1, ping.v1, dns.v1 server).
 */
export function isPrivateIp(ip: string): boolean {
  if (ip === "localhost") return true;
  if (!ipaddr.isValid(ip)) return true;
  const address = ipaddr.process(ip);
  if (address.kind() === "ipv6") {
    const v6 = address as ipaddr.IPv6;
    const range = v6.range();
    if (range === "unicast") return false;
    const embedded = embeddedIpv4Addresses(v6);
    return embedded.length === 0 || embedded.some(isPrivateIp);
  }
  return address.range() !== "unicast";
}
