// Hand-drawn, minimalist line icons for the bottom navigation. Kept as plain
// inline SVGs (no icon library) so the stroke weight and proportions stay
// consistent across the whole set.

interface IconProps {
  className?: string;
}

const commonProps = {
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.6,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

export function IconInspiracje({ className }: IconProps) {
  return (
    <svg {...commonProps} className={className} aria-hidden="true">
      <path d="M6.5 3.5h11a1 1 0 0 1 1 1V21l-6.5-4.3L5.5 21V4.5a1 1 0 0 1 1-1Z" />
    </svg>
  );
}

export function IconTworzenie({ className }: IconProps) {
  return (
    <svg {...commonProps} className={className} aria-hidden="true">
      <path d="M4 20h4.3L19 9.3a1.8 1.8 0 0 0 0-2.5l-1.8-1.8a1.8 1.8 0 0 0-2.5 0L4 15.7V20Z" />
      <path d="M13.2 6.3 17.7 10.8" />
    </svg>
  );
}

export function IconAnalityke({ className }: IconProps) {
  return (
    <svg {...commonProps} className={className} aria-hidden="true">
      <path d="M4.5 20.5V11" />
      <path d="M12 20.5V5.5" />
      <path d="M19.5 20.5v-7" />
    </svg>
  );
}

export function IconWiadomosci({ className }: IconProps) {
  return (
    <svg {...commonProps} className={className} aria-hidden="true">
      <path d="M4.5 5.5h15a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1h-9l-4.5 3.5v-3.5h-.5a1 1 0 0 1-1-1v-9a1 1 0 0 1 1-1Z" />
    </svg>
  );
}
