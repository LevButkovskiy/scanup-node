export interface WaitForShutdownOptions {
  signal: AbortSignal;
  remindEveryMs: number;
  remind: () => void;
}
