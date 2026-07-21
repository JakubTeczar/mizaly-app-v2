// Single-slide Konva canvas editor for a carousel slide: background image
// (pan/zoom), text layers, and inset image layers. Shared between mobile's
// multi-slide carousel composer (apps/mobile/src/pages/tworzenie/
// CarouselSlideEditor.tsx, which wraps N of these plus add/remove/reorder
// chrome) and admin's single-slide "closing slide template" editor
// (apps/admin/src/components/ClosingSlideEditor.tsx) - a fixed last slide
// auto-appended to every new carousel, see Organization.closingSlideTemplate.
//
// Deliberately NOT re-exported from packages/shared/src/index.ts: the
// backend also imports @mizaly/shared (for plain types like SocialPlatform)
// via that single entry file, and this component pulls in react-konva/
// use-image, which the backend doesn't have as a dependency - importing them
// at module scope from index.ts would break the backend's `tsc -b` (same
// class of problem apps/backend/src/lib/enums.ts already documents for
// SOCIAL_PLATFORM_VALUES). Consumers import this file directly:
// `@mizaly/shared/src/carousel/SlideCanvasEditor`.
//
// Image uploads are injected via `onUploadImage` rather than calling a fixed
// apiClient - mobile and admin have separate auth (different bearer tokens/
// endpoints), so the caller supplies its own upload function.
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
import { Stage, Layer, Rect, Group, Image as KonvaImage, Text as KonvaText, Transformer } from "react-konva";
import useImage from "use-image";
import type Konva from "konva";
import type { CarouselImageLayer, CarouselSlide, CarouselTextFontFamily, CarouselTextLayer } from "../index";
import { fileToDataUrl, readImageDimensions } from "./imageHelpers";

// Slides are always exported at 1080x1080 (Instagram's carousel size). Text
// layers store their x/y/width/fontSize in that same fixed coordinate space
// regardless of how big the on-screen canvas actually is, so a layout looks
// identical on a 320px phone and a wide admin panel column alike - only the
// live display scale (see useContainerWidth) changes, never the stored numbers.
export const MODEL_SIZE = 1080;
const FALLBACK_BACKGROUND = "#1f1633";
const FONT_OPTIONS: CarouselTextFontFamily[] = ["Montserrat", "Bebas Neue", "Gantari", "Poppins"];

export function createTextLayer(existingCount: number): CarouselTextLayer {
  return {
    id: crypto.randomUUID(),
    content: "Nowy tekst",
    x: MODEL_SIZE / 2 - 300,
    y: MODEL_SIZE / 2 - 50 + existingCount * 90,
    width: 600,
    fontSize: 80,
    // Poppins (Black Italic) is the default for a brand-new text layer - see
    // FONT_OPTIONS above for the full picker.
    fontFamily: "Poppins",
    color: "#ffffff",
    align: "center",
  };
}

// Default size caps the inset photo at a sensible fraction of the slide
// (unlike the full-bleed background) while preserving its real aspect ratio,
// so a portrait phone photo doesn't get squashed into a square.
const DEFAULT_IMAGE_LAYER_WIDTH = 420;

export function createImageLayer(url: string, naturalWidth: number, naturalHeight: number, existingCount: number): CarouselImageLayer {
  const width = DEFAULT_IMAGE_LAYER_WIDTH;
  const height = Math.round(width * ((naturalHeight || 1) / (naturalWidth || 1)));
  const offset = existingCount * 40;
  return {
    id: crypto.randomUUID(),
    url,
    x: clamp(MODEL_SIZE / 2 - width / 2 + offset, 0, MODEL_SIZE - width),
    y: clamp(MODEL_SIZE / 2 - height / 2 + offset, 0, MODEL_SIZE - height),
    width,
    height,
  };
}

// Measures a wrapper's live rendered width so the canvas can be a responsive
// square (fits a narrow phone and a wide admin panel column alike) while the
// model coordinates above stay fixed - see MODEL_SIZE.
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

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

// A background image is stored in the same fixed 1080x1080 model space as
// text layers (see MODEL_SIZE), as a position + scale rather than a native
// Konva `crop`, so the user can pan/zoom it (drag to reposition, slider to
// zoom) instead of only getting an automatic centered square crop.
const MIN_ZOOM = 1;
const MAX_ZOOM = 3;

interface BackgroundGeometry {
  coverScale: number;
  scale: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

function computeBackgroundGeometry(image: HTMLImageElement, slide: CarouselSlide): BackgroundGeometry {
  // The minimum scale at which the image fully covers the square (no gaps),
  // matching CSS object-fit: cover.
  const coverScale = Math.max(MODEL_SIZE / image.width, MODEL_SIZE / image.height);
  const scale = Math.max(slide.backgroundImageScale ?? coverScale, coverScale);
  const width = image.width * scale;
  const height = image.height * scale;
  const defaultX = (MODEL_SIZE - width) / 2;
  const defaultY = (MODEL_SIZE - height) / 2;
  // Re-clamped every time (not just on drag) so a stored position from a
  // smaller zoom level never leaves a gap after the scale changes.
  const x = clamp(slide.backgroundImageX ?? defaultX, MODEL_SIZE - width, 0);
  const y = clamp(slide.backgroundImageY ?? defaultY, MODEL_SIZE - height, 0);
  return { coverScale, scale, x, y, width, height };
}

interface ImageLayerNodeProps {
  layer: CarouselImageLayer;
  scale: number;
  registerNode: (id: string, node: Konva.Image | null) => void;
  onSelect: (id: string) => void;
  onDragEnd: (layer: CarouselImageLayer, node: Konva.Image) => void;
  onTransformEnd: (layer: CarouselImageLayer, node: Konva.Image) => void;
  onLoadError: () => void;
}

// A separate component per inset image layer so each can call useImage() on
// its own URL - hooks can't be called in a variable number of times inside a
// single component's render (i.e. inside slide.imageLayers.map in the parent).
function ImageLayerNode({ layer, scale, registerNode, onSelect, onDragEnd, onTransformEnd, onLoadError }: ImageLayerNodeProps) {
  const [image, status] = useImage(layer.url, "anonymous");

  useEffect(() => {
    if (status === "failed") onLoadError();
  }, [status, onLoadError]);

  if (!image) return null;

  return (
    <KonvaImage
      ref={(node) => registerNode(layer.id, node)}
      image={image}
      x={layer.x * scale}
      y={layer.y * scale}
      width={layer.width * scale}
      height={layer.height * scale}
      draggable
      onClick={() => onSelect(layer.id)}
      onTap={() => onSelect(layer.id)}
      onDragEnd={(e) => onDragEnd(layer, e.target as Konva.Image)}
      onTransformEnd={(e) => onTransformEnd(layer, e.target as Konva.Image)}
    />
  );
}

export interface SlideCanvasEditorHandle {
  exportDataUrl: () => string;
}

export interface SlideCanvasEditorProps {
  slide: CarouselSlide;
  onChange: (patch: Partial<CarouselSlide>) => void;
  onBackgroundError: () => void;
  onImageLayerError: (message: string) => void;
  // Uploads a data URL and resolves to its public URL - see module comment.
  onUploadImage: (dataUrl: string) => Promise<string>;
}

export const SlideCanvasEditor = forwardRef<SlideCanvasEditorHandle, SlideCanvasEditorProps>(function SlideCanvasEditor(
  { slide, onChange, onBackgroundError, onImageLayerError, onUploadImage },
  ref
) {
  const { ref: containerRef, width: displaySize } = useContainerWidth();
  const stageRef = useRef<Konva.Stage>(null);
  const trRef = useRef<Konva.Transformer>(null);
  const textNodeRefs = useRef<Record<string, Konva.Text | null>>({});
  const imageNodeRefs = useRef<Record<string, Konva.Image | null>>({});
  const imageFileInputRef = useRef<HTMLInputElement>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingValue, setEditingValue] = useState("");
  const [isUploadingImage, setIsUploadingImage] = useState(false);

  const scale = displaySize > 0 ? displaySize / MODEL_SIZE : 0;

  const [bgImage, bgStatus] = useImage(slide.backgroundImageUrl || "", "anonymous");

  useEffect(() => {
    if (bgStatus === "failed") onBackgroundError();
  }, [bgStatus, onBackgroundError]);

  const bgGeometry = useMemo(
    () => (bgImage ? computeBackgroundGeometry(bgImage, slide) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [bgImage, slide.backgroundImageX, slide.backgroundImageY, slide.backgroundImageScale]
  );

  const handleBackgroundDragEnd = (node: Konva.Image) => {
    if (!bgGeometry) return;
    onChange({
      backgroundImageX: node.x() / scale,
      backgroundImageY: node.y() / scale,
      backgroundImageScale: bgGeometry.scale,
    });
  };

  const handleZoomChange = (zoomFactor: number) => {
    if (!bgImage || !bgGeometry) return;
    const newScale = bgGeometry.coverScale * zoomFactor;
    const newWidth = bgImage.width * newScale;
    const newHeight = bgImage.height * newScale;
    // Zoom around the currently visible center, not the top-left corner.
    const centerX = bgGeometry.x + bgGeometry.width / 2;
    const centerY = bgGeometry.y + bgGeometry.height / 2;
    onChange({
      backgroundImageScale: newScale,
      backgroundImageX: clamp(centerX - newWidth / 2, MODEL_SIZE - newWidth, 0),
      backgroundImageY: clamp(centerY - newHeight / 2, MODEL_SIZE - newHeight, 0),
    });
  };

  // A canvas never repaints on its own once a @font-face finishes loading
  // after first paint, unlike DOM text - force one redraw when fonts settle
  // so an export triggered right away doesn't bake in the fallback font.
  useEffect(() => {
    document.fonts?.ready?.then(() => {
      stageRef.current?.getLayers().forEach((layer) => layer.batchDraw());
    });
  }, []);

  useEffect(() => {
    const node = selectedId ? textNodeRefs.current[selectedId] ?? imageNodeRefs.current[selectedId] : null;
    trRef.current?.nodes(node ? [node] : []);
    trRef.current?.getLayer()?.batchDraw();
  }, [selectedId, slide.textLayers, slide.imageLayers]);

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

  const updateImageLayer = (id: string, patch: Partial<CarouselImageLayer>) => {
    onChange({ imageLayers: slide.imageLayers.map((layer) => (layer.id === id ? { ...layer, ...patch } : layer)) });
  };

  const removeImageLayer = (id: string) => {
    setSelectedId(null);
    onChange({ imageLayers: slide.imageLayers.filter((layer) => layer.id !== id) });
  };

  const handleImageDragEnd = (layer: CarouselImageLayer, node: Konva.Image) => {
    updateImageLayer(layer.id, { x: node.x() / scale, y: node.y() / scale });
  };

  const handleImageTransformEnd = (layer: CarouselImageLayer, node: Konva.Image) => {
    const factor = node.scaleX();
    node.scaleX(1);
    node.scaleY(1);
    updateImageLayer(layer.id, {
      x: node.x() / scale,
      y: node.y() / scale,
      width: Math.max(40, layer.width * factor),
      height: Math.max(40, layer.height * factor),
    });
  };

  const handleAddImageFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    setIsUploadingImage(true);
    try {
      const rawDataUrl = await fileToDataUrl(file);
      const { width: naturalWidth, height: naturalHeight } = await readImageDimensions(rawDataUrl);
      const url = await onUploadImage(rawDataUrl);
      const layer = createImageLayer(url, naturalWidth, naturalHeight, slide.imageLayers.length);
      onChange({ imageLayers: [...slide.imageLayers, layer] });
      setSelectedId(layer.id);
    } catch (err) {
      onImageLayerError(
        err instanceof Error
          ? err.message
          : "Nie udało się wgrać zdjęcia. Spróbuj innego zdjęcia lub sprawdź, czy plik nie jest uszkodzony."
      );
    } finally {
      setIsUploadingImage(false);
    }
  };

  const selectedLayer = slide.textLayers.find((layer) => layer.id === selectedId) ?? null;
  const selectedImageLayer = slide.imageLayers.find((layer) => layer.id === selectedId) ?? null;
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
              {bgImage && bgGeometry && (
                <Group clip={{ x: 0, y: 0, width: displaySize, height: displaySize }}>
                  <KonvaImage
                    image={bgImage}
                    x={bgGeometry.x * scale}
                    y={bgGeometry.y * scale}
                    width={bgGeometry.width * scale}
                    height={bgGeometry.height * scale}
                    draggable
                    dragBoundFunc={(pos) => ({
                      x: clamp(pos.x, displaySize - bgGeometry.width * scale, 0),
                      y: clamp(pos.y, displaySize - bgGeometry.height * scale, 0),
                    })}
                    onDragEnd={(e) => handleBackgroundDragEnd(e.target as Konva.Image)}
                  />
                </Group>
              )}
              {slide.imageLayers.map((layer) => (
                <ImageLayerNode
                  key={layer.id}
                  layer={layer}
                  scale={scale}
                  registerNode={(id, node) => {
                    imageNodeRefs.current[id] = node;
                  }}
                  onSelect={setSelectedId}
                  onDragEnd={handleImageDragEnd}
                  onTransformEnd={handleImageTransformEnd}
                  onLoadError={() =>
                    onImageLayerError("Nie udało się wyświetlić zdjęcia. Spróbuj innego zdjęcia lub sprawdź, czy plik nie jest uszkodzony.")
                  }
                />
              ))}
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

      {bgImage && bgGeometry && (
        <div className="carousel-zoom-control">
          <span className="carousel-zoom-label">Powiększenie zdjęcia</span>
          <input
            type="range"
            min={MIN_ZOOM}
            max={MAX_ZOOM}
            step={0.01}
            value={bgGeometry.scale / bgGeometry.coverScale}
            onChange={(e) => handleZoomChange(Number(e.target.value))}
          />
        </div>
      )}

      <div className="carousel-canvas-toolbar">
        <button type="button" className="btn btn-secondary btn-small" onClick={addLayer}>
          + Dodaj tekst
        </button>
        <button
          type="button"
          className="btn btn-secondary btn-small"
          disabled={isUploadingImage}
          onClick={() => imageFileInputRef.current?.click()}
        >
          {isUploadingImage ? "Wgrywanie…" : "+ Dodaj zdjęcie"}
        </button>
        <input
          ref={imageFileInputRef}
          type="file"
          accept="image/*"
          style={{ display: "none" }}
          onChange={handleAddImageFile}
        />
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
        {selectedImageLayer && (
          <button
            type="button"
            className="btn-text"
            onClick={() => removeImageLayer(selectedImageLayer.id)}
            aria-label="Usuń zdjęcie"
          >
            Usuń zdjęcie
          </button>
        )}
      </div>
    </div>
  );
});
