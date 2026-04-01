import { inspectServiceMounts } from "../core/mount-discovery";
import { listServicesOnHost } from "../core/service-discovery";
import type { CommandHandler } from "../domain/types";
import { parseValue } from "../utils/args";
import { createLogger } from "../utils/log";

export const listServicesCommand: CommandHandler = async (args, options) => {
  const logger = createLogger(options.json ? "json" : "human");
  const host = parseValue(args, "--host");
  const label = host ?? "localhost";

  const services = await listServicesOnHost(host);

  if (options.json) {
    const detailed = await Promise.all(
      services.map(async (service) => ({
        ...service,
        mounts: await inspectServiceMounts(host, service.name),
      }))
    );
    logger.info("Discovered services", { host: label, services: detailed });
    return;
  }

  logger.info(`Coolify services with persistent data on ${label}:\n`);
  if (services.length === 0) {
    logger.info("  No services with persistent volumes or bind mounts found.");
    logger.info("  Only services that store data (databases, apps with volumes) are shown.");
    return;
  }

  for (const service of services) {
    const statusLabel = service.status === "running" ? "running" : service.status;
    logger.info(`  ${service.name}  (${service.containers} container(s), ${statusLabel})`);

    const mounts = await inspectServiceMounts(host, service.name);
    if (mounts.length === 0) {
      logger.info("    No persistent mounts\n");
      continue;
    }

    for (const mount of mounts) {
      const mountLabel = mount.type === "volume" ? "Volume" : "Bind";
      logger.info(`    ${mountLabel}: ${mount.source} -> ${mount.target}`);
    }
    logger.info("");
  }

  logger.info("These are services whose data can be migrated to another host.");
};
