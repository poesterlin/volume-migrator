#!/usr/bin/env bun

import { doctorCommand } from "./commands/doctor";
import { inspectCommand } from "./commands/inspect";
import { listServicesCommand } from "./commands/list-services";
import { migrateCommand } from "./commands/migrate";
import { verifyCommand } from "./commands/verify";
import { CliError, ExitCode } from "./domain/errors";
import type { CommandSpec, GlobalCliOptions } from "./domain/types";

const commands: CommandSpec[] = [
  {
    name: "migrate",
    description: "Migrate persistent volumes/bind mounts between two Coolify hosts",
    handler: migrateCommand,
  },
  {
    name: "inspect",
    description: "Show containers, mounts, and risks for a service on a host",
    handler: inspectCommand,
  },
  {
    name: "list-services",
    description: "Discover and list running Coolify services on a host",
    handler: listServicesCommand,
  },
  {
    name: "verify",
    description: "Check that a migration completed successfully (containers, mounts, data)",
    handler: verifyCommand,
  },
  {
    name: "doctor",
    description: "Check local/remote prerequisites (SSH, Docker, rsync)",
    handler: doctorCommand,
  },
];

function getBinName(): string {
  const argv0 = Bun.argv[0] ?? "volume-migrator";
  const basename = argv0.split("/").pop() ?? "volume-migrator";
  const arg1 = Bun.argv[1];

  // When run via bun: argv = ["/.../bun", "src/cli.ts", ...]
  if (arg1 && (arg1.endsWith(".ts") || arg1.endsWith(".js"))) {
    const script = arg1.split("/").slice(-2).join("/");
    return `${basename} ${script}`;
  }

  // Compiled binary: argv = ["/.../volume-migrator", ...]
  // Bun embeds itself, so argv[0] may still be "bun" — use process.argv[1] as fallback
  if (basename === "bun" && process.argv[1]) {
    const binFromProcess = process.argv[1].split("/").pop() ?? "volume-migrator";
    return binFromProcess;
  }

  return basename;
}

function printHelp(): void {
  const bin = getBinName();
  console.log("Coolify Volume Migration Tool");
  console.log("Migrate persistent service data between Coolify hosts safely.");
  console.log("");
  console.log("Usage:");
  console.log(`  ${bin} <command> [options]`);
  console.log("");
  console.log("Commands:");
  for (const command of commands) {
    console.log(`  ${command.name.padEnd(16)}${command.description}`);
  }
  console.log("");
  console.log("Global options:");
  console.log("  --json             Output machine-readable JSON instead of human text");
  console.log("  --help, -h         Show this help");
  console.log("");
  console.log("Examples:");
  console.log(`  ${bin} doctor --host root@server-a`);
  console.log(`  ${bin} list-services --host root@server-a`);
  console.log(`  ${bin} inspect --host root@server-a --service n8n`);
  console.log(`  ${bin} migrate --source root@server-a --target root@server-b`);
}

function parseGlobalOptions(rawArgs: string[]): { args: string[]; options: GlobalCliOptions } {
  const options: GlobalCliOptions = {};
  const args: string[] = [];

  for (const arg of rawArgs) {
    if (arg === "--json") {
      options.json = true;
      continue;
    }
    args.push(arg);
  }

  return { args, options };
}

async function run(): Promise<void> {
  const argv = Bun.argv.slice(2);
  const { args, options } = parseGlobalOptions(argv);

  const commandName = args[0];
  if (!commandName || commandName === "help" || commandName === "--help" || commandName === "-h") {
    printHelp();
    return;
  }

  const command = commands.find((entry) => entry.name === commandName);
  if (!command) {
    throw new CliError({
      code: "UNKNOWN_COMMAND",
      humanMessage: `Unknown command: ${commandName}`,
      remediationHint: "Run with --help to see available commands.",
      exitCode: ExitCode.GeneralError,
    });
  }

  await command.handler(args.slice(1), options);
}

run().catch((error) => {
  if (error instanceof CliError) {
    console.error(error.humanMessage);
    if (error.remediationHint) {
      console.error(`Hint: ${error.remediationHint}`);
    }
    process.exit(error.exitCode);
  }

  const message = error instanceof Error ? error.message : String(error);
  console.error(`Unexpected error: ${message}`);
  process.exit(ExitCode.GeneralError);
});
