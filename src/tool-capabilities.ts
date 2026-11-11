import type { NodeCapability } from "./api-client";

export interface ToolCapabilitySource {
  capability: string;
  version: string;
}

export function capabilitiesOf(
  tools: readonly ToolCapabilitySource[],
): NodeCapability[] {
  const versionsByType = new Map<string, string[]>();
  for (const tool of tools) {
    const versions = versionsByType.get(tool.capability) ?? [];
    if (!versions.includes(tool.version)) versions.push(tool.version);
    versionsByType.set(tool.capability, versions);
  }
  return [...versionsByType].map(([type, schemaVersions]) => ({
    type,
    schemaVersions,
  }));
}
