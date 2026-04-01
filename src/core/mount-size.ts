import { exec } from "../infra/ssh";
import type { MountInfo } from "./mount-discovery";

/**
 * Measure the size of a mount on a host.
 * Returns human-readable size string (e.g. "142M") or undefined on failure.
 *
 * - Volumes: uses a temporary alpine container with the volume mounted read-only.
 * - Binds: uses du directly on the host path.
 */
export async function measureMountSize(
  host: string | undefined,
  mount: MountInfo
): Promise<string | undefined> {
  let command: string;

  if (mount.type === "volume") {
    // Extract volume name from the full source path.
    // Docker volume source paths look like /var/lib/docker/volumes/<name>/_data
    // but the volume name for `docker run -v` is just <name>.
    const volumeName = extractVolumeName(mount.source);
    command = `docker run --rm -v ${volumeName}:/data:ro alpine du -sh /data 2>/dev/null | cut -f1`;
  } else {
    command = `du -sh ${mount.source} 2>/dev/null | cut -f1`;
  }

  const result = await exec(host, command);
  if (result.exitCode !== 0 || !result.stdout.trim()) {
    return undefined;
  }

  return result.stdout.trim();
}

/**
 * Extract Docker volume name from a full source path.
 * e.g. "/var/lib/docker/volumes/myvolume/_data" -> "myvolume"
 * e.g. "/mnt/Volume1/docker-data/volumes/myvolume/_data" -> "myvolume"
 *
 * Falls back to the full path if pattern doesn't match.
 */
function extractVolumeName(source: string): string {
  const match = source.match(/\/volumes\/([^/]+)\/_data$/);
  return match?.[1] ?? source;
}
