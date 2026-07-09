import type { InspirationItem } from "@mizaly/shared";

interface FavoritesViewProps {
  items: InspirationItem[];
  isLoading: boolean;
  loadError: string | null;
  onBack: () => void;
  onDelete: (id: string) => void;
}

// Full subpage (not a popup) for saved inspirations - opened from the heart
// button in InspirationSourceBar. A dedicated page rather than a modal
// because this list is expected to grow large over time.
export function FavoritesView({ items, isLoading, loadError, onBack, onDelete }: FavoritesViewProps) {
  return (
    <div>
      <div className="favorites-header">
        <button type="button" className="btn btn-secondary btn-small" onClick={onBack}>
          ← Wróć
        </button>
        <h2 className="favorites-title">Zapisane inspiracje ({items.length})</h2>
      </div>

      {isLoading && <p className="hint-text">Ładowanie…</p>}
      {loadError && <p className="error-text">{loadError}</p>}

      {!isLoading && !loadError && items.length === 0 && (
        <p className="empty-state">Nie masz jeszcze zapisanych inspiracji.</p>
      )}

      <div className="list">
        {items.map((item) => (
          <div key={item.id} className="list-item">
            <p style={{ margin: "0 0 6px" }}>{item.content}</p>
            {item.sourceUrl && (
              <p className="hint-text" style={{ margin: "0 0 6px", wordBreak: "break-all" }}>
                {item.sourceUrl}
              </p>
            )}
            {item.note && <p className="hint-text" style={{ margin: "0 0 6px" }}>{item.note}</p>}
            <div>
              {item.tags.map((tag) => (
                <span key={tag} className="tag-pill">
                  #{tag}
                </span>
              ))}
            </div>
            <button
              type="button"
              className="btn btn-danger btn-small"
              style={{ marginTop: 10 }}
              onClick={() => onDelete(item.id)}
            >
              Usuń
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
