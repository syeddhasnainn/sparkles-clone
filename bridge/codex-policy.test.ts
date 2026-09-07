import { describe, expect, it } from "vitest";
import { runInNewContext } from "node:vm";
import { codexPolicyBuildCommand, codexPolicyPatch } from "./codex-policy";

describe("hosted Codex ACP trust policy", () => {
  it("removes automatic repository trust and fails closed when the pinned adapter changes", () => {
    const patch = (source: string) => {
      let result: string | undefined;
      runInNewContext(codexPolicyPatch, {
        process: { argv: ["node", "adapter.js"] },
        require: () => ({
          readFileSync: () => source,
          writeFileSync: (_path: string, value: string) => {
            result = value;
          },
        }),
      });
      return result;
    };
    expect(patch('projects: { root: { trust_level: "trusted" } }')).toContain(
      'trust_level: "untrusted"',
    );
    expect(() => patch("projects: {}")).toThrow("Unexpected Codex ACP trust policy");
    expect(() => patch('trust_level: "trusted", trust_level: "trusted"')).toThrow(
      "Unexpected Codex ACP trust policy",
    );
    expect(codexPolicyBuildCommand).not.toContain("\n");
  });
});
