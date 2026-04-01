import type { MountInfo } from "../core/mount-discovery";

export type OutputMode = "human" | "json";

export type GlobalCliOptions = {
  json?: boolean;
};

export type CommandHandler = (args: string[], options: GlobalCliOptions) => Promise<void>;

export type CommandSpec = {
  name: string;
  description: string;
  handler: CommandHandler;
};

// --- Migrate domain types ---

export type TransferStrategy = "volume-stream" | "bind-rsync";

export type MountMapping = {
  source: MountInfo;
  target: MountInfo;
  strategy: TransferStrategy;
  sourceSize?: string;
  targetSize?: string;
};

export type MigrateFlags = {
  source?: string;
  target?: string;
  sourceService?: string;
  targetService?: string;
  stopSource?: boolean;
  stopTarget?: boolean;
  startTarget?: boolean;
  clearTarget?: boolean;
  dryRun?: boolean;
  yes?: boolean;
  noCompress?: boolean;
  verify?: boolean;
};

export type MigrationPlan = {
  sourceHost: string;
  targetHost: string;
  sourceService: string;
  targetService: string;
  mappings: MountMapping[];
  stopSource: boolean;
  stopTarget: boolean;
  startTarget: boolean;
  clearTarget: boolean;
};
