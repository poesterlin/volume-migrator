import { exec } from "../infra/ssh";
import type { MountInfo } from "./mount-discovery";
import type { MountMapping, MigrationPlan } from "../domain/types";
import { extractVolumeName } from "./mount-size";
import type { Logger } from "../utils/log";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type CheckStatus = "pass" | "warn" | "fail";

export type VerifyCheck = {
  name: string;
  status: CheckStatus;
  details: string;
};

export type MountVerification = {
  sourceLabel: string;
  targetLabel: string;
  checks: VerifyCheck[];
};

export type VerificationResult = {
  mounts: MountVerification[];
  containerHealth: VerifyCheck | null;
  passed: boolean;
  warnings: number;
  failures: number;
};

// ---------------------------------------------------------------------------
// Individual checks
// ---------------------------------------------------------------------------

/**
 * Count files (regular + directories) inside a mount.
 */
async function countFiles(
  host: string | undefined,
  mount: MountInfo,
): Promise<number | undefined> {
  let command: string;

  if (mount.type === "volume") {
    const vol = extractVolumeName(mount.source);
    command = `docker run --rm -v ${vol}:/data:ro alpine sh -c 'find /data -mindepth 1 | wc -l'`;
  } else {
    command = `find ${mount.source} -mindepth 1 2>/dev/null | wc -l`;
  }

  const result = await exec(host, command);
  if (result.exitCode !== 0) return undefined;

  const n = parseInt(result.stdout.trim(), 10);
  return Number.isNaN(n) ? undefined : n;
}

/**
 * Get total size in bytes of a mount.
 */
async function sizeBytes(
  host: string | undefined,
  mount: MountInfo,
): Promise<number | undefined> {
  let command: string;

  if (mount.type === "volume") {
    const vol = extractVolumeName(mount.source);
    command = `docker run --rm -v ${vol}:/data:ro alpine sh -c 'du -sb /data 2>/dev/null | cut -f1'`;
  } else {
    command = `du -sb ${mount.source} 2>/dev/null | cut -f1`;
  }

  const result = await exec(host, command);
  if (result.exitCode !== 0) return undefined;

  const n = parseInt(result.stdout.trim(), 10);
  return Number.isNaN(n) ? undefined : n;
}

/**
 * Check whether any containers for a service are currently running.
 */
async function checkContainersRunning(
  host: string | undefined,
  service: string,
): Promise<{ running: number; total: number }> {
  // Total containers
  const allResult = await exec(
    host,
    `docker ps -a --filter "label=coolify.name=${service}" --format '{{.ID}}' | wc -l`,
  );
  let total = 0;
  if (allResult.exitCode === 0) {
    total = parseInt(allResult.stdout.trim(), 10) || 0;
  }
  // Fallback by name
  if (total === 0) {
    const byName = await exec(
      host,
      `docker ps -a --filter "name=${service}" --format '{{.ID}}' | wc -l`,
    );
    if (byName.exitCode === 0) {
      total = parseInt(byName.stdout.trim(), 10) || 0;
    }
  }

  // Running containers
  const runResult = await exec(
    host,
    `docker ps --filter "label=coolify.name=${service}" --filter "status=running" --format '{{.ID}}' | wc -l`,
  );
  let running = 0;
  if (runResult.exitCode === 0) {
    running = parseInt(runResult.stdout.trim(), 10) || 0;
  }
  if (running === 0) {
    const byName = await exec(
      host,
      `docker ps --filter "name=${service}" --filter "status=running" --format '{{.ID}}' | wc -l`,
    );
    if (byName.exitCode === 0) {
      running = parseInt(byName.stdout.trim(), 10) || 0;
    }
  }

  return { running, total };
}

// ---------------------------------------------------------------------------
// Per-mount verification
// ---------------------------------------------------------------------------

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024)
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

async function verifyMount(
  sourceHost: string | undefined,
  targetHost: string | undefined,
  mapping: MountMapping,
): Promise<MountVerification> {
  const sourceLabel =
    mapping.source.type === "volume"
      ? extractVolumeName(mapping.source.source)
      : mapping.source.source;
  const targetLabel =
    mapping.target.type === "volume"
      ? extractVolumeName(mapping.target.source)
      : mapping.target.source;

  const checks: VerifyCheck[] = [];

  // 1. Target non-empty check
  const [targetFileCount, sourceFileCount] = await Promise.all([
    countFiles(targetHost, mapping.target),
    countFiles(sourceHost, mapping.source),
  ]);

  if (targetFileCount === undefined) {
    checks.push({
      name: "Target has data",
      status: "warn",
      details: "Could not count files on target",
    });
  } else if (targetFileCount === 0) {
    checks.push({
      name: "Target has data",
      status: "fail",
      details: "Target mount is empty — transfer may have failed",
    });
  } else {
    checks.push({
      name: "Target has data",
      status: "pass",
      details: `${targetFileCount} file(s) found on target`,
    });
  }

  // 2. File count comparison
  if (sourceFileCount !== undefined && targetFileCount !== undefined) {
    if (targetFileCount === sourceFileCount) {
      checks.push({
        name: "File count match",
        status: "pass",
        details: `${sourceFileCount} file(s) on both sides`,
      });
    } else if (targetFileCount >= sourceFileCount) {
      checks.push({
        name: "File count match",
        status: "pass",
        details: `source: ${sourceFileCount}, target: ${targetFileCount} (target has additional files)`,
      });
    } else {
      const diff = sourceFileCount - targetFileCount;
      const pct = ((diff / sourceFileCount) * 100).toFixed(1);
      checks.push({
        name: "File count match",
        status: diff / sourceFileCount > 0.1 ? "fail" : "warn",
        details: `source: ${sourceFileCount}, target: ${targetFileCount} (${diff} fewer, ${pct}% missing)`,
      });
    }
  }

  // 3. Size comparison
  const [sourceBytes, targetBytes] = await Promise.all([
    sizeBytes(sourceHost, mapping.source),
    sizeBytes(targetHost, mapping.target),
  ]);

  if (sourceBytes !== undefined && targetBytes !== undefined) {
    if (sourceBytes === 0 && targetBytes === 0) {
      checks.push({
        name: "Size match",
        status: "pass",
        details: "Both sides empty (0 bytes)",
      });
    } else if (sourceBytes === 0) {
      checks.push({
        name: "Size match",
        status: "pass",
        details: `source: 0 B, target: ${formatBytes(targetBytes)}`,
      });
    } else {
      const ratio = targetBytes / sourceBytes;
      if (ratio >= 0.95 && ratio <= 1.05) {
        checks.push({
          name: "Size match",
          status: "pass",
          details: `source: ${formatBytes(sourceBytes)}, target: ${formatBytes(targetBytes)}`,
        });
      } else if (ratio >= 0.8) {
        checks.push({
          name: "Size match",
          status: "warn",
          details: `source: ${formatBytes(sourceBytes)}, target: ${formatBytes(targetBytes)} (${((1 - ratio) * 100).toFixed(1)}% difference)`,
        });
      } else {
        checks.push({
          name: "Size match",
          status: "fail",
          details: `source: ${formatBytes(sourceBytes)}, target: ${formatBytes(targetBytes)} — significant size mismatch`,
        });
      }
    }
  } else if (sourceBytes === undefined && targetBytes === undefined) {
    checks.push({
      name: "Size match",
      status: "warn",
      details: "Could not measure sizes on either side",
    });
  } else {
    checks.push({
      name: "Size match",
      status: "warn",
      details: `Could not measure size on ${sourceBytes === undefined ? "source" : "target"}`,
    });
  }

  return { sourceLabel, targetLabel, checks };
}

// ---------------------------------------------------------------------------
// Full verification
// ---------------------------------------------------------------------------

export type VerifyOptions = {
  /** Check that target containers are healthy (only if startTarget was set). */
  checkContainers?: boolean;
};

/**
 * Run post-migration verification checks.
 *
 * Compares file counts and sizes between source and target mounts,
 * and optionally checks that target containers are running.
 */
export async function verifyMigration(
  plan: MigrationPlan,
  options: VerifyOptions,
  logger: Logger,
): Promise<VerificationResult> {
  const sourceHost =
    plan.sourceHost === "localhost" ? undefined : plan.sourceHost;
  const targetHost =
    plan.targetHost === "localhost" ? undefined : plan.targetHost;

  logger.info("\nVerification");
  logger.info("============\n");

  // Verify each mount mapping
  const mounts: MountVerification[] = [];
  for (let i = 0; i < plan.mappings.length; i++) {
    const mapping = plan.mappings[i]!;
    logger.info(
      `  Checking mount ${i + 1}/${plan.mappings.length}...`,
    );

    const mv = await verifyMount(sourceHost, targetHost, mapping);
    mounts.push(mv);

    for (const check of mv.checks) {
      const icon =
        check.status === "pass"
          ? "OK"
          : check.status === "warn"
            ? "WARN"
            : "FAIL";
      logger.info(`    [${icon}] ${check.name}: ${check.details}`);
    }
  }

  // Container health check
  let containerHealth: VerifyCheck | null = null;
  if (options.checkContainers) {
    logger.info("\n  Checking target container health...");
    const health = await checkContainersRunning(
      targetHost,
      plan.targetService,
    );

    if (health.total === 0) {
      containerHealth = {
        name: "Container health",
        status: "fail",
        details: `No containers found for "${plan.targetService}" on ${plan.targetHost}`,
      };
    } else if (health.running === health.total) {
      containerHealth = {
        name: "Container health",
        status: "pass",
        details: `${health.running}/${health.total} container(s) running`,
      };
    } else if (health.running > 0) {
      containerHealth = {
        name: "Container health",
        status: "warn",
        details: `${health.running}/${health.total} container(s) running`,
      };
    } else {
      containerHealth = {
        name: "Container health",
        status: "fail",
        details: `0/${health.total} container(s) running on ${plan.targetHost}`,
      };
    }

    const icon =
      containerHealth.status === "pass"
        ? "OK"
        : containerHealth.status === "warn"
          ? "WARN"
          : "FAIL";
    logger.info(
      `    [${icon}] ${containerHealth.name}: ${containerHealth.details}`,
    );
  }

  // Aggregate
  let warnings = 0;
  let failures = 0;
  const allChecks = mounts.flatMap((m) => m.checks);
  if (containerHealth) allChecks.push(containerHealth);

  for (const c of allChecks) {
    if (c.status === "warn") warnings++;
    if (c.status === "fail") failures++;
  }

  const passed = failures === 0;

  logger.info("");
  if (passed && warnings === 0) {
    logger.info("  Verification passed — all checks OK.");
  } else if (passed) {
    logger.warn(
      `  Verification passed with ${warnings} warning(s). Review the output above.`,
    );
  } else {
    logger.error(
      `  Verification FAILED — ${failures} check(s) failed, ${warnings} warning(s).`,
    );
  }

  return { mounts, containerHealth, passed, warnings, failures };
}

/**
 * Return verification result as a JSON-serializable object.
 */
export function verificationToJson(
  result: VerificationResult,
): Record<string, unknown> {
  return {
    passed: result.passed,
    warnings: result.warnings,
    failures: result.failures,
    mounts: result.mounts.map((m) => ({
      source: m.sourceLabel,
      target: m.targetLabel,
      checks: m.checks.map((c) => ({
        name: c.name,
        status: c.status,
        details: c.details,
      })),
    })),
    containerHealth: result.containerHealth
      ? {
          name: result.containerHealth.name,
          status: result.containerHealth.status,
          details: result.containerHealth.details,
        }
      : null,
  };
}
