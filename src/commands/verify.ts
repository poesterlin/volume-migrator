import type { CommandHandler } from "../domain/types";
import { createLogger } from "../utils/log";

export const verifyCommand: CommandHandler = async (_args, options) => {
  const logger = createLogger(options.json ? "json" : "human");
  logger.warn("verify is not implemented yet. Planned for milestone 4.");
};
