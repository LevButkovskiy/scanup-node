import { ApiClient, type DispatchedJob } from "./api-client";
import { parseHttpPingPayload, runHttpPing } from "./checks/http-ping";
import { loadConfig } from "./config";
import { errorMessage } from "./lib/error-message";
import { log } from "./lib/log";
import { sleep } from "./lib/sleep";
import { readPackageVersion } from "./lib/version";

const CAPABILITIES = [{ type: "http-ping", schemaVersions: ["v1"] }];

async function executeJob(api: ApiClient, job: DispatchedJob): Promise<void> {
  if (job.jobType !== "http-ping") {
    await api.submitResult(job.jobId, {
      status: "failed",
      error: `Unsupported jobType: ${job.jobType}`,
    });
    return;
  }

  try {
    const payload = parseHttpPingPayload(job.payload);
    const result = await runHttpPing(payload);
    await api.submitResult(job.jobId, {
      status: "done",
      result: {
        statusCode: result.statusCode,
        responseTimeMs: result.responseTimeMs,
      },
    });
    log(
      `job ${job.jobId}: done (status ${result.statusCode}, ${result.responseTimeMs}ms)`,
    );
  } catch (error) {
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

  // Heartbeat — отдельный самопланирующийся цикл, ошибки не фатальны:
  // backend восстановит картину на следующем успешном heartbeat'е.
  const sendHeartbeat = async (): Promise<void> => {
    try {
      await api.heartbeat({ version, capabilities: CAPABILITIES });
    } catch (error) {
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
