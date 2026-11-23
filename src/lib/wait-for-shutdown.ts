import type { WaitForShutdownOptions } from "../types/shutdown.types";

export function waitForShutdown(
  options: WaitForShutdownOptions,
): Promise<void> {
  const { signal, remindEveryMs, remind } = options;
  if (signal.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const reminder = setInterval(remind, remindEveryMs);
    signal.addEventListener(
      "abort",
      () => {
        clearInterval(reminder);
        resolve();
      },
      { once: true },
    );
  });
}
