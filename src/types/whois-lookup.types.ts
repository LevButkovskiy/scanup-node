export interface WhoisLookupPayloadV1 {
  domain: string;
}

export interface WhoisLookupResult {
  domain: string;
  registrar?: string;
  registrarUrl?: string;
  createdAt?: string;
  updatedAt?: string;
  expiresAt?: string;
  nameServers: string[];
  status: string[];
  queryTime: number;
}
