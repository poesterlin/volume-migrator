import type { MountInfo } from "./mount-discovery";
import type { MigrationPlan, MigrateFlags } from "../domain/types";
import { DiscoveryError } from "../domain/errors";
import { inspectServiceMounts } from "./mount-discovery";
import { measureMountSize } from "./mount-size";
import { listServicesOnHost } from "./service-discovery";
import { matchMounts } from "./matching";

/**
 * Resolve a service name on a host — verify it actually exists.
 * Throws DiscoveryError if the service is not found.
 */
async function resolveService(host: string | undefined, serviceName: string): Promise<string> {
  const label = host ?? "localhost";
  const services = await listServicesOnHost(host);
  const match = services.find(
    (s) => s.name.toLowerCase() === serviceName.toLowerCase()
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

/**
 * Build a migration plan from the provided flags.
 *
 * Steps:
 * 1. Resolve source and target services (verify they exist)
 * 2. Discover mounts on both sides
 * 3. Match source mounts to target mounts
 * 4. Return the plan
 */
export async function buildMigrationPlan(flags: MigrateFlags): Promise<MigrationPlan> {
  const sourceHost = flags.source;
  const targetHost = flags.target;

  // Resolve services
  const sourceService = await resolveService(sourceHost, flags.sourceService!);
  const targetService = await resolveService(targetHost, flags.targetService!);

  // Discover mounts
  const sourceMounts = await inspectServiceMounts(sourceHost, sourceService);
  const targetMounts = await inspectServiceMounts(targetHost, targetService);

  // Match
  const mappings = matchMounts(sourceMounts, targetMounts);

  // Measure sizes in parallel
  const sizeResults = await Promise.all(
    mappings.flatMap((m) => [
      measureMountSize(sourceHost, m.source),
      measureMountSize(targetHost, m.target),
    ])
  );

  for (let i = 0; i < mappings.length; i++) {
    mappings[i]!.sourceSize = sizeResults[i * 2];
    mappings[i]!.targetSize = sizeResults[i * 2 + 1];
  }

  return {
    sourceHost: sourceHost ?? "localhost",
    targetHost: targetHost ?? "localhost",
    sourceService,
    targetService,
    mappings,
    clearTarget: flags.clearTarget ?? false,
  };
}
