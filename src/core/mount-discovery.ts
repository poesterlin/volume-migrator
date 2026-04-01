import { exec } from "../infra/ssh.ts";

export type MountInfo = {
  type: "volume" | "bind";
  source: string;
  target: string;
  readOnly: boolean;
};

type DockerMountEntry = {
  Type: string;
  Source: string;
  Destination: string;
  RW: boolean;
};

function toMountInfo(entry: DockerMountEntry): MountInfo {
  return {
    type: entry.Type === "volume" ? "volume" : "bind",
    source: entry.Source,
    target: entry.Destination,
    readOnly: !entry.RW,
  };
}

export async function inspectServiceMounts(host: string | undefined, service: string): Promise<MountInfo[]> {
  if (!service.trim()) {
    return [];
  }

  // Find container IDs that match this service name via label or container name
  const findResult = await exec(
    host,
    `docker ps -a --filter "label=coolify.name=${service}" --filter "label=com.docker.compose.service=${service}" --format '{{.ID}}' | sort -u`
  );

  let containerIds: string[] = [];

  if (findResult.exitCode === 0 && findResult.stdout.trim()) {
    containerIds = findResult.stdout.split("\n").filter((id: string) => id.trim());
  }

  // Fallback: try matching by container name
  if (containerIds.length === 0) {
    const fallback = await exec(
      host,
      `docker ps -a --filter "name=${service}" --format '{{.ID}}'`
    );
    if (fallback.exitCode === 0 && fallback.stdout.trim()) {
      containerIds = fallback.stdout.split("\n").filter((id: string) => id.trim());
    }
  }

  if (containerIds.length === 0) {
    return [];
  }

  const allMounts: MountInfo[] = [];
  const seen = new Set<string>();

  for (const id of containerIds) {
    const inspectResult = await exec(
      host,
      `docker inspect --format '{{json .Mounts}}' ${id}`
    );

    if (inspectResult.exitCode !== 0 || !inspectResult.stdout.trim()) {
      continue;
    }

    const entries = JSON.parse(inspectResult.stdout) as DockerMountEntry[];
    for (const entry of entries) {
      // Skip tmpfs and other non-persistent mounts
      if (entry.Type !== "volume" && entry.Type !== "bind") {
        continue;
      }

      const key = `${entry.Type}:${entry.Source}:${entry.Destination}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      allMounts.push(toMountInfo(entry));
    }
  }

  return allMounts;
}
