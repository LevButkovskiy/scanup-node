export function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    // AbortSignal.timeout даёт DOMException TimeoutError — превращаем в
    // человекочитаемую причину для истории проверок
    if (error.name === "TimeoutError") return "Request timed out";
    return error.cause instanceof Error
      ? `${error.message}: ${error.cause.message}`
      : error.message;
  }
  return String(error);
}
