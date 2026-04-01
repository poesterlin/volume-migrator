import type { MigrationPlan, MigrateFlags } from "../domain/types";
import { DiscoveryError } from "../domain/errors";
import { inspectServiceMounts } from "./mount-discovery";
import { measureMountSize } from "./mount-size";
import { listServicesOnHost } from "./service-discovery";
import { matchMounts } from "./matching";
import { exec, resolveSshKey } from "../infra/ssh";

// ---------------------------------------------------------------------------
// Service resolution
// ---------------------------------------------------------------------------

/**
 * Resolve a service name on a host — verify it actually exists.
 * Throws DiscoveryError if the service is not found.
 */
async function resolveService(
  host: string | undefined,
  serviceName: string,
): Promise<string> {
  const label = host ?? "localhost";
  const services = await listServicesOnHost(host);
  const match = services.find(
    (s) => s.name.toLowerCase() === serviceName.toLowerCase(),
  );

  if (!match) {
    const available = services.map((s) => s.name).join(", ");
    throw new DiscoveryError({
      code: "SERVICE_NOT_FOUND",
      humanMessage: `Service "${serviceName}" not found on ${label}.`,
      technicalDetails: available
        ? `Available services: ${available}`
        : "No services found on this host.",
      remediationHint: host
        ? `Run 'list-services --host ${host}' to see what's available.`
        : "Run 'list-services' to see what's available locally.",
    });
  }

  return match.name;
}

// ---------------------------------------------------------------------------
// Database detection
// ---------------------------------------------------------------------------

const DB_IMAGE_PATTERNS = [
  "postgres",
  "mysql",
  "mariadb",
  "redis",
  "mongo",
  "mongodb",
  "clickhouse",
  "influxdb",
  "couchdb",
  "cassandra",
  "elasticsearch",
  "meilisearch",
];

/**
 * Fetch the container images used by a service on a host.
 */
async function getServiceImages(
  host: string | undefined,
  service: string,
): Promise<string[]> {
  // Try Coolify label
  const byLabel = await exec(
    host,
    `docker ps -a --filter "label=coolify.name=${service}" --format '{{.Image}}' | sort -u`,
  );

  if (byLabel.exitCode === 0 && byLabel.stdout.trim()) {
    return byLabel.stdout.split("\n").filter((i) => i.trim());
  }

  // Try compose label
  const byCompose = await exec(
    host,
    `docker ps -a --filter "label=com.docker.compose.service=${service}" --format '{{.Image}}' | sort -u`,
  );

  if (byCompose.exitCode === 0 && byCompose.stdout.trim()) {
    return byCompose.stdout.split("\n").filter((i) => i.trim());
  }

  // Fallback by name
  const byName = await exec(
    host,
    `docker ps -a --filter "name=${service}" --format '{{.Image}}'`,
  );

  if (byName.exitCode === 0 && byName.stdout.trim()) {
    return byName.stdout.split("\n").filter((i) => i.trim());
  }

  return [];
}

/**
 * Check images against known DB patterns and return warnings.
 */
function detectDatabaseWarnings(
  images: string[],
  serviceName: string,
): string[] {
  const warnings: string[] = [];

  for (const image of images) {
    const lower = image.toLowerCase();
    const dbMatch = DB_IMAGE_PATTERNS.find((p) => lower.includes(p));
    if (dbMatch) {
      warnings.push(
        `Service "${serviceName}" appears to be a database (image: ${image}). ` +
          `Copying database files from a running instance risks data corruption. ` +
          `Stop the source container before migration or use --allow-live-db-copy to proceed at your own risk.`,
      );
      break; // One DB warning per service is sufficient
    }
  }

  return warnings;
}

// ---------------------------------------------------------------------------
// Plan builder
// ---------------------------------------------------------------------------

/**
 * Build a migration plan from the provided flags.
 *
 * Steps:
 * 1. Resolve source and target services (verify they exist)
 * 2. Discover mounts on both sides
 * 3. Match source mounts to target mounts
 * 4. Measure sizes (in parallel)
 * 5. Detect database workloads and generate warnings
 * 6. Return the complete plan
 */
export async function buildMigrationPlan(
  flags: MigrateFlags,
): Promise<MigrationPlan> {
  const sourceHost = flags.source;
  const targetHost = flags.target;

  // Resolve Coolify SSH keys for remote hosts before any remote calls
  await Promise.all([
    sourceHost ? resolveSshKey(sourceHost) : undefined,
    targetHost ? resolveSshKey(targetHost) : undefined,
  ]);

  // Resolve services
  const sourceService = await resolveService(sourceHost, flags.sourceService!);
  const targetService = await resolveService(targetHost, flags.targetService!);

  // Discover mounts
  const sourceMounts = await inspectServiceMounts(sourceHost, sourceService);
  const targetMounts = await inspectServiceMounts(targetHost, targetService);

  // Match source -> target
  const mappings = matchMounts(sourceMounts, targetMounts);

  // Measure sizes in parallel
  const sizeResults = await Promise.all(
    mappings.flatMap((m) => [
      measureMountSize(sourceHost, m.source),
      measureMountSize(targetHost, m.target),
    ]),
  );

  for (let i = 0; i < mappings.length; i++) {
    mappings[i]!.sourceSize = sizeResults[i * 2];
    mappings[i]!.targetSize = sizeResults[i * 2 + 1];
  }

  // Detect database warnings
  const sourceImages = await getServiceImages(sourceHost, sourceService);
  const warnings = detectDatabaseWarnings(sourceImages, sourceService);

  return {
    sourceHost: sourceHost ?? "localhost",
    targetHost: targetHost ?? "localhost",
    sourceService,
    targetService,
    mappings,
    stopSource: flags.stopSource ?? false,
    stopTarget: flags.stopTarget ?? false,
    startTarget: flags.startTarget ?? false,
    clearTarget: flags.clearTarget ?? false,
    warnings,
  };
}
