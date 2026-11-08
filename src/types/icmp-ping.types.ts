import type { promise as ping } from "ping";

export type PingProbe = typeof ping.probe;

export type PingResponse = Awaited<ReturnType<PingProbe>>;

export interface IcmpPingPayloadV1 {
  host: string;
  timeoutMs: number;
  packets: number;
}

export interface IcmpPingRunOptions {
  allowPrivateTargets: boolean;
}

export interface IcmpPingResultV1 {
  ip: string;
  packetsSent: number;
  packetsReceived: number;
  packetLoss: number;
  rttMinMs?: number;
  rttAvgMs?: number;
  rttMaxMs?: number;
}

export interface IcmpPingTargetErrorV1 {
  error: string;
}

export type IcmpPingOutcomeV1 = IcmpPingResultV1 | IcmpPingTargetErrorV1;
