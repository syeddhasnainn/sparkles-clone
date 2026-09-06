import { useId, type ReactNode } from "react";

export function SettingsSection({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  const headingId = useId();
  return (
    <section className="settings-section" aria-labelledby={headingId}>
      <div className="settings-section-heading">
        <h2 id={headingId}>{title}</h2>
        {description && <p>{description}</p>}
      </div>
      {children}
    </section>
  );
}
