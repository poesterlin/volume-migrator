import { buildMigrationPlan } from "../core/migration-plan";
import type { CommandHandler, MigrateFlags } from "../domain/types";
import { parseValue, hasFlag } from "../utils/args";
import { createLogger } from "../utils/log";
import { printPlan, planToJson } from "../utils/plan-display";

function parseMigrateFlags(args: string[]): MigrateFlags {
  return {
    source: parseValue(args, "--source"),
    target: parseValue(args, "--target"),
    sourceService: parseValue(args, "--source-service"),
    targetService: parseValue(args, "--target-service"),
    clearTarget: hasFlag(args, "--clear-target"),
    dryRun: hasFlag(args, "--dry-run"),
    yes: hasFlag(args, "--yes"),
  };
}

function printUsage(logger: ReturnType<typeof createLogger>): void {
  logger.error("Missing required flags for migrate.\n");
  logger.error("Required:");
  logger.error("  --source <user@host>        Source host (or omit for localhost)");
  logger.error("  --target <user@host>        Target host (or omit for localhost)");
  logger.error("  --source-service <name>     Service name on source");
  logger.error("  --target-service <name>     Service name on target\n");
  logger.error("Options:");
  logger.error("  --clear-target              Wipe target volume/path before restore");
  logger.error("  --dry-run                   Show plan without executing");
  logger.error("  --yes                       Skip confirmations\n");
  logger.error("Examples:");
  logger.error("  migrate --source root@old-server --target root@new-server \\");
  logger.error("          --source-service n8n --target-service n8n --dry-run\n");
  logger.error("  migrate --source root@old-server --target root@new-server \\");
  logger.error("          --source-service postgres --target-service postgres --clear-target");
}

export const migrateCommand: CommandHandler = async (args, options) => {
  const logger = createLogger(options.json ? "json" : "human");
  const flags = parseMigrateFlags(args);

  // Validate required flags
  if (!flags.sourceService || !flags.targetService) {
    printUsage(logger);
    process.exit(1);
  }

  // Build the plan (discovery + matching)
  logger.info("Discovering services and mounts...\n");
  const plan = await buildMigrationPlan(flags);

  if (options.json) {
    logger.info("Migration plan", { plan: planToJson(plan) });
  } else {
    printPlan(plan, logger);
  }

  if (flags.dryRun) {
    logger.info("Dry run — no data was transferred.");
    return;
  }

  // Real execution not implemented yet
  logger.warn("Execution engine not implemented yet. Use --dry-run to preview the plan.");
};
