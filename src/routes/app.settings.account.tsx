import { createFileRoute } from "@tanstack/react-router";
import { AccountSettings } from "@/components/settings/account-settings";

export const Route = createFileRoute("/app/settings/account")({
  head: () => ({ meta: [{ title: "Account — Sparkles" }] }),
  component: AccountSettings,
});
