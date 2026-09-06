import { createFileRoute } from "@tanstack/react-router";
import { GitHubSettings } from "@/components/settings/github-settings";

const statuses = ["connected", "cancelled", "failed", "unavailable", "installed"] as const;

export const Route = createFileRoute("/app/settings/integrations")({
  validateSearch: (search: Record<string, unknown>): { github?: (typeof statuses)[number] } => ({
    github: statuses.find((status) => status === search.github),
  }),
  head: () => ({ meta: [{ title: "Integrations — Sparkles" }] }),
  component: Integrations,
});

function Integrations() {
  const { github } = Route.useSearch();

  return <GitHubSettings status={github} />;
}
