import { isPrivateIp } from "./is-private-ip";
import { resolveIpv4 } from "./resolve-ipv4";

const NAME_NOT_FOUND_CODES = new Set(["ENOTFOUND", "ENODATA"]);

export class PingTargetError extends Error {}

function isNameNotFound(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === "string" && NAME_NOT_FOUND_CODES.has(code);
}

export async function resolvePingTarget(host: string): Promise<string> {
  try {
    return await resolveIpv4(host);
  } catch (error) {
    const message = `Cannot resolve ${host} to an IPv4 address`;
    if (isNameNotFound(error)) throw new PingTargetError(message);
    throw new Error(message, { cause: error });
  }
}

export async function resolvePublicIpv4(host: string): Promise<string> {
  const ip = await resolvePingTarget(host);
  if (isPrivateIp(ip)) {
    throw new PingTargetError("Ping to private IP addresses is not allowed");
  }
  return ip;
}

export function isPingExecFailure(output: string): boolean {
  return /operation not permitted|permission denied|not found/i.test(output);
}

export function finiteNumberOrUndefined(
  value: string | number,
): number | undefined {
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}
