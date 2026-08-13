export const DNS_RECORD_TYPES = [
  "A",
  "AAAA",
  "MX",
  "NS",
  "TXT",
  "CNAME",
  "SOA",
  "PTR",
] as const;
export type DnsRecordType = (typeof DNS_RECORD_TYPES)[number];

export interface DnsLookupPayloadV1 {
  domain: string;
  server: string;
  types: readonly DnsRecordType[];
}

export interface DnsRecord {
  ttl: number;
  address?: string;
  exchange?: string;
  priority?: number;
  value?: string;
  data?: string;
  nsname?: string;
  hostmaster?: string;
  serial?: number;
  refresh?: number;
  retry?: number;
  expire?: number;
  minttl?: number;
}

export interface DnsLookupResult {
  domain: string;
  server: string;
  queryTime: number;
  results: Record<DnsRecordType, DnsRecord[]>;
}
