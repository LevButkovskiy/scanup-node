import { readFileSync } from "node:fs";
import type { CgroupReader, CpuStatSample } from "../types/node-metrics.types";

const CGROUP_ROOT = "/sys/fs/cgroup";
const SELF_CGROUP_FILE = "/proc/self/cgroup";
const ROOT_PATH = "/";

export type TextReader = (path: string) => string | null;

export interface CgroupReaderOptions {
  root?: string;
  selfCgroupFile?: string;
  readText?: TextReader;
}

function readFileText(path: string): string | null {
  try {
    return readFileSync(path, "utf8").trim();
  } catch {
    return null;
  }
}

export function parseCgroupPath(text: string | null): string | null {
  if (text === null) return null;
  const line = text.split("\n").find((entry) => entry.startsWith("0::"));
  return line ? line.slice("0::".length).trim() || ROOT_PATH : null;
}

function parseFields(text: string | null): Map<string, number> {
  const fields = new Map<string, number>();
  for (const line of (text ?? "").split("\n")) {
    const [name, value] = line.split(" ");
    if (name && value !== undefined) fields.set(name, Number(value));
  }
  return fields;
}

export function parseCpuStat(text: string | null): CpuStatSample | null {
  if (text === null) return null;
  const fields = parseFields(text);
  const usageUsec = fields.get("usage_usec");
  if (usageUsec === undefined || !Number.isFinite(usageUsec)) return null;
  const throttled = fields.get("nr_throttled");
  return {
    usageUsec,
    throttledPeriods:
      throttled !== undefined && Number.isFinite(throttled) ? throttled : null,
  };
}

export function parseCpuMax(text: string | null): number | null {
  if (text === null) return null;
  const [quota, period] = text.split(" ");
  if (!quota || quota === "max") return null;
  const cores = Number(quota) / Number(period);
  return Number.isFinite(cores) && cores > 0 ? cores : null;
}

export function parseBytes(text: string | null): number | null {
  if (text === null || text === "max") return null;
  const bytes = Number(text);
  return Number.isFinite(bytes) && bytes >= 0 ? bytes : null;
}

export function parseInactiveFile(text: string | null): number | null {
  const bytes = parseFields(text).get("inactive_file");
  return bytes !== undefined && Number.isFinite(bytes) ? bytes : null;
}

const UNAVAILABLE: CgroupReader = {
  readCpuStat: () => null,
  readCpuMax: () => null,
  readMemoryCurrent: () => null,
  readMemoryMax: () => null,
  readInactiveFile: () => null,
};

export function createCgroupReader(
  options: CgroupReaderOptions = {},
): CgroupReader {
  const {
    root = CGROUP_ROOT,
    selfCgroupFile = SELF_CGROUP_FILE,
    readText = readFileText,
  } = options;
  const path = parseCgroupPath(readText(selfCgroupFile));
  if (path === null) return UNAVAILABLE;
  const dir = path === ROOT_PATH ? root : `${root}${path}`;
  const read = (name: string): string | null => readText(`${dir}/${name}`);

  const isHostRoot =
    path === ROOT_PATH &&
    read("cpu.max") === null &&
    read("memory.current") === null;
  if (isHostRoot) return UNAVAILABLE;

  return {
    readCpuStat: () => parseCpuStat(read("cpu.stat")),
    readCpuMax: () => parseCpuMax(read("cpu.max")),
    readMemoryCurrent: () => parseBytes(read("memory.current")),
    readMemoryMax: () => parseBytes(read("memory.max")),
    readInactiveFile: () => parseInactiveFile(read("memory.stat")),
  };
}
