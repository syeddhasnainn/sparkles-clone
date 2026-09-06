import { Popover } from "@base-ui/react/popover";
import type { ReactNode } from "react";

interface PickerProps {
  label: string;
  trigger: ReactNode;
  children: ReactNode;
  className?: string;
  popupClassName?: string;
  side?: "top" | "bottom";
}

export function Picker({
  label,
  trigger,
  children,
  className = "toolbar-button",
  popupClassName = "",
  side = "bottom",
}: PickerProps) {
  return (
    <Popover.Root>
      <Popover.Trigger className={className} aria-label={label}>
        {trigger}
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner side={side} align="start" sideOffset={6} className="picker-positioner">
          <Popover.Popup className={`picker-popup ${popupClassName}`}>
            <Popover.Title className="sr-only">{label}</Popover.Title>
            {children}
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
