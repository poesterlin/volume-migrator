export type ToolStatus = {
  name: string;
  ok: boolean;
  details: string;
};

async function checkBinary(binary: string): Promise<ToolStatus> {
  const proc = Bun.spawn(["bash", "-lc", `command -v ${binary}`], {
    stdout: "pipe",
    stderr: "pipe",
  });

  const exitCode = await proc.exited;
  if (exitCode === 0) {
    const out = await new Response(proc.stdout).text();
    return {
      name: binary,
      ok: true,
      details: out.trim(),
    };
  }

  const err = await new Response(proc.stderr).text();
  return {
    name: binary,
    ok: false,
    details: err.trim() || `${binary} not found in PATH`,
  };
}

export async function runLocalToolChecks(): Promise<ToolStatus[]> {
  const requiredTools = ["ssh", "docker", "rsync", "bash"];
  return Promise.all(requiredTools.map((tool) => checkBinary(tool)));
}
