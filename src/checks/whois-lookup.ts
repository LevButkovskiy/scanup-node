import type {
  WhoisLookupPayloadV1,
  WhoisLookupResult,
} from "../types/whois-lookup.types";

const TIMEOUT_MS = 15_000;

type WhoisFields = Record<string, string | string[] | undefined>;

export function parseWhoisLookupPayload(
  payload: Record<string, unknown>,
): WhoisLookupPayloadV1 {
  const domain = payload.domain;
  if (typeof domain !== "string" || domain.length === 0) {
    throw new Error("whois.v1 payload: domain is missing");
  }
  return { domain };
}

export async function runWhoisLookup(
  payload: WhoisLookupPayloadV1,
): Promise<WhoisLookupResult> {
  const start = Date.now();

  // whoiser is ESM-only — this package compiles to CommonJS, so a static
  // import would fail with ERR_REQUIRE_ESM. Dynamic import loads it fine.
  //
  // follow: 1 queries only the registry server (derived from IANA). The
  // default (2) also follows the "Registrar WHOIS Server" named in the
  // registry response — a host the domain owner can influence, and the one
  // outbound path here that isPrivateIp could not cover. firstResult() keeps
  // the registry answer either way, so nothing is lost by not following.
  let data: WhoisFields;
  try {
    const { whoisDomain, firstResult } = await import("whoiser");
    const result = await whoisDomain(payload.domain, {
      timeout: TIMEOUT_MS,
      follow: 1,
    });
    data = firstResult(result) as WhoisFields;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "WHOIS lookup failed";
    throw new Error(message);
  }

  return {
    domain: payload.domain,
    registrar: getString(data, "Registrar"),
    registrarUrl:
      getString(data, "Registrar URL") ?? getString(data, "Registrar Website"),
    createdAt:
      getDate(data, "Creation Date") ??
      getDate(data, "Created Date") ??
      getDate(data, "Domain Registration Date"),
    updatedAt:
      getDate(data, "Updated Date") ??
      getDate(data, "Last Updated On") ??
      getDate(data, "Last Modified"),
    expiresAt:
      getDate(data, "Registry Expiry Date") ??
      getDate(data, "Registrar Registration Expiration Date") ??
      getDate(data, "Expiry Date") ??
      getDate(data, "Expiration Date"),
    nameServers: getArray(data, "Name Server"),
    status: getArray(data, "Domain Status"),
    queryTime: Date.now() - start,
  };
}

function getString(data: WhoisFields, key: string): string | undefined {
  const val = data[key];
  if (!val) return undefined;
  const str = Array.isArray(val) ? val[0] : val;
  return str?.trim() || undefined;
}

function getDate(data: WhoisFields, key: string): string | undefined {
  const val = getString(data, key);
  if (!val) return undefined;
  const date = new Date(val);
  return isNaN(date.getTime()) ? undefined : date.toISOString();
}

function getArray(data: WhoisFields, key: string): string[] {
  const val = data[key];
  if (!val) return [];
  const arr = Array.isArray(val) ? val : [val];
  return arr.map((s) => s.trim()).filter(Boolean);
}
