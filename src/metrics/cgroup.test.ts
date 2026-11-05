import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createCgroupReader,
  parseBytes,
  parseCgroupPath,
  parseCpuMax,
  parseCpuStat,
  parseInactiveFile,
} from "./cgroup";

describe("cgroup parsing", () => {
  it("reads usage and throttling from cpu.stat", () => {
    const stat = parseCpuStat(
      "usage_usec 12345\nuser_usec 1\nsystem_usec 2\nnr_periods 9\nnr_throttled 3\nthrottled_usec 7",
    );
    assert.deepEqual(stat, { usageUsec: 12345, throttledPeriods: 3 });
    assert.equal(parseCpuStat("usage_usec 5")?.throttledPeriods, null);
  });

  it("returns null when cpu.stat is missing or has no usage", () => {
    assert.equal(parseCpuStat(null), null);
    assert.equal(parseCpuStat("nr_periods 9"), null);
  });

  it("converts cpu.max quota to cores and treats max as unlimited", () => {
    assert.equal(parseCpuMax("150000 100000"), 1.5);
    assert.equal(parseCpuMax("max 100000"), null);
    assert.equal(parseCpuMax(null), null);
  });

  it("treats memory.max of max as no limit", () => {
    assert.equal(parseBytes("268435456"), 268435456);
    assert.equal(parseBytes("max"), null);
    assert.equal(parseBytes(null), null);
  });

  it("takes the path from the cgroup v2 line", () => {
    assert.equal(
      parseCgroupPath("0::/system.slice/docker-abc.scope\n"),
      "/system.slice/docker-abc.scope",
    );
    assert.equal(parseCgroupPath("12:cpu:/x\n0::/\n"), "/");
    assert.equal(parseCgroupPath("12:cpu:/x"), null);
    assert.equal(parseCgroupPath(null), null);
  });

  it("reads inactive_file from memory.stat", () => {
    assert.equal(
      parseInactiveFile("anon 1\ninactive_file 4096\nactive_file 2"),
      4096,
    );
    assert.equal(parseInactiveFile("anon 1"), null);
  });
});

function files(entries: Record<string, string>) {
  return (path: string): string | null => entries[path] ?? null;
}

describe("createCgroupReader", () => {
  it("reads the cgroup directory named in /proc/self/cgroup", () => {
    const reader = createCgroupReader({
      root: "/cg",
      selfCgroupFile: "/self",
      readText: files({
        "/self": "0::/kubepods/pod1",
        "/cg/kubepods/pod1/cpu.stat": "usage_usec 7\nnr_throttled 1",
        "/cg/kubepods/pod1/cpu.max": "200000 100000",
        "/cg/kubepods/pod1/memory.current": "1000",
        "/cg/kubepods/pod1/memory.max": "max",
      }),
    });
    assert.deepEqual(reader.readCpuStat(), {
      usageUsec: 7,
      throttledPeriods: 1,
    });
    assert.equal(reader.readCpuMax(), 2);
    assert.equal(reader.readMemoryCurrent(), 1000);
    assert.equal(reader.readMemoryMax(), null);
  });

  it("reads the root directory in a container with its own cgroup namespace", () => {
    const reader = createCgroupReader({
      root: "/cg",
      selfCgroupFile: "/self",
      readText: files({
        "/self": "0::/",
        "/cg/cpu.stat": "usage_usec 7",
        "/cg/cpu.max": "max 100000",
        "/cg/memory.current": "1000",
      }),
    });
    assert.equal(reader.readCpuStat()?.usageUsec, 7);
    assert.equal(reader.readMemoryCurrent(), 1000);
  });

  it("reports nothing on the host root cgroup so cpu and memory both fall back to host", () => {
    const reader = createCgroupReader({
      root: "/cg",
      selfCgroupFile: "/self",
      readText: files({
        "/self": "0::/",
        "/cg/cpu.stat": "usage_usec 7\nnr_throttled 0",
      }),
    });
    assert.equal(reader.readCpuStat(), null);
    assert.equal(reader.readMemoryCurrent(), null);
  });

  it("reports nothing without cgroup v2", () => {
    const reader = createCgroupReader({
      root: "/cg",
      selfCgroupFile: "/self",
      readText: files({}),
    });
    assert.equal(reader.readCpuStat(), null);
  });
});
