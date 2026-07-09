// Minimalist line icons for the Tworzenie hub tiles. Same hand-drawn style as
// the bottom-nav icon set, just rendered larger.

interface IconProps {
  className?: string;
}

const commonProps = {
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.5,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

export function IconKalendarz({ className }: IconProps) {
  return (
    <svg {...commonProps} className={className} aria-hidden="true">
      <rect x="4" y="5.5" width="16" height="15" rx="2.5" />
      <path d="M4 10h16" />
      <path d="M8 3.5v3.5" />
      <path d="M16 3.5v3.5" />
      <path d="M8 14h2" />
      <path d="M14 14h2" />
      <path d="M8 17h2" />
    </svg>
  );
}

export function IconPost({ className }: IconProps) {
  return (
    <svg {...commonProps} className={className} aria-hidden="true">
      <rect x="3.5" y="3.5" width="17" height="17" rx="3" />
      <path d="M3.5 15.5 8.5 11a1.5 1.5 0 0 1 2.1 0l2.4 2.4" />
      <circle cx="15" cy="8.5" r="1.5" />
    </svg>
  );
}

export function IconStrona({ className }: IconProps) {
  return (
    <svg {...commonProps} className={className} aria-hidden="true">
      <circle cx="12" cy="12" r="8.5" />
      <path d="M3.5 12h17" />
      <path d="M12 3.5c2.2 2.3 3.4 5.3 3.4 8.5s-1.2 6.2-3.4 8.5c-2.2-2.3-3.4-5.3-3.4-8.5S9.8 5.8 12 3.5Z" />
    </svg>
  );
}

export function IconReels({ className }: IconProps) {
  return (
    <svg {...commonProps} className={className} aria-hidden="true">
      <rect x="6" y="3.5" width="12" height="17" rx="2.5" />
      <path d="M10.3 9.3v5.4l4.2-2.7-4.2-2.7Z" />
    </svg>
  );
}
