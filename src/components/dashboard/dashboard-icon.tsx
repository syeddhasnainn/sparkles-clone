import type { CSSProperties } from "react";

interface IconStyle extends CSSProperties {
  "--icon": string;
}

export function DashboardIcon({ name, size = 16 }: { name: string; size?: number }) {
  const style = {
    "--icon": `url(/brand/${name}.svg)`,
    width: size,
    height: size,
  } satisfies IconStyle;

  return <span aria-hidden="true" className="dashboard-icon" style={style} />;
}
