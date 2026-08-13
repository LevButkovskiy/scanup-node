import { resolve4 } from "node:dns/promises";
import { isIP } from "node:net";

/**
 * Resolves a hostname to its first IPv4 address, or returns it unchanged if
 * it's already an IP literal. Throws whatever `resolve4` throws on failure —
 * callers decide how to surface that.
 */
export async function resolveIpv4(host: string): Promise<string> {
  if (isIP(host)) return host;
  const addrs = await resolve4(host);
  return addrs[0] as string;
}
