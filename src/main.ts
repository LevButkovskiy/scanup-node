import {
  ApiClient,
  NodeTokenRejectedError,
  type DispatchedJob,
} from "./api-client";
import { parseDnsLookupPayload, runDnsLookup } from "./checks/dns-lookup";
import { parseHttpPingPayload, runHttpPing } from "./checks/http-ping";
import { parsePingPayload, runPing } from "./checks/ping";
import { parseSslCheckPayload, runSslCheck } from "./checks/ssl-check";
import { parseWhoisLookupPayload, runWhoisLookup } from "./checks/whois-lookup";
import { loadConfig } from "./config";
import { errorMessage } from "./lib/error-message";
import { log } from "./lib/log";
import { sleep } from "./lib/sleep";
import { readPackageVersion } from "./lib/version";

const CAPABILITIES = [
  { type: "http_ping", schemaVersions: ["v1"] },
  { type: "dns", schemaVersions: ["v1"] },
  { type: "whois", schemaVersions: ["v1"] },
  { type: "ssl", schemaVersions: ["v1"] },
  { type: "ping", schemaVersions: ["v1"] },
];

async function runJob(
  jobType: string,
  payload: Record<string, unknown>,
): Promise<unknown> {
  switch (jobType) {
    case "http_ping": {
      const result = await runHttpPing(parseHttpPingPayload(payload));
      return {
        statusCode: result.statusCode,
        responseTimeMs: result.responseTimeMs,
      };
    }
    case "dns":
      return runDnsLookup(parseDnsLookupPayload(payload));
    case "whois":
      return runWhoisLookup(parseWhoisLookupPayload(payload));
    case "ssl":
      return runSslCheck(parseSslCheckPayload(payload));
    case "ping":
      return runPing(parsePingPayload(payload));
    default:
      throw new Error(`Unsupported jobType: ${jobType}`);
  }
}

async function executeJob(api: ApiClient, job: DispatchedJob): Promise<void> {
  try {
    const result = (await runJob(job.jobType, job.payload)) as Record<
      string,
      unknown
    >;
    await api.submitResult(job.jobId, { status: "done", result });
    log(`job ${job.jobId}: done (${job.jobType})`);
  } catch (error) {
    if (error instanceof NodeTokenRejectedError) throw error;
    const message = errorMessage(error);
    await api.submitResult(job.jobId, { status: "failed", error: message });
    log(`job ${job.jobId}: failed (${message})`);
  }
}

async function main(): Promise<void> {
  const config = loadConfig();
  const api = new ApiClient(config);
  const version = readPackageVersion();

  log(
    `scanup-node v${version} starting` +
      (config.location ? ` (location: ${config.location})` : ""),
  );

  let running = true;
  const stop = (): void => {
    log("shutting down...");
    running = false;
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);

  const stopRevoked = (): void => {
    log("node token revoked — shutting down");
    running = false;
  };

  // Heartbeat — отдельный самопланирующийся цикл, ошибки не фатальны:
  // backend восстановит картину на следующем успешном heartbeat'е.
  const sendHeartbeat = async (): Promise<void> => {
    try {
      await api.heartbeat({ version, capabilities: CAPABILITIES });
    } catch (error) {
      if (error instanceof NodeTokenRejectedError) {
        stopRevoked();
        return;
      }
      log(`heartbeat failed: ${errorMessage(error)}`);
    }
  };
  await sendHeartbeat();
  const heartbeatTimer = setInterval(() => {
    void sendHeartbeat();
  }, config.heartbeatIntervalMs);

  // Основной цикл: забрать job -> выполнить -> отчитаться. Пустая очередь —
  // пауза pollIntervalMs (лимит backend'а 60/мин на jobs/next), сетевая
  // ошибка — более длинный backoff.
  while (running) {
    try {
      const job = await api.nextJob();
      if (!job) {
        await sleep(config.pollIntervalMs);
        continue;
      }
      await executeJob(api, job);
    } catch (error) {
      if (error instanceof NodeTokenRejectedError) {
        stopRevoked();
        break;
      }
      log(`poll failed: ${errorMessage(error)}`);
      await sleep(config.errorBackoffMs);
    }
  }

  clearInterval(heartbeatTimer);
}

main().catch((error: unknown) => {
  console.error(errorMessage(error));
  process.exit(1);
});
