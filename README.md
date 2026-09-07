# Sparkles Clone

TanStack Start with React, TypeScript, Tailwind CSS v4, and shadcn/ui using the default Base UI preset (`base-nova`). Oxlint runs the generic anti-slop rules; Oxfmt handles code formatting.

## Development

```bash
pnpm install
pnpm run bridge:install
pnpm run db:migrate
pnpm run dev
```

The development server runs at http://localhost:3000 using the Cloudflare Workers runtime. D1 conversations and R2 checkpoints are stored locally under `.wrangler` during development. The local migrations include the agent session tables. `pnpm dev` starts the Worker and a local Node bridge automatically, without Docker. The bridge uses an ephemeral loopback port and a per-session access token; it closes when Vite stops. `dev.enable_containers` remains disabled in `wrangler.jsonc`. `pnpm run bridge:install` installs the separately locked Node bridge dependencies needed for TypeScript checks and direct bridge development; Docker installs these itself when building the image.

## Commands

- `pnpm run build`: production build
- `pnpm run bridge:install`: install the Node service dependencies
- `pnpm run preview`: preview the production build

Sandbox Preview uses the task's coding agent to start the app. **Start preview** sends an explicit request to inspect repository instructions, set up dependencies and system tools, resolve startup failures, and verify the app. **Fix with agent** uses the same flow after a failure. Progress and questions appear in the conversation. Opening the Preview tab only polls the service; it does not install packages or launch guessed commands.

The agent receives platform preview instructions with every turn, so a normal chat request can also start the app. It uses the sandbox's preview supervisor on loopback port 4098 to inspect logs and start a persistent development server with the project's actual command, port, and title. When the supervisor reports ready, the runner records a durable preview event and the conversation displays an **Open preview** card. The card opens the Preview panel; it never sends users to localhost on their own computer. Server readiness does not verify login or every app feature. Explicit commands remain available in Preview settings. Startup retries retain bounded failure logs, and old generated dependency-install commands are cleared when the sandbox service restarts.

- `pnpm run lint`: run Oxlint
- `pnpm run lint:fix`: apply lint fixes
- `pnpm run format`: format with Oxfmt
- `pnpm run format:check`: check formatting
- `pnpm run typecheck`: check TypeScript
- `pnpm run check`: lint, formatting, and TypeScript checks
- `pnpm run react:doctor`: full React Doctor scan; fails on errors or warnings
- `pnpm test`: run Vitest
- `pnpm run db:migrate`: apply D1 migrations locally
- `pnpm run cf-typegen`: regenerate Workers binding types
- `pnpm run deploy`: build and deploy to Cloudflare Workers

## Adding UI components

```bash
pnpm dlx shadcn@latest add <component>
```

Components live in `src/components/ui` and use Base UI. Routes live in `src/routes`; `src/routeTree.gen.ts` is generated automatically.

## Authentication

Authentication uses the WorkOS AuthKit TanStack Start SDK and its hosted sign-in flow.

Create `.env.local` from `.env.example` and set the WorkOS client ID, API key, and a random cookie password of at least 32 characters. Keep `.env.local` out of version control. Generate a cookie password with `openssl rand -base64 48`.

Configure these application URLs in the WorkOS dashboard for local development:

- Redirect URI: `http://localhost:3000/api/auth/callback`
- Initiate login URI: `http://localhost:3000/api/auth/sign-in`
- App homepage: `http://localhost:3000`
- Sign-out URI: `http://localhost:3000/sign-in`

Run `pnpm dev` and open `http://localhost:3000`. Use the same hostname and port throughout the sign-in flow so the callback receives its verification cookie. For deployment, configure the equivalent HTTPS URLs and server environment variables.

Sign-in redirects directly to hosted AuthKit, which provides Google and the other enabled authentication methods. WorkOS demo Google credentials support staging; production requires your own Google OAuth client configured in WorkOS.

All `/app` routes require a WorkOS session. Account settings displays the signed-in user's profile and provides sign-out.

## GitHub repository access

GitHub access uses a GitHub App, separately from WorkOS sign-in. Users authorize their GitHub account, install the app on selected repositories, and choose an accessible repository in the dashboard. Connections can be managed or disconnected under Settings → Integrations.

Register a GitHub App with these local settings:

- Callback URL: `http://localhost:3000/api/github/callback`
- Setup URL: `http://localhost:3000/app/settings/integrations?github=installed`
- Keep expiring user authorization tokens enabled.
- Leave “Request user authorization (OAuth) during installation” disabled. Account authorization starts from Sparkles before repository installation.
- Enable redirect on installation updates.
- Disable webhooks for this integration; access is checked through GitHub when listing repositories.
- Repository permissions: Metadata read-only, Contents read and write, and Pull requests read and write. Existing installations must accept added permissions. Checkout tokens remain restricted to Contents read-only; sandbox pushes and PR creation still require an implementation that requests and uses write permissions.
- Allow installation on any account if other users will try the demo.

Add the app's client ID, client secret, and slug to `.env.local`. Set `GITHUB_REDIRECT_URI` to the callback URL above. Generate `GITHUB_TOKEN_ENCRYPTION_KEY` with `openssl rand -hex 32`. Keep this key stable: it encrypts credentials and project environment variables in D1, and saved cloud-browser profiles in R2. Replacing it requires reconnecting existing accounts, re-entering saved project variables, and clearing saved cloud-browser sessions. Never put GitHub tokens in client code or browser storage.

OAuth state is single-use and bound to the signed-in WorkOS user and session. The callback also verifies a browser cookie and uses PKCE. GitHub access and refresh tokens are encrypted with AES-GCM using the WorkOS user ID as authenticated context. A database lock serializes token refresh and disconnect operations. Repository listing uses user access tokens, so GitHub enforces the intersection of the user's access and the app's installed repositories.

The repository picker supports account selection, pagination, and filtering loaded repositories. The composer can prepare an isolated workspace for the selected repository once workspace hosting is configured. Disconnect revokes the stored token and deletes the local connection. It does not uninstall the app from shared organizations.

## Modal workspaces

The Worker handles authentication and the UI. A per-user Durable Object saves workspace requests and runs provisioning through durable alarms. It calls a private Cloudflare Container running the TypeScript service in `bridge/`. That Node service uses Modal's SDK to create the sandbox and check out the repository at `/workspace/repo` on a new `sparkles/<workspace-id>` branch.

The composer saves the task description and shows provisioning, ready, stopping, stopped, or failed states. Requests are idempotent, survive browser closure, and retry with backoff. Each user can run three workspaces at once. Sandboxes have two CPUs, 4 GiB of memory, and a one-hour maximum lifetime. Durable alarms synchronize agent events every two seconds while ready, independently of browser polling; workspace status refreshes every five seconds. The bridge uses at most four Cloudflare Container instances, each sleeping after five minutes without requests.

Add these server settings alongside the existing GitHub and WorkOS configuration:

| Setting                                 | Source                                                                                                                                             |
| --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `MODAL_TOKEN_ID` / `MODAL_TOKEN_SECRET` | A Modal token for the target workspace; production should use a service user.                                                                      |
| `GITHUB_APP_ID`                         | The numeric App ID in the GitHub App's settings.                                                                                                   |
| `GITHUB_APP_PRIVATE_KEY`                | A private key generated for that GitHub App. PKCS#1 and PKCS#8 PEM keys are supported; literal `\n` separators are accepted for environment files. |
| `MODAL_APP_NAME`                        | Wrangler variable, default `sparkles-workspaces`; use separate names/accounts for isolated environments.                                           |

Before checkout, the Worker rechecks the user's access through GitHub, then creates an installation token restricted to that one repository with Contents read-only permission. The bridge receives this temporary token but never the GitHub App signing key or the user's OAuth credentials. The sandbox receives the token over stdin, uses a temporary credential helper, and deletes the helper and token after checkout. The Worker revokes the installation token in a finally block. An interrupted checkout never overwrites an existing repository. Tokens are excluded from clone URLs, workspace state, and responses. The Container is reachable only through its Worker binding; no public forwarding endpoint is exposed.

For local end-to-end testing, run `pnpm run bridge:install` once and then `pnpm dev`. The Worker calls the local Node bridge, which creates real sandboxes in the configured Modal account. No Docker or second terminal is needed. Local runs incur normal Modal usage. Local bridge connection details are injected only into the development Worker; production builds always use the Cloudflare Container binding.

Deploying builds the Docker image and requires a Docker engine on the build machine (for example, a CI runner) and Cloudflare Containers access. Docker is not needed on your Mac for development.

OpenCode or Codex executes the saved prompt through ACP in the sandbox. Conversation history persists in D1, and R2 checkpoints let stopped tasks resume in a fresh sandbox with their files and original agent session. Interactive terminal access, file uploads, and pushes/PRs are not implemented. Modal's Node SDK is confined to the bridge, and the Worker talks to a small provider interface so another sandbox service can replace it later.

Modal's SDK is pinned to `0.10.0` in the bridge lockfile. The bridge has its own minimum-release-age and trust policies. Its exact-version trust exception accounts for the npm package name previously belonging to an unrelated project; this version was checked against `modal-labs/modal-client/js/package.json`. Optional native CBOR build scripts and protobuf postinstall scripts are disabled.

## Agents, ChatGPT, and ACP

The sandbox image installs OpenCode `1.18.29`, Codex CLI `0.153.3`, the Codex ACP adapter `1.10.0`, and the ACP SDK `1.4.0`. A sandbox-local runner starts `opencode acp` or `codex-acp`, negotiates ACP v1 over stdio, creates a session in `/workspace/repo`, and submits the saved prompt. The task page at `/app/tasks/<id>` shows setup progress, incremental text, tool activity, and permission requests. It supports follow-up prompts and cancellation. The initial prompt and retries use stable request IDs to prevent duplicate turns in the running session.

Set `OPENROUTER_API_KEY` on the server and `AGENT_MODEL` to an OpenCode model identifier (default `openrouter/anthropic/claude-sonnet-4`). The Worker keeps the provider key and forwards model requests through `/api/model/chat/completions`. Sandboxes receive a per-run gateway credential, validated against D1 and revoked on stop; they never receive the provider key. Set `MODEL_GATEWAY_URL` to the public HTTPS app origin in production. Local development loads `.env.local` and automatically starts a gateway-only Cloudflare tunnel (requires `cloudflared`); it closes when the dev server stops. Apply local D1 migrations before starting a new task. Repository OpenCode configuration and external plugins are disabled so a checkout cannot start plugins or MCP servers before approval. Agent permissions default to asking, and automatic sharing and updates are disabled.

Set `CHATGPT_TOKEN_ENCRYPTION_KEY` to a stable 32-byte hex key (`openssl rand -hex 32`), apply migration `0004_chatgpt_connections.sql`, then connect ChatGPT in Settings → Integrations. Device authorization happens on OpenAI’s sign-in page. One connection supplies both agents; they share the account’s subscription allowance. The composer selects the agent and model, which stay pinned for follow-ups and resumed tasks. Existing tasks retain the OpenRouter/OpenCode default.

The Worker stores encrypted ChatGPT credentials in D1, serializes refresh-token rotation, and authorizes Responses requests through `/api/model/responses`. ChatGPT inference uses the server-side Node bridge (`/chatgpt/responses`) for outbound HTTPS because the Worker runtime adds a `cf-worker` header that ChatGPT rejects. Development uses the authenticated loopback bridge; production uses the private `MODAL_BRIDGE` container binding. The relay fixes the destination, rebuilds the provider headers, and streams responses with cancellation. Sandboxes receive only revocable, task-scoped gateway credentials. Disconnecting revokes access for every task using that connection. Reconnecting the same account preserves task compatibility; connecting a different account requires a new task. There is no paid API fallback on quota or authentication failures.

The pinned Codex ACP adapter receives a checked build-time patch (`bridge/codex-policy.ts`) to mark repository roots untrusted. This prevents project-local `.codex` configuration, hooks, rules, and MCP processes from being activated automatically. The image build fails if the expected upstream policy changes. Codex uses standard workspace permissions with approval requests for restricted actions. Its ACP gateway authentication uses only the temporary Sparkles credential; ChatGPT refresh tokens never enter agent state or checkpoints.

The browser polls cursor-based events through authenticated server functions. This HTTP bridge is application transport; the agent-facing transport is standard ACP stdio. Each request checks workspace ownership through the user's Durable Object. The runner binds only to sandbox loopback, and the bridge accesses it through authenticated Modal exec. Events are appended to a sandbox journal before being emitted and are acknowledged only after D1 commits them. D1 stores ordered conversation events, the ACP session ID, prompt request IDs, and checkpoint metadata with user ownership and run fencing. History stays readable after sandbox termination. Interrupted turns are never automatically replayed.

Tool permissions are forwarded to the task page with the agent's Allow/Reject options. Cancelling a turn also cancels pending permission requests. Repository instructions and tool outputs render as text. The SDK integration test uses a fake ACP agent to verify protocol updates, permission decisions, and retry deduplication.

### Saving and resuming tasks

The Durable Object coordinates background saves even with every browser tab closed. A baseline checkpoint is saved before the initial prompt, followed by checkpoints after completed turns and every minute while idle. Stop and one-hour expiry cancel the active turn, save a clean checkpoint where possible, then terminate the sandbox. Modal allows five additional minutes for cleanup. Unexpected termination preserves the last successful checkpoint and any events already committed to D1; changes since that checkpoint can be lost.

Checkpoints contain the Git checkout (including uncommitted and untracked files), runner session state, and consistent SQLite backups of the selected agent’s data. Provider authentication files are excluded. Untracked `node_modules` directories are omitted and may need reinstalling after resume. Archives are limited to 512 MiB compressed and 2 GiB expanded. R2 upload and integrity validation must succeed before the D1 checkpoint pointer advances; the last three successful versions are retained. Checkpoint storage is private and server-mediated.

Cloud-browser cookies and site storage are saved separately per user and project, encrypted in R2, and restored into new or resumed tasks. Profiles save every minute and before an orderly stop; unexpected sandbox loss preserves the last completed save. Archives omit caches and are limited to 16 MiB compressed and 128 MiB expanded. Concurrent tasks cannot overwrite a newer saved profile with stale browser data; the task displays a warning when its browser changes cannot be saved.

Account settings can clear saved cloud-browser sessions and reset browsers in running tasks. Clearing invalidates older saves so they cannot restore cleared logins. Failed resets are reported and block that workspace from saving browser data until clearing succeeds. This clears cloud-browser data without revoking website sessions on other devices. Apply database migrations with `pnpm db:migrate` for local development.

**Resume workspace** rechecks repository access, allocates a new sandbox, verifies and restores the archive, then calls ACP `session/load` with the saved session ID. Conversation history remains in D1 and continues with monotonic event IDs. Resume does not rerun the initial prompt or interrupted tools; send a follow-up to continue. Tasks created before persistence was installed have no recoverable checkpoint unless one was saved while their sandbox was still running.

Protocol references: [ACP introduction](https://agentclientprotocol.com/get-started/introduction), [OpenCode ACP support](https://opencode.ai/docs/acp/).

## Cloudflare deployment

The app remains on WorkOS Staging for the demo. Before deploying, configure the HTTPS callback and application URLs in WorkOS and the GitHub App, and update the redirect environment variables accordingly.

Create the private R2 checkpoint bucket with `pnpm exec wrangler r2 bucket create sparkles-checkpoints`; its `CHECKPOINTS` binding is configured in `wrangler.jsonc`. Create the D1 database with `pnpm exec wrangler d1 create sparkles-demo` and add its returned database ID to `wrangler.jsonc`. Apply migrations with `pnpm exec wrangler d1 migrations apply sparkles-demo --remote`. Set the variables listed in `.env.example` using `pnpm exec wrangler secret put <NAME>` or a secret-management workflow, then deploy. Local `.env.local` values are not deployed automatically.

Use a separate database, encryption key, GitHub App, and WorkOS environment for any future production deployment.

## Anti-slop lint rules

The [anti-slop plugin](https://github.com/dmmulroy/anti-slop) is vendored in `tools/oxlint/anti-slop/`. All 15 generic rules run as errors through `pnpm lint` and `pnpm check`, configured in `.oxlintrc.json`. Generated bindings, generated routes, vendored rules, and agent tooling are excluded from linting.

Keep `oxlint` and `@oxlint/plugins` pinned to the same version when upgrading. Only the generic rules are vendored; the Effect folder is omitted. GitHub service tests inject typed dependencies; storage tests run against Miniflare D1 with the application migration.

## React Doctor

React Doctor is pinned as a development dependency. Run `pnpm run react:doctor` for a full application scan. `doctor.config.json` excludes only vendored anti-slop rules and generated route/Workers files; application rules remain enabled. The scan must finish without warnings or errors.

Dependency installs use a 24-hour minimum release age and reject trust downgrades. Exact-version exceptions cover the legacy publication metadata for `semver@6.3.1` (Babel) and `undici-types@6.21.0` (Node 22 types); future versions remain subject to the policy.

Codex permission modes can be selected from the composer before creation or changed in a running task. Standard maps to `read-only`, Auto to `agent` (Codex auto review), and Full access to `agent-full-access` inside the isolated workspace. The runner validates choices against the native modes, sends `session/set_mode`, journals the confirmed mode, and reapplies it on restore. Changes affect subsequent turns and do not resolve pending approvals. Older running workspaces must stop and resume to load the updated runner. OpenCode remains in Manual mode; planning is a separate agent capability.

### Project environment variables

Settings → Projects lets each user manage variables for a GitHub repository. Values are encrypted in D1, masked in the editor, and injected through Modal Secrets when a new or resumed sandbox is allocated. Running workspaces keep their current values until the next start. Paste `.env` contents into a name field to import multiple values; runtime-reserved names are rejected. Apply migration `0005_project_environments.sql` alongside the application update.

Workspace startup uses the connected GitHub account to authorize the selected repository, installs `gh`, and configures Git with the connected user’s noreply identity. Each run receives a short-lived installation token scoped to that repository; write access is requested only when the connected user has push permission. Tokens are encrypted in D1 for revocation when the workspace stops. Sandbox credentials live outside repository checkpoints and are renewed on resume. Apply D1 migrations when updating the worker and update the bridge alongside it.
