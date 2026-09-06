import { z } from "zod";
import { createFileRoute } from "@tanstack/react-router";
import { GitHubSettings } from "@/components/settings/github-settings";

const statuses = ["connected", "cancelled", "failed", "unavailable", "installed"] as const;

export const Route = createFileRoute("/app/settings/integrations")({
  validateSearch: z.object({
    github: z.enum(statuses).optional().catch(undefined),
  }),
  head: () => ({ meta: [{ title: "Integrations — Sparkles" }] }),
  component: Integrations,
});

function Integrations() {
  const { github } = Route.useSearch();

  return <GitHubSettings status={github} />;
}
