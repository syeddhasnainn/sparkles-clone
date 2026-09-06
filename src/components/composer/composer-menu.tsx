import type { ReactNode } from "react";
import { Popover } from "@base-ui/react/popover";

export function ComposerMenu({
  label,
  trigger,
  className,
  children,
}: {
  label: string;
  trigger: ReactNode;
  className: string;
  children: ReactNode;
}) {
  return (
    <Popover.Root>
      <Popover.Trigger className={className} aria-label={label}>
        {trigger}
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner
          side="top"
          align="start"
          sideOffset={8}
          className="composer-menu-positioner"
        >
          <Popover.Popup className="composer-menu">
            <Popover.Title className="composer-menu-heading">{label}</Popover.Title>
            {children}
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
