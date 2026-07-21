import { useState, type ChangeEvent } from "react";
import type { CarouselSlide, Organization } from "@mizaly/shared";
import { SlideCanvasEditor } from "@mizaly/shared/src/carousel/SlideCanvasEditor";
import { fileToDataUrl, normalizeToJpeg } from "@mizaly/shared/src/carousel/imageHelpers";
import { apiClient, ApiError } from "../lib/apiClient";

interface ClosingSlideEditorProps {
  organization: { id: string; name: string; closingSlideTemplate: CarouselSlide | null };
  onClose: () => void;
  onSaved: (organization: Organization) => void;
}

const BLANK_SLIDE: CarouselSlide = { order: 0, textLayers: [], imageLayers: [] };

async function uploadClosingSlideImage(organizationId: string, dataUrl: string): Promise<string> {
  const result = await apiClient.post<{ url: string }>(
    `/api/admin/organizations/${organizationId}/closing-slide-image`,
    { dataUrl }
  );
  return result.url;
}

// Admin's version of CarouselSlideEditor.tsx's SlideRowCard, but for exactly
// one slide (no add/remove/reorder chrome) - designs the fixed last slide
// auto-appended to every new carousel this organization creates, see
// Organization.closingSlideTemplate.
export function ClosingSlideEditor({ organization, onClose, onSaved }: ClosingSlideEditorProps) {
  const [slide, setSlide] = useState<CarouselSlide>(organization.closingSlideTemplate ?? BLANK_SLIDE);
  const [isUploadingBackground, setIsUploadingBackground] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const updateSlide = (patch: Partial<CarouselSlide>) => setSlide((prev) => ({ ...prev, ...patch }));

  const handleBackgroundChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    setError(null);
    setIsUploadingBackground(true);
    try {
      const rawDataUrl = await fileToDataUrl(file);
      const dataUrl = await normalizeToJpeg(rawDataUrl);
      const url = await uploadClosingSlideImage(organization.id, dataUrl);
      // Reset pan/zoom on a new photo so it starts centered rather than
      // inheriting the previous image's position/scale.
      updateSlide({
        backgroundImageUrl: url,
        backgroundImageX: undefined,
        backgroundImageY: undefined,
        backgroundImageScale: undefined,
      });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Nie udało się wgrać zdjęcia tła.");
    } finally {
      setIsUploadingBackground(false);
    }
  };

  const save = async (template: CarouselSlide | null) => {
    setError(null);
    setIsSaving(true);
    try {
      const updated = await apiClient.patch<Organization>(`/api/admin/organizations/${organization.id}`, {
        closingSlideTemplate: template,
      });
      onSaved(updated);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Nie udało się zapisać slajdu zamykającego.");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <h2>Slajd zamykający karuzeli: {organization.name}</h2>
        <p className="form-hint">
          Stały ostatni slajd, automatycznie dodawany do każdej nowej karuzeli tej organizacji (np. zaproszenie do
          kontaktu) - warstwy tekstu i zdjęć pozostają w pełni edytowalne per post w edytorze karuzeli w apce
          mobilnej.
        </p>

        <SlideCanvasEditor
          slide={slide}
          onChange={updateSlide}
          onUploadImage={(dataUrl) => uploadClosingSlideImage(organization.id, dataUrl)}
          onBackgroundError={() => setError("Nie udało się wyświetlić zdjęcia tła. Spróbuj innego zdjęcia.")}
          onImageLayerError={(message) => setError(message)}
        />

        <label htmlFor="closingSlideBackground">
          {isUploadingBackground ? "Wgrywanie…" : slide.backgroundImageUrl ? "Zmień zdjęcie tła" : "Dodaj zdjęcie tła"}
        </label>
        <input
          id="closingSlideBackground"
          type="file"
          accept="image/*"
          disabled={isUploadingBackground}
          onChange={handleBackgroundChange}
        />

        {error && <div className="form-error">{error}</div>}

        <div className="modal-card__actions">
          <button type="button" className="secondary" onClick={() => save(null)} disabled={isSaving}>
            Usuń szablon
          </button>
          <button type="button" className="secondary" onClick={onClose} disabled={isSaving}>
            Anuluj
          </button>
          <button type="button" onClick={() => save(slide)} disabled={isSaving}>
            {isSaving ? "Zapisywanie…" : "Zapisz"}
          </button>
        </div>
      </div>
    </div>
  );
}
