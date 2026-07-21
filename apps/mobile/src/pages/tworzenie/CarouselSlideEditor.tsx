import { forwardRef, useEffect, useRef, useState, type ChangeEvent } from "react";
import type { CarouselSlide } from "@mizaly/shared";
import { SlideCanvasEditor, type SlideCanvasEditorHandle } from "@mizaly/shared/src/carousel/SlideCanvasEditor";
import { fileToDataUrl, normalizeToJpeg } from "@mizaly/shared/src/carousel/imageHelpers";
import { apiClient, ApiError } from "../../lib/apiClient";
import { Modal } from "../../components/Modal";

interface CarouselSlideEditorProps {
  initialSlides: CarouselSlide[];
  onClose: () => void;
  onSave: (renderedDataUrls: string[], uploadedUrls: string[], slides: CarouselSlide[]) => void;
}

interface SlideRow {
  id: number;
  slide: CarouselSlide;
}

// Uploads a data URL through mobile's own auth'd API and resolves to its
// public URL - passed into the shared SlideCanvasEditor, which has no fixed
// upload mechanism of its own (see its module comment).
async function uploadImage(dataUrl: string): Promise<string> {
  const result = await apiClient.post<{ url: string }>("/api/media/upload", { dataUrl });
  return result.url;
}

interface SlideRowCardProps {
  index: number;
  slide: CarouselSlide;
  isFirst: boolean;
  isLast: boolean;
  isOnly: boolean;
  onChange: (patch: Partial<CarouselSlide>) => void;
  onMove: (direction: -1 | 1) => void;
  onRemove: () => void;
}

const SlideRowCard = forwardRef<SlideCanvasEditorHandle, SlideRowCardProps>(function SlideRowCard(
  { index, slide, isFirst, isLast, isOnly, onChange, onMove, onRemove },
  ref
) {
  const [isUploadingBackground, setIsUploadingBackground] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleBackgroundChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    setError(null);
    setIsUploadingBackground(true);
    try {
      const rawDataUrl = await fileToDataUrl(file);
      const dataUrl = await normalizeToJpeg(rawDataUrl);
      const url = await uploadImage(dataUrl);
      // Reset pan/zoom on a new photo so it starts centered rather than
      // inheriting the previous image's position/scale.
      onChange({
        backgroundImageUrl: url,
        backgroundImageX: undefined,
        backgroundImageY: undefined,
        backgroundImageScale: undefined,
      });
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : "Nie udało się wgrać zdjęcia tła. Spróbuj innego zdjęcia lub sprawdź, czy plik nie jest uszkodzony."
      );
    } finally {
      setIsUploadingBackground(false);
    }
  };

  return (
    <div className="carousel-slide-editor">
      <div className="carousel-slide-editor__header">
        <span>Slajd {index + 1}</span>
        <div className="carousel-slide-editor__actions">
          <button type="button" aria-label="Przesuń slajd w górę" disabled={isFirst} onClick={() => onMove(-1)}>
            ↑
          </button>
          <button type="button" aria-label="Przesuń slajd w dół" disabled={isLast} onClick={() => onMove(1)}>
            ↓
          </button>
          <button type="button" aria-label="Usuń slajd" disabled={isOnly} onClick={onRemove}>
            ×
          </button>
        </div>
      </div>

      <div className="carousel-slide-editor__body">
        <SlideCanvasEditor
          ref={ref}
          slide={slide}
          onChange={onChange}
          onUploadImage={uploadImage}
          onBackgroundError={() =>
            setError("Nie udało się wyświetlić zdjęcia tła. Spróbuj innego zdjęcia lub sprawdź, czy plik nie jest uszkodzony.")
          }
          onImageLayerError={(message) => setError(message)}
        />

        <label
          htmlFor={`slideBg${index}`}
          className={`photo-action-btn${isUploadingBackground ? " photo-action-btn-disabled" : ""}`}
          style={{ marginTop: 10 }}
        >
          {isUploadingBackground ? "Wgrywanie…" : slide.backgroundImageUrl ? "Zmień zdjęcie tła" : "Dodaj zdjęcie tła"}
        </label>
        <input
          id={`slideBg${index}`}
          type="file"
          accept="image/*"
          disabled={isUploadingBackground}
          onChange={handleBackgroundChange}
          style={{ display: "none" }}
        />
        {error && <p className="error-text">{error}</p>}
      </div>
    </div>
  );
});

export function CarouselSlideEditor({ initialSlides, onClose, onSave }: CarouselSlideEditorProps) {
  const nextRowId = useRef(0);
  const makeRow = (slide: CarouselSlide): SlideRow => ({ id: nextRowId.current++, slide });

  // Captured once - only a brand-new carousel (no slides yet) gets the
  // organization's closing slide auto-appended; re-editing a saved one must
  // never re-fetch/re-insert it.
  const isBrandNewCarousel = useRef(initialSlides.length === 0);
  // Tracks which row (if any) is the auto-appended closing slide, so newly
  // added slides can be inserted before it instead of after - see addSlide.
  const closingSlideRowIdRef = useRef<number | null>(null);

  const [rows, setRows] = useState<SlideRow[]>(() =>
    (initialSlides.length > 0 ? initialSlides : [{ order: 0, textLayers: [], imageLayers: [] }]).map(makeRow)
  );
  const editorRefs = useRef<Record<number, SlideCanvasEditorHandle | null>>({});
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    if (!isBrandNewCarousel.current) return;
    (async () => {
      try {
        const organization = await apiClient.get<{ closingSlideTemplate: CarouselSlide | null }>("/api/organizations/me");
        if (!organization.closingSlideTemplate) return;
        const row = makeRow(organization.closingSlideTemplate);
        closingSlideRowIdRef.current = row.id;
        setRows((prev) => [...prev, row]);
      } catch {
        // Best-effort - a brand-new carousel just behaves as before (blank)
        // if the org has no template configured or the fetch fails.
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const updateSlide = (id: number, patch: Partial<CarouselSlide>) => {
    setRows((prev) => prev.map((row) => (row.id === id ? { ...row, slide: { ...row.slide, ...patch } } : row)));
  };

  const addSlide = () => {
    const newRow = makeRow({ order: 0, textLayers: [], imageLayers: [] });
    setRows((prev) => {
      const closingIndex = prev.findIndex((row) => row.id === closingSlideRowIdRef.current);
      if (closingIndex === -1) return [...prev, newRow];
      const next = [...prev];
      next.splice(closingIndex, 0, newRow);
      return next;
    });
  };

  const removeSlide = (id: number) => {
    delete editorRefs.current[id];
    if (closingSlideRowIdRef.current === id) closingSlideRowIdRef.current = null;
    setRows((prev) => prev.filter((row) => row.id !== id));
  };

  const moveSlide = (id: number, direction: -1 | 1) => {
    setRows((prev) => {
      const index = prev.findIndex((row) => row.id === id);
      const target = index + direction;
      if (target < 0 || target >= prev.length) return prev;
      const next = [...prev];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  };

  const handleSave = async () => {
    setSaveError(null);
    setIsSaving(true);
    try {
      const rendered: string[] = [];
      const uploaded: string[] = [];
      for (const row of rows) {
        const dataUrl = editorRefs.current[row.id]?.exportDataUrl();
        if (!dataUrl) throw new Error("Nie udało się wygenerować obrazu slajdu.");
        rendered.push(dataUrl);
        const uploadResult = await apiClient.post<{ url: string }>("/api/media/upload", { dataUrl });
        uploaded.push(uploadResult.url);
      }
      const slides = rows.map((row, index) => ({ ...row.slide, order: index }));
      onSave(rendered, uploaded, slides);
    } catch (err) {
      setSaveError(err instanceof ApiError ? err.message : "Nie udało się wygenerować karuzeli.");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Modal title="Edytor karuzeli" onClose={onClose}>
      <p className="hint-text">
        Dodaj zdjęcie tła i tekst do każdego slajdu - przeciągnij zdjęcie tła, żeby je wykadrować, i użyj suwaka, żeby
        je powiększyć. Możesz też dodać dodatkowe, mniejsze zdjęcie, które nie wypełnia całego tła - przeciągnij je i
        złap za rożek, żeby zmienić rozmiar, tak samo jak tekst. Przeciągnij tekst, żeby go przesunąć, złap za rożek,
        żeby zmienić rozmiar, kliknij dwa razy, żeby edytować treść.
      </p>

      {rows.map((row, index) => (
        <SlideRowCard
          key={row.id}
          ref={(handle) => {
            editorRefs.current[row.id] = handle;
          }}
          index={index}
          slide={row.slide}
          isFirst={index === 0}
          isLast={index === rows.length - 1}
          isOnly={rows.length === 1}
          onChange={(patch) => updateSlide(row.id, patch)}
          onMove={(direction) => moveSlide(row.id, direction)}
          onRemove={() => removeSlide(row.id)}
        />
      ))}

      <button type="button" className="btn btn-secondary" onClick={addSlide}>
        + Dodaj slajd
      </button>

      {saveError && <p className="error-text">{saveError}</p>}

      <div className="modal-actions">
        <button type="button" className="btn btn-secondary" onClick={onClose}>
          Anuluj
        </button>
        <button type="button" className="btn" disabled={isSaving} onClick={handleSave}>
          {isSaving ? "Generowanie…" : "Zapisz karuzelę"}
        </button>
      </div>
    </Modal>
  );
}
