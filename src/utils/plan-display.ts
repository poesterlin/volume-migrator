import type { MigrationPlan } from "../domain/types";
import type { Logger } from "../utils/log";

/**
 * Display a migration plan in human-readable format.
 */
export function printPlan(plan: MigrationPlan, logger: Logger): void {
  logger.info("Migration Plan");
  logger.info("==============\n");

  logger.info(`  Source:  ${plan.sourceService} on ${plan.sourceHost}`);
  logger.info(`  Target:  ${plan.targetService} on ${plan.targetHost}`);
  logger.info(`  Clear target before restore: ${plan.clearTarget ? "yes" : "no"}`);
  logger.info("");

  logger.info(`  ${plan.mappings.length} mount(s) to transfer:\n`);

  for (let i = 0; i < plan.mappings.length; i++) {
    const m = plan.mappings[i]!;
    const num = `[${i + 1}/${plan.mappings.length}]`;
    const strategyLabel =
      m.strategy === "volume-stream"
        ? "docker tar stream"
        : "rsync";

    logger.info(`  ${num} ${strategyLabel}`);
    logger.info(`       Source: ${m.source.type} ${m.source.source}`);
    logger.info(`               mounted at ${m.source.target}${m.sourceSize ? `  (${m.sourceSize})` : ""}`);
    logger.info(`       Target: ${m.target.type} ${m.target.source}`);
    logger.info(`               mounted at ${m.target.target}${m.targetSize ? `  (${m.targetSize})` : ""}`);
    logger.info("");
  }
}

/**
 * Return the plan as a JSON-serializable object.
 */
export function planToJson(plan: MigrationPlan): Record<string, unknown> {
  return {
    sourceHost: plan.sourceHost,
    targetHost: plan.targetHost,
    sourceService: plan.sourceService,
    targetService: plan.targetService,
    clearTarget: plan.clearTarget,
    mappings: plan.mappings.map((m) => ({
      strategy: m.strategy,
      source: { type: m.source.type, source: m.source.source, target: m.source.target, size: m.sourceSize ?? null },
      target: { type: m.target.type, source: m.target.source, target: m.target.target, size: m.targetSize ?? null },
    })),
  };
}
