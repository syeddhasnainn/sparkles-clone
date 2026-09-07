import { z } from "zod";

export const githubCredentialsSchema = z.object({
  token: z.string().min(1).max(2048),
  expiresAt: z.number().positive(),
  repository: z.string().regex(/^[\w.-]+\/[\w.-]+$/),
  login: z.string().min(1),
  name: z.string().min(1),
  email: z.string().min(1),
});

export type GitHubCredentials = z.infer<typeof githubCredentialsSchema>;

export const githubCredentialHelper = String.raw`#!/usr/bin/env node
const fs = require('node:fs');
if (process.argv[2] !== 'get') process.exit(0);
const fields = Object.fromEntries(fs.readFileSync(0, 'utf8').trim().split('\n').map(line => {
  const separator = line.indexOf('=');
  return [line.slice(0, separator), line.slice(separator + 1)];
}));
const credentials = JSON.parse(fs.readFileSync('/opt/sparkles/github-credentials.json', 'utf8'));
if (fields.protocol !== 'https' || fields.host !== 'github.com' ||
    (fields.path || '').replace(/\.git$/, '').toLowerCase() !== credentials.repository.toLowerCase() ||
    Date.now() >= credentials.expiresAt) process.exit(0);
process.stdout.write('username=x-access-token\npassword=' + credentials.token + '\n\n');
`;

export const githubCliWrapper = String.raw`#!/usr/bin/env node
const fs = require('node:fs');
const { spawnSync } = require('node:child_process');
const credentials = JSON.parse(fs.readFileSync('/opt/sparkles/github-credentials.json', 'utf8'));
if (Date.now() >= credentials.expiresAt) {
  process.stderr.write('Workspace GitHub connection expired. Resume the workspace to renew it.\n');
  process.exit(1);
}
const result = spawnSync('/usr/bin/gh', process.argv.slice(2), {
  stdio: 'inherit',
  env: { ...process.env, GH_TOKEN: credentials.token, GITHUB_TOKEN: credentials.token,
    GH_HOST: 'github.com', GH_REPO: credentials.repository, GH_PROMPT_DISABLED: '1' },
});
process.exit(result.status ?? 1);
`;

export const githubInstructions = `GitHub is already connected to this workspace. Use git push and gh for the selected repository; credentials and the connected user's Git identity are configured automatically. Do not ask the user to sign into GitHub on their desktop or run gh auth login. Never print, copy, or commit authentication tokens or the workspace credential file. If GitHub rejects an operation, report its actual permission error.`;
