import { runInNewContext } from "node:vm";
import { createRequire } from "node:module";
import { expect, it } from "vitest";
import { githubCredentialHelper, githubCliWrapper } from "./github-credentials";

const credentials = {
  token: "test-token",
  repository: "owner/repo",
  expiresAt: Date.now() + 60000,
};
function helper(input: string, operation = "get", expired = false) {
  let output = "";
  const exit = Symbol("exit");
  try {
    runInNewContext(githubCredentialHelper, {
      require: () => ({
        readFileSync: (path: string | number) =>
          path === 0
            ? input
            : JSON.stringify({ ...credentials, expiresAt: expired ? 1 : credentials.expiresAt }),
      }),
      process: {
        argv: ["node", "helper", operation],
        exit: () => {
          throw exit;
        },
        stdout: {
          write: (value: string) => {
            output += value;
          },
        },
      },
    });
  } catch (error) {
    if (error !== exit) throw error;
  }
  return output;
}
it("supplies Git credentials only to the selected HTTPS repository", () => {
  expect(helper("protocol=https\nhost=github.com\npath=owner/repo.git\n")).toContain(
    "password=test-token",
  );
  for (const input of [
    "protocol=https\nhost=evil.example\npath=owner/repo.git\n",
    "protocol=https\nhost=github.com\npath=owner/other.git\n",
    "protocol=http\nhost=github.com\npath=owner/repo.git\n",
    "protocol=https\nhost=github.com\n",
  ])
    expect(helper(input)).toBe("");
  expect(helper("protocol=https\nhost=github.com\npath=owner/repo.git\n", "get", true)).toBe("");
  expect(helper("", "store")).toBe("");
});
it("passes connected credentials to gh even when the agent environment has no token", () => {
  const calls: unknown[] = [];
  runInNewContext(githubCliWrapper, {
    require: (name: string) =>
      name === "node:fs"
        ? { readFileSync: () => JSON.stringify(credentials) }
        : name === "node:child_process"
          ? {
              spawnSync: (...args: unknown[]) => {
                calls.push(args);
                return { status: 0 };
              },
            }
          : createRequire(import.meta.url)(name),
    process: {
      argv: ["node", "gh", "pr", "create"],
      env: {},
      exit: () => {},
      stderr: { write: () => {} },
    },
  });
  expect(calls).toEqual([
    [
      "/usr/bin/gh",
      ["pr", "create"],
      {
        stdio: "inherit",
        env: {
          GH_TOKEN: credentials.token,
          GITHUB_TOKEN: credentials.token,
          GH_HOST: "github.com",
          GH_REPO: credentials.repository,
          GH_PROMPT_DISABLED: "1",
        },
      },
    ],
  ]);
});
