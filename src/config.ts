import type { NodeLocation } from "./api-client";

export interface NodeConfig {
  apiUrl: string;
  nodeToken: string;
  location: NodeLocation | null;
  heartbeatIntervalMs: number;
  jobWaitMs: number;
  jobConcurrency: number;
  errorBackoffMs: number;
  allowPrivateTargets: boolean;
}

// Number('') = 0, Number('abc') = NaN — оба значения разрушили бы интервалы,
// поэтому всегда валидируем и откатываемся на дефолт.
function intFromEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

const MAX_CITY_LENGTH = 64;
const COUNTRY_CODE_PATTERN = /^[A-Z]{2}$/;

function locationFromEnv(): NodeLocation | null {
  const city = process.env.NODE_CITY?.trim().slice(0, MAX_CITY_LENGTH);
  const rawCountryCode = process.env.NODE_COUNTRY_CODE?.trim();
  const countryCode =
    rawCountryCode && COUNTRY_CODE_PATTERN.test(rawCountryCode)
      ? rawCountryCode
      : undefined;
  if (rawCountryCode && !countryCode) {
    console.error(
      "NODE_COUNTRY_CODE must be a two-letter uppercase ISO code — ignored",
    );
  }
  if (!city && !countryCode) return null;
  return { ...(city ? { city } : {}), ...(countryCode ? { countryCode } : {}) };
}

const DEFAULT_HEARTBEAT_INTERVAL_MS = 30_000; // лимит backend: 30/мин
const DEFAULT_JOB_WAIT_MS = 25_000;
const DEFAULT_JOB_CONCURRENCY = 8;
const DEFAULT_ERROR_BACKOFF_MS = 10_000;

export function loadConfig(): NodeConfig {
  const apiUrl = process.env.SCANUP_API_URL;
  const nodeToken = process.env.SCANUP_NODE_TOKEN;

  if (!apiUrl) throw new Error("SCANUP_API_URL is not set");
  if (!nodeToken) throw new Error("SCANUP_NODE_TOKEN is not set");

  return {
    apiUrl: apiUrl.replace(/\/+$/, ""),
    nodeToken,
    location: locationFromEnv(),
    heartbeatIntervalMs: intFromEnv(
      "HEARTBEAT_INTERVAL_MS",
      DEFAULT_HEARTBEAT_INTERVAL_MS,
    ),
    jobWaitMs: intFromEnv("JOB_WAIT_MS", DEFAULT_JOB_WAIT_MS),
    jobConcurrency: intFromEnv("JOB_CONCURRENCY", DEFAULT_JOB_CONCURRENCY),
    errorBackoffMs: intFromEnv("ERROR_BACKOFF_MS", DEFAULT_ERROR_BACKOFF_MS),
    allowPrivateTargets: process.env.ALLOW_PRIVATE_TARGETS === "true",
  };
}
