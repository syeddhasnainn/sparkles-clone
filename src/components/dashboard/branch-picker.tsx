import { AppIcon } from "../ui/app-icon";
import { useState } from "react";
import { Popover } from "@base-ui/react/popover";
import Check from "@hugeicons/core-free-icons/Tick02Icon";
import ChevronDown from "@hugeicons/core-free-icons/ArrowDown01Icon";
import Search from "@hugeicons/core-free-icons/Search01Icon";
import { DashboardIcon } from "./dashboard-icon";
import { Picker } from "./picker";

const branches = [
  "main",
  "bugs-fixes-high-medium-low",
  "chore/cloudflare-worker-deploy",
  "codex/clerk-api-auth",
  "dashboard-clerk-auth",
  "feat/backend-setup-and-db-setup",
  "feat/clerk-auth-setup",
  "feat/numeric-site-id-dashboard-redesign",
  "fix/frontend-api-base-url",
  "production-hardening-onboarding",
  "redesign/overview-dashboard",
];

export function BranchPicker({
  repository,
  branch,
  onChange,
}: {
  repository: string;
  branch: string;
  onChange: (value: string) => void;
}) {
  const [search, setSearch] = useState("");
  const filtered = branches.filter((name) => name.includes(search.toLowerCase()));

  return (
    <div className="branch-tab">
      <Picker
        label={`Switch branch for ${repository}`}
        className="branch-button"
        trigger={
          <>
            <DashboardIcon name="branch" size={14} />
            <span>{branch}</span>
            <AppIcon icon={ChevronDown} size={12} />
          </>
        }
      >
        <label className="picker-search">
          <AppIcon icon={Search} size={16} />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search branches..."
            aria-label="Search branches"
          />
        </label>
        <div className="branch-options">
          {filtered.map((name) => (
            <Popover.Close className="picker-option" key={name} onClick={() => onChange(name)}>
              <span className="selection-mark">
                {branch === name && <AppIcon icon={Check} size={14} />}
              </span>
              {name}
            </Popover.Close>
          ))}
          {!filtered.length && <p className="picker-caption">No branches found.</p>}
        </div>
      </Picker>
    </div>
  );
}
