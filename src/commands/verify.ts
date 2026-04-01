import { buildMigrationPlan } from "../core/migration-plan";
import {
  verifyMigration,
  verificationToJson,
} from "../core/verification";
import type { CommandHandler, MigrateFlags } from "../domain/types";
import { parseValue, hasFlag } from "../utils/args";
import { createLogger, type Logger } from "../utils/log";

// ---------------------------------------------------------------------------
// Flag parsing
// ---------------------------------------------------------------------------

function parseVerifyFlags(args: string[]): MigrateFlags {
  return {
    source: parseValue(args, "--source"),
    target: parseValue(args, "--target"),
    sourceService: parseValue(args, "--source-service"),
    targetService: parseValue(args, "--target-service"),
    // Behaviour flags are not relevant for verify, but we need the plan shape.
    // stopSource/stopTarget/startTarget/clearTarget default to false.
  };
}

// ---------------------------------------------------------------------------
// Usage
// ---------------------------------------------------------------------------

function printUsage(logger: Logger): void {
  logger.error("Missing required flags for verify.\n");
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
  logger.error("Options:");
  logger.error(
    "  --check-containers          Also verify target containers are running\n",
  );
  logger.error("Examples:");
  logger.error(
    "  verify --source root@old --target root@new \\",
  );
  logger.error(
    "         --source-service n8n --target-service n8n\n",
  );
  logger.error(
    "  verify --source root@old --target root@new \\",
  );
  logger.error(
    "         --source-service n8n --target-service n8n --check-containers",
  );
}

// ---------------------------------------------------------------------------
// Command handler
// ---------------------------------------------------------------------------

export const verifyCommand: CommandHandler = async (args, options) => {
  const logger = createLogger(options.json ? "json" : "human");
  const flags = parseVerifyFlags(args);
  const checkContainers = hasFlag(args, "--check-containers");

  if (!flags.sourceService || !flags.targetService) {
    printUsage(logger);
    process.exit(1);
  }

  logger.info("Discovering services and mounts...\n");
  const plan = await buildMigrationPlan(flags);

  const result = await verifyMigration(
    plan,
    { checkContainers },
    logger,
  );

  if (options.json) {
    logger.info("Verification result", {
      ...verificationToJson(result),
    });
  }

  if (!result.passed) {
    process.exit(6);
  }
};
