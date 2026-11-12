import type { HttpCheckErrorKind } from "../types/http-check.types";
import { BLOCKED_CODE } from "./public-address-guard";

export const TOO_MANY_REDIRECTS_CODE = "TOO_MANY_REDIRECTS";

export const NODE_SIDE_ERROR_CODES = new Set([
  "EAI_AGAIN",
  "EAI_FAIL",
  "ENETUNREACH",
  "ENETDOWN",
  "EMFILE",
  "ENFILE",
  "ENOBUFS",
  "ENOMEM",
  "EADDRNOTAVAIL",
]);

export function errorCode(error: unknown): string | null {
  const candidate = error as {
    code?: unknown;
    cause?: { code?: unknown };
  } | null;
  const code = candidate?.code ?? candidate?.cause?.code;
  return typeof code === "string" ? code : null;
}

export function errorKind(
  error: unknown,
  code: string | null,
): HttpCheckErrorKind {
  const name = (error as { name?: unknown } | null)?.name;
  if (name === "TimeoutError" || name === "AbortError") return "timeout";
  if (code === BLOCKED_CODE) return "blocked";
  if (code === "ENOTFOUND" || code === "ENODATA") return "dns";
  if (code === "ECONNREFUSED") return "refused";
  if (code === "ECONNRESET" || code === "EPIPE") return "reset";
  if (code === "EHOSTUNREACH") return "unreachable";
  if (code === "UND_ERR_CONNECT_TIMEOUT") return "timeout";
  if (code === TOO_MANY_REDIRECTS_CODE) return "redirects";
  if (
    code &&
    /CERT|SELF_SIGNED|UNABLE_TO_VERIFY|ERR_TLS|ERR_SSL|EPROTO|HOSTNAME_MISMATCH/.test(
      code,
    )
  ) {
    return "tls";
  }
  return "other";
}

function nestedErrorsOf(error: object): unknown[] {
  const errors = (error as { errors?: unknown }).errors;
  return Array.isArray(errors) ? errors : [];
}

export function isNodeSideError(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const nested = nestedErrorsOf(error);
  if (nested.length > 0) return nested.every(isNodeSideError);
  const { code, cause } = error as { code?: unknown; cause?: unknown };
  if (typeof code === "string" && code.length > 0) {
    return NODE_SIDE_ERROR_CODES.has(code);
  }
  return cause !== undefined && isNodeSideError(cause);
}
