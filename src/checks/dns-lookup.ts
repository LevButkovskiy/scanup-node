import Dns2 from "dns2";
import { isPrivateIp } from "../lib/is-private-ip";
import {
  DNS_RECORD_TYPES,
  type DnsLookupPayloadV1,
  type DnsLookupResult,
  type DnsRecord,
  type DnsRecordType,
} from "../types/dns-lookup.types";

const DEFAULT_SERVER = "8.8.8.8";
const TIMEOUT_MS = 10_000;

export function parseDnsLookupPayload(
  payload: Record<string, unknown>,
): DnsLookupPayloadV1 {
  const domain = payload.domain;
  if (typeof domain !== "string" || domain.length === 0) {
    throw new Error("dns.v1 payload: domain is missing");
  }

  const server =
    typeof payload.server === "string" && payload.server.length > 0
      ? payload.server
      : DEFAULT_SERVER;

  const types =
    Array.isArray(payload.types) &&
    payload.types.length > 0 &&
    payload.types.every((t) => DNS_RECORD_TYPES.includes(t as DnsRecordType))
      ? (payload.types as DnsRecordType[])
      : DNS_RECORD_TYPES;

  return { domain, server, types };
}

export async function runDnsLookup(
  payload: DnsLookupPayloadV1,
): Promise<DnsLookupResult> {
  if (isPrivateIp(payload.server)) {
    throw new Error("DNS server cannot be a private or reserved IP address");
  }

  const dns = new Dns2({
    nameServers: [payload.server],
    timeout: TIMEOUT_MS,
  });
  const start = Date.now();

  const settled = await Promise.allSettled(
    payload.types.map(async (type) => {
      const { answers } = await dns.resolve(payload.domain, type);
      return (answers ?? []).map((a) => mapAnswer(a, type));
    }),
  );

  const settledByType = new Map(payload.types.map((t, i) => [t, settled[i]]));
  const results = Object.fromEntries(
    DNS_RECORD_TYPES.map((type) => {
      const outcome = settledByType.get(type);
      return [type, outcome?.status === "fulfilled" ? outcome.value : []];
    }),
  ) as Record<DnsRecordType, DnsRecord[]>;

  return {
    domain: payload.domain,
    server: payload.server,
    queryTime: Date.now() - start,
    results,
  };
}

function mapAnswer(
  answer: Dns2.Packet.Resource,
  type: DnsRecordType,
): DnsRecord {
  const ttl = answer.ttl ?? 0;

  switch (type) {
    case "A":
    case "AAAA":
      return { ttl, address: answer.address };

    case "MX":
      return { ttl, exchange: answer.exchange, priority: answer.priority };

    case "NS":
      return { ttl, value: answer.ns };

    case "CNAME":
    case "PTR":
      return { ttl, value: answer.domain };

    case "TXT":
      return {
        ttl,
        data: Array.isArray(answer.data)
          ? answer.data.join(" ")
          : answer.data !== undefined
            ? String(answer.data)
            : undefined,
      };

    case "SOA":
      return {
        ttl,
        nsname: answer.primary,
        hostmaster: answer.admin,
        serial: answer.serial,
        refresh: answer.refresh,
        retry: answer.retry,
        expire:
          answer.expiration !== undefined
            ? Number(answer.expiration)
            : undefined,
        minttl: answer.minimum,
      };

    default:
      return { ttl };
  }
}
