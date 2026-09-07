// codex-acp 1.10.0 automatically trusts session roots. Hosted repositories must
// not activate project-local MCP servers, hooks, or rules before user approval.
// Keep this patch version-specific and fail the image build if upstream changes.
export const codexPolicyPatch = String.raw`
const fs = require("node:fs");
const path = process.argv[1];
const source = fs.readFileSync(path, "utf8");
const target = 'trust_level: "trusted"';
if (source.split(target).length !== 2) throw new Error("Unexpected Codex ACP trust policy");
fs.writeFileSync(path, source.replace(target, 'trust_level: "untrusted"'));
`;

const shellQuote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;

export const codexPolicyBuildCommand =
  `RUN node -e ${shellQuote(codexPolicyPatch.replaceAll("\n", " "))} ` +
  "/usr/local/lib/node_modules/@agentclientprotocol/codex-acp/dist/index.js";
