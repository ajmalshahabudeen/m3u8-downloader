"use client";

import { cn } from "@/lib/utils";

interface GridPatternProps {
  className?: string;
  width?: number;
  height?: number;
  x?: number;
  y?: number;
  strokeDasharray?: string;
  squares?: Array<[number, number]>;
}

export function GridPattern({
  width = 40,
  height = 40,
  x = -1,
  y = -1,
  strokeDasharray = "0",
  squares,
  className,
}: GridPatternProps) {
  const id = "grid-pattern";

  return (
    <svg
      aria-hidden="true"
      className={cn(
        "pointer-events-none absolute inset-0 h-full w-full fill-neutral-400/20 stroke-neutral-400/20 dark:fill-neutral-600/15 dark:stroke-neutral-600/20",
        className,
      )}
    >
      <defs>
        <pattern
          id={id}
          width={width}
          height={height}
          patternUnits="userSpaceOnUse"
          x={x}
          y={y}
        >
          <path
            d={`M.5 ${height}V.5H${width}`}
            fill="none"
            strokeDasharray={strokeDasharray}
          />
        </pattern>
      </defs>
      <rect width="100%" height="100%" strokeWidth={0} fill={`url(#${id})`} />
      {squares?.map(([sx, sy]) => (
        <rect
          key={`${sx}-${sy}`}
          width={width - 1}
          height={height - 1}
          x={sx * width + 1}
          y={sy * height + 1}
          className="fill-neutral-400/30 dark:fill-neutral-500/20"
          strokeWidth={0}
        />
      ))}
    </svg>
  );
}
