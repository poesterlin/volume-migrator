import type { MountInfo } from "./mount-discovery";
import type { MountMapping, TransferStrategy } from "../domain/types";
import { MatchingError } from "../domain/errors";

/**
 * Determine transfer strategy based on mount type.
 * Volumes use docker tar streaming, bind mounts use rsync.
 */
function strategyFor(mount: MountInfo): TransferStrategy {
  return mount.type === "volume" ? "volume-stream" : "bind-rsync";
}

/**
 * Extract the last path segment (basename) from a source path.
 * For volumes this is the volume name, for binds the directory name.
 */
function basename(path: string): string {
  return path.split("/").filter(Boolean).pop() ?? path;
}

/**
 * Match source mounts to target mounts.
 *
 * Priority:
 * 1. Exact match on container-internal mount path (target) + same type
 * 2. Same container-internal mount path, different type
 * 3. Same type + similar source basename
 *
 * Unmatched source mounts cause a MatchingError — we refuse to guess.
 */
export function matchMounts(
  sourceMounts: MountInfo[],
  targetMounts: MountInfo[]
): MountMapping[] {
  if (sourceMounts.length === 0) {
    throw new MatchingError({
      code: "NO_SOURCE_MOUNTS",
      humanMessage: "Source service has no persistent mounts — nothing to migrate.",
      remediationHint: "Use 'inspect' to check what the source service looks like.",
    });
  }

  if (targetMounts.length === 0) {
    throw new MatchingError({
      code: "NO_TARGET_MOUNTS",
      humanMessage: "Target service has no persistent mounts — nowhere to migrate data to.",
      remediationHint:
        "Make sure the target service is deployed and has volumes or bind mounts configured.",
    });
  }

  const mappings: MountMapping[] = [];
  const usedTargetIndices = new Set<number>();

  for (const src of sourceMounts) {
    const match = findBestMatch(src, targetMounts, usedTargetIndices);

    if (!match) {
      const srcLabel = src.type === "volume" ? `volume "${src.source}"` : `bind "${src.source}"`;
      throw new MatchingError({
        code: "UNMATCHED_MOUNT",
        humanMessage: `Could not find a matching target mount for source ${srcLabel} (mounted at ${src.target}).`,
        technicalDetails: `Source: type=${src.type} source=${src.source} target=${src.target}`,
        remediationHint:
          "The target service must have a mount with the same container path or a similar name. " +
          "Use 'inspect' on both hosts to compare mounts.",
      });
    }

    usedTargetIndices.add(match.index);
    mappings.push({
      source: src,
      target: match.mount,
      strategy: strategyFor(src),
    });
  }

  return mappings;
}

type MatchCandidate = {
  mount: MountInfo;
  index: number;
};

function findBestMatch(
  source: MountInfo,
  targets: MountInfo[],
  usedIndices: Set<number>
): MatchCandidate | undefined {
  // Pass 1: exact container path + same type
  for (let i = 0; i < targets.length; i++) {
    if (usedIndices.has(i)) continue;
    const t = targets[i]!;
    if (t.target === source.target && t.type === source.type) {
      return { mount: t, index: i };
    }
  }

  // Pass 2: same container path, any type
  for (let i = 0; i < targets.length; i++) {
    if (usedIndices.has(i)) continue;
    const t = targets[i]!;
    if (t.target === source.target) {
      return { mount: t, index: i };
    }
  }

  // Pass 3: same type + matching basename
  const srcBase = basename(source.source);
  for (let i = 0; i < targets.length; i++) {
    if (usedIndices.has(i)) continue;
    const t = targets[i]!;
    if (t.type === source.type && basename(t.source) === srcBase) {
      return { mount: t, index: i };
    }
  }

  return undefined;
}
