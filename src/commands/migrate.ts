import * as readline from "readline";
import { buildMigrationPlan } from "../core/migration-plan";
import {
  executeMigration,
  isTargetNonEmpty,
  type ExecutionResult,
} from "../core/migrate-execution";
import type { CommandHandler, MigrateFlags, MigrationPlan } from "../domain/types";
import { UserAbortError } from "../domain/errors";
import { parseValue, hasFlag } from "../utils/args";
import { createLogger, type Logger } from "../utils/log";
import { printPlan, planToJson } from "../utils/plan-display";
import { verifyMigration, verificationToJson } from "../core/verification";

// ---------------------------------------------------------------------------
// Flag parsing
// ---------------------------------------------------------------------------

function parseMigrateFlags(args: string[]): MigrateFlags {
  return {
    source: parseValue(args, "--source"),
    target: parseValue(args, "--target"),
    sourceService: parseValue(args, "--source-service"),
    targetService: parseValue(args, "--target-service"),
    stopSource: hasFlag(args, "--stop-source"),
    stopTarget: hasFlag(args, "--stop-target"),
    startTarget: hasFlag(args, "--start-target"),
    clearTarget: hasFlag(args, "--clear-target"),
    dryRun: hasFlag(args, "--dry-run"),
    yes: hasFlag(args, "--yes"),
    noCompress: hasFlag(args, "--no-compress"),
    verify: hasFlag(args, "--verify"),
  };
}

// ---------------------------------------------------------------------------
// Usage
// ---------------------------------------------------------------------------

function printUsage(logger: Logger): void {
  logger.error("Missing required flags for migrate.\n");
  logger.error("Required:");
  logger.error(
    "  --source-service <name>     Service name on source",
  );
  logger.error(
    "  --target-service <name>     Service name on target\n",
  );
  logger.error("Host options:");
  logger.error(
    "  --source <user@host>        Source host (omit for localhost)",
  );
  logger.error(
    "  --target <user@host>        Target host (omit for localhost)\n",
  );
  logger.error("Behaviour:");
  logger.error(
    "  --stop-source               Stop source containers before transfer",
  );
  logger.error(
    "  --stop-target               Stop target containers before transfer",
  );
  logger.error(
    "  --start-target              Start target containers after transfer",
  );
  logger.error(
    "  --clear-target              Wipe target volume/path before restore",
  );
  logger.error(
    "  --no-compress               Disable gzip compression for tar streams",
  );
  logger.error(
    "  --verify                    Run post-migration validation checks",
  );
  logger.error(
    "  --dry-run                   Show plan without executing",
  );
  logger.error(
    "  --yes                       Skip confirmations\n",
  );
  logger.error("Examples:");
  logger.error(
    "  migrate --source root@old --target root@new \\",
  );
  logger.error(
    "          --source-service n8n --target-service n8n --dry-run\n",
  );
  logger.error(
    "  migrate --source root@old --target root@new \\",
  );
  logger.error(
    "          --source-service n8n --target-service n8n \\",
  );
  logger.error(
    "          --stop-source --clear-target --start-target --yes",
  );
}

// ---------------------------------------------------------------------------
// Interactive confirmation
// ---------------------------------------------------------------------------

async function confirm(message: string): Promise<boolean> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(`${message} [y/N] `, (answer) => {
      rl.close();
      const a = answer.trim().toLowerCase();
      resolve(a === "y" || a === "yes");
    });
  });
}

// ---------------------------------------------------------------------------
// Target protection: warn about non-empty targets
// ---------------------------------------------------------------------------

async function checkTargetProtection(
  plan: MigrationPlan,
  flags: MigrateFlags,
  logger: Logger,
): Promise<void> {
  if (plan.clearTarget) {
    // User explicitly wants to clear — no extra warning needed
    return;
  }

  const targetHost =
    plan.targetHost === "localhost" ? undefined : plan.targetHost;

  const nonEmptyTargets: string[] = [];
  for (const mapping of plan.mappings) {
    const notEmpty = await isTargetNonEmpty(targetHost, mapping.target);
    if (notEmpty) {
      const label =
        mapping.target.type === "volume"
          ? `volume "${mapping.target.source}"`
          : `bind "${mapping.target.source}"`;
      nonEmptyTargets.push(label);
    }
  }

  if (nonEmptyTargets.length === 0) {
    return;
  }

  logger.warn("\nTarget mount(s) already contain data:");
  for (const t of nonEmptyTargets) {
    logger.warn(`  - ${t}`);
  }
  logger.warn(
    "Data will be merged/overwritten. Use --clear-target to wipe before restore.",
  );

  if (!flags.yes) {
    const proceed = await confirm("Continue without clearing target?");
    if (!proceed) {
      throw new UserAbortError("Aborted — target was not empty.");
    }
  }
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

function printSummary(
  result: ExecutionResult,
  logger: Logger,
): void {
  logger.info("\n==============");
  logger.info("Migration Summary");
  logger.info("==============\n");

  const succeeded = result.transfers.filter((t) => t.success).length;
  const failed = result.transfers.filter((t) => !t.success).length;

  logger.info(`  Transfers: ${succeeded} succeeded, ${failed} failed`);

  if (result.sourceContainersStopped) {
    logger.info("  Source containers were stopped.");
  }
  if (result.targetContainersStarted) {
    logger.info("  Target containers were started.");
  }

  logger.info(`  Total time: ${formatMs(result.totalDurationMs)}`);
  logger.info("");

  for (const t of result.transfers) {
    const icon = t.success ? "OK" : "FAIL";
    const srcLabel =
      t.mapping.source.type === "volume"
        ? t.mapping.source.source
        : t.mapping.source.source;
    logger.info(
      `  [${icon}] ${srcLabel} -> ${t.mapping.target.source}  (${formatMs(t.durationMs)})`,
    );
    if (!t.success && t.error) {
      logger.error(`        ${t.error}`);
    }
  }

  logger.info("");
  if (result.allSucceeded) {
    logger.info("Migration completed successfully.");
  } else {
    logger.error(
      "Migration completed with errors. Review the failed transfers above.",
    );
  }
}

function formatMs(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return `${m}m ${s % 60}s`;
}

// ---------------------------------------------------------------------------
// Command handler
// ---------------------------------------------------------------------------

export const migrateCommand: CommandHandler = async (args, options) => {
  const logger = createLogger(options.json ? "json" : "human");
  const flags = parseMigrateFlags(args);

  // Validate required flags
  if (!flags.sourceService || !flags.targetService) {
    printUsage(logger);
    process.exit(1);
  }

  // 1. Build the plan (discovery + matching + size)
  logger.info("Discovering services and mounts...\n");
  const plan = await buildMigrationPlan(flags);

  // 2. Display the plan
  if (options.json) {
    logger.info("Migration plan", { plan: planToJson(plan) });
  } else {
    printPlan(plan, logger);
  }

  // 3. Dry run stops here
  if (flags.dryRun) {
    logger.info("Dry run — no data was transferred.");
    return;
  }

  // 4. Target protection
  await checkTargetProtection(plan, flags, logger);

  // 5. Final confirmation
  if (!flags.yes) {
    const proceed = await confirm("\nProceed with migration?");
    if (!proceed) {
      throw new UserAbortError();
    }
  }

  // 6. Execute
  const compress = !flags.noCompress;
  const result = await executeMigration(plan, { compress }, logger);

  // 7. Summary
  if (options.json) {
    logger.info("Migration result", {
      allSucceeded: result.allSucceeded,
      sourceContainersStopped: result.sourceContainersStopped,
      targetContainersStarted: result.targetContainersStarted,
      totalDurationMs: result.totalDurationMs,
      transfers: result.transfers.map((t) => ({
        source: t.mapping.source.source,
        target: t.mapping.target.source,
        strategy: t.mapping.strategy,
        success: t.success,
        error: t.error ?? null,
        durationMs: t.durationMs,
      })),
    });
  } else {
    printSummary(result, logger);
  }

  if (!result.allSucceeded) {
    process.exit(5);
  }

  // 8. Post-migration verification
  if (flags.verify) {
    const verifyResult = await verifyMigration(
      plan,
      { checkContainers: plan.startTarget },
      logger,
    );

    if (options.json) {
      logger.info("Verification result", {
        ...verificationToJson(verifyResult),
      });
    }

    if (!verifyResult.passed) {
      process.exit(6);
    }
  }
};
