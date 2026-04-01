import { exec } from "../infra/ssh";
import type { MountInfo } from "./mount-discovery";
import type { MigrationPlan, MountMapping } from "../domain/types";
import { TransferError } from "../domain/errors";
import type { Logger } from "../utils/log";
import { extractVolumeName } from "./mount-size";
import {
  createCountingStream,
  createTransferProgressBar,
  parseHumanSize,
} from "../utils/progress";

// ---------------------------------------------------------------------------
// Container management
// ---------------------------------------------------------------------------

/**
 * Find all container IDs belonging to a service (running or stopped).
 */
async function findContainerIds(
  host: string | undefined,
  service: string,
): Promise<string[]> {
  // Try by Coolify / Compose labels first
  const byLabel = await exec(
    host,
    `docker ps -a --filter "label=coolify.name=${service}" --format '{{.ID}}' | sort -u`,
  );

  if (byLabel.exitCode === 0 && byLabel.stdout.trim()) {
    return byLabel.stdout.split("\n").filter((id) => id.trim());
  }

  // Also try compose service label
  const byCompose = await exec(
    host,
    `docker ps -a --filter "label=com.docker.compose.service=${service}" --format '{{.ID}}' | sort -u`,
  );

  if (byCompose.exitCode === 0 && byCompose.stdout.trim()) {
    return byCompose.stdout.split("\n").filter((id) => id.trim());
  }

  // Fallback: match by container name
  const byName = await exec(
    host,
    `docker ps -a --filter "name=${service}" --format '{{.ID}}'`,
  );

  if (byName.exitCode === 0 && byName.stdout.trim()) {
    return byName.stdout.split("\n").filter((id) => id.trim());
  }

  return [];
}

/**
 * Find only *running* container IDs for a service.
 */
async function findRunningContainerIds(
  host: string | undefined,
  service: string,
): Promise<string[]> {
  const byLabel = await exec(
    host,
    `docker ps --filter "label=coolify.name=${service}" --filter "status=running" --format '{{.ID}}' | sort -u`,
  );

  if (byLabel.exitCode === 0 && byLabel.stdout.trim()) {
    return byLabel.stdout.split("\n").filter((id) => id.trim());
  }

  const byCompose = await exec(
    host,
    `docker ps --filter "label=com.docker.compose.service=${service}" --filter "status=running" --format '{{.ID}}' | sort -u`,
  );

  if (byCompose.exitCode === 0 && byCompose.stdout.trim()) {
    return byCompose.stdout.split("\n").filter((id) => id.trim());
  }

  const byName = await exec(
    host,
    `docker ps --filter "name=${service}" --filter "status=running" --format '{{.ID}}'`,
  );

  if (byName.exitCode === 0 && byName.stdout.trim()) {
    return byName.stdout.split("\n").filter((id) => id.trim());
  }

  return [];
}

/**
 * Stop all running containers for a service. Returns the IDs that were stopped.
 */
export async function stopContainers(
  host: string | undefined,
  service: string,
  logger: Logger,
): Promise<string[]> {
  const ids = await findRunningContainerIds(host, service);
  if (ids.length === 0) {
    logger.info(`  No running containers found for "${service}" — skipping stop.`);
    return [];
  }

  const label = host ?? "localhost";
  logger.info(`  Stopping ${ids.length} container(s) for "${service}" on ${label}...`);

  const result = await exec(host, `docker stop ${ids.join(" ")}`);
  if (result.exitCode !== 0) {
    throw new TransferError({
      code: "CONTAINER_STOP_FAILED",
      humanMessage: `Failed to stop containers for "${service}" on ${label}.`,
      technicalDetails: result.stderr,
      remediationHint:
        "Check if Docker is running and you have sufficient permissions.",
    });
  }

  logger.info(`  Stopped ${ids.length} container(s).`);
  return ids;
}

/**
 * Start all containers for a service.
 */
export async function startContainers(
  host: string | undefined,
  service: string,
  logger: Logger,
): Promise<void> {
  const ids = await findContainerIds(host, service);
  if (ids.length === 0) {
    logger.warn(`  No containers found for "${service}" — nothing to start.`);
    return;
  }

  const label = host ?? "localhost";
  logger.info(
    `  Starting ${ids.length} container(s) for "${service}" on ${label}...`,
  );

  const result = await exec(host, `docker start ${ids.join(" ")}`);
  if (result.exitCode !== 0) {
    throw new TransferError({
      code: "CONTAINER_START_FAILED",
      humanMessage: `Failed to start containers for "${service}" on ${label}.`,
      technicalDetails: result.stderr,
      remediationHint:
        "Try starting the service manually via Coolify or 'docker start <id>'.",
    });
  }

  logger.info(`  Started ${ids.length} container(s).`);
}

// ---------------------------------------------------------------------------
// Target clearing
// ---------------------------------------------------------------------------

async function clearTargetVolume(
  host: string | undefined,
  mount: MountInfo,
  logger: Logger,
): Promise<void> {
  const volName = extractVolumeName(mount.source);
  const label = host ?? "localhost";
  logger.info(`    Clearing target volume "${volName}" on ${label}...`);

  const result = await exec(
    host,
    `docker run --rm -v ${volName}:/data alpine sh -c 'rm -rf /data/* /data/.[!.]* /data/..?* 2>/dev/null; true'`,
  );

  if (result.exitCode !== 0) {
    throw new TransferError({
      code: "CLEAR_TARGET_FAILED",
      humanMessage: `Failed to clear target volume "${volName}" on ${label}.`,
      technicalDetails: result.stderr,
      remediationHint:
        "Check if the volume exists and Docker can access it. Ensure the 'alpine' image is available.",
    });
  }
}

async function clearTargetBind(
  host: string | undefined,
  mount: MountInfo,
  logger: Logger,
): Promise<void> {
  const label = host ?? "localhost";
  logger.info(`    Clearing target bind mount ${mount.source} on ${label}...`);

  // Use find + delete instead of rm with globs to be safer
  const result = await exec(
    host,
    `find ${mount.source} -mindepth 1 -delete 2>/dev/null; true`,
  );

  if (result.exitCode !== 0) {
    throw new TransferError({
      code: "CLEAR_TARGET_FAILED",
      humanMessage: `Failed to clear target bind mount ${mount.source} on ${label}.`,
      technicalDetails: result.stderr,
      remediationHint: "Check permissions on the target path.",
    });
  }
}

// ---------------------------------------------------------------------------
// Target non-empty detection
// ---------------------------------------------------------------------------

/**
 * Check whether a target mount already contains data.
 */
export async function isTargetNonEmpty(
  host: string | undefined,
  mount: MountInfo,
): Promise<boolean> {
  if (mount.type === "volume") {
    const volName = extractVolumeName(mount.source);
    const result = await exec(
      host,
      `docker run --rm -v ${volName}:/data:ro alpine sh -c 'ls -A /data 2>/dev/null | head -1'`,
    );
    return result.exitCode === 0 && result.stdout.trim().length > 0;
  }

  const result = await exec(
    host,
    `ls -A ${mount.source} 2>/dev/null | head -1`,
  );
  return result.exitCode === 0 && result.stdout.trim().length > 0;
}

// ---------------------------------------------------------------------------
// Volume streaming  (docker run -> tar -> SSH pipe)
// ---------------------------------------------------------------------------

function buildTarExportCmd(
  host: string | undefined,
  volumeName: string,
  compress: boolean,
): string[] {
  const tarFlags = compress ? "-czf" : "-cf";
  const dockerCmd = `docker run --rm -v ${volumeName}:/data:ro alpine tar ${tarFlags} - -C /data .`;

  if (host) {
    return [
      "ssh",
      "-o", "BatchMode=yes",
      "-o", "ConnectTimeout=10",
      host,
      dockerCmd,
    ];
  }
  return ["bash", "-c", dockerCmd];
}

function buildTarImportCmd(
  host: string | undefined,
  volumeName: string,
  compress: boolean,
): string[] {
  const tarFlags = compress ? "-xzf" : "-xf";
  const dockerCmd = `docker run --rm -i -v ${volumeName}:/data alpine tar ${tarFlags} - -C /data`;

  if (host) {
    return [
      "ssh",
      "-o", "BatchMode=yes",
      "-o", "ConnectTimeout=10",
      host,
      dockerCmd,
    ];
  }
  return ["bash", "-c", dockerCmd];
}

async function transferVolume(
  sourceHost: string | undefined,
  targetHost: string | undefined,
  sourceMount: MountInfo,
  targetMount: MountInfo,
  compress: boolean,
  logger: Logger,
  sourceSize?: string,
): Promise<void> {
  const sourceVol = extractVolumeName(sourceMount.source);
  const targetVol = extractVolumeName(targetMount.source);

  const exportCmd = buildTarExportCmd(sourceHost, sourceVol, compress);
  const importCmd = buildTarImportCmd(targetHost, targetVol, compress);

  logger.info(
    `    Streaming volume "${sourceVol}" -> "${targetVol}"${compress ? " (gzip)" : ""}...`,
  );

  const totalBytes = sourceSize ? parseHumanSize(sourceSize) : undefined;
  const progress = createTransferProgressBar({
    logMode: logger.mode,
    totalBytes,
    compressed: compress,
  });

  const sourceProc = Bun.spawn(exportCmd, {
    stdout: "pipe",
    stderr: "pipe",
  });

  // Interpose a counting stream between source stdout and target stdin
  const counting = createCountingStream((bytes) => progress.update(bytes));
  const pipePromise = sourceProc.stdout.pipeTo(counting.writable);

  const targetProc = Bun.spawn(importCmd, {
    stdin: counting.readable,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [sourceExit, targetExit, , sourceStderr, targetStderr] =
    await Promise.all([
      sourceProc.exited,
      targetProc.exited,
      pipePromise,
      new Response(sourceProc.stderr).text(),
      new Response(targetProc.stderr).text(),
    ]);

  progress.stop();

  if (sourceExit !== 0) {
    throw new TransferError({
      code: "VOLUME_EXPORT_FAILED",
      humanMessage: `Failed to export volume "${sourceVol}" from ${sourceHost ?? "localhost"}.`,
      technicalDetails: sourceStderr.trim(),
      remediationHint:
        "Ensure the volume exists and Docker can access it. Check if the 'alpine' image is available.",
    });
  }

  if (targetExit !== 0) {
    throw new TransferError({
      code: "VOLUME_IMPORT_FAILED",
      humanMessage: `Failed to import into volume "${targetVol}" on ${targetHost ?? "localhost"}.`,
      technicalDetails: targetStderr.trim(),
      remediationHint:
        "Ensure the target volume exists. Try deploying the target service first.",
    });
  }
}

// ---------------------------------------------------------------------------
// Bind mount transfer  (rsync when possible, tar stream as fallback)
// ---------------------------------------------------------------------------

async function transferBind(
  sourceHost: string | undefined,
  targetHost: string | undefined,
  sourceMount: MountInfo,
  targetMount: MountInfo,
  compress: boolean,
  logger: Logger,
  sourceSize?: string,
): Promise<void> {
  const sourcePath = sourceMount.source;
  const targetPath = targetMount.source;

  const bothLocal = !sourceHost && !targetHost;
  const oneRemote =
    (sourceHost && !targetHost) || (!sourceHost && targetHost);

  // rsync can only handle local<->remote (one remote side at most)
  if (bothLocal || oneRemote) {
    return transferBindRsync(
      sourceHost,
      targetHost,
      sourcePath,
      targetPath,
      logger,
    );
  }

  // Both sides are remote — fall back to tar streaming
  return transferBindTarStream(
    sourceHost!,
    targetHost!,
    sourcePath,
    targetPath,
    compress,
    logger,
    sourceSize,
  );
}

async function transferBindRsync(
  sourceHost: string | undefined,
  targetHost: string | undefined,
  sourcePath: string,
  targetPath: string,
  logger: Logger,
): Promise<void> {
  const src = sourceHost ? `${sourceHost}:${sourcePath}/` : `${sourcePath}/`;
  const dst = targetHost ? `${targetHost}:${targetPath}/` : `${targetPath}/`;

  logger.info(`    rsync ${src} -> ${dst}...`);

  const args = [
    "rsync",
    "-aHAX",
    "--numeric-ids",
    ...(sourceHost || targetHost
      ? ["-e", "ssh -o BatchMode=yes -o ConnectTimeout=10"]
      : []),
    src,
    dst,
  ];

  const proc = Bun.spawn(args, { stdout: "pipe", stderr: "pipe" });
  const [exitCode, stderr] = await Promise.all([
    proc.exited,
    new Response(proc.stderr).text(),
  ]);

  if (exitCode !== 0) {
    throw new TransferError({
      code: "RSYNC_FAILED",
      humanMessage: `rsync failed transferring ${sourcePath} -> ${targetPath}.`,
      technicalDetails: stderr.trim(),
      remediationHint:
        "Ensure rsync is installed on both hosts and the paths are accessible.",
    });
  }
}

async function transferBindTarStream(
  sourceHost: string,
  targetHost: string,
  sourcePath: string,
  targetPath: string,
  compress: boolean,
  logger: Logger,
  sourceSize?: string,
): Promise<void> {
  const tarCreate = compress ? "-czf" : "-cf";
  const tarExtract = compress ? "-xzf" : "-xf";

  logger.info(
    `    Streaming bind ${sourcePath} -> ${targetPath}${compress ? " (gzip)" : ""}...`,
  );

  const totalBytes = sourceSize ? parseHumanSize(sourceSize) : undefined;
  const progress = createTransferProgressBar({
    logMode: logger.mode,
    totalBytes,
    compressed: compress,
  });

  const exportCmd = [
    "ssh",
    "-o", "BatchMode=yes",
    "-o", "ConnectTimeout=10",
    sourceHost,
    `tar ${tarCreate} - -C ${sourcePath} .`,
  ];

  const importCmd = [
    "ssh",
    "-o", "BatchMode=yes",
    "-o", "ConnectTimeout=10",
    targetHost,
    `mkdir -p ${targetPath} && tar ${tarExtract} - -C ${targetPath}`,
  ];

  const sourceProc = Bun.spawn(exportCmd, {
    stdout: "pipe",
    stderr: "pipe",
  });

  // Interpose a counting stream between source stdout and target stdin
  const counting = createCountingStream((bytes) => progress.update(bytes));
  const pipePromise = sourceProc.stdout.pipeTo(counting.writable);

  const targetProc = Bun.spawn(importCmd, {
    stdin: counting.readable,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [sourceExit, targetExit, , sourceStderr, targetStderr] =
    await Promise.all([
      sourceProc.exited,
      targetProc.exited,
      pipePromise,
      new Response(sourceProc.stderr).text(),
      new Response(targetProc.stderr).text(),
    ]);

  progress.stop();

  if (sourceExit !== 0) {
    throw new TransferError({
      code: "BIND_EXPORT_FAILED",
      humanMessage: `Failed to export bind mount ${sourcePath} from ${sourceHost}.`,
      technicalDetails: sourceStderr.trim(),
      remediationHint: "Check if the source path exists and is readable.",
    });
  }

  if (targetExit !== 0) {
    throw new TransferError({
      code: "BIND_IMPORT_FAILED",
      humanMessage: `Failed to import into bind mount ${targetPath} on ${targetHost}.`,
      technicalDetails: targetStderr.trim(),
      remediationHint: "Check if the target path is writable.",
    });
  }
}

// ---------------------------------------------------------------------------
// Execution result types
// ---------------------------------------------------------------------------

export type TransferResult = {
  mapping: MountMapping;
  success: boolean;
  error?: string;
  durationMs: number;
};

export type ExecutionResult = {
  transfers: TransferResult[];
  allSucceeded: boolean;
  sourceContainersStopped: boolean;
  targetContainersStarted: boolean;
  totalDurationMs: number;
};

// ---------------------------------------------------------------------------
// Main execution orchestrator
// ---------------------------------------------------------------------------

export type ExecutionOptions = {
  compress: boolean;
};

/**
 * Execute a migration plan: stop containers, clear targets, transfer data,
 * start containers.
 *
 * Each mount mapping is transferred sequentially. If a single transfer
 * fails the remaining transfers are still attempted (partial-failure model)
 * so the user gets maximum visibility into what worked and what didn't.
 */
export async function executeMigration(
  plan: MigrationPlan,
  options: ExecutionOptions,
  logger: Logger,
): Promise<ExecutionResult> {
  const totalSteps = computeTotalSteps(plan);
  let currentStep = 0;
  const step = () => `[${++currentStep}/${totalSteps}]`;

  const executionStart = Date.now();

  const result: ExecutionResult = {
    transfers: [],
    allSucceeded: true,
    sourceContainersStopped: false,
    targetContainersStarted: false,
    totalDurationMs: 0,
  };

  const sourceHost = toSshHost(plan.sourceHost);
  const targetHost = toSshHost(plan.targetHost);

  // ---- Stop source containers ----
  if (plan.stopSource) {
    logger.info(`\n${step()} Stopping source containers...`);
    await stopContainers(sourceHost, plan.sourceService, logger);
    result.sourceContainersStopped = true;
  }

  // ---- Stop target containers ----
  if (plan.stopTarget) {
    logger.info(`\n${step()} Stopping target containers...`);
    await stopContainers(targetHost, plan.targetService, logger);
  }

  // ---- Transfer each mapping ----
  for (let i = 0; i < plan.mappings.length; i++) {
    const mapping = plan.mappings[i]!;
    logger.info(
      `\n${step()} Transferring mount ${i + 1}/${plan.mappings.length}...`,
    );

    const start = Date.now();

    try {
      // Clear target before restore if requested
      if (plan.clearTarget) {
        if (mapping.target.type === "volume") {
          await clearTargetVolume(targetHost, mapping.target, logger);
        } else {
          await clearTargetBind(targetHost, mapping.target, logger);
        }
      }

      // Actual transfer
      if (mapping.strategy === "volume-stream") {
        await transferVolume(
          sourceHost,
          targetHost,
          mapping.source,
          mapping.target,
          options.compress,
          logger,
          mapping.sourceSize,
        );
      } else {
        await transferBind(
          sourceHost,
          targetHost,
          mapping.source,
          mapping.target,
          options.compress,
          logger,
          mapping.sourceSize,
        );
      }

      const elapsed = Date.now() - start;
      result.transfers.push({ mapping, success: true, durationMs: elapsed });
      logger.info(`    Done (${formatDuration(elapsed)}).`);
    } catch (err) {
      const elapsed = Date.now() - start;
      const errorMsg = err instanceof Error ? err.message : String(err);
      result.transfers.push({
        mapping,
        success: false,
        error: errorMsg,
        durationMs: elapsed,
      });
      result.allSucceeded = false;
      logger.error(`    FAILED: ${errorMsg}`);
      if (err instanceof TransferError && err.remediationHint) {
        logger.error(`    Hint: ${err.remediationHint}`);
      }
    }
  }

  // ---- Start target containers ----
  if (plan.startTarget) {
    logger.info(`\n${step()} Starting target containers...`);
    try {
      await startContainers(targetHost, plan.targetService, logger);
      result.targetContainersStarted = true;
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      logger.error(`  Failed to start target containers: ${errorMsg}`);
    }
  }

  result.totalDurationMs = Date.now() - executionStart;
  return result;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function computeTotalSteps(plan: MigrationPlan): number {
  let steps = plan.mappings.length;
  if (plan.stopSource) steps++;
  if (plan.stopTarget) steps++;
  if (plan.startTarget) steps++;
  return steps;
}

function toSshHost(host: string): string | undefined {
  return host === "localhost" ? undefined : host;
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remaining = seconds % 60;
  return `${minutes}m ${remaining}s`;
}
