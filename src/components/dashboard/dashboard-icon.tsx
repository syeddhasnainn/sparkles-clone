import type { CSSProperties } from "react";

export function DashboardIcon({ name, size = 16 }: { name: string; size?: number }) {
  return (
    <span
      aria-hidden="true"
      className="dashboard-icon"
      style={{ "--icon": `url(/brand/${name}.svg)`, width: size, height: size } as CSSProperties}
    />
  );
}
