# Sparkles Clone

TanStack Start with React, TypeScript, Tailwind CSS v4, and shadcn/ui using the default Base UI preset (`base-nova`). Oxlint and Oxfmt use their default settings.

## Development

```bash
pnpm install
pnpm run dev
```

The development server runs at http://localhost:3000.

## Commands

- `pnpm run build`: production build
- `pnpm run preview`: preview the production build
- `pnpm run lint`: run Oxlint
- `pnpm run lint:fix`: apply lint fixes
- `pnpm run format`: format with Oxfmt
- `pnpm run format:check`: check formatting
- `pnpm run typecheck`: check TypeScript
- `pnpm run check`: lint, formatting, and TypeScript checks
- `pnpm test`: run Vitest

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

All `/app` routes require a WorkOS session. Account settings displays the signed-in user's profile and provides sign-out. GitHub repository access is a separate integration.
