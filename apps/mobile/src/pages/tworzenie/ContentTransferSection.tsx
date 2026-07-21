import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { SocialPlatform, type ContentTransferPost, type SocialAccount } from "@mizaly/shared";
import { apiClient, ApiError } from "../../lib/apiClient";
import { platformLabel } from "../../lib/platformLabels";
import { Modal } from "../../components/Modal";

// Accusative ("na kogo/co") form of each platform name, for "prześlij na X" /
// "przesłano na X" phrasing - platformLabel itself stays nominative since
// it's also used for plain labels elsewhere (e.g. "Facebook: połączono").
const PLATFORM_LABEL_ACCUSATIVE: Record<string, string> = {
  facebook: "Facebooka",
  instagram: "Instagrama",
  tiktok: "TikTok",
  youtube: "YouTube",
  linkedin: "LinkedIna",
  threads: "Threads",
  pinterest: "Pinteresta",
  reddit: "Reddita",
};

function platformLabelAccusative(platform: string): string {
  return PLATFORM_LABEL_ACCUSATIVE[platform] ?? platformLabel(platform);
}

interface PostsResponse {
  connected: boolean;
  posts: ContentTransferPost[];
  isRefreshing: boolean;
}

function formatPostedAt(postedAt: string | null): string {
  if (!postedAt) return "";
  return new Date(postedAt).toLocaleDateString("pl-PL", { day: "numeric", month: "short", year: "numeric" });
}

function formatTransferredAt(isoDate: string): string {
  return new Date(isoDate).toLocaleDateString("pl-PL", { day: "numeric", month: "short", year: "numeric" });
}

function truncateCaption(caption: string, maxLength = 140): string {
  const trimmed = caption.trim();
  if (trimmed.length <= maxLength) return trimmed;
  return `${trimmed.slice(0, maxLength).trimEnd()}…`;
}

interface SharePromptState {
  post: ContentTransferPost;
  // Almost always one platform (a single per-platform button) - an array so
  // the same prompt/modal also covers "prześlij na wszystkie naraz", which
  // just means publishing the same edited caption to every pending platform
  // in one sequential batch instead of opening the modal N times.
  platforms: SocialPlatform[];
}

// "Facebooka", "Facebooka i TikTok", "Facebooka, TikTok i LinkedIna" - reads
// naturally for the 1/2/3+ platform cases the modal title and button need.
function joinPlatformNames(platforms: SocialPlatform[]): string {
  const names = platforms.map(platformLabelAccusative);
  if (names.length <= 1) return names[0] ?? "";
  if (names.length === 2) return `${names[0]} i ${names[1]}`;
  return `${names.slice(0, -1).join(", ")} i ${names[names.length - 1]}`;
}

export function ContentTransferSection() {
  const [connected, setConnected] = useState(false);
  const [posts, setPosts] = useState<ContentTransferPost[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [connectedAccounts, setConnectedAccounts] = useState<SocialAccount[]>([]);

  const [isRefreshing, setIsRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState<string | null>(null);

  const [sharePrompt, setSharePrompt] = useState<SharePromptState | null>(null);
  const [draftContent, setDraftContent] = useState("");
  const [isPublishing, setIsPublishing] = useState(false);
  const [publishError, setPublishError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      apiClient.get<PostsResponse>("/api/content-transfer/posts"),
      apiClient.get<SocialAccount[]>("/api/social-accounts"),
    ])
      .then(([postsRes, accounts]) => {
        setConnected(postsRes.connected);
        setPosts(postsRes.posts);
        setConnectedAccounts(accounts);
      })
      .catch((err) => setLoadError(err instanceof ApiError ? err.message : "Nie udało się wczytać postów."))
      .finally(() => setIsLoading(false));
  }, []);

  const targetPlatforms = Array.from(new Set(connectedAccounts.map((a) => a.platform))).filter(
    (platform) => platform !== SocialPlatform.INSTAGRAM
  );

  const handleRefresh = async () => {
    setIsRefreshing(true);
    setRefreshError(null);
    try {
      const result = await apiClient.post<{ posts: ContentTransferPost[] }>("/api/content-transfer/refresh");
      setPosts(result.posts);
      setConnected(true);
    } catch (err) {
      setRefreshError(err instanceof ApiError ? err.message : "Nie udało się odświeżyć postów.");
    } finally {
      setIsRefreshing(false);
    }
  };

  const openSharePrompt = (post: ContentTransferPost, platforms: SocialPlatform[]) => {
    setSharePrompt({ post, platforms });
    setDraftContent(post.caption);
    setPublishError(null);
  };

  const closeSharePrompt = () => {
    setSharePrompt(null);
    setDraftContent("");
    setPublishError(null);
  };

  const handlePublish = async () => {
    if (!sharePrompt) return;
    setIsPublishing(true);
    setPublishError(null);

    const succeeded: SocialPlatform[] = [];
    let stoppedEarly = false;
    for (const platform of sharePrompt.platforms) {
      try {
        const response = await apiClient.post<{ post: ContentTransferPost }>(
          `/api/content-transfer/${sharePrompt.post.id}/publish`,
          { platform, content: draftContent }
        );
        // Applied after each platform (not just at the end) so a later
        // failure in the same batch doesn't lose the ones that already went
        // through - the post card's per-platform state stays accurate.
        setPosts((prev) => prev.map((p) => (p.id === response.post.id ? response.post : p)));
        succeeded.push(platform);
      } catch (err) {
        setPublishError(
          succeeded.length > 0
            ? `Przesłano na ${joinPlatformNames(succeeded)}, ale nie udało się przesłać na ${platformLabelAccusative(platform)}: ${
                err instanceof ApiError ? err.message : "nieznany błąd"
              }`
            : err instanceof ApiError
              ? err.message
              : "Nie udało się przesłać treści."
        );
        stoppedEarly = true;
        break;
      }
    }

    setIsPublishing(false);
    if (!stoppedEarly) {
      setSuccessMessage(`Przesłano na ${joinPlatformNames(succeeded)}.`);
      closeSharePrompt();
    }
  };

  return (
    <div>
      <section className="card">
        <div className="card-header-row">
          <h2>Przenoszenie treści z IG</h2>
          {connected && (
            <button type="button" className="btn btn-secondary" onClick={handleRefresh} disabled={isRefreshing}>
              {isRefreshing ? "Odświeżanie…" : "Odśwież"}
            </button>
          )}
        </div>

        {isLoading && <p className="hint-text">Ładowanie…</p>}
        {loadError && <p className="error-text">{loadError}</p>}
        {refreshError && <p className="error-text">{refreshError}</p>}
        {successMessage && <p className="hint-text success">{successMessage}</p>}

        {!isLoading && !connected && (
          <p className="card-muted-text">
            Połącz konto Instagram, żeby przenosić z niego treść na inne platformy.{" "}
            <Link to="/konta">Połącz konto</Link>.
          </p>
        )}

        {!isLoading && connected && targetPlatforms.length === 0 && (
          <p className="note-banner">
            Nie masz jeszcze podłączonej żadnej innej platformy (Facebook, TikTok, LinkedIn…). <Link to="/konta">Połącz konto</Link>,
            żeby móc przenosić na nie treść z Instagrama.
          </p>
        )}

        {!isLoading && connected && posts.length === 0 && !refreshError && (
          <p className="hint-text">Brak jeszcze pobranych postów. Kliknij "Odśwież", żeby je pobrać.</p>
        )}

        {posts.length > 0 && (
          <div className="content-transfer-list">
            {posts.map((post) => {
              const pendingPlatforms = targetPlatforms.filter((p) => !post.transferredTo[p]);
              // Only meaningfully different from a single per-platform button
              // once there are >=2 targets - with just one, "wszystkie" would
              // just duplicate the lone button below it.
              const isFullyTransferred = targetPlatforms.length > 0 && pendingPlatforms.length === 0;

              return (
                <div
                  key={post.id}
                  className={`content-transfer-post${isFullyTransferred ? " content-transfer-post--complete" : ""}`}
                >
                  {isFullyTransferred && (
                    <span className="content-transfer-post-check" title="Przesłano na wszystkie podłączone platformy">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <path d="M5 13l4 4L19 7" />
                      </svg>
                    </span>
                  )}
                  <div className="content-transfer-post-media">
                    {post.imageUrl ? (
                      <img src={post.imageUrl} alt="Podgląd posta" />
                    ) : post.videoUrl ? (
                      <video src={post.videoUrl} muted preload="metadata" />
                    ) : null}
                  </div>
                  <div className="content-transfer-post-body">
                    <p className="content-transfer-post-caption">{truncateCaption(post.caption)}</p>
                    <p className="card-muted-text">
                      {formatPostedAt(post.postedAt)}
                      {isFullyTransferred && (
                        <span className="tag-pill" style={{ marginLeft: 8 }}>
                          Zsynchronizowano
                        </span>
                      )}
                    </p>
                    {targetPlatforms.length > 0 && (
                      <div className="content-transfer-post-actions">
                        {targetPlatforms.length > 1 && pendingPlatforms.length > 1 && (
                          <button
                            type="button"
                            className="btn-text content-transfer-send-all"
                            onClick={() => openSharePrompt(post, pendingPlatforms)}
                          >
                            Prześlij na wszystkie naraz ({pendingPlatforms.length})
                          </button>
                        )}
                        {targetPlatforms.map((platform) => {
                          const transferredAt = post.transferredTo[platform];
                          return (
                            <div key={platform} className="content-transfer-platform-action">
                              <button
                                type="button"
                                className="btn-text"
                                onClick={() => openSharePrompt(post, [platform])}
                              >
                                {transferredAt
                                  ? `Prześlij ponownie na ${platformLabelAccusative(platform)}`
                                  : `Prześlij na ${platformLabelAccusative(platform)}`}
                              </button>
                              {transferredAt && (
                                <span className="card-muted-text">
                                  ✓ Przeniesione {formatTransferredAt(transferredAt)}
                                </span>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {sharePrompt && (
        <Modal title={`Prześlij na ${joinPlatformNames(sharePrompt.platforms)}`} onClose={closeSharePrompt}>
          <div className="content-transfer-modal-media">
            {sharePrompt.post.imageUrl ? (
              <img src={sharePrompt.post.imageUrl} alt="Podgląd posta" />
            ) : sharePrompt.post.videoUrl ? (
              <video src={sharePrompt.post.videoUrl} controls muted />
            ) : null}
          </div>
          <div className="field">
            <label htmlFor="shareContent">Treść</label>
            <textarea
              id="shareContent"
              value={draftContent}
              onChange={(e) => setDraftContent(e.target.value)}
              autoFocus
            />
          </div>
          {publishError && <p className="error-text">{publishError}</p>}
          <div className="modal-actions">
            <button type="button" className="btn btn-secondary" onClick={closeSharePrompt}>
              Anuluj
            </button>
            <button type="button" className="btn" disabled={isPublishing} onClick={handlePublish}>
              {isPublishing ? "Publikowanie…" : "Publikuj"}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
