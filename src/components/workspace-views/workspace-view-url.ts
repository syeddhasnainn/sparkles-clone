export function isolatedWorkspaceUrl(value: string, parentOrigin: string) {
  const url = new URL(value);
  if (
    url.protocol !== "https:" ||
    !(url.hostname.endsWith(".modal.host") || url.hostname.endsWith(".modal.run")) ||
    url.origin === new URL(parentOrigin).origin ||
    url.username ||
    url.password
  ) {
    throw new Error("Workspace views require an isolated Modal origin.");
  }
  return url.href;
}
