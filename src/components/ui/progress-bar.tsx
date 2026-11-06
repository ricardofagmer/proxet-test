import { cva } from "class-variance-authority";

import { cn } from "#/lib/utils";

const progressIndicatorVariants = cva("h-full rounded-full transition-[width]", {
  variants: {
    variant: {
      default: "bg-primary",
      destructive: "bg-destructive",
    },
  },
  defaultVariants: {
    variant: "default",
  },
});

interface ProgressBarProps {
  /** Percent complete, 0-100; values outside the range are clamped. */
  value: number;
  variant?: "default" | "destructive";
  /** Accessible name announced for the progressbar role. */
  label: string;
  className?: string;
}

function clampPercent(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(100, Math.max(0, value));
}

function ProgressBar({
  value,
  variant = "default",
  label,
  className,
}: ProgressBarProps): React.JSX.Element {
  const percent = Math.round(clampPercent(value));
  return (
    <div
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percent}
      aria-label={label}
      data-slot="progress-bar"
      data-variant={variant}
      className={cn("h-2 w-full overflow-hidden rounded-full bg-muted", className)}
    >
      <div
        className={progressIndicatorVariants({ variant })}
        style={{ width: `${percent}%` }}
      />
    </div>
  );
}

export { ProgressBar };
