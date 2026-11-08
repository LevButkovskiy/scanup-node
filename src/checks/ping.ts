import { isIP } from "node:net";
import { promise as ping } from "ping";
import {
  isPingExecFailure,
  resolvePublicIpv4,
  finiteNumberOrUndefined,
} from "../lib/system-ping";
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
  const ip = await resolvePublicIpv4(host);

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
    min: finiteNumberOrUndefined(res.min),
    avg: finiteNumberOrUndefined(res.avg),
    max: finiteNumberOrUndefined(res.max),
    // typed as number by the package, actually a string like "0.000"
    packetLoss: finiteNumberOrUndefined(res.packetLoss),
    queryTime,
  };
}
