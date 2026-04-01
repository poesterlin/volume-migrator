export type ExecResult = {
  stdout: string;
  stderr: string;
  exitCode: number;
};

export async function exec(host: string | undefined, command: string): Promise<ExecResult> {
  const args = host
    ? ["ssh", "-o", "BatchMode=yes", "-o", "ConnectTimeout=10", host, command]
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
