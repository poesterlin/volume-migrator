import { listServicesOnHost } from "../core/service-discovery";
import { runLocalToolChecks } from "../core/preflight";
import { migrateCommand } from "./migrate";
import type { CommandHandler } from "../domain/types";
import { promptInput, promptConfirm, promptSelect } from "../utils/prompt";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function header(text: string): void {
  console.log(`\n${"=".repeat(50)}`);
  console.log(`  ${text}`);
  console.log(`${"=".repeat(50)}`);
}

function step(n: number, total: number, text: string): void {
  console.log(`\n--- Step ${n}/${total}: ${text} ---`);
}

/**
 * Turn the collected wizard answers into the argv array that migrateCommand
 * expects.  This lets us delegate to the existing command handler and reuse
 * all safety gates, plan display, execution & summary logic.
 */
function buildArgs(answers: WizardAnswers): string[] {
  const args: string[] = [];

  if (answers.source) {
    args.push("--source", answers.source);
  }
  if (answers.target) {
    args.push("--target", answers.target);
  }

  args.push("--source-service", answers.sourceService);
  args.push("--target-service", answers.targetService);

  if (answers.stopSource) args.push("--stop-source");
  if (answers.stopTarget) args.push("--stop-target");
  if (answers.startTarget) args.push("--start-target");
  if (answers.clearTarget) args.push("--clear-target");
  if (answers.allowLiveDbCopy) args.push("--allow-live-db-copy");
  if (answers.noCompress) args.push("--no-compress");
  if (answers.verify) args.push("--verify");
  if (answers.dryRun) args.push("--dry-run");

  // The wizard already confirms — skip the migrate command's own confirmation
  args.push("--yes");

  return args;
}

function formatCommand(answers: WizardAnswers, binName: string): string {
  const parts = [binName, "migrate"];

  if (answers.source) parts.push(`--source ${answers.source}`);
  if (answers.target) parts.push(`--target ${answers.target}`);
  parts.push(`--source-service ${answers.sourceService}`);
  parts.push(`--target-service ${answers.targetService}`);
  if (answers.stopSource) parts.push("--stop-source");
  if (answers.stopTarget) parts.push("--stop-target");
  if (answers.startTarget) parts.push("--start-target");
  if (answers.clearTarget) parts.push("--clear-target");
  if (answers.allowLiveDbCopy) parts.push("--allow-live-db-copy");
  if (answers.noCompress) parts.push("--no-compress");
  if (answers.verify) parts.push("--verify");
  if (answers.dryRun) parts.push("--dry-run");

  return parts.join(" \\\n    ");
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type WizardAnswers = {
  source?: string;
  target?: string;
  sourceService: string;
  targetService: string;
  stopSource: boolean;
  stopTarget: boolean;
  startTarget: boolean;
  clearTarget: boolean;
  allowLiveDbCopy: boolean;
  noCompress: boolean;
  verify: boolean;
  dryRun: boolean;
};

// ---------------------------------------------------------------------------
// Wizard flow
// ---------------------------------------------------------------------------

const TOTAL_STEPS = 6;

async function askHosts(): Promise<{ source?: string; target?: string }> {
  step(1, TOTAL_STEPS, "Hosts");

  console.log("Enter the SSH connection strings for source and target.");
  console.log("Leave blank if the host is the local machine.\n");

  const source = await promptInput("Source host (e.g. root@old-server)", "localhost");
  const target = await promptInput("Target host (e.g. root@new-server)", "localhost");

  return {
    source: source === "localhost" ? undefined : source,
    target: target === "localhost" ? undefined : target,
  };
}

async function runPreflight(): Promise<boolean> {
  step(2, TOTAL_STEPS, "Preflight checks");

  console.log("Checking local prerequisites...\n");
  const results = await runLocalToolChecks();

  let allOk = true;
  for (const r of results) {
    const icon = r.ok ? "OK" : "MISSING";
    console.log(`  [${icon}] ${r.name}${r.ok ? "" : ` — ${r.details}`}`);
    if (!r.ok) allOk = false;
  }

  if (!allOk) {
    console.log("\nSome required tools are missing. Install them before proceeding.");
    const proceed = await promptConfirm("Continue anyway?", false);
    return proceed;
  }

  console.log("\nAll prerequisites satisfied.");
  return true;
}

async function askService(
  host: string | undefined,
  role: "source" | "target",
  stepNum: number,
): Promise<string> {
  step(stepNum, TOTAL_STEPS, `${role === "source" ? "Source" : "Target"} service`);

  const label = host ?? "localhost";
  console.log(`Discovering services on ${label}...`);

  const services = await listServicesOnHost(host);

  if (services.length === 0) {
    console.log(`  No services found on ${label}.`);
    console.log("  Enter the service name manually.\n");
    const name = await promptInput(`${role === "source" ? "Source" : "Target"} service name`);
    if (!name) {
      throw new Error(`A ${role} service name is required.`);
    }
    return name;
  }

  return promptSelect(
    `Select the ${role} service:`,
    services.map((s) => ({
      label: s.name,
      value: s.name,
      description: `(${s.containers} container(s), ${s.status})`,
    })),
  );
}

async function askBehavior(): Promise<{
  stopSource: boolean;
  stopTarget: boolean;
  startTarget: boolean;
  clearTarget: boolean;
  allowLiveDbCopy: boolean;
  noCompress: boolean;
  verify: boolean;
}> {
  step(5, TOTAL_STEPS, "Migration behaviour");

  console.log("Configure how the migration should run.\n");

  const stopSource = await promptConfirm(
    "Stop source containers before transfer? (recommended for databases)",
    false,
  );
  const stopTarget = await promptConfirm(
    "Stop target containers before transfer?",
    false,
  );
  const clearTarget = await promptConfirm(
    "Clear target volumes/paths before restoring? (prevents data merge)",
    false,
  );
  const startTarget = await promptConfirm(
    "Start target containers after transfer?",
    true,
  );
  const verify = await promptConfirm(
    "Run post-migration validation? (compares file counts, sizes, container health)",
    true,
  );

  console.log("\nAdvanced options:");

  const allowLiveDbCopy = !stopSource
    ? await promptConfirm(
        "Allow live database copy without stopping source? (risky)",
        false,
      )
    : false;

  const noCompress = await promptConfirm(
    "Disable gzip compression? (faster on fast networks, slower on slow ones)",
    false,
  );

  return { stopSource, stopTarget, startTarget, clearTarget, allowLiveDbCopy, noCompress, verify };
}

async function askDryRun(): Promise<boolean> {
  step(6, TOTAL_STEPS, "Confirm");

  return promptSelect("How would you like to proceed?", [
    { label: "Dry run", value: true, description: "— show the plan without transferring data" },
    { label: "Execute migration", value: false, description: "— transfer data now" },
  ]);
}

// ---------------------------------------------------------------------------
// Command handler
// ---------------------------------------------------------------------------

export const wizardCommand: CommandHandler = async (_args, options) => {
  header("Volume Migration Wizard");
  console.log("This wizard will guide you through setting up a migration.");
  console.log("You can press Ctrl+C at any time to abort.\n");

  // 1 — Hosts
  const { source, target } = await askHosts();

  // 2 — Preflight
  const preflightOk = await runPreflight();
  if (!preflightOk) {
    process.exit(3);
  }

  // 3 — Source service
  const sourceService = await askService(source, "source", 3);

  // 4 — Target service
  const targetService = await askService(target, "target", 4);

  // 5 — Behaviour
  const behavior = await askBehavior();

  // 6 — Dry run vs execute
  const dryRun = await askDryRun();

  // Assemble answers
  const answers: WizardAnswers = {
    source,
    target,
    sourceService,
    targetService,
    ...behavior,
    dryRun,
  };

  // Show summary
  header("Summary");
  console.log("");
  console.log(`  Source:            ${source ?? "localhost"}`);
  console.log(`  Target:            ${target ?? "localhost"}`);
  console.log(`  Source service:     ${sourceService}`);
  console.log(`  Target service:    ${targetService}`);
  console.log(`  Stop source:       ${behavior.stopSource ? "yes" : "no"}`);
  console.log(`  Stop target:       ${behavior.stopTarget ? "yes" : "no"}`);
  console.log(`  Clear target:      ${behavior.clearTarget ? "yes" : "no"}`);
  console.log(`  Start target:      ${behavior.startTarget ? "yes" : "no"}`);
  console.log(`  Compress:          ${behavior.noCompress ? "no" : "yes"}`);
  console.log(`  Verify:            ${behavior.verify ? "yes" : "no"}`);
  if (behavior.allowLiveDbCopy) {
    console.log(`  Live DB copy:      yes (unsafe)`);
  }
  console.log(`  Mode:              ${dryRun ? "dry run" : "execute"}`);

  const binName = process.argv[0]?.split("/").pop() ?? "volume-migrator";
  console.log(`\nEquivalent command:\n\n  ${formatCommand(answers, binName)}\n`);

  // Final confirmation
  const proceed = await promptConfirm("Start migration?", true);
  if (!proceed) {
    console.log("Aborted.");
    return;
  }

  // Delegate to the migrate command handler
  const args = buildArgs(answers);
  console.log("");
  await migrateCommand(args, options);
};
