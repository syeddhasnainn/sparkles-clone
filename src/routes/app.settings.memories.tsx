import { createFileRoute } from "@tanstack/react-router";
import { SettingsHeading } from "@/components/settings/settings-heading";

export const Route = createFileRoute("/app/settings/memories")({
  head: () => ({ meta: [{ title: "Memories — Sparkles" }] }),
  component: MemoriesSettings,
});

function MemoriesSettings() {
  return (
    <>
      <SettingsHeading title="Memories" description="What the agent remembers about you." />
      <div className="settings-scroll">
        <div className="settings-content coming-soon">
          <h2>Coming soon</h2>
        </div>
      </div>
    </>
  );
}
