export interface NodeConfig {
  apiUrl: string;
  nodeToken: string;
  location: string | null;
  heartbeatIntervalMs: number;
  pollIntervalMs: number;
  errorBackoffMs: number;
}

// Number('') = 0, Number('abc') = NaN — оба значения разрушили бы интервалы,
// поэтому всегда валидируем и откатываемся на дефолт.
function intFromEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

const DEFAULT_HEARTBEAT_INTERVAL_MS = 30_000; // лимит backend: 30/мин
const DEFAULT_POLL_INTERVAL_MS = 3_000; // лимит backend: 60/мин на jobs/next
const DEFAULT_ERROR_BACKOFF_MS = 10_000;

export function loadConfig(): NodeConfig {
  const apiUrl = process.env.SCANUP_API_URL;
  const nodeToken = process.env.SCANUP_NODE_TOKEN;

  if (!apiUrl) throw new Error("SCANUP_API_URL is not set");
  if (!nodeToken) throw new Error("SCANUP_NODE_TOKEN is not set");

  return {
    apiUrl: apiUrl.replace(/\/+$/, ""),
    nodeToken,
    location: process.env.NODE_LOCATION ?? null,
    heartbeatIntervalMs: intFromEnv(
      "HEARTBEAT_INTERVAL_MS",
      DEFAULT_HEARTBEAT_INTERVAL_MS,
    ),
    pollIntervalMs: intFromEnv("POLL_INTERVAL_MS", DEFAULT_POLL_INTERVAL_MS),
    errorBackoffMs: intFromEnv("ERROR_BACKOFF_MS", DEFAULT_ERROR_BACKOFF_MS),
  };
}
