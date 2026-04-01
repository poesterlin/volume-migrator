import { readdir } from "fs/promises";

export type ExecResult = {
  stdout: string;
  stderr: string;
  exitCode: number;
};

// ---------------------------------------------------------------------------
// Coolify SSH key auto-detection
// ---------------------------------------------------------------------------

const COOLIFY_KEY_DIR = "/data/coolify/ssh/keys";

/**
 * Cache of resolved identity files per host.
 * `null` means "we checked and no Coolify key works — use default SSH config".
 */
const resolvedKeys = new Map<string, string | null>();

/**
 * List private key files inside the Coolify key directory.
 * Ignores `.lock` files and returns absolute paths.
 */
async function listCoolifyKeys(): Promise<string[]> {
  try {
    const entries = await readdir(COOLIFY_KEY_DIR);
    return entries
      .filter((e) => !e.endsWith(".lock"))
      .map((e) => `${COOLIFY_KEY_DIR}/${e}`);
  } catch {
    return [];
  }
}

/**
 * Try to authenticate to `host` using a specific key file.
 * Returns `true` if the connection succeeds (exit 0).
 */
async function probeKey(host: string, keyPath: string): Promise<boolean> {
  const proc = Bun.spawn(
    [
      "ssh",
      "-o", "BatchMode=yes",
      "-o", "ConnectTimeout=5",
      "-o", "StrictHostKeyChecking=accept-new",
      "-i", keyPath,
      host,
      "true",
    ],
    { stdout: "pipe", stderr: "pipe" },
  );

  const exitCode = await proc.exited;
  return exitCode === 0;
}

/**
 * Resolve which Coolify SSH key (if any) works for the given host.
 * Results are cached for the lifetime of the process.
 */
export async function resolveSshKey(host: string): Promise<string | null> {
  if (resolvedKeys.has(host)) {
    return resolvedKeys.get(host)!;
  }

  const keys = await listCoolifyKeys();
  for (const key of keys) {
    if (await probeKey(host, key)) {
      resolvedKeys.set(host, key);
      return key;
    }
  }

  resolvedKeys.set(host, null);
  return null;
}

// ---------------------------------------------------------------------------
// Shared SSH arg builder
// ---------------------------------------------------------------------------

/**
 * Build the SSH argument array used for remote command execution.
 * All SSH invocations in the codebase should go through this helper.
 */
export function buildSshArgs(host: string): string[] {
  const key = resolvedKeys.get(host);
  const args = [
    "ssh",
    "-o", "BatchMode=yes",
    "-o", "ConnectTimeout=10",
    "-o", "StrictHostKeyChecking=accept-new",
  ];

  if (key) {
    args.push("-i", key);
  }

  args.push(host);
  return args;
}

/**
 * Build the `-e` argument string for rsync (the SSH transport command).
 */
export function buildRsyncSshArg(host: string): string {
  const key = resolvedKeys.get(host);
  let cmd = "ssh -o BatchMode=yes -o ConnectTimeout=10 -o StrictHostKeyChecking=accept-new";
  if (key) {
    cmd += ` -i ${key}`;
  }
  return cmd;
}

// ---------------------------------------------------------------------------
// Remote / local command execution
// ---------------------------------------------------------------------------

export async function exec(host: string | undefined, command: string): Promise<ExecResult> {
  const args = host
    ? [...buildSshArgs(host), command]
    : ["bash", "-c", command];

  const proc = Bun.spawn(args, {
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  return { stdout: stdout.trim(), stderr: stderr.trim(), exitCode };
}
