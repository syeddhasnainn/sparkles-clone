import { z } from "zod";
import type { Sandbox } from "modal";
import type { AgentCommand } from "./contracts.ts";

export type RunnerCommand =
  | AgentCommand
  | { kind: "sync"; cursor: number; acknowledge?: number }
  | { kind: "prepare_checkpoint" | "release_checkpoint"; id: string };

export async function runnerRequest(sandbox: Sandbox, command: RunnerCommand) {
  const process = await sandbox.exec(
    [
      "node",
      "-e",
      `
    let input = ''; process.stdin.on('data', chunk => input += chunk);
    process.stdin.on('end', async () => {
      try {
        const response = await fetch('http://127.0.0.1:4097', { method: 'POST', body: input, signal: AbortSignal.timeout(15000) });
        if (!response.ok) process.exitCode = 1;
        else process.stdout.write(await response.text());
      } catch { process.exitCode = 1; }
    });
  `,
    ],
    { timeoutMs: 20000 },
  );
  await process.stdin.writeText(JSON.stringify(command));
  await process.stdin.close();
  const [output, code] = await Promise.all([process.stdout.readText(), process.wait()]);
  if (code !== 0) throw new Error("Agent unavailable or busy.");
  return z.record(z.string(), z.unknown()).parse(JSON.parse(output));
}
