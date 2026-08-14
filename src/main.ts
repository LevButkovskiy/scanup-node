import {
  ApiClient,
  NodeTokenRejectedError,
  type DispatchedJob,
  type NodeCapability,
} from "./api-client";
import { parseDnsLookupPayload, runDnsLookup } from "./checks/dns-lookup";
import { parseHttpPingPayload, runHttpPing } from "./checks/http-ping";
import { parsePingPayload, runPing } from "./checks/ping";
import { parseSslCheckPayload, runSslCheck } from "./checks/ssl-check";
import { parseWhoisLookupPayload, runWhoisLookup } from "./checks/whois-lookup";
import { loadConfig, type NodeConfig } from "./config";
import { errorMessage } from "./lib/error-message";
import { log } from "./lib/log";
import { sleep } from "./lib/sleep";
import { readPackageVersion } from "./lib/version";

interface ToolDefinition {
  wireType: string;
  capability: string;
  version: string;
  run: (payload: Record<string, unknown>) => Promise<unknown>;
}

const TOOLS: readonly ToolDefinition[] = [
  {
    wireType: "http_ping",
    capability: "http_ping",
    version: "v1",
    run: async (payload) => {
      const result = await runHttpPing(parseHttpPingPayload(payload));
      return {
        statusCode: result.statusCode,
        responseTimeMs: result.responseTimeMs,
      };
    },
  },
  {
    wireType: "dns.v1",
    capability: "dns",
    version: "v1",
    run: (payload) => runDnsLookup(parseDnsLookupPayload(payload)),
  },
  {
    wireType: "whois.v1",
    capability: "whois",
    version: "v1",
    run: (payload) => runWhoisLookup(parseWhoisLookupPayload(payload)),
  },
  {
    wireType: "ssl.v1",
    capability: "ssl",
    version: "v1",
    run: (payload) => runSslCheck(parseSslCheckPayload(payload)),
  },
  {
    wireType: "ping.v1",
    capability: "ping",
    version: "v1",
    run: (payload) => runPing(parsePingPayload(payload)),
  },
];

const CAPABILITIES: NodeCapability[] = TOOLS.map((tool) => ({
  type: tool.capability,
  schemaVersions: [tool.version],
}));

const TOOLS_BY_WIRE_TYPE = new Map(TOOLS.map((tool) => [tool.wireType, tool]));

async function runJob(
  jobType: string,
  payload: Record<string, unknown>,
): Promise<unknown> {
  const tool = TOOLS_BY_WIRE_TYPE.get(jobType);
  if (!tool) {
    throw new Error(`Unsupported jobType: ${jobType}`);
  }
  return tool.run(payload);
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

async function runWorker(
  workerId: number,
  api: ApiClient,
  config: NodeConfig,
  isRunning: () => boolean,
  shutdownSignal: AbortSignal,
  stopRevoked: () => void,
): Promise<void> {
  while (isRunning()) {
    try {
      const job = await api.nextJob(config.jobWaitMs, shutdownSignal);
      if (!job) continue; // long-poll вернулся пусто — сразу спрашиваем снова
      await executeJob(api, job);
    } catch (error) {
      if (error instanceof NodeTokenRejectedError) {
        stopRevoked();
        return;
      }
      if (shutdownSignal.aborted) return; // штатное завершение оборвало long-poll
      log(`worker ${workerId}: poll failed: ${errorMessage(error)}`);
      await sleep(config.errorBackoffMs);
    }
  }
}

async function main(): Promise<void> {
  const config = loadConfig();
  const api = new ApiClient(config);
  const version = readPackageVersion();

  log(
    `scanup-node v${version} starting (concurrency: ${config.jobConcurrency})` +
      (config.location ? ` — location: ${config.location}` : ""),
  );

  let running = true;
  const shutdown = new AbortController();
  const stop = (): void => {
    log("shutting down...");
    running = false;
    shutdown.abort();
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);

  const stopRevoked = (): void => {
    log("node token revoked — shutting down");
    running = false;
    shutdown.abort();
  };

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

  const workers = Array.from({ length: config.jobConcurrency }, (_, i) =>
    runWorker(i, api, config, () => running, shutdown.signal, stopRevoked),
  );
  await Promise.all(workers);

  clearInterval(heartbeatTimer);
}

main().catch((error: unknown) => {
  console.error(errorMessage(error));
  process.exit(1);
});
