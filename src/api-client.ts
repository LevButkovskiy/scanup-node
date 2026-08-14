import type { NodeConfig } from "./config";

// Протокол ноды (backend: NodesController, авторизация Bearer-токеном):
//   POST /nodes/heartbeat
//   GET  /nodes/jobs/next          -> { job: DispatchedJob | null }
//   POST /nodes/jobs/:jobId/result
// jobId — идентификатор job'ы в очереди backend'а; нода его не интерпретирует.

export interface NodeCapability {
  type: string;
  schemaVersions: string[];
}

export interface HeartbeatBody {
  version: string;
  capabilities: NodeCapability[];
}

export interface DispatchedJob {
  jobId: string;
  jobType: string;
  payload: Record<string, unknown>;
}

export interface SubmitResultBody {
  status: "done" | "failed";
  result?: Record<string, unknown>;
  error?: string;
}

export class NodeTokenRejectedError extends Error {
  constructor() {
    super("node token rejected (revoked or invalid)");
    this.name = "NodeTokenRejectedError";
  }
}

export class ApiClient {
  constructor(private readonly config: NodeConfig) {}

  async heartbeat(body: HeartbeatBody): Promise<void> {
    await this.request("POST", "/nodes/heartbeat", body);
  }

  async nextJob(
    waitMs: number,
    signal?: AbortSignal,
  ): Promise<DispatchedJob | null> {
    const response = await this.request<{ job: DispatchedJob | null }>(
      "GET",
      `/nodes/jobs/next?wait=${waitMs}`,
      undefined,
      waitMs + 10_000,
      signal,
    );
    return response.job;
  }

  async submitResult(jobId: string, body: SubmitResultBody): Promise<void> {
    await this.request(
      "POST",
      `/nodes/jobs/${encodeURIComponent(jobId)}/result`,
      body,
    );
  }

  private async request<T>(
    method: "GET" | "POST",
    path: string,
    body?: unknown,
    timeoutMs = 30_000,
    signal?: AbortSignal,
  ): Promise<T> {
    const timeoutSignal = AbortSignal.timeout(timeoutMs);
    const response = await fetch(`${this.config.apiUrl}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${this.config.nodeToken}`,
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: signal ? AbortSignal.any([timeoutSignal, signal]) : timeoutSignal,
    });

    if (response.status === 401) {
      throw new NodeTokenRejectedError();
    }
    if (!response.ok) {
      throw new Error(`${method} ${path} failed: HTTP ${response.status}`);
    }
    return (await response.json()) as T;
  }
}
