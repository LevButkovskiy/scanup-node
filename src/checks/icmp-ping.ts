import { promise as ping } from "ping";
import {
  finiteNumberOrUndefined,
  isPingExecFailure,
  PingTargetError,
  resolvePublicIpv4,
} from "../lib/system-ping";
import type {
  IcmpPingOutcomeV1,
  IcmpPingPayloadV1,
  IcmpPingResultV1,
  PingProbe,
  PingResponse,
} from "../types/icmp-ping.types";

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_PACKETS = 3;

function positiveIntegerOr(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isInteger(value) && value > 0
    ? value
    : fallback;
}

export function parseIcmpPingPayload(
  payload: Record<string, unknown>,
): IcmpPingPayloadV1 {
  const host = payload.host;
  if (typeof host !== "string" || host.length === 0) {
    throw new Error("icmp_ping payload: host is missing");
  }
  return {
    host,
    timeoutMs: positiveIntegerOr(payload.timeoutMs, DEFAULT_TIMEOUT_MS),
    packets: positiveIntegerOr(payload.packets, DEFAULT_PACKETS),
  };
}

function countOf(output: string, pattern: RegExp): number | undefined {
  const match = pattern.exec(output);
  return match ? Number(match[1]) : undefined;
}

function receivedOf(
  response: PingResponse,
  packetsSent: number,
  packetLoss: number | undefined,
): number {
  const parsed = countOf(response.output, /(\d+) (?:packets )?received/);
  if (parsed !== undefined) return parsed;
  if (!response.alive) return 0;
  return packetLoss === undefined
    ? 1
    : Math.max(1, Math.round(packetsSent * (1 - packetLoss / 100)));
}

export function toIcmpPingResult(
  ip: string,
  response: PingResponse,
  packets: number,
): IcmpPingResultV1 {
  const packetsSent =
    countOf(response.output, /(\d+) packets transmitted/) ?? packets;
  const reportedLoss = finiteNumberOrUndefined(response.packetLoss);
  const packetsReceived = receivedOf(response, packetsSent, reportedLoss);
  const result: IcmpPingResultV1 = {
    ip,
    packetsSent,
    packetsReceived,
    packetLoss:
      reportedLoss ??
      ((packetsSent - packetsReceived) / Math.max(packetsSent, 1)) * 100,
  };
  if (packetsReceived === 0) return result;
  return {
    ...result,
    rttMinMs: finiteNumberOrUndefined(response.min),
    rttAvgMs: finiteNumberOrUndefined(response.avg),
    rttMaxMs: finiteNumberOrUndefined(response.max),
  };
}

export async function runIcmpPing(
  payload: IcmpPingPayloadV1,
  probe: PingProbe = ping.probe,
): Promise<IcmpPingOutcomeV1> {
  let ip: string;
  try {
    ip = await resolvePublicIpv4(payload.host);
  } catch (error) {
    if (error instanceof PingTargetError) return { error: error.message };
    throw error;
  }
  const secondsBetweenPackets = payload.packets - 1;
  const replyWaitSeconds = Math.max(
    1,
    Math.ceil(payload.timeoutMs / 1000) - secondsBetweenPackets,
  );
  const response = await probe(ip, {
    min_reply: payload.packets,
    timeout: replyWaitSeconds,
    numeric: true,
  });
  if (isPingExecFailure(response.output)) {
    throw new Error(`ping exec failed: ${response.output.trim()}`);
  }
  return toIcmpPingResult(ip, response, payload.packets);
}

export async function isIcmpPingAvailable(
  probe: PingProbe = ping.probe,
): Promise<boolean> {
  try {
    const response = await probe("127.0.0.1", { min_reply: 1, timeout: 1 });
    return response.alive && !isPingExecFailure(response.output);
  } catch {
    return false;
  }
}
