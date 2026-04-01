import { runLocalToolChecks } from "../core/preflight";
import type { CommandHandler } from "../domain/types";
import { createLogger } from "../utils/log";

function parseHostArg(args: string[]): string | undefined {
  const idx = args.findIndex((arg) => arg === "--host");
  if (idx === -1) {
    return undefined;
  }

  return args[idx + 1];
}

export const doctorCommand: CommandHandler = async (args, options) => {
  const logger = createLogger(options.json ? "json" : "human");
  const host = parseHostArg(args);

  logger.info("Checking if your system has everything needed for migrations...\n");
  const checks = await runLocalToolChecks();

  if (options.json) {
    logger.info("Doctor result", {
      host: host ?? null,
      checks,
      allOk: checks.every((check) => check.ok),
    });
    return;
  }

  const allOk = checks.every((check) => check.ok);

  logger.info("Required tools on this machine:");
  for (const check of checks) {
    const status = check.ok ? "OK" : "MISSING";
    logger.info(`  [${status}] ${check.name}  ${check.ok ? check.details : ""}`);
  }
  logger.info("");

  if (!allOk) {
    const missing = checks.filter((c) => !c.ok).map((c) => c.name);
    logger.warn(`Install missing tools before migrating: ${missing.join(", ")}`);
  } else {
    logger.info("All local prerequisites met.");
  }

  if (host) {
    logger.info(`\nRemote host checks for ${host} are planned for a future update.`);
  } else {
    logger.info("Tip: use --host <user@host> to also check a remote server.");
  }
};
