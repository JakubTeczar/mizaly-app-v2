import { useEffect, useState, type FormEvent } from "react";
import type { Post, WebsiteArticle } from "@mizaly/shared";
import { apiClient, ApiError } from "../../lib/apiClient";

type Mode = "fromPost" | "fromScratch";

export function StronaSection() {
  const [mode, setMode] = useState<Mode>("fromPost");

  const [posts, setPosts] = useState<Post[]>([]);
  const [isLoadingPosts, setIsLoadingPosts] = useState(true);
  const [sourcePostId, setSourcePostId] = useState("");

  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  useEffect(() => {
    apiClient
      .get<Post[]>("/api/posts")
      .then((res) => {
        setPosts(res);
        if (res.length > 0) setSourcePostId(res[0].id);
      })
      .catch(() => setPosts([]))
      .finally(() => setIsLoadingPosts(false));
  }, []);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setSuccessMessage(null);
    setIsSubmitting(true);
    try {
      const payload = mode === "fromPost" ? { sourcePostId } : { title, body };
      await apiClient.post<WebsiteArticle>("/api/website-articles", payload);
      setSuccessMessage("Artykuł zapisany.");
      setTitle("");
      setBody("");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Nie udało się zapisać artykułu.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <section className="card">
      <h2>Stwórz posta na stronę</h2>

      <div className="sub-tabs">
        <button type="button" className={mode === "fromPost" ? "active" : ""} onClick={() => setMode("fromPost")}>
          Na podstawie posta
        </button>
        <button
          type="button"
          className={mode === "fromScratch" ? "active" : ""}
          onClick={() => setMode("fromScratch")}
        >
          Od zera
        </button>
      </div>

      <form onSubmit={handleSubmit}>
        {mode === "fromPost" ? (
          <div className="field">
            <label htmlFor="sourcePostId">Wybierz post</label>
            {isLoadingPosts ? (
              <p className="hint-text">Ładowanie postów…</p>
            ) : posts.length === 0 ? (
              <p className="hint-text">Nie masz jeszcze żadnych postów. Stwórz najpierw post social media.</p>
            ) : (
              <select id="sourcePostId" value={sourcePostId} onChange={(e) => setSourcePostId(e.target.value)}>
                {posts.map((post) => (
                  <option key={post.id} value={post.id}>
                    {post.heading}
                  </option>
                ))}
              </select>
            )}
          </div>
        ) : (
          <>
            <div className="field">
              <label htmlFor="articleTitle">Tytuł</label>
              <input id="articleTitle" type="text" value={title} onChange={(e) => setTitle(e.target.value)} required />
            </div>
            <div className="field">
              <label htmlFor="articleBody">Treść</label>
              <textarea id="articleBody" value={body} onChange={(e) => setBody(e.target.value)} required />
            </div>
          </>
        )}

        {error && <p className="error-text">{error}</p>}
        {successMessage && <p className="hint-text">{successMessage}</p>}

        <button
          type="submit"
          className="btn"
          disabled={isSubmitting || (mode === "fromPost" && !sourcePostId)}
        >
          {isSubmitting ? "Zapisywanie…" : "Zapisz artykuł"}
        </button>
      </form>
    </section>
  );
}
