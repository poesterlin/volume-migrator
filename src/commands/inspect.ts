import { inspectServiceMounts } from "../core/mount-discovery";
import type { CommandHandler } from "../domain/types";
import { parseValue } from "../utils/args";
import { createLogger } from "../utils/log";

export const inspectCommand: CommandHandler = async (args, options) => {
  const logger = createLogger(options.json ? "json" : "human");
  const host = parseValue(args, "--host");
  const service = parseValue(args, "--service");
  const label = host ?? "localhost";

  if (!service) {
    logger.error("Which service do you want to inspect?");
    logger.error("Usage: inspect --service <name> [--host <user@host>]");
    logger.error("Example: inspect --service n8n");
    logger.error("Example: inspect --host root@server-a --service n8n");
    return;
  }

  const mounts = await inspectServiceMounts(host, service);

  if (options.json) {
    logger.info("Inspection result", { host: label, service, mounts });
    return;
  }

  logger.info(`Persistent data for service "${service}" on ${label}:\n`);
  if (mounts.length === 0) {
    logger.info("  No persistent volumes or bind mounts found for this service.");
    logger.info("  This service does not store data that needs to be migrated.");
    return;
  }

  for (const mount of mounts) {
    const mountLabel = mount.type === "volume" ? "Docker Volume" : "Bind Mount";
    logger.info(`  ${mountLabel}`);
    logger.info(`    Source:     ${mount.source}`);
    logger.info(`    Mounted at: ${mount.target}`);
    logger.info("");
  }
  logger.info("These are the data locations that would be transferred during a migration.");
};
