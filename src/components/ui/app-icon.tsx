import { HugeiconsIcon, type HugeiconsIconProps } from "@hugeicons/react";

export function AppIcon({ size = 24, strokeWidth = 1.5, ...props }: HugeiconsIconProps) {
  return <HugeiconsIcon aria-hidden="true" size={size} strokeWidth={strokeWidth} {...props} />;
}
