// Used for carousel prev/next arrows (PostPreview.tsx, ClassificationRanking.tsx).
// A proper stroke path centers exactly regardless of font/OS - unlike the
// "‹"/"›" text characters this replaced, which render at slightly different
// optical heights depending on the fallback font, so the two arrows on a
// carousel could visibly drift out of vertical alignment with each other.
export function ChevronIcon({ direction }: { direction: "left" | "right" }) {
  const d = direction === "left" ? "M15 6l-6 6 6 6" : "M9 6l6 6-6 6";
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={d} />
    </svg>
  );
}
