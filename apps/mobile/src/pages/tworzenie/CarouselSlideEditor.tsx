import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
} from "react";
import { Stage, Layer, Rect, Image as KonvaImage, Text as KonvaText, Transformer } from "react-konva";
import useImage from "use-image";
import type Konva from "konva";
import type { CarouselSlide, CarouselTextFontFamily, CarouselTextLayer } from "@mizaly/shared";
import { apiClient, ApiError } from "../../lib/apiClient";
import { fileToDataUrl } from "../../lib/imageCrop";
import { Modal } from "../../components/Modal";

// Slides are always exported at 1080x1080 (Instagram's carousel size). Text
// layers store their x/y/width/fontSize in that same fixed coordinate space
// regardless of how big the on-screen canvas actually is, so a layout looks
// identical on a 320px phone and a 480px tablet - only the live display
// scale (see useContainerWidth) changes, never the stored numbers.
const MODEL_SIZE = 1080;
const FALLBACK_BACKGROUND = "#1f1633";
const FONT_OPTIONS: CarouselTextFontFamily[] = ["Montserrat", "Bebas Neue", "Gantari"];

interface CarouselSlideEditorProps {
  initialSlides: CarouselSlide[];
  onClose: () => void;
  onSave: (renderedDataUrls: string[], uploadedUrls: string[], slides: CarouselSlide[]) => void;
}

interface SlideRow {
  id: number;
  slide: CarouselSlide;
}

function createTextLayer(existingCount: number): CarouselTextLayer {
  return {
    id: crypto.randomUUID(),
    content: "Nowy tekst",
    x: MODEL_SIZE / 2 - 300,
    y: MODEL_SIZE / 2 - 50 + existingCount * 90,
    width: 600,
    fontSize: 80,
    fontFamily: "Montserrat",
    color: "#ffffff",
    align: "center",
  };
}

// Measures a wrapper's live rendered width so the canvas can be a responsive
// square (fits a narrow phone and a wide tablet alike) while the model
// coordinates above stay fixed - see MODEL_SIZE.
function useContainerWidth() {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    setWidth(el.clientWidth);
    const observer = new ResizeObserver((entries) => setWidth(entries[0].contentRect.width));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return { ref, width };
}

function SlideBackgroundImage({ url, displaySize }: { url: string; displaySize: number }) {
  const [image] = useImage(url, "anonymous");

  const crop = useMemo(() => {
    if (!image) return null;
    // Center-crop to a square from whichever dimension is larger, matching
    // CSS object-fit: cover, since the target is always a 1:1 slide.
    if (image.width >= image.height) {
      const size = image.height;
      return { x: (image.width - size) / 2, y: 0, width: size, height: size };
    }
    const size = image.width;
    return { x: 0, y: (image.height - size) / 2, width: size, height: size };
  }, [image]);

  if (!image || !crop) return null;
  return <KonvaImage image={image} x={0} y={0} width={displaySize} height={displaySize} crop={crop} />;
}

export interface SlideCanvasEditorHandle {
  exportDataUrl: () => string;
}

interface SlideCanvasEditorProps {
  slide: CarouselSlide;
  onChange: (patch: Partial<CarouselSlide>) => void;
}

const SlideCanvasEditor = forwardRef<SlideCanvasEditorHandle, SlideCanvasEditorProps>(function SlideCanvasEditor(
  { slide, onChange },
  ref
) {
  const { ref: containerRef, width: displaySize } = useContainerWidth();
  const stageRef = useRef<Konva.Stage>(null);
  const trRef = useRef<Konva.Transformer>(null);
  const textNodeRefs = useRef<Record<string, Konva.Text | null>>({});
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingValue, setEditingValue] = useState("");

  const scale = displaySize > 0 ? displaySize / MODEL_SIZE : 0;

  // A canvas never repaints on its own once a @font-face finishes loading
  // after first paint, unlike DOM text - force one redraw when fonts settle
  // so an export triggered right away doesn't bake in the fallback font.
  useEffect(() => {
    document.fonts?.ready?.then(() => {
      stageRef.current?.getLayers().forEach((layer) => layer.batchDraw());
    });
  }, []);

  useEffect(() => {
    const node = selectedId ? textNodeRefs.current[selectedId] : null;
    trRef.current?.nodes(node ? [node] : []);
    trRef.current?.getLayer()?.batchDraw();
  }, [selectedId, slide.textLayers]);

  useImperativeHandle(ref, () => ({
    exportDataUrl: () => {
      // Deselecting imperatively (not via setState) so the selection
      // handles are gone from the very next paint, before toDataURL runs -
      // waiting on a React re-render here would risk exporting them too.
      trRef.current?.nodes([]);
      trRef.current?.getLayer()?.batchDraw();
      return stageRef.current!.toDataURL({
        pixelRatio: MODEL_SIZE / displaySize,
        mimeType: "image/jpeg",
        quality: 0.92,
      });
    },
  }));

  const updateLayer = (id: string, patch: Partial<CarouselTextLayer>) => {
    onChange({ textLayers: slide.textLayers.map((layer) => (layer.id === id ? { ...layer, ...patch } : layer)) });
  };

  const removeLayer = (id: string) => {
    setSelectedId(null);
    onChange({ textLayers: slide.textLayers.filter((layer) => layer.id !== id) });
  };

  const addLayer = () => {
    const layer = createTextLayer(slide.textLayers.length);
    onChange({ textLayers: [...slide.textLayers, layer] });
    setSelectedId(layer.id);
    setEditingId(layer.id);
    setEditingValue(layer.content);
  };

  const startEditing = (layer: CarouselTextLayer) => {
    setSelectedId(layer.id);
    setEditingId(layer.id);
    setEditingValue(layer.content);
  };

  const commitEditing = () => {
    if (editingId) updateLayer(editingId, { content: editingValue || "Tekst" });
    setEditingId(null);
  };

  const handleDragEnd = (layer: CarouselTextLayer, node: Konva.Text) => {
    updateLayer(layer.id, { x: node.x() / scale, y: node.y() / scale });
  };

  const handleTransformEnd = (layer: CarouselTextLayer, node: Konva.Text) => {
    const factor = node.scaleX();
    node.scaleX(1);
    node.scaleY(1);
    updateLayer(layer.id, {
      x: node.x() / scale,
      y: node.y() / scale,
      width: Math.max(60, layer.width * factor),
      fontSize: Math.max(10, Math.round(layer.fontSize * factor)),
    });
  };

  const selectedLayer = slide.textLayers.find((layer) => layer.id === selectedId) ?? null;
  const isEditingSelected = editingId !== null && editingId === selectedId;
  // Positioned from the data model, not the Konva node - a just-added
  // layer's <Text> ref isn't attached yet on the render that first shows
  // the edit overlay (refs only attach after commit), and the model is the
  // authoritative position anyway (kept in sync by onDragEnd/onTransformEnd).
  const editingLayer = isEditingSelected ? selectedLayer : null;

  return (
    <div>
      <div className="carousel-slide-canvas-wrap" ref={containerRef}>
        {displaySize > 0 && (
          <Stage
            ref={stageRef}
            width={displaySize}
            height={displaySize}
            onMouseDown={(e) => {
              if (e.target === e.target.getStage()) setSelectedId(null);
            }}
            onTouchStart={(e) => {
              if (e.target === e.target.getStage()) setSelectedId(null);
            }}
          >
            <Layer>
              <Rect x={0} y={0} width={displaySize} height={displaySize} fill={FALLBACK_BACKGROUND} />
              {slide.backgroundImageUrl && (
                <SlideBackgroundImage url={slide.backgroundImageUrl} displaySize={displaySize} />
              )}
              {slide.textLayers.map((layer) => (
                <KonvaText
                  key={layer.id}
                  ref={(node) => {
                    textNodeRefs.current[layer.id] = node;
                  }}
                  text={layer.content}
                  x={layer.x * scale}
                  y={layer.y * scale}
                  width={layer.width * scale}
                  fontSize={layer.fontSize * scale}
                  fontFamily={layer.fontFamily}
                  fill={layer.color}
                  align={layer.align}
                  draggable
                  visible={editingId !== layer.id}
                  onClick={() => setSelectedId(layer.id)}
                  onTap={() => setSelectedId(layer.id)}
                  onDblClick={() => startEditing(layer)}
                  onDblTap={() => startEditing(layer)}
                  onDragEnd={(e) => handleDragEnd(layer, e.target as Konva.Text)}
                  onTransformEnd={(e) => handleTransformEnd(layer, e.target as Konva.Text)}
                />
              ))}
              {selectedId && !isEditingSelected && (
                <Transformer ref={trRef} enabledAnchors={["top-left", "top-right", "bottom-left", "bottom-right"]} rotateEnabled={false} />
              )}
            </Layer>
          </Stage>
        )}

        {editingLayer && (
          <textarea
            className="carousel-text-edit-overlay"
            autoFocus
            value={editingValue}
            onChange={(e) => setEditingValue(e.target.value)}
            onBlur={commitEditing}
            style={{
              left: editingLayer.x * scale,
              top: editingLayer.y * scale,
              width: editingLayer.width * scale,
              fontSize: editingLayer.fontSize * scale,
              fontFamily: editingLayer.fontFamily,
              color: editingLayer.color,
              textAlign: editingLayer.align,
            }}
          />
        )}
      </div>

      <div className="carousel-canvas-toolbar">
        <button type="button" className="btn btn-secondary btn-small" onClick={addLayer}>
          + Dodaj tekst
        </button>
        {selectedLayer && !isEditingSelected && (
          <>
            <input
              type="color"
              className="carousel-color-swatch"
              value={selectedLayer.color}
              onChange={(e) => updateLayer(selectedLayer.id, { color: e.target.value })}
              aria-label="Kolor tekstu"
            />
            <select
              value={selectedLayer.fontFamily}
              onChange={(e) => updateLayer(selectedLayer.id, { fontFamily: e.target.value as CarouselTextFontFamily })}
              aria-label="Czcionka"
            >
              {FONT_OPTIONS.map((font) => (
                <option key={font} value={font}>
                  {font}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="btn-text"
              onClick={() => removeLayer(selectedLayer.id)}
              aria-label="Usuń tekst"
            >
              Usuń tekst
            </button>
          </>
        )}
      </div>
    </div>
  );
});

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
        <SlideCanvasEditor ref={ref} slide={slide} onChange={onChange} />

        <label
          htmlFor={`slideBg${index}`}
          className={`photo-action-btn${isUploadingBackground ? " photo-action-btn-disabled" : ""}`}
          style={{ marginTop: 10 }}
        >
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
        {error && <p className="error-text">{error}</p>}
      </div>
    </div>
  );
});

export function CarouselSlideEditor({ initialSlides, onClose, onSave }: CarouselSlideEditorProps) {
  const nextRowId = useRef(0);
  const makeRow = (slide: CarouselSlide): SlideRow => ({ id: nextRowId.current++, slide });

  const [rows, setRows] = useState<SlideRow[]>(() =>
    (initialSlides.length > 0 ? initialSlides : [{ order: 0, textLayers: [] }]).map(makeRow)
  );
  const editorRefs = useRef<Record<number, SlideCanvasEditorHandle | null>>({});
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const updateSlide = (id: number, patch: Partial<CarouselSlide>) => {
    setRows((prev) => prev.map((row) => (row.id === id ? { ...row, slide: { ...row.slide, ...patch } } : row)));
  };

  const addSlide = () => {
    setRows((prev) => [...prev, makeRow({ order: prev.length, textLayers: [] })]);
  };

  const removeSlide = (id: number) => {
    delete editorRefs.current[id];
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
        Dodaj zdjęcie i tekst do każdego slajdu - przeciągnij tekst, żeby go przesunąć, złap za rożek, żeby zmienić
        rozmiar, kliknij dwa razy, żeby edytować treść.
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
