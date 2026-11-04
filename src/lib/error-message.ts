function errorCode(error: object): string {
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" ? code : "";
}

function nestedErrors(error: object): unknown[] {
  const errors = (error as { errors?: unknown }).errors;
  return Array.isArray(errors) ? errors : [];
}

function joinedReasons(errors: unknown[]): string {
  return errors.map(reasonOf).filter(Boolean).join("; ");
}

function reasonOf(error: unknown): string {
  if (typeof error !== "object" || error === null) return "";
  const nested = joinedReasons(nestedErrors(error));
  if (nested) return nested;
  const message = (error as { message?: unknown }).message;
  if (typeof message === "string" && message) return message;
  return errorCode(error);
}

export function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    // AbortSignal.timeout даёт DOMException TimeoutError — превращаем в
    // человекочитаемую причину для истории проверок
    if (error.name === "TimeoutError") return "Request timed out";
    const reason = error.cause
      ? reasonOf(error.cause)
      : joinedReasons(nestedErrors(error));
    if (error.message && reason) return `${error.message}: ${reason}`;
    return error.message || reason || errorCode(error) || error.name;
  }
  return String(error);
}
