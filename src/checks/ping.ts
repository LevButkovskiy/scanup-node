import { isIP } from "node:net";
import { promise as ping } from "ping";
import { isPrivateIp } from "../lib/is-private-ip";
import { resolveIpv4 } from "../lib/resolve-ipv4";
import type { PingPayloadV1, PingResult } from "../types/ping.types";

const COUNT = 4;
const TIMEOUT_PER_PACKET_S = 5;

export function parsePingPayload(
  payload: Record<string, unknown>,
): PingPayloadV1 {
  const host = payload.host;
  if (typeof host !== "string" || host.length === 0) {
    throw new Error("ping.v1 payload: host is missing");
  }
  if (!isIP(host) && host.includes(":")) {
    throw new Error(`${host} is not a valid IP address`);
  }
  return { host };
}

export async function runPing(payload: PingPayloadV1): Promise<PingResult> {
  const { host } = payload;

  let ip: string;
  try {
    ip = await resolveIpv4(host);
  } catch {
    throw new Error(`Cannot resolve ${host} to an IPv4 address`);
  }

  if (isPrivateIp(ip)) {
    throw new Error("Ping to private IP addresses is not allowed");
  }

  const start = Date.now();
  const res = await ping.probe(ip, {
    min_reply: COUNT,
    timeout: TIMEOUT_PER_PACKET_S,
    numeric: true,
  });
  const queryTime = Date.now() - start;

  if (isPingExecFailure(res.output)) {
    throw new Error(`ping exec failed: ${res.output.trim()}`);
  }

  if (!res.alive) return { host, alive: false, queryTime };

  return {
    host,
    alive: true,
    min: toMs(res.min),
    avg: toMs(res.avg),
    max: toMs(res.max),
    // typed as number by the package, actually a string like "0.000"
    packetLoss: toMs(res.packetLoss),
    queryTime,
  };
}

// "host unreachable" is a legitimate alive:false answer, but a node that
// cannot run ping at all must report an error rather than confidently
// claiming every host is down.
function isPingExecFailure(output: string): boolean {
  return /operation not permitted|permission denied|not found/i.test(output);
}

// Numeric fields arrive as strings, and as "unknown" when the platform's ping
// does not report them (e.g. min/avg/max on Windows).
function toMs(value: string | number): number | undefined {
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}
