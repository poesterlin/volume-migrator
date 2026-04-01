import { exec } from "../infra/ssh.ts";

export type ContainerStatus = "running" | "stopped" | "restarting" | "exited" | "unknown";

export type DiscoveredService = {
  name: string;
  containers: number;
  status: ContainerStatus;
};

type DockerPsEntry = {
  Names: string;
  State: string;
  Labels: string;
};

function parseStatus(state: string): ContainerStatus {
  const s = state.toLowerCase();
  if (s === "running") return "running";
  if (s === "exited") return "exited";
  if (s === "restarting") return "restarting";
  if (s === "created" || s === "paused" || s === "dead") return "stopped";
  return "unknown";
}

function groupByService(entries: DockerPsEntry[]): DiscoveredService[] {
  const serviceMap = new Map<string, { count: number; status: ContainerStatus }>();

  for (const entry of entries) {
    // Coolify labels its containers with coolify.name or com.docker.compose.service
    const labels = Object.fromEntries(
      entry.Labels.split(",").map((l) => {
        const [key, ...rest] = l.split("=");
        return [key?.trim(), rest.join("=").trim()];
      })
    );

    const serviceName =
      labels["coolify.name"] ||
      labels["com.docker.compose.service"] ||
      entry.Names.split(",")[0]?.trim() ||
      "unknown";

    const existing = serviceMap.get(serviceName);
    const status = parseStatus(entry.State);

    if (existing) {
      existing.count += 1;
      // If any container is running, mark the service as running
      if (status === "running") {
        existing.status = "running";
      }
    } else {
      serviceMap.set(serviceName, { count: 1, status });
    }
  }

  return Array.from(serviceMap.entries()).map(([name, info]) => ({
    name,
    containers: info.count,
    status: info.status,
  }));
}

export async function listServicesOnHost(host?: string): Promise<DiscoveredService[]> {
  const label = host || "localhost";
  const format = '{"Names":"{{.Names}}","State":"{{.State}}","Labels":"{{.Labels}}"}';
  const result = await exec(host, `docker ps -a --format '${format}'`);

  if (result.exitCode !== 0) {
    throw new Error(
      `Failed to list containers on ${label}: ${result.stderr || "unknown error"}`
    );
  }

  if (!result.stdout) {
    return [];
  }

  const entries: DockerPsEntry[] = result.stdout
    .split("\n")
    .filter((line: string) => line.trim())
    .map((line: string) => JSON.parse(line) as DockerPsEntry);

  return groupByService(entries);
}
