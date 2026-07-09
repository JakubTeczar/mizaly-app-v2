import { IconHeart, IconSourceInstagram, IconSourceMail, IconSourceYoutube } from "./SourceIcons";

export type InspirationSource = "instagram" | "youtube" | "mail";

const SOURCES: { id: InspirationSource; label: string; Icon: typeof IconSourceInstagram }[] = [
  { id: "instagram", label: "Instagram", Icon: IconSourceInstagram },
  { id: "youtube", label: "YouTube", Icon: IconSourceYoutube },
  { id: "mail", label: "Newslettery", Icon: IconSourceMail },
];

interface InspirationSourceBarProps {
  activeSource: InspirationSource;
  onSourceChange: (source: InspirationSource) => void;
  favoritesCount: number;
  isFavoritesOpen: boolean;
  onToggleFavorites: () => void;
}

// Pinned bottom-left over the page content (above the app's bottom nav) so the
// source switcher and the saved-inspirations shortcut stay reachable while
// scrolling the feed.
export function InspirationSourceBar({
  activeSource,
  onSourceChange,
  favoritesCount,
  isFavoritesOpen,
  onToggleFavorites,
}: InspirationSourceBarProps) {
  return (
    <div className="inspiration-source-bar">
      <div className="inspiration-source-switcher" role="tablist" aria-label="Źródło inspiracji">
        {SOURCES.map(({ id, label, Icon }) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={!isFavoritesOpen && activeSource === id}
            title={label}
            className={`inspiration-source-btn${!isFavoritesOpen && activeSource === id ? " active" : ""}`}
            onClick={() => onSourceChange(id)}
          >
            <Icon className="inspiration-source-icon" />
          </button>
        ))}
      </div>

      <button
        type="button"
        className={`inspiration-favorites-btn${isFavoritesOpen ? " active" : ""}`}
        title="Zapisane inspiracje"
        aria-pressed={isFavoritesOpen}
        onClick={onToggleFavorites}
      >
        <IconHeart className="inspiration-favorites-icon" filled={isFavoritesOpen || favoritesCount > 0} />
        {favoritesCount > 0 && <span className="inspiration-favorites-badge">{favoritesCount}</span>}
      </button>
    </div>
  );
}
