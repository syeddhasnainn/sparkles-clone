import type { ReactNode } from "react";
import { WorkspacesContext, useWorkspaceState } from "../../hooks/use-workspaces";
import type { WorkspaceClient, WorkspaceList } from "../../hooks/use-workspaces";

export function WorkspacesProvider({
  initialData,
  children,
  client,
}: {
  initialData: WorkspaceList;
  children: ReactNode;
  client: WorkspaceClient;
}) {
  const value = useWorkspaceState(initialData, client);
  return <WorkspacesContext value={value}>{children}</WorkspacesContext>;
}
