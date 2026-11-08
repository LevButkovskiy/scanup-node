import {
  ApiClient,
  NodeTokenRejectedError,
  type DispatchedJob,
  type NodeCapability,
  type NodeLocation,
  type SubmitResultBody,
} from "./api-client";
import { parseDnsLookupPayload, runDnsLookup } from "./checks/dns-lookup";
import { parseHttpCheckPayload, runHttpCheck } from "./checks/http-check";
import { parseHttpPingPayload, runHttpPing } from "./checks/http-ping";
import {
  isIcmpPingAvailable,
  parseIcmpPingPayload,
  runIcmpPing,
} from "./checks/icmp-ping";
import { parsePingPayload, runPing } from "./checks/ping";
import { parseSslCheckPayload, runSslCheck } from "./checks/ssl-check";
import { parseWhoisLookupPayload, runWhoisLookup } from "./checks/whois-lookup";
import { loadConfig, type NodeConfig } from "./config";
import { errorMessage } from "./lib/error-message";
import { log } from "./lib/log";
import { sleep } from "./lib/sleep";
import { MetricsReporter } from "./metrics/metrics-reporter";
import { SystemSampler } from "./metrics/system-sampler";
import { WorkerLoadTracker } from "./metrics/worker-load-tracker";
import { readPackageVersion } from "./lib/version";
import { submitResultWithRetry } from "./submit-result";
import type { HttpPingRunOptions } from "./types/http-ping.types";
import type { IcmpPingRunOptions } from "./types/icmp-ping.types";

type ToolRunOptions = HttpPingRunOptions & IcmpPingRunOptions;

interface ToolDefinition {
  wireType: string;
  capability: string;
  version: string;
  run: (
    payload: Record<string, unknown>,
    options: ToolRunOptions,
  ) => Promise<unknown>;
}

const TOOLS: readonly ToolDefinition[] = [
  {
    wireType: "http_ping",
    capability: "http_ping",
    version: "v1",
    run: async (payload, { allowPrivateTargets }) => {
      const result = await runHttpPing(parseHttpPingPayload(payload), {
        allowPrivateTargets,
      });
      return {
        statusCode: result.statusCode,
        responseTimeMs: result.responseTimeMs,
      };
    },
  },
  {
    wireType: "icmp_ping",
    capability: "icmp_ping",
    version: "v1",
    run: (payload, { allowPrivateTargets }) =>
      runIcmpPing(parseIcmpPingPayload(payload), { allowPrivateTargets }),
  },
  {
    wireType: "http_check.v1",
    capability: "http_check",
    version: "v1",
    run: (payload) => runHttpCheck(parseHttpCheckPayload(payload)),
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

async function detectCapabilities(): Promise<NodeCapability[]> {
  const icmpPingAvailable = await isIcmpPingAvailable();
  if (!icmpPingAvailable) {
    log(
      "ERROR: ping to 127.0.0.1 failed, icmp_ping capability is not announced — check ICMP permissions (net.ipv4.ping_group_range or CAP_NET_RAW)",
    );
  }
  return TOOLS.filter(
    (tool) => icmpPingAvailable || tool.capability !== "icmp_ping",
  ).map((tool) => ({
    type: tool.capability,
    schemaVersions: [tool.version],
  }));
}

const TOOLS_BY_WIRE_TYPE = new Map(TOOLS.map((tool) => [tool.wireType, tool]));

async function runJob(
  jobType: string,
  payload: Record<string, unknown>,
  options: ToolRunOptions,
): Promise<unknown> {
  const tool = TOOLS_BY_WIRE_TYPE.get(jobType);
  if (!tool) {
    throw new Error(`Unsupported jobType: ${jobType}`);
  }
  return tool.run(payload, options);
}

async function executeJob(
  api: ApiClient,
  job: DispatchedJob,
  shutdownSignal: AbortSignal,
  tracker: WorkerLoadTracker,
  options: ToolRunOptions,
): Promise<void> {
  let body: SubmitResultBody;
  try {
    const result = (await runJob(job.jobType, job.payload, options)) as Record<
      string,
      unknown
    >;
    body = { status: "done", result };
  } catch (error) {
    body = { status: "failed", error: errorMessage(error) };
  }
  const outcome = await submitResultWithRetry({
    api,
    jobId: job.jobId,
    body,
    signal: shutdownSignal,
    onThrottled: () => tracker.throttled(),
  });
  if (outcome !== "delivered") {
    tracker.gaveUp();
    return;
  }
  tracker.delivered(body.status);
  log(
    body.status === "done"
      ? `job ${job.jobId}: done (${job.jobType})`
      : `job ${job.jobId}: failed (${body.error})`,
  );
}

async function runWorker(
  workerId: number,
  api: ApiClient,
  config: NodeConfig,
  isRunning: () => boolean,
  shutdownSignal: AbortSignal,
  stopRevoked: () => void,
  tracker: WorkerLoadTracker,
): Promise<void> {
  while (isRunning()) {
    try {
      const job = await api.nextJob(config.jobWaitMs, shutdownSignal);
      if (!job) {
        tracker.idlePoll();
        continue;
      }
      tracker.jobStarted();
      try {
        await executeJob(api, job, shutdownSignal, tracker, {
          allowPrivateTargets: config.allowPrivateTargets,
        });
      } finally {
        tracker.jobFinished();
      }
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

function describeLocation(location: NodeLocation | null): string | null {
  if (!location) return null;
  return [location.city, location.countryCode].filter(Boolean).join(", ");
}

async function main(): Promise<void> {
  const config = loadConfig();
  const api = new ApiClient(config);
  const version = readPackageVersion();

  log(
    `scanup-node v${version} starting (concurrency: ${config.jobConcurrency})` +
      (describeLocation(config.location)
        ? ` — location: ${describeLocation(config.location)}`
        : ""),
  );

  if (config.allowPrivateTargets) {
    log(
      "WARN: ALLOW_PRIVATE_TARGETS=true — monitor checks (http_ping, icmp_ping) may reach private and internal addresses from this node",
    );
  }

  const capabilities = await detectCapabilities();

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
      await api.heartbeat({
        version,
        capabilities,
        ...(config.location ? { location: config.location } : {}),
      });
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

  const tracker = new WorkerLoadTracker(config.jobConcurrency);
  const metricsReporter = new MetricsReporter({
    api,
    tracker,
    sampler: new SystemSampler(),
    onTokenRejected: stopRevoked,
  });
  const metricsTimer = setInterval(() => {
    void metricsReporter.report();
  }, config.heartbeatIntervalMs);

  const workers = Array.from({ length: config.jobConcurrency }, (_, i) =>
    runWorker(
      i,
      api,
      config,
      () => running,
      shutdown.signal,
      stopRevoked,
      tracker,
    ),
  );
  await Promise.all(workers);

  clearInterval(heartbeatTimer);
  clearInterval(metricsTimer);
}

main().catch((error: unknown) => {
  console.error(errorMessage(error));
  process.exit(1);
});
