import { readFileSync } from "node:fs";
import { join } from "node:path";

// package.json лежит на уровень выше dist/ — читаем на рантайме, чтобы
// версия не дублировалась в коде
export function readPackageVersion(): string {
  const raw = readFileSync(join(__dirname, "..", "..", "package.json"), "utf8");
  const parsed = JSON.parse(raw) as { version?: string };
  return parsed.version ?? "0.0.0";
}
