# Sparkles Clone

TanStack Start with React, TypeScript, Tailwind CSS v4, and shadcn/ui using the default Base UI preset (`base-nova`). Oxlint runs the generic anti-slop rules; Oxfmt handles code formatting.

## Development

```bash
pnpm install
pnpm run db:migrate
pnpm run dev
```

The development server runs at http://localhost:3000 using the Cloudflare Workers runtime. D1 data is stored locally under `.wrangler` during development.

## Commands

- `pnpm run build`: production build
- `pnpm run preview`: preview the production build
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
- Repository permissions: Metadata read-only and Contents read-only. This integration lists and selects repositories; agent execution and write access are separate work.
- Allow installation on any account if other users will try the demo.

Add the app's client ID, client secret, and slug to `.env.local`. Set `GITHUB_REDIRECT_URI` to the callback URL above. Generate `GITHUB_TOKEN_ENCRYPTION_KEY` with `openssl rand -hex 32`. Keep this key stable: it encrypts credentials in D1, and replacing it requires reconnecting existing accounts. Never put GitHub tokens in client code or browser storage.

OAuth state is single-use and bound to the signed-in WorkOS user and session. The callback also verifies a browser cookie and uses PKCE. GitHub access and refresh tokens are encrypted with AES-GCM using the WorkOS user ID as authenticated context. A database lock serializes token refresh and disconnect operations. Repository listing uses user access tokens, so GitHub enforces the intersection of the user's access and the app's installed repositories.

The repository picker supports account selection, pagination, and filtering loaded repositories. The selected repository is held in the current composer session; task creation and execution are not implemented yet. Disconnect revokes the stored token and deletes the local connection. It does not uninstall the app from shared organizations.

## Cloudflare deployment

The app remains on WorkOS Staging for the demo. Before deploying, configure the HTTPS callback and application URLs in WorkOS and the GitHub App, and update the redirect environment variables accordingly.

Create the D1 database with `pnpm exec wrangler d1 create sparkles-demo` and add its returned database ID to `wrangler.jsonc`. Apply migrations with `pnpm exec wrangler d1 migrations apply sparkles-demo --remote`. Set the variables listed in `.env.example` using `pnpm exec wrangler secret put <NAME>` or a secret-management workflow, then deploy. Local `.env.local` values are not deployed automatically.

Use a separate database, encryption key, GitHub App, and WorkOS environment for any future production deployment.

## Anti-slop lint rules

The [anti-slop plugin](https://github.com/dmmulroy/anti-slop) is vendored in `tools/oxlint/anti-slop/`. All 15 generic rules run as errors through `pnpm lint` and `pnpm check`, configured in `.oxlintrc.json`. Generated bindings, generated routes, vendored rules, and agent tooling are excluded from linting.

Keep `oxlint` and `@oxlint/plugins` pinned to the same version when upgrading. Only the generic rules are vendored; the Effect folder is omitted. GitHub service tests inject typed dependencies; storage tests run against Miniflare D1 with the application migration.

## React Doctor

React Doctor is pinned as a development dependency. Run `pnpm run react:doctor` for a full application scan. `doctor.config.json` excludes only vendored anti-slop rules and generated route/Workers files; application rules remain enabled. The scan must finish without warnings or errors.

Dependency installs use a 24-hour minimum release age and reject trust downgrades. Exact-version exceptions cover the legacy publication metadata for `semver@6.3.1` (Babel) and `undici-types@6.21.0` (Node 22 types); future versions remain subject to the policy.
