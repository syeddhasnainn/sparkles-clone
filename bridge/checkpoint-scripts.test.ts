import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, readFile, writeFile, rm, symlink, readlink } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { createCheckpointScript, restoreCheckpointScript } from "./checkpoint-scripts";
import { checkpointMetadataSchema } from "./contracts";
import type { CheckpointMetadata } from "./contracts";

const paths: string[] = [];
afterEach(async () => {
  for (const path of paths.splice(0)) await rm(path, { recursive: true, force: true });
});
async function python(script: string, root: string, input: Uint8Array | string, argument?: string) {
  const child = spawn("python3", ["-c", script, ...(argument ? [argument] : [])], {
    env: { ...process.env, SPARKLES_WORKSPACE_ROOT: root },
    stdio: ["pipe", "pipe", "pipe"],
  });
  child.stdin.end(input);
  let output = "";
  let error = "";
  child.stdout.on("data", (chunk) => {
    output += chunk;
  });
  child.stderr.on("data", (chunk) => {
    error += chunk;
  });
  const code = await new Promise<number | null>((resolve, reject) => {
    child.on("error", reject);
    child.on("exit", resolve);
  });
  if (code !== 0) throw new Error(error || "Checkpoint process failed");
  return output;
}
async function fixture(agent = "opencode") {
  const agentPath = agent === "codex" ? "codex" : "data/opencode";
  const root = await mkdtemp(join(tmpdir(), "sparkles-checkpoint-test-"));
  paths.push(root);
  await mkdir(join(root, "repo"));
  await mkdir(join(root, ".sparkles", agentPath), { recursive: true });
  await writeFile(join(root, "repo", "note.txt"), "before checkpoint");
  await symlink("note.txt", join(root, "repo", "note-link"));
  await writeFile(join(root, "checkout.json"), JSON.stringify({ commit: "a".repeat(40) }));
  await writeFile(
    join(root, ".sparkles", "runner-state.json"),
    JSON.stringify({
      agent,
      status: "checkpointing",
      sessionId: "session-test",
      sequence: 7,
      requests: [["request-a", "Write note"]],
      acknowledged: 7,
    }),
  );
  await writeFile(
    join(root, ".sparkles", agentPath, "auth.json"),
    "credentials-must-not-be-archived",
  );
  await mkdir(join(root, ".sparkles", agentPath, ".tmp", "plugins"), { recursive: true });
  await writeFile(join(root, ".sparkles", agentPath, ".tmp", "plugins", "catalog"), "temporary");
  await mkdir(join(root, "repo", ".tmp"));
  await writeFile(join(root, "repo", ".tmp", "user-work"), "preserve repository files");
  await python(
    "import os,subprocess,sqlite3;root=os.environ['SPARKLES_WORKSPACE_ROOT'];subprocess.run(['git','init','-q',root+'/repo'],check=True);db=sqlite3.connect(root+'/.sparkles/" +
      agentPath +
      "/opencode.db');db.execute('CREATE TABLE session (id TEXT)');db.execute(\"INSERT INTO session VALUES ('session-test')\");db.commit()",
    root,
    "",
  );
  const id = crypto.randomUUID();
  const metadata = checkpointMetadataSchema.parse(
    JSON.parse(
      await python(
        createCheckpointScript,
        root,
        JSON.stringify({ id, sessionId: "session-test", cursor: 7, interrupted: false }),
      ),
    ),
  );
  const archive = join("/tmp", `sparkles-checkpoint-${id}.tar.gz`);
  paths.push(archive);
  return { root, metadata, bytes: await readFile(archive) };
}
async function restore(root: string, metadata: CheckpointMetadata, bytes: Uint8Array, cursor = 12) {
  return python(
    restoreCheckpointScript,
    root,
    bytes,
    JSON.stringify({ checkpoint: metadata, cursor, name: "sparkles-test" }),
  );
}

describe("workspace checkpoint archives", () => {
  it("restores source files and OpenCode SQLite data, excludes credentials, and advances the event cursor", async () => {
    const saved = await fixture();
    await writeFile(join(saved.root, "repo", "note.txt"), "changed after checkpoint");
    const restored = await mkdtemp(join(tmpdir(), "sparkles-restored-test-"));
    paths.push(restored);
    await restore(restored, saved.metadata, saved.bytes);
    expect(await readFile(join(restored, "repo", "note.txt"), "utf8")).toBe("before checkpoint");
    const state = JSON.parse(
      await readFile(join(restored, ".sparkles", "runner-state.json"), "utf8"),
    );
    expect(await readlink(join(restored, "repo", "note-link"))).toBe("note.txt");
    expect(state.sequence).toBe(12);
    expect(state.sessionId).toBe("session-test");
    await expect(
      readFile(join(restored, ".sparkles", "data", "opencode", "auth.json")),
    ).rejects.toThrow();
    const session = await python(
      "import os,sqlite3;print(sqlite3.connect(os.environ['SPARKLES_WORKSPACE_ROOT']+'/.sparkles/data/opencode/opencode.db').execute('SELECT id FROM session').fetchone()[0])",
      restored,
      "",
    );
    expect(session.trim()).toBe("session-test");
    await writeFile(join(restored, "repo", "note.txt"), "new work after restore");
    await restore(restored, saved.metadata, saved.bytes);
    expect(await readFile(join(restored, "repo", "note.txt"), "utf8")).toBe(
      "new work after restore",
    );
  });
  it("restores Codex session data to its isolated home without authentication files", async () => {
    const saved = await fixture("codex");
    const restored = await mkdtemp(join(tmpdir(), "sparkles-codex-restored-test-"));
    paths.push(restored);
    await restore(restored, saved.metadata, saved.bytes);
    const state = JSON.parse(
      await readFile(join(restored, ".sparkles", "runner-state.json"), "utf8"),
    );
    expect(state.agent).toBe("codex");
    const session = await python(
      "import os,sqlite3;print(sqlite3.connect(os.environ['SPARKLES_WORKSPACE_ROOT']+'/.sparkles/codex/opencode.db').execute('SELECT id FROM session').fetchone()[0])",
      restored,
      "",
    );
    expect(session.trim()).toBe("session-test");
    await expect(readFile(join(restored, ".sparkles", "codex", "auth.json"))).rejects.toThrow();
    await expect(
      readFile(join(restored, ".sparkles", "codex", ".tmp", "plugins", "catalog")),
    ).rejects.toThrow();
    expect(await readFile(join(restored, "repo", ".tmp", "user-work"), "utf8")).toBe(
      "preserve repository files",
    );
  });
  it("rejects corrupt archives and refuses to overwrite an existing checkout", async () => {
    const saved = await fixture();
    const restored = await mkdtemp(join(tmpdir(), "sparkles-restored-test-"));
    paths.push(restored);
    const corrupt = Buffer.from(saved.bytes);
    corrupt[0] ^= 1;
    await expect(restore(restored, saved.metadata, corrupt)).rejects.toThrow("integrity");
    await mkdir(join(restored, "repo"));
    await writeFile(join(restored, "repo", "important.txt"), "keep");
    await expect(restore(restored, saved.metadata, saved.bytes)).rejects.toThrow("overwrite");
    expect(await readFile(join(restored, "repo", "important.txt"), "utf8")).toBe("keep");
  });
  it("rejects escaping symlinks before writing outside the restore directory", async () => {
    const saved = await fixture();
    const encoded = await python(
      "import io,tarfile,base64;out=io.BytesIO();t=tarfile.open(fileobj=out,mode='w:gz');link=tarfile.TarInfo('repo/escape');link.type=tarfile.SYMTYPE;link.linkname='../../outside';t.addfile(link);t.close();print(base64.b64encode(out.getvalue()).decode())",
      saved.root,
      "",
    );
    const bytes = Buffer.from(encoded.trim(), "base64");
    const metadata = {
      ...saved.metadata,
      size: bytes.length,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    };
    const restored = await mkdtemp(join(tmpdir(), "sparkles-restored-test-"));
    paths.push(restored);
    await expect(restore(restored, metadata, bytes)).rejects.toThrow("Unsafe checkpoint link");
  });
  it("rejects an oversized declared entry before decompressing its contents", async () => {
    const saved = await fixture();
    const encoded = await python(
      "import tarfile,gzip,base64;t=tarfile.TarInfo('repo/huge');t.size=3*1024*1024*1024;print(base64.b64encode(gzip.compress(t.tobuf()+bytes(1024))).decode())",
      saved.root,
      "",
    );
    const bytes = Buffer.from(encoded.trim(), "base64");
    const metadata = {
      ...saved.metadata,
      size: bytes.length,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    };
    const restored = await mkdtemp(join(tmpdir(), "sparkles-restored-test-"));
    paths.push(restored);
    await expect(restore(restored, metadata, bytes)).rejects.toThrow("Expanded checkpoint exceeds");
  });
});
