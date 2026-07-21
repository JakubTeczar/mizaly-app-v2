import { useEffect, useRef, useState } from "react";
import type { InspirationItem } from "@mizaly/shared";
import { apiClient, ApiError } from "../lib/apiClient";
import { FavoritesView } from "./inspiracje/FavoritesView";
import { InspirationSourceBar, type InspirationSource } from "./inspiracje/InspirationSourceBar";
import { InstagramSection } from "./inspiracje/InstagramSection";
import { YoutubeSection } from "./inspiracje/YoutubeSection";
import { NewsletterSection } from "./inspiracje/NewsletterSection";
import { FEATURE_FLAGS } from "../lib/featureFlags";

export function InspiracjePage() {
  const [items, setItems] = useState<InspirationItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [activeSource, setActiveSource] = useState<InspirationSource>("instagram");
  const [showFavorites, setShowFavorites] = useState(false);

  // Remembers where the user was scrolled to on each source tab, so
  // switching back to a tab they've already been on resumes where they left
  // off - but a tab visited for the first time this session always starts at
  // the top, it never inherits the previous tab's scroll position.
  const scrollPositions = useRef<Partial<Record<InspirationSource, number>>>({});
  const visitedSources = useRef<Set<InspirationSource>>(new Set([activeSource]));

  useEffect(() => {
    const alreadyVisited = visitedSources.current.has(activeSource);
    visitedSources.current.add(activeSource);

    // Double rAF so this runs after the newly-switched-to section has had its
    // first paint (its own data may still be loading, but the layout that
    // exists so far is enough to scroll within).
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        window.scrollTo(0, alreadyVisited ? scrollPositions.current[activeSource] ?? 0 : 0);
      });
    });
  }, [activeSource]);

  const loadItems = () => {
    setIsLoading(true);
    apiClient
      .get<InspirationItem[]>("/api/inspiration-items")
      .then(setItems)
      .catch((err) => setLoadError(err instanceof ApiError ? err.message : "Nie udało się pobrać inspiracji."))
      .finally(() => setIsLoading(false));
  };

  useEffect(() => {
    loadItems();
  }, []);

  const handleDelete = async (id: string) => {
    const previous = items;
    setItems((prev) => prev.filter((item) => item.id !== id));
    try {
      await apiClient.del(`/api/inspiration-items/${id}`);
    } catch {
      setItems(previous);
    }
  };

  return (
    <div>
      {(FEATURE_FLAGS.inspiracjeNewsletter || FEATURE_FLAGS.inspiracjePolubienia) && (
        <p className="info-note" style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span className="badge-coming-soon">Wkrótce</span>
          Zakładka Newslettery i lista polubionych inspiracji będą dostępne wkrótce.
        </p>
      )}

      <h1 className="page-title">Inspiracje</h1>

      {showFavorites ? (
        <FavoritesView
          items={items}
          isLoading={isLoading}
          loadError={loadError}
          onBack={() => setShowFavorites(false)}
          onDelete={handleDelete}
        />
      ) : (
        <>
          {activeSource === "instagram" && (
            <InstagramSection onSaved={(item) => setItems((prev) => [item, ...prev])} />
          )}

          {activeSource === "youtube" && <YoutubeSection />}

          {activeSource === "mail" && <NewsletterSection />}
        </>
      )}

      <InspirationSourceBar
        activeSource={activeSource}
        onSourceChange={(source) => {
          if (source === activeSource) return;
          scrollPositions.current[activeSource] = window.scrollY;
          setActiveSource(source);
          setShowFavorites(false);
        }}
        favoritesCount={items.length}
        isFavoritesOpen={showFavorites}
        onToggleFavorites={() => setShowFavorites((prev) => !prev)}
      />
    </div>
  );
}
