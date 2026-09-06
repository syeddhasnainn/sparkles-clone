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
- `pnpm test`: run Vitest (no tests are included yet)

## Adding UI components

```bash
pnpm dlx shadcn@latest add <component>
```

Components live in `src/components/ui` and use Base UI. Routes live in `src/routes`; `src/routeTree.gen.ts` is generated automatically.
