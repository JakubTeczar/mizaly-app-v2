// Line icons for the inspiration-source switcher (Instagram / YouTube /
// newsletter). Same hand-drawn stroke style as components/NavIcons.tsx so the
// floating switcher matches the rest of the chrome.

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

export function IconSourceInstagram({ className }: IconProps) {
  return (
    <svg {...commonProps} className={className} aria-hidden="true">
      <rect x="3.5" y="3.5" width="17" height="17" rx="5" />
      <circle cx="12" cy="12" r="4.2" />
      <circle cx="16.8" cy="7.2" r="1" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function IconSourceYoutube({ className }: IconProps) {
  return (
    <svg {...commonProps} className={className} aria-hidden="true">
      <rect x="2.5" y="5.5" width="19" height="13" rx="4" />
      <path d="M10.3 9.3v5.4l4.9-2.7-4.9-2.7Z" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function IconSourceMail({ className }: IconProps) {
  return (
    <svg {...commonProps} className={className} aria-hidden="true">
      <rect x="2.5" y="5" width="19" height="14" rx="3" />
      <path d="M3.5 6.5 12 13l8.5-6.5" />
    </svg>
  );
}

export function IconHeart({ className, filled }: IconProps & { filled?: boolean }) {
  return (
    <svg
      {...commonProps}
      className={className}
      fill={filled ? "currentColor" : "none"}
      aria-hidden="true"
    >
      <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 1 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
    </svg>
  );
}
