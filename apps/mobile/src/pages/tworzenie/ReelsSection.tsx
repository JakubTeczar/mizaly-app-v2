import { useState, type ChangeEvent, type FormEvent } from "react";
import type { Reel } from "@mizaly/shared";
import { apiClient, ApiError } from "../../lib/apiClient";

export function ReelsSection() {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");

  // MVP: video is only previewed locally via URL.createObjectURL.
  // TODO(later): real upload to storage and use the resulting URL as videoUrl.
  const [videoPreview, setVideoPreview] = useState<string | null>(null);

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const handleVideoChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setVideoPreview(URL.createObjectURL(file));
  };

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setSuccessMessage(null);
    setIsSubmitting(true);
    try {
      await apiClient.post<Reel>("/api/reels", {
        title,
        description,
        videoUrl: "", // TODO(later): replace with real uploaded video URL
        platforms: [],
        status: "draft",
      });
      setSuccessMessage("Reels zapisany jako szkic.");
      setTitle("");
      setDescription("");
      setVideoPreview(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Nie udało się zapisać reelsa.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <section className="card">
      <h2>Dodaj Reelsa</h2>
      <form onSubmit={handleSubmit}>
        <div className="field">
          <label htmlFor="reelTitle">Tytuł</label>
          <input id="reelTitle" type="text" value={title} onChange={(e) => setTitle(e.target.value)} required />
        </div>
        <div className="field">
          <label htmlFor="reelDescription">Opis</label>
          <textarea
            id="reelDescription"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            required
          />
        </div>
        <div className="field">
          <label htmlFor="reelVideo">Wideo</label>
          <input id="reelVideo" type="file" accept="video/*" onChange={handleVideoChange} />
          {videoPreview && (
            <div className="media-preview-row">
              <video src={videoPreview} muted />
            </div>
          )}
        </div>

        {error && <p className="error-text">{error}</p>}
        {successMessage && <p className="hint-text">{successMessage}</p>}

        <button type="submit" className="btn" disabled={isSubmitting}>
          {isSubmitting ? "Zapisywanie…" : "Zapisz reelsa"}
        </button>
      </form>
    </section>
  );
}
