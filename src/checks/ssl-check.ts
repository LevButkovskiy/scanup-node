import { isIP } from "node:net";
import * as tls from "node:tls";
import { isPrivateIp } from "../lib/is-private-ip";
import { resolveIpv4 } from "../lib/resolve-ipv4";
import type {
  SslCertificate,
  SslCheckPayloadV1,
  SslCheckResult,
} from "../types/ssl-check.types";

const DEFAULT_PORT = 443;
const TIMEOUT_MS = 10_000;
const EXPIRING_SOON_DAYS = 30;

export function parseSslCheckPayload(
  payload: Record<string, unknown>,
): SslCheckPayloadV1 {
  const host = payload.host;
  if (typeof host !== "string" || host.length === 0) {
    throw new Error("ssl.v1 payload: host is missing");
  }

  const port =
    typeof payload.port === "number" &&
    Number.isInteger(payload.port) &&
    payload.port > 0 &&
    payload.port <= 65535
      ? payload.port
      : DEFAULT_PORT;

  return { host, port };
}

export async function runSslCheck(
  payload: SslCheckPayloadV1,
): Promise<SslCheckResult> {
  const { host, port } = payload;
  const start = Date.now();

  // Resolve before connecting: the SSRF check must run on the actual IP,
  // and the connection must go to that same IP (no re-resolve → no DNS
  // rebinding between check and connect)
  let ip: string;
  try {
    ip = await resolveIpv4(host);
  } catch {
    return {
      host,
      port,
      valid: false,
      error: `Cannot resolve ${host}`,
      queryTime: Date.now() - start,
    };
  }

  if (isPrivateIp(ip)) {
    throw new Error("SSL check for private IP addresses is not allowed");
  }

  try {
    const { certificate, authorized, authorizationError } =
      await fetchCertificate(host, ip, port);
    return {
      host,
      port,
      valid: authorized,
      certificate,
      error: authorized ? undefined : authorizationError,
      queryTime: Date.now() - start,
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "SSL check failed";
    return {
      host,
      port,
      valid: false,
      error: message,
      queryTime: Date.now() - start,
    };
  }
}

interface FetchedCertificate {
  certificate: SslCertificate;
  authorized: boolean;
  authorizationError?: string;
}

function fetchCertificate(
  host: string,
  ip: string,
  port: number,
): Promise<FetchedCertificate> {
  return new Promise<FetchedCertificate>((resolvePromise, reject) => {
    // rejectUnauthorized: false — an expired, self-signed or wrong-host
    // certificate is the answer the user came for, not a reason to abort the
    // handshake. Trust is reported separately via `authorized`.
    // SNI only for hostnames — an IP literal is not a valid servername
    const socket = tls.connect(
      {
        host: ip,
        port,
        timeout: TIMEOUT_MS,
        rejectUnauthorized: false,
        ...(isIP(host) ? {} : { servername: host }),
      },
      () => {
        try {
          const raw = socket.getPeerCertificate(true);

          if (!raw || !raw.subject) {
            socket.destroy();
            reject(new Error("No certificate returned"));
            return;
          }

          const validFrom = new Date(raw.valid_from).toISOString();
          const validToDate = new Date(raw.valid_to);
          const validTo = validToDate.toISOString();
          const daysRemaining = Math.floor(
            (validToDate.getTime() - Date.now()) / 86_400_000,
          );

          const certificate: SslCertificate = {
            subject: String(raw.subject?.CN ?? ""),
            issuer: String(raw.issuer?.CN ?? raw.issuer?.O ?? ""),
            validFrom,
            validTo,
            daysRemaining,
            isExpired: daysRemaining < 0,
            isExpiringSoon:
              daysRemaining >= 0 && daysRemaining < EXPIRING_SOON_DAYS,
            subjectAltNames: parseSubjectAltNames(raw.subjectaltname ?? ""),
            serialNumber: raw.serialNumber ?? "",
            fingerprint: raw.fingerprint ?? "",
          };

          const { authorized, authorizationError } = socket;
          socket.destroy();
          resolvePromise({
            certificate,
            authorized,
            authorizationError: authorized
              ? undefined
              : describeAuthorizationError(authorizationError),
          });
        } catch (err: unknown) {
          socket.destroy();
          reject(err instanceof Error ? err : new Error(String(err)));
        }
      },
    );

    socket.on("timeout", () => {
      socket.destroy();
      reject(new Error("SSL connection timed out"));
    });

    socket.on("error", (err) => {
      socket.destroy();
      reject(err);
    });
  });
}

// Node types authorizationError as Error, but at runtime it is the OpenSSL
// reason code string (e.g. "ERR_TLS_CERT_ALTNAME_INVALID").
function describeAuthorizationError(
  reason: tls.TLSSocket["authorizationError"],
): string | undefined {
  if (!reason) return undefined;
  return reason instanceof Error ? reason.message : String(reason);
}

function parseSubjectAltNames(altNameString: string): string[] {
  if (!altNameString) return [];
  return altNameString
    .split(",")
    .map((entry) => entry.trim().replace(/^DNS:/, ""))
    .filter(Boolean);
}
