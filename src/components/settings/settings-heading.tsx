export function SettingsHeading({ title, description }: { title: string; description: string }) {
  return (
    <div className="settings-heading">
      <div className="settings-heading-content">
        <p className="settings-eyebrow">Your account</p>
        <h1>{title}</h1>
        <p className="settings-description">{description}</p>
      </div>
    </div>
  );
}
