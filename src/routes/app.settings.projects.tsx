import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { ProjectSettings } from "@/components/settings/project-settings";

export const Route = createFileRoute("/app/settings/projects")({
  validateSearch: z.object({
    repository: z.coerce.number().int().positive().optional().catch(undefined),
  }),
  head: () => ({ meta: [{ title: "Projects — Sparkles" }] }),
  component: Projects,
});

function Projects() {
  const { repository } = Route.useSearch();
  return <ProjectSettings repositoryId={repository} />;
}
