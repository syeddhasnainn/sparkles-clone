import { AppIcon } from "../ui/app-icon";
import type { CSSProperties } from "react";
import SidebarMinimalisticIcon from "@hugeicons/core-free-icons/SidebarLeftIcon";
import ListIcon from "@hugeicons/core-free-icons/ListViewIcon";
import BoltIcon from "@hugeicons/core-free-icons/FlashIcon";
import HistoryIcon from "@hugeicons/core-free-icons/HistoryIcon";
import SettingsIcon from "@hugeicons/core-free-icons/Settings01Icon";
import WorkflowCircle04Icon from "@hugeicons/core-free-icons/WorkflowCircle04Icon";

const icons = {
  sidebar: SidebarMinimalisticIcon,
  backlog: ListIcon,
  automations: BoltIcon,
  history: HistoryIcon,
  settings: SettingsIcon,
  branch: WorkflowCircle04Icon,
};

interface IconStyle extends CSSProperties {
  "--icon": string;
}

export function DashboardIcon({ name, size = 16 }: { name: string; size?: number }) {
  if (name === "github") {
    const style = {
      "--icon": "url(/brand/github.svg)",
      width: size,
      height: size,
    } satisfies IconStyle;
    return <span aria-hidden="true" className="dashboard-brand-icon" style={style} />;
  }
  const Icon = Object.entries(icons).find(([key]) => key === name)?.[1];
  return Icon ? (
    <AppIcon icon={Icon} aria-hidden="true" className="dashboard-icon" size={size} />
  ) : null;
}
