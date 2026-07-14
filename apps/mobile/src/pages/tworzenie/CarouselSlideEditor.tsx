import { useEffect, useRef, useState, type ChangeEvent } from "react";
import type { CarouselSlide } from "@mizaly/shared";
import { apiClient, ApiError } from "../../lib/apiClient";
import { fileToDataUrl } from "../../lib/imageCrop";
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

async function renderSlidePreview(slide: CarouselSlide): Promise<string> {
  const result = await apiClient.post<{ dataUrl: string }>("/api/posts/carousel-slide-preview", {
    backgroundImageUrl: slide.backgroundImageUrl,
    heading: slide.heading,
    text: slide.text,
  });
  return result.dataUrl;
}

interface SlideEditorCardProps {
  index: number;
  slide: CarouselSlide;
  isFirst: boolean;
  isLast: boolean;
  isOnly: boolean;
  onChange: (patch: Partial<CarouselSlide>) => void;
  onMove: (direction: -1 | 1) => void;
  onRemove: () => void;
  onPreviewChange: (dataUrl: string | null) => void;
}

// Owns its own debounced live preview, scoped to this one slide's fields -
// editing slide 3 of 8 never waits on (or re-renders) the other 7, and a
// freshly added blank slide renders its own preview automatically within the
// debounce window without any "generate" button anywhere.
function SlideEditorCard({
  index,
  slide,
  isFirst,
  isLast,
  isOnly,
  onChange,
  onMove,
  onRemove,
  onPreviewChange,
}: SlideEditorCardProps) {
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [isLoadingPreview, setIsLoadingPreview] = useState(false);
  const [isUploadingBackground, setIsUploadingBackground] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestId = useRef(0);

  useEffect(() => {
    const id = (requestId.current += 1);
    setIsLoadingPreview(true);

    const timeoutId = setTimeout(async () => {
      try {
        const dataUrl = await renderSlidePreview(slide);
        if (requestId.current === id) {
          setPreviewUrl(dataUrl);
          onPreviewChange(dataUrl);
        }
      } catch (err) {
        if (requestId.current === id) {
          setError(err instanceof ApiError ? err.message : "Nie udało się wygenerować podglądu slajdu.");
        }
      } finally {
        if (requestId.current === id) {
          setIsLoadingPreview(false);
        }
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, 500);

    return () => clearTimeout(timeoutId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slide.heading, slide.text, slide.backgroundImageUrl]);

  const handleBackgroundChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    setError(null);
    setIsUploadingBackground(true);
    try {
      const dataUrl = await fileToDataUrl(file);
      const result = await apiClient.post<{ url: string }>("/api/media/upload", { dataUrl });
      onChange({ backgroundImageUrl: result.url });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Nie udało się wgrać zdjęcia tła.");
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
        <div className="field">
          <label htmlFor={`slideHeading${index}`}>Nagłówek</label>
          <input
            id={`slideHeading${index}`}
            type="text"
            value={slide.heading ?? ""}
            onChange={(e) => onChange({ heading: e.target.value })}
          />
        </div>
        <div className="field">
          <label htmlFor={`slideText${index}`}>Tekst</label>
          <textarea
            id={`slideText${index}`}
            value={slide.text ?? ""}
            onChange={(e) => onChange({ text: e.target.value })}
          />
        </div>
        <div className="field">
          <label>Zdjęcie w tle (opcjonalnie)</label>
          <label htmlFor={`slideBg${index}`} className="photo-picker-button">
            {isUploadingBackground ? "Wgrywanie…" : slide.backgroundImageUrl ? "Zmień zdjęcie" : "Dodaj zdjęcie"}
          </label>
          <input
            id={`slideBg${index}`}
            type="file"
            accept="image/*"
            disabled={isUploadingBackground}
            onChange={handleBackgroundChange}
            style={{ display: "none" }}
          />
        </div>

        <div className="carousel-slide-preview-wrap">
          {previewUrl && <img className="carousel-slide-preview" src={previewUrl} alt={`Podgląd slajdu ${index + 1}`} />}
          {isLoadingPreview && <p className="hint-text">Generowanie podglądu…</p>}
        </div>
        {error && <p className="error-text">{error}</p>}
      </div>
    </div>
  );
}

export function CarouselSlideEditor({ initialSlides, onClose, onSave }: CarouselSlideEditorProps) {
  const nextRowId = useRef(0);
  const makeRow = (slide: CarouselSlide): SlideRow => ({ id: nextRowId.current++, slide });

  const [rows, setRows] = useState<SlideRow[]>(() =>
    (initialSlides.length > 0 ? initialSlides : [{ order: 0, heading: "", text: "" }]).map(makeRow)
  );
  // Latest rendered preview per row, reused at save time instead of
  // re-rendering every slide from scratch - keyed by the row's stable id
  // (not array index), so reordering slides never mixes up which preview
  // belongs to which slide.
  const previewsByRowId = useRef<Record<number, string>>({});
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const updateSlide = (id: number, patch: Partial<CarouselSlide>) => {
    setRows((prev) => prev.map((row) => (row.id === id ? { ...row, slide: { ...row.slide, ...patch } } : row)));
  };

  const addSlide = () => {
    setRows((prev) => [...prev, makeRow({ order: prev.length, heading: "", text: "" })]);
  };

  const removeSlide = (id: number) => {
    delete previewsByRowId.current[id];
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
        // Reuse the slide's already-generated live preview when it's ready;
        // only re-render as a fallback if the user hits Save before that
        // slide's debounce settled.
        const dataUrl = previewsByRowId.current[row.id] ?? (await renderSlidePreview(row.slide));
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
    <Modal title="Generator karuzeli" onClose={onClose}>
      <p className="hint-text">
        Dodaj slajdy z nagłówkiem, tekstem i opcjonalnym zdjęciem w tle - każdy slajd stanie się osobnym zdjęciem
        karuzeli w tej samej kolejności. Podgląd każdego slajdu generuje się automatycznie w trakcie edycji.
      </p>

      {rows.map((row, index) => (
        <SlideEditorCard
          key={row.id}
          index={index}
          slide={row.slide}
          isFirst={index === 0}
          isLast={index === rows.length - 1}
          isOnly={rows.length === 1}
          onChange={(patch) => updateSlide(row.id, patch)}
          onMove={(direction) => moveSlide(row.id, direction)}
          onRemove={() => removeSlide(row.id)}
          onPreviewChange={(dataUrl) => {
            if (dataUrl) previewsByRowId.current[row.id] = dataUrl;
          }}
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
