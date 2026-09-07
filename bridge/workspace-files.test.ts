import { afterEach, beforeEach, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { workspaceFilesSource } from "./workspace-files-source";
import { workspaceViewResultSchema } from "./workspace-view-contracts";
import type { WorkspaceViewCommand } from "./workspace-view-contracts";

let root: string;
let commit: string;
const git = (...args: string[]) => execFileSync("git", args, { cwd: root }).toString().trim();
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "sparkles-files-"));
  git("init", "-q");
  git("config", "user.email", "test@example.com");
  git("config", "user.name", "Test");
  writeFileSync(join(root, "index.ts"), "export const answer = 1;\n");
  writeFileSync(join(root, "removed.txt"), "remove me\n");
  git("add", ".");
  git("commit", "-qm", "initial");
  commit = git("rev-parse", "HEAD");
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

function read(command: WorkspaceViewCommand) {
  return workspaceViewResultSchema.parse(
    JSON.parse(
      execFileSync(process.execPath, ["-e", workspaceFilesSource], {
        env: { ...process.env, SPARKLES_WORKSPACE_DIR: root },
        input: JSON.stringify({ command, commit }),
        maxBuffer: 4 * 1024 * 1024,
        stdio: ["pipe", "pipe", "pipe"],
      }).toString(),
    ),
  );
}

it("lists modified, deleted, and untracked files with literal unusual names", () => {
  writeFileSync(join(root, "index.ts"), "export const answer = 2;\n");
  rmSync(join(root, "removed.txt"));
  writeFileSync(join(root, "new\tfile.txt"), "new");
  const result = read({ kind: "files", scope: "changed", base: "task" });
  expect(result.kind).toBe("files");
  if (result.kind !== "files") throw new Error("Missing file list");
  expect(result.files.map((file) => [file.path, file.status])).toEqual([
    ["index.ts", "modified"],
    ["new\tfile.txt", "added"],
    ["removed.txt", "deleted"],
  ]);
  expect(result.files[0]).toMatchObject({ additions: 1, deletions: 1 });
});

it("keeps task changes visible after committing, while uncommitted comparison is clean", () => {
  writeFileSync(join(root, "index.ts"), "export const answer = 2;\n");
  git("add", ".");
  git("commit", "-qm", "change");
  const result = read({ kind: "file", path: "index.ts", base: "task" });
  expect(result).toMatchObject({
    before: "export const answer = 1;\n",
    after: "export const answer = 2;\n",
  });
  expect(read({ kind: "files", scope: "changed", base: "head" })).toMatchObject({ files: [] });
});

it("counts untracked text lines and marks binary or oversized counts unavailable", () => {
  writeFileSync(join(root, "new.txt"), "one\ntwo");
  writeFileSync(join(root, "empty.txt"), "");
  writeFileSync(join(root, "binary.bin"), Buffer.from([0, 1]));
  writeFileSync(join(root, "large.txt"), "x".repeat(600 * 1024));
  const result = read({ kind: "files", scope: "changed", base: "task" });
  if (result.kind !== "files") throw new Error("Missing files");
  expect(result.files.find((file) => file.path === "new.txt")).toMatchObject({
    additions: 2,
    deletions: 0,
  });
  expect(result.files.find((file) => file.path === "empty.txt")).toMatchObject({ additions: 0 });
  expect(result.files.find((file) => file.path === "binary.bin")).toMatchObject({
    additions: null,
  });
  expect(result.files.find((file) => file.path === "large.txt")).toMatchObject({ additions: null });
});

it("rejects traversal, internal credentials, and symlinks outside the repository", () => {
  symlinkSync(tmpdir(), join(root, "escape"));
  writeFileSync(join(root, ".env"), "SECRET=hidden");
  for (const path of ["../secret", "/etc/passwd", ".git/config", ".env", "escape/other"]) {
    expect(() => read({ kind: "file", path, base: "task" })).toThrow();
  }
  const result = read({ kind: "files", scope: "all", base: "task" });
  if (result.kind !== "files") throw new Error("Missing files");
  expect(result.files.some((file) => file.path === ".env")).toBe(false);
});

it("handles binary and oversized files without returning unsafe text", () => {
  writeFileSync(join(root, "binary.bin"), Buffer.from([0, 1, 2, 255]));
  writeFileSync(join(root, "large.txt"), "x".repeat(600 * 1024));
  expect(read({ kind: "file", path: "binary.bin", base: "task" })).toMatchObject({
    binary: true,
    before: null,
    after: null,
  });
  expect(read({ kind: "file", path: "large.txt", base: "task" })).toMatchObject({
    tooLarge: true,
    after: null,
  });
});

it("rejects aliases into blocked directories", () => {
  writeFileSync(join(root, ".git", "private.txt"), "synthetic secret");
  symlinkSync(".git", join(root, "alias"));
  expect(() => read({ kind: "file", path: "alias/private.txt", base: "task" })).toThrow();
});
