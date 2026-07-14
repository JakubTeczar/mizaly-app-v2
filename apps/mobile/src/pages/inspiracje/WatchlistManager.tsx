import { useState, type FormEvent } from "react";
import { Modal } from "../../components/Modal";

interface WatchlistItem {
  id: string;
  label: string;
}

interface WatchlistManagerProps {
  title: string;
  description: string;
  placeholder: string;
  items: WatchlistItem[];
  isLoading: boolean;
  loadError: string | null;
  onAdd: (value: string) => Promise<void>;
  onRemove: (id: string) => Promise<void>;
}

// Shared chip-list + add-form UI for "which accounts/channels are we
// scraping" - used by both the Instagram and YouTube tabs in Inspiracje so
// the two watch lists (WatchedInstagramAccount / WatchedYoutubeChannel) look
// and behave the same way.
export function WatchlistManager({
  title,
  description,
  placeholder,
  items,
  isLoading,
  loadError,
  onAdd,
  onRemove,
}: WatchlistManagerProps) {
  const [value, setValue] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [pendingRemoval, setPendingRemoval] = useState<WatchlistItem | null>(null);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (!value.trim()) return;
    setFormError(null);
    setIsSubmitting(true);
    try {
      await onAdd(value.trim());
      setValue("");
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Nie udało się dodać.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleConfirmRemove = async () => {
    if (!pendingRemoval) return;
    const id = pendingRemoval.id;
    setPendingRemoval(null);
    setRemovingId(id);
    try {
      await onRemove(id);
    } finally {
      setRemovingId(null);
    }
  };

  return (
    <section className="card">
      <h2>{title}</h2>
      <p className="card-muted-text" style={{ marginBottom: 12 }}>
        {description}
      </p>

      {isLoading && <p className="hint-text">Ładowanie…</p>}
      {loadError && <p className="error-text">{loadError}</p>}

      {!isLoading && !loadError && (
        <div className="watchlist-chips">
          {items.length === 0 && <p className="hint-text">Brak obserwowanych - dodaj pierwszy poniżej.</p>}
          {items.map((item) => (
            <span key={item.id} className="watchlist-chip">
              {item.label}
              <button
                type="button"
                className="watchlist-chip-remove"
                aria-label={`Usuń ${item.label}`}
                disabled={removingId === item.id}
                onClick={() => setPendingRemoval(item)}
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}

      <form onSubmit={handleSubmit} className="watchlist-add-form">
        <input
          type="text"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={placeholder}
        />
        <button type="submit" className="btn btn-secondary btn-small" disabled={isSubmitting}>
          {isSubmitting ? "Dodawanie…" : "Dodaj"}
        </button>
      </form>
      {formError && <p className="error-text">{formError}</p>}

      {pendingRemoval && (
        <Modal title="Usuń z obserwowanych" onClose={() => setPendingRemoval(null)}>
          <p>
            Czy na pewno chcesz usunąć <strong>{pendingRemoval.label}</strong> z listy obserwowanych? Kolejne
            pobranie danych nie będzie już obejmować tego konta/kanału.
          </p>
          <div className="modal-actions">
            <button type="button" className="btn btn-secondary" onClick={() => setPendingRemoval(null)}>
              Anuluj
            </button>
            <button type="button" className="btn btn-danger" onClick={handleConfirmRemove}>
              Usuń
            </button>
          </div>
        </Modal>
      )}
    </section>
  );
}
