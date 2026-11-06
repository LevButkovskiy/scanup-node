import dns from "node:dns";
import net from "node:net";
import { isPrivateIp } from "./is-private-ip";

export const BLOCKED_CODE = "EBLOCKED";

export function codedError(
  message: string,
  code: string,
): NodeJS.ErrnoException {
  const error: NodeJS.ErrnoException = new Error(message);
  error.code = code;
  return error;
}

export function blockedAddressError(): NodeJS.ErrnoException {
  return codedError("Private address is not allowed", BLOCKED_CODE);
}

export function guardedLookup(
  hostname: string,
  options: dns.LookupOptions,
  callback: (
    error: NodeJS.ErrnoException | null,
    address: string | dns.LookupAddress[],
    family?: number,
  ) => void,
): void {
  dns.lookup(hostname, options, (error, address, family) => {
    if (error) return callback(error, address);
    const addresses: string[] = Array.isArray(address)
      ? address.map((entry) => entry.address)
      : [address];
    if (addresses.some(isPrivateIp)) {
      return callback(
        codedError(`${hostname} resolves to a private address`, BLOCKED_CODE),
        address,
      );
    }
    callback(null, address, family);
  });
}

export function isPrivateIpLiteral(host: string): boolean {
  const bare = host.replace(/^\[|\]$/g, "");
  return net.isIP(bare) !== 0 && isPrivateIp(bare);
}

export function assertPublicHost(url: URL): void {
  if (isPrivateIpLiteral(url.hostname)) throw blockedAddressError();
}
