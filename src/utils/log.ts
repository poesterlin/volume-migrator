import { toJson } from "./format";

export type LogMode = "human" | "json";

export type Logger = {
  mode: LogMode;
  info: (message: string, data?: Record<string, unknown>) => void;
  warn: (message: string, data?: Record<string, unknown>) => void;
  error: (message: string, data?: Record<string, unknown>) => void;
};

function printJson(level: "info" | "warn" | "error", message: string, data?: Record<string, unknown>): void {
  const payload: Record<string, unknown> = {
    level,
    message,
    ...(data ? { data } : {}),
    ts: new Date().toISOString(),
  };

  console.log(toJson(payload));
}

export function createLogger(mode: LogMode): Logger {
  if (mode === "json") {
    return {
      mode,
      info: (message, data) => printJson("info", message, data),
      warn: (message, data) => printJson("warn", message, data),
      error: (message, data) => printJson("error", message, data),
    };
  }

  return {
    mode,
    info: (message) => console.log(message),
    warn: (message) => console.warn(message),
    error: (message) => console.error(message),
  };
}
