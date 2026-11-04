import { ApiResponseError, NodeTokenRejectedError } from "../api-client";
import type { ApiClient } from "../api-client";
import { errorMessage } from "../lib/error-message";
import { log } from "../lib/log";
import type { NodeMetricsBody } from "../types/node-metrics.types";
import { fitToApiLimits } from "./metrics-limits";
import type { SystemSampler } from "./system-sampler";
import type { WorkerLoadTracker } from "./worker-load-tracker";

export interface MetricsReporterOptions {
  api: Pick<ApiClient, "sendMetrics">;
  tracker: WorkerLoadTracker;
  sampler: Pick<SystemSampler, "sample">;
  onTokenRejected: () => void;
}

export class MetricsReporter {
  private readonly loggedFailures = new Set<string>();

  constructor(private readonly options: MetricsReporterOptions) {}

  async report(): Promise<void> {
    const { api, tracker, sampler, onTokenRejected } = this.options;
    const body: NodeMetricsBody = fitToApiLimits({
      ...tracker.snapshotAndReset(),
      ...sampler.sample(),
    });
    try {
      await api.sendMetrics(body);
      this.loggedFailures.clear();
    } catch (error) {
      if (error instanceof NodeTokenRejectedError) {
        onTokenRejected();
        return;
      }
      this.logFailureOnce(error);
    }
  }

  private logFailureOnce(error: unknown): void {
    const kind =
      error instanceof ApiResponseError ? `http-${error.status}` : "network";
    if (this.loggedFailures.has(kind)) return;
    this.loggedFailures.add(kind);
    const unsupported =
      error instanceof ApiResponseError &&
      (error.status === 404 || error.status === 400);
    log(
      unsupported
        ? `metrics not accepted by the API (${errorMessage(error)}) — node keeps working, will keep trying`
        : `metrics report failed: ${errorMessage(error)}`,
    );
  }
}
