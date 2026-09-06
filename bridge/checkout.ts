export const checkoutScript = String.raw`
const fs = require("node:fs");
const { execFileSync } = require("node:child_process");
const input = JSON.parse(fs.readFileSync(0, "utf8"));
const marker = "/workspace/checkout.json";

if (fs.existsSync(marker)) {
  process.stdout.write(fs.readFileSync(marker));
  process.exit(0);
}

fs.mkdirSync("/workspace", { recursive: true });
if (fs.existsSync("/workspace/repo")) throw new Error("Existing checkout has no completion marker; refusing to overwrite it.");
const staging = fs.mkdtempSync("/workspace/clone-");
const credentials = fs.mkdtempSync("/tmp/sparkles-credentials-");
const askpass = credentials + "/askpass";
try {
fs.writeFileSync(credentials + "/token", input.token, { mode: 0o600 });
fs.writeFileSync(askpass, '#!/bin/sh\ncase "$1" in\n*Username*) printf "%s" "x-access-token" ;;\n*) cat "' + credentials + '/token" ;;\nesac\n', { mode: 0o700 });

  execFileSync("git", ["-c", "credential.helper=", "clone", "--single-branch", "--branch", input.branch, "--", "https://github.com/" + input.repository + ".git", staging + "/repo"], {
    env: { ...process.env, GIT_ASKPASS: askpass, GIT_TERMINAL_PROMPT: "0", GIT_LFS_SKIP_SMUDGE: "1" },
    stdio: "ignore",
    timeout: 120000,
  });
  fs.renameSync(staging + "/repo", "/workspace/repo");
  const commit = execFileSync("git", ["-C", "/workspace/repo", "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  execFileSync("git", ["-C", "/workspace/repo", "checkout", "-b", input.branchName], { stdio: "ignore" });
  fs.writeFileSync(marker, JSON.stringify({ commit }));
  process.stdout.write(JSON.stringify({ commit }));
} catch {
  process.exitCode = 1;
} finally {
  fs.rmSync(staging, { recursive: true, force: true });
  fs.rmSync(credentials, { recursive: true, force: true });
}
`;
