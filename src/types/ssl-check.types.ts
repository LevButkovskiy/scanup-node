export interface SslCheckPayloadV1 {
  host: string;
  port: number;
}

export interface SslCertificate {
  subject: string;
  issuer: string;
  validFrom: string;
  validTo: string;
  daysRemaining: number;
  isExpired: boolean;
  isExpiringSoon: boolean;
  subjectAltNames: string[];
  serialNumber: string;
  fingerprint: string;
}

export interface SslCheckResult {
  host: string;
  port: number;
  valid: boolean;
  certificate?: SslCertificate;
  error?: string;
  queryTime: number;
}
