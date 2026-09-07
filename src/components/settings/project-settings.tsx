import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useProjects } from "@/hooks/use-projects";
import type { Repository } from "../../../bridge/contracts";
import { RepositoryPicker } from "../dashboard/repository-picker";
import { DashboardIcon } from "../dashboard/dashboard-icon";
import { Button } from "../ui/button";
import { SettingsHeading } from "./settings-heading";
import { EnvironmentEditor } from "./environment-editor";

export function ProjectSettings({ repositoryId }: { repositoryId?: number }) {
  const { projects, loading, error, refresh } = useProjects();
  const [added, setAdded] = useState<Repository | null>(null);
  const navigate = useNavigate();
  const all =
    added && !projects.some((project) => project.repository.id === added.id)
      ? [...projects, { repository: added, variableCount: 0, revision: 0 }]
      : projects;
  const open = (id?: number) =>
    void navigate({ to: "/app/settings/projects", search: id ? { repository: id } : {} });
  return (
    <>
      <SettingsHeading
        title="Projects"
        description="Environment variables for your GitHub repositories."
      />
      <div className="settings-scroll" data-scroll-restoration-id="settings-content">
        <div className="settings-content project-settings-content">
          <div className="project-add">
            <span>Add a project</span>
            <RepositoryPicker
              selected={null}
              onSelect={(repository) => {
                setAdded(repository);
                open(repository.id);
              }}
            />
          </div>
          {loading && (
            <p className="project-environment-note" role="status">
              Loading projects…
            </p>
          )}
          {error && (
            <p className="project-environment-note" role="alert">
              Could not load projects.{" "}
              <Button variant="ghost" size="sm" onClick={() => void refresh()}>
                Retry
              </Button>
            </p>
          )}
          {!loading && !error && !all.length && (
            <p className="project-environment-note">
              Choose a repository to add environment variables. Repositories from your chats also
              appear here.
            </p>
          )}
          {all.map(({ repository, variableCount }) => (
            <section className="project-settings-card" key={repository.id}>
              <div className="project-settings-card-header">
                <DashboardIcon name="github" size={18} />
                <div>
                  <h2>{repository.name.split("/").at(-1)}</h2>
                  <p>{repository.name}</p>
                  <small>
                    {variableCount} environment variable{variableCount === 1 ? "" : "s"}
                  </small>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  aria-expanded={repositoryId === repository.id}
                  onClick={() => open(repositoryId === repository.id ? undefined : repository.id)}
                >
                  {repositoryId === repository.id ? "Close" : "Manage"}
                </Button>
              </div>
              {repositoryId === repository.id && (
                <EnvironmentEditor key={repository.id} repository={repository} />
              )}
            </section>
          ))}
        </div>
      </div>
    </>
  );
}
