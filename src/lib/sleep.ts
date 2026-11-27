import { setTimeout as delay } from "node:timers/promises";

export async function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  try {
    await delay(ms, undefined, { signal });
  } catch (error) {
    if (!signal?.aborted) throw error;
  }
}
