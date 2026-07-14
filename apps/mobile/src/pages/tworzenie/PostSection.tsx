import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import { Link } from "react-router-dom";
import type { CarouselSlide, Post, SocialAccount, SocialPlatform } from "@mizaly/shared";
import { apiClient, ApiError } from "../../lib/apiClient";
import { fileToDataUrl, cropToSafeAspectRatio } from "../../lib/imageCrop";
import { Modal } from "../../components/Modal";
import { PostPreview } from "./PostPreview";
import { CarouselSlideEditor } from "./CarouselSlideEditor";

interface AiCaptionResponse {
  title: string;
  caption: string;
  hashtags: string[];
}

type AiMode = "quick" | "precise";

type StoryTemplate = "none" | "new_post" | "series";

interface AiInterviewHistoryItem {
  question: string;
  options: string[];
  answer: string;
}

type AiInterviewResponse =
  | { done: false; confidence: number; question: string; options: string[] }
  | { done: true; confidence: number; title: string; caption: string; hashtags: string[] };

interface PublishResponse {
  post: Post;
  zernio: { status: string; platforms: { platform: string; accountId: string; status: string }[] };
}

// Small tap-to-reveal info affordance for explanatory copy that doesn't need
// to sit permanently under a field - this is a touch device (mobile PWA), so
// a hover-only `title` tooltip would never be reachable, hence the explicit
// toggle button instead. Purely presentational, no effect on form state.
function InfoTip({ text }: { text: string }) {
  const [isOpen, setIsOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        className="info-tip-trigger"
        aria-expanded={isOpen}
        aria-label="Więcej informacji"
        onClick={() => setIsOpen((prev) => !prev)}
      >
        i
      </button>
      {isOpen && <span className="info-tip-bubble">{text}</span>}
    </>
  );
}

export function PostSection() {
  const [heading, setHeading] = useState("");
  const [content, setContent] = useState("");
  const [firstComment, setFirstComment] = useState("");
  const [platforms, setPlatforms] = useState<SocialPlatform[]>([]);

  // Only platforms with an actually connected account can be published to -
  // see the "Konta" page (src/pages/KontaPage.tsx) for connecting one.
  const [connectedAccounts, setConnectedAccounts] = useState<SocialAccount[]>([]);
  const [isLoadingAccounts, setIsLoadingAccounts] = useState(true);

  // Photos are uploaded to Cloudinary immediately on selection (Zernio needs
  // a public URL, not a local blob) - see /api/media/upload.
  const [photoPreviews, setPhotoPreviews] = useState<string[]>([]);
  const [mediaUrls, setMediaUrls] = useState<string[]>([]);
  const [isUploadingPhotos, setIsUploadingPhotos] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  // Saved carousel definition (source of truth for re-editing) - null/[]
  // means the post is just plain uploaded photos. Once saved, mediaUrls
  // above holds the rendered slide images actually sent to Zernio, see
  // CarouselSlideEditor's onSave.
  const [carouselSlides, setCarouselSlides] = useState<CarouselSlide[]>([]);
  const [isCarouselEditorOpen, setIsCarouselEditorOpen] = useState(false);

  // Collapsed by default - AI generation is an optional helper, not part of
  // the main composing flow, so it shouldn't push the form down on entry.
  const [isAiOpen, setIsAiOpen] = useState(false);
  const [aiMode, setAiMode] = useState<AiMode>("quick");
  const [aiTopic, setAiTopic] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);

  // "Dokładny" mode: a back-and-forth interview (see /api/ai/interview) that
  // keeps asking one question at a time - each with pick-list options plus a
  // free-text "Inny" escape hatch - until the model is ≥95% confident it has
  // enough concrete detail to write a post worth reading.
  const [interviewTopic, setInterviewTopic] = useState("");
  const [interviewHistory, setInterviewHistory] = useState<AiInterviewHistoryItem[]>([]);
  const [currentQuestion, setCurrentQuestion] = useState<{ question: string; options: string[] } | null>(null);
  const [interviewConfidence, setInterviewConfidence] = useState(0);
  const [isInterviewLoading, setIsInterviewLoading] = useState(false);
  const [interviewError, setInterviewError] = useState<string | null>(null);
  const [isInterviewDone, setIsInterviewDone] = useState(false);
  const [customAnswer, setCustomAnswer] = useState("");
  const [isCustomAnswerOpen, setIsCustomAnswerOpen] = useState(false);
  const [selectedOption, setSelectedOption] = useState<string | null>(null);

  // Visual template for the Instagram Story auto-published alongside the
  // feed post (see backend routes/posts.ts) - "none" (default) means the
  // story is just the raw post photo, unmodified. Ephemeral - only sent at
  // publish time, never saved on the post itself.
  const [storyTemplate, setStoryTemplate] = useState<StoryTemplate>("none");
  const [seriesName, setSeriesName] = useState("");

  // Collapsed by default, same reasoning as the AI section above - first
  // comment and story template are secondary, occasional choices, not part
  // of the core "write and publish" path, so they shouldn't take up space
  // on entry.
  const [isMoreOptionsOpen, setIsMoreOptionsOpen] = useState(false);

  // Auto-regenerated (debounced) whenever the template or its inputs change -
  // see the effect below. templatePreviewRequestId guards against an older,
  // slower request overwriting a newer one's result.
  const [templatePreviewUrl, setTemplatePreviewUrl] = useState<string | null>(null);
  const [isLoadingTemplatePreview, setIsLoadingTemplatePreview] = useState(false);
  const [templatePreviewError, setTemplatePreviewError] = useState<string | null>(null);
  const templatePreviewRequestId = useRef(0);

  const [isScheduleModalOpen, setIsScheduleModalOpen] = useState(false);
  const [scheduledFor, setScheduledFor] = useState("");

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Used as the `min` on the datetime picker so users can't schedule into the past.
  const nowLocal = new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16);

  useEffect(() => {
    apiClient
      .get<SocialAccount[]>("/api/social-accounts")
      .then(setConnectedAccounts)
      .catch(() => setConnectedAccounts([]))
      .finally(() => setIsLoadingAccounts(false));
  }, []);

  const connectedPlatforms = Array.from(new Set(connectedAccounts.map((a) => a.platform)));

  const togglePlatform = (platform: SocialPlatform) => {
    setPlatforms((prev) =>
      prev.includes(platform) ? prev.filter((p) => p !== platform) : [...prev, platform]
    );
  };

  const handlePhotosChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (!files || files.length === 0) return;

    setUploadError(null);
    setIsUploadingPhotos(true);
    try {
      // Crop to Instagram's safe feed aspect ratio (0.8-1.91) *before*
      // uploading, so we never send Zernio/Instagram an image they'll reject
      // (e.g. tall Story-style screenshots) - see lib/imageCrop.ts.
      const uploaded: string[] = [];
      const previews: string[] = [];
      for (const file of Array.from(files)) {
        const rawDataUrl = await fileToDataUrl(file);
        const croppedDataUrl = await cropToSafeAspectRatio(rawDataUrl);
        previews.push(croppedDataUrl);
        const result = await apiClient.post<{ url: string }>("/api/media/upload", { dataUrl: croppedDataUrl });
        uploaded.push(result.url);
      }
      setPhotoPreviews((prev) => [...prev, ...previews]);
      setMediaUrls((prev) => [...prev, ...uploaded]);
    } catch (err) {
      setUploadError(err instanceof ApiError ? err.message : "Nie udało się wgrać zdjęć.");
    } finally {
      setIsUploadingPhotos(false);
      event.target.value = "";
    }
  };

  const handleRemovePhoto = (index: number) => {
    setPhotoPreviews((prev) => prev.filter((_, i) => i !== index));
    setMediaUrls((prev) => prev.filter((_, i) => i !== index));
  };

  const handleOpenCarouselEditor = () => {
    setIsCarouselEditorOpen(true);
  };

  const handleRemoveCarousel = () => {
    setCarouselSlides([]);
    setPhotoPreviews([]);
    setMediaUrls([]);
  };

  const handleGenerateWithAi = async () => {
    if (!aiTopic.trim()) return;
    setAiError(null);
    setIsGenerating(true);
    try {
      const result = await apiClient.post<AiCaptionResponse>("/api/ai/generate-caption", {
        topic: aiTopic.trim(),
      });
      const hashtagsLine = result.hashtags?.length ? `\n\n${result.hashtags.join(" ")}` : "";
      if (result.title) setHeading(result.title);
      setContent(`${result.caption}${hashtagsLine}`);
    } catch (err) {
      setAiError(err instanceof ApiError ? err.message : "Nie udało się wygenerować treści.");
    } finally {
      setIsGenerating(false);
    }
  };

  const resetInterview = () => {
    setInterviewTopic("");
    setInterviewHistory([]);
    setCurrentQuestion(null);
    setInterviewConfidence(0);
    setIsInterviewLoading(false);
    setInterviewError(null);
    setIsInterviewDone(false);
    setCustomAnswer("");
    setIsCustomAnswerOpen(false);
    setSelectedOption(null);
  };

  const applyInterviewResponse = (result: AiInterviewResponse) => {
    setInterviewConfidence(result.confidence);
    setSelectedOption(null);
    if (result.done) {
      const hashtagsLine = result.hashtags?.length ? `\n\n${result.hashtags.join(" ")}` : "";
      if (result.title) setHeading(result.title);
      setContent(`${result.caption}${hashtagsLine}`);
      setCurrentQuestion(null);
      setIsInterviewDone(true);
    } else {
      setCurrentQuestion({ question: result.question, options: result.options });
    }
  };

  const handleStartInterview = async () => {
    if (!interviewTopic.trim()) return;
    setInterviewError(null);
    setIsInterviewLoading(true);
    try {
      const result = await apiClient.post<AiInterviewResponse>("/api/ai/interview", {
        topic: interviewTopic.trim(),
        history: [],
      });
      applyInterviewResponse(result);
    } catch (err) {
      setInterviewError(err instanceof ApiError ? err.message : "Nie udało się rozpocząć rozmowy z AI.");
    } finally {
      setIsInterviewLoading(false);
    }
  };

  const handleAnswerQuestion = async (answer: string) => {
    if (!currentQuestion || !answer.trim()) return;
    setInterviewError(null);
    setIsInterviewLoading(true);
    const nextHistory = [
      ...interviewHistory,
      { question: currentQuestion.question, options: currentQuestion.options, answer: answer.trim() },
    ];
    setInterviewHistory(nextHistory);
    setCurrentQuestion(null);
    setCustomAnswer("");
    setIsCustomAnswerOpen(false);
    try {
      const result = await apiClient.post<AiInterviewResponse>("/api/ai/interview", {
        topic: interviewTopic.trim(),
        history: nextHistory,
      });
      applyInterviewResponse(result);
    } catch (err) {
      setInterviewError(err instanceof ApiError ? err.message : "Nie udało się kontynuować rozmowy z AI.");
    } finally {
      setIsInterviewLoading(false);
    }
  };

  const resetForm = () => {
    setHeading("");
    setContent("");
    setFirstComment("");
    setPlatforms([]);
    setPhotoPreviews([]);
    setMediaUrls([]);
    setCarouselSlides([]);
    setScheduledFor("");
    setIsScheduleModalOpen(false);
    setStoryTemplate("none");
    setSeriesName("");
    setTemplatePreviewUrl(null);
    setTemplatePreviewError(null);
    resetInterview();
  };

  // Auto-regenerates the template preview whenever the template choice or any
  // of its inputs change, debounced so typing in "Nazwa serii" (or editing
  // the heading/content) doesn't spin up a headless browser on every
  // keystroke - only once things settle for 700ms.
  const firstMediaUrl = mediaUrls[0];
  useEffect(() => {
    if (storyTemplate === "none" || !firstMediaUrl) {
      templatePreviewRequestId.current += 1;
      setTemplatePreviewUrl(null);
      setTemplatePreviewError(null);
      setIsLoadingTemplatePreview(false);
      return;
    }

    const requestId = (templatePreviewRequestId.current += 1);
    setIsLoadingTemplatePreview(true);
    setTemplatePreviewError(null);

    const timeoutId = setTimeout(async () => {
      try {
        const result = await apiClient.post<{ dataUrl: string }>("/api/posts/story-preview", {
          photoUrl: firstMediaUrl,
          heading,
          content,
          storyTemplate,
          seriesName: storyTemplate === "series" ? seriesName.trim() : undefined,
        });
        if (templatePreviewRequestId.current === requestId) {
          setTemplatePreviewUrl(result.dataUrl);
        }
      } catch (err) {
        if (templatePreviewRequestId.current === requestId) {
          setTemplatePreviewError(err instanceof ApiError ? err.message : "Nie udało się wygenerować podglądu szablonu.");
        }
      } finally {
        if (templatePreviewRequestId.current === requestId) {
          setIsLoadingTemplatePreview(false);
        }
      }
    }, 700);

    return () => clearTimeout(timeoutId);
  }, [storyTemplate, seriesName, heading, content, firstMediaUrl]);

  const savePost = () =>
    apiClient.post<Post>("/api/posts", {
      heading,
      content,
      firstComment: firstComment.trim() || undefined,
      mediaUrls,
      carouselSlides: carouselSlides.length > 0 ? carouselSlides : undefined,
      platforms,
      status: "draft",
    });

  const handleSaveDraft = async (event: FormEvent) => {
    event.preventDefault();
    setSubmitError(null);
    setSuccessMessage(null);
    setIsSubmitting(true);
    try {
      await savePost();
      setSuccessMessage("Post zapisany jako szkic.");
      resetForm();
    } catch (err) {
      setSubmitError(err instanceof ApiError ? err.message : "Nie udało się zapisać posta.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handlePublishNow = async () => {
    setSubmitError(null);
    setSuccessMessage(null);
    setIsSubmitting(true);
    try {
      const created = await savePost();
      const result = await apiClient.post<PublishResponse>(`/api/posts/${created.id}/publish`, {
        mode: "now",
        storyTemplate,
        seriesName: storyTemplate === "series" ? seriesName.trim() : undefined,
      });
      const failed = result.zernio.platforms.filter((p) => p.status === "failed");
      if (failed.length > 0) {
        setSubmitError(`Post zapisany, ale nie powiodło się na: ${failed.map((p) => p.platform).join(", ")}.`);
      } else {
        setSuccessMessage("Post opublikowany!");
        resetForm();
      }
    } catch (err) {
      setSubmitError(err instanceof ApiError ? err.message : "Nie udało się opublikować posta.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSchedule = async () => {
    if (!scheduledFor) return;
    setSubmitError(null);
    setSuccessMessage(null);
    setIsSubmitting(true);
    try {
      const created = await savePost();
      await apiClient.post<PublishResponse>(`/api/posts/${created.id}/publish`, {
        mode: "schedule",
        scheduledFor: new Date(scheduledFor).toISOString(),
        storyTemplate,
        seriesName: storyTemplate === "series" ? seriesName.trim() : undefined,
      });
      setSuccessMessage("Post zaplanowany — pojawi się w kalendarzu pod wybraną datą.");
      resetForm();
    } catch (err) {
      setSubmitError(err instanceof ApiError ? err.message : "Nie udało się zaplanować publikacji.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const canPublish = platforms.length > 0 && platforms.every((p) => connectedPlatforms.includes(p));

  return (
    <div>
      <section className="card collapsible-card">
        <button
          type="button"
          className="collapsible-toggle"
          aria-expanded={isAiOpen}
          onClick={() => setIsAiOpen((prev) => !prev)}
        >
          <span>Generuj treść przez AI</span>
          <svg
            className={`collapsible-chevron${isAiOpen ? " open" : ""}`}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M6 9l6 6 6-6" />
          </svg>
        </button>
        {isAiOpen && (
          <div className="collapsible-body">
            <div className="sub-tabs">
              <button type="button" className={aiMode === "quick" ? "active" : ""} onClick={() => setAiMode("quick")}>
                Szybkie
              </button>
              <button
                type="button"
                className={aiMode === "precise" ? "active" : ""}
                onClick={() => setAiMode("precise")}
              >
                Dokładne
              </button>
            </div>

            {aiMode === "quick" ? (
              <>
                <div className="field">
                  <label htmlFor="aiTopic">Temat posta</label>
                  <input
                    id="aiTopic"
                    type="text"
                    value={aiTopic}
                    onChange={(e) => setAiTopic(e.target.value)}
                    placeholder="Np. promocja letnia w naszej kawiarni"
                  />
                </div>
                {aiError && <p className="error-text">{aiError}</p>}
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={handleGenerateWithAi}
                  disabled={isGenerating || !aiTopic.trim()}
                >
                  {isGenerating ? "Generowanie…" : "Generuj treść przez AI"}
                </button>
              </>
            ) : (
              <>
                <p className="hint-text">Napisz temat posta. AI dopyta Cię o szczegóły, a potem stworzy gotową treść.</p>

                {interviewHistory.length === 0 && !currentQuestion && !isInterviewDone && (
                  <div className="field">
                    <label htmlFor="interviewTopic">Temat posta</label>
                    <input
                      id="interviewTopic"
                      type="text"
                      value={interviewTopic}
                      onChange={(e) => setInterviewTopic(e.target.value)}
                      placeholder="Np. podnoszenie martwego ciągu"
                    />
                  </div>
                )}

                {currentQuestion && <p className="ai-question">{currentQuestion.question}</p>}

                {currentQuestion && (
                  <div className="ai-answer-list">
                    {currentQuestion.options.map((option) => (
                      <button
                        key={option}
                        type="button"
                        className={`ai-answer-option${selectedOption === option ? " selected" : ""}`}
                        onClick={() => {
                          setSelectedOption(option);
                          setIsCustomAnswerOpen(false);
                        }}
                        disabled={isInterviewLoading}
                      >
                        <span className="ai-answer-option-radio" />
                        {option}
                      </button>
                    ))}
                    <button
                      type="button"
                      className="ai-answer-option ai-answer-option-other"
                      onClick={() => {
                        setIsCustomAnswerOpen(true);
                        setSelectedOption(null);
                      }}
                      disabled={isInterviewLoading}
                    >
                      <span className="ai-answer-option-radio" />
                      Inna odpowiedź
                    </button>
                  </div>
                )}

                {currentQuestion && selectedOption && !isCustomAnswerOpen && (
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={() => handleAnswerQuestion(selectedOption)}
                    disabled={isInterviewLoading}
                  >
                    {isInterviewLoading ? "Wysyłanie…" : "Zatwierdź odpowiedź"}
                  </button>
                )}

                {currentQuestion && isCustomAnswerOpen && (
                  <form
                    className="field"
                    onSubmit={(e) => {
                      e.preventDefault();
                      handleAnswerQuestion(customAnswer);
                    }}
                  >
                    <input
                      type="text"
                      value={customAnswer}
                      onChange={(e) => setCustomAnswer(e.target.value)}
                      placeholder="Wpisz własną odpowiedź"
                      autoFocus
                    />
                    <button
                      type="submit"
                      className="btn btn-secondary"
                      disabled={isInterviewLoading || !customAnswer.trim()}
                      style={{ marginTop: 8 }}
                    >
                      Wyślij
                    </button>
                  </form>
                )}

                {interviewError && <p className="error-text">{interviewError}</p>}

                {isInterviewLoading && <p className="hint-text">AI analizuje odpowiedź…</p>}

                {isInterviewDone && (
                  <p className="hint-text success">
                    Gotowe! Wygenerowano treść posta (pewność {interviewConfidence}%). Znajdziesz ją poniżej w
                    formularzu.
                  </p>
                )}

                {!isInterviewDone && !currentQuestion && interviewHistory.length === 0 && (
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={handleStartInterview}
                    disabled={isInterviewLoading || !interviewTopic.trim()}
                  >
                    {isInterviewLoading ? "Rozpoczynanie…" : "Rozpocznij rozmowę z AI"}
                  </button>
                )}

                {isInterviewDone && (
                  <button type="button" className="btn btn-secondary" onClick={resetInterview}>
                    Zacznij od nowa
                  </button>
                )}
              </>
            )}
          </div>
        )}
      </section>

      <section className="card">
        <h2>Stwórz posta social media</h2>
        <form onSubmit={handleSaveDraft}>
          <div className="form-section form-section-first">
            <p className="form-section-title">Treść posta</p>
            <div className="field">
              <label htmlFor="heading">Tytuł</label>
              <input id="heading" type="text" value={heading} onChange={(e) => setHeading(e.target.value)} required />
            </div>

            <div className="field">
              <label htmlFor="content">Treść</label>
              <textarea id="content" value={content} onChange={(e) => setContent(e.target.value)} required />
            </div>
          </div>

          <div className="form-section">
            <p className="form-section-title">Zdjęcia</p>
            <div className="field">
              <div className="field-label-row">
                <label>Zdjęcia</label>
                <InfoTip text="Zdjęcia o nietypowych proporcjach są automatycznie przycinane do formatu zgodnego z Instagramem." />
              </div>
              <label htmlFor="photos" className="photo-picker-button">
                Dodaj zdjęcia
              </label>
              <input
                id="photos"
                type="file"
                accept="image/*"
                multiple
                onChange={handlePhotosChange}
                disabled={isUploadingPhotos}
                style={{ display: "none" }}
              />
              {isUploadingPhotos && <p className="hint-text">Wgrywanie zdjęć…</p>}
              {uploadError && <p className="error-text">{uploadError}</p>}
              {photoPreviews.length > 0 && (
                <div className="photo-grid">
                  {photoPreviews.map((src, index) => (
                    <div key={src} className="photo-thumb">
                      <img src={src} alt="Podgląd zdjęcia" />
                      <button
                        type="button"
                        className="photo-thumb-remove"
                        aria-label="Usuń zdjęcie"
                        onClick={() => handleRemovePhoto(index)}
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>
              )}
              <div className="carousel-actions">
                <button type="button" className="btn btn-secondary" onClick={handleOpenCarouselEditor}>
                  {carouselSlides.length > 0 ? "Edytuj karuzelę" : "Wygeneruj karuzelę"}
                </button>
                {carouselSlides.length > 0 && (
                  <button type="button" className="btn-text" onClick={handleRemoveCarousel}>
                    Usuń karuzelę
                  </button>
                )}
              </div>
              {carouselSlides.length > 0 && (
                <p className="hint-text">
                  Zdjęcia powyżej to wygenerowane slajdy karuzeli ({carouselSlides.length}) - ręcznie dodane zdjęcia
                  zastąpią je przy publikacji.
                </p>
              )}
            </div>
          </div>

          <div className="collapsible-inline">
            <button
              type="button"
              className="collapsible-toggle"
              aria-expanded={isMoreOptionsOpen}
              onClick={() => setIsMoreOptionsOpen((prev) => !prev)}
            >
              <span>Więcej opcji (pierwszy komentarz, szablon relacji)</span>
              <svg
                className={`collapsible-chevron${isMoreOptionsOpen ? " open" : ""}`}
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M6 9l6 6 6-6" />
              </svg>
            </button>
            {isMoreOptionsOpen && (
              <div className="collapsible-body">
                <div className="field">
                  <div className="field-label-row">
                    <label htmlFor="firstComment">Pierwszy komentarz</label>
                    <InfoTip text="Działa tylko na Facebooku i LinkedIn. Instagram (i inne platformy) nie obsługuje automatycznego pierwszego komentarza." />
                  </div>
                  <textarea
                    id="firstComment"
                    value={firstComment}
                    onChange={(e) => setFirstComment(e.target.value)}
                    placeholder="Opcjonalnie"
                  />
                </div>

                <div className="field">
                  <div className="field-label-row">
                    <label htmlFor="storyTemplate">Szablon relacji (Instagram Story)</label>
                    <InfoTip text="Dotyczy tylko relacji publikowanej automatycznie na Instagramie razem z postem. Domyślnie to po prostu to samo zdjęcie co w poście, bez żadnej grafiki." />
                  </div>
                  <select
                    id="storyTemplate"
                    value={storyTemplate}
                    onChange={(e) => {
                      setStoryTemplate(e.target.value as StoryTemplate);
                      setTemplatePreviewUrl(null);
                      setTemplatePreviewError(null);
                    }}
                  >
                    <option value="none">Brak (surowe zdjęcie)</option>
                    <option value="new_post">Nowy post</option>
                    <option value="series">Seria</option>
                  </select>
                  {storyTemplate === "series" && (
                    <input
                      type="text"
                      value={seriesName}
                      onChange={(e) => setSeriesName(e.target.value)}
                      placeholder="Nazwa serii, np. Trening w domu #3"
                    />
                  )}
                </div>
              </div>
            )}
          </div>

          <div className="form-section">
            <p className="form-section-title">Platformy i publikacja</p>
            <div className="field">
              <label>Platformy</label>
              {isLoadingAccounts ? (
                <p className="hint-text">Ładowanie połączonych kont…</p>
              ) : connectedPlatforms.length === 0 ? (
                <p className="card-muted-text">
                  Nie masz jeszcze podłączonych kont. <Link to="/konta">Połącz konto</Link>, żeby móc publikować.
                </p>
              ) : (
                <div>
                  {connectedPlatforms.map((platform) => (
                    <span
                      key={platform}
                      className="tag-pill"
                      style={{
                        cursor: "pointer",
                        background: platforms.includes(platform) ? "var(--color-primary)" : "var(--color-primary-tint)",
                        color: platforms.includes(platform) ? "#fff" : "var(--color-primary)",
                      }}
                      onClick={() => togglePlatform(platform)}
                    >
                      {platform}
                    </span>
                  ))}
                </div>
              )}
            </div>

            {submitError && <p className="error-text">{submitError}</p>}
            {successMessage && <p className="hint-text success">{successMessage}</p>}
            {!canPublish && connectedPlatforms.length > 0 && platforms.length === 0 && (
              <p className="hint-text">Wybierz co najmniej jedną platformę powyżej, żeby móc zaplanować lub opublikować post.</p>
            )}
            {!canPublish && platforms.length > 0 && (
              <p className="note-banner">Wśród wybranych platform jest taka bez podłączonego konta, więc publikacja od razu jest niedostępna.</p>
            )}

            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button type="submit" className="btn btn-secondary" disabled={isSubmitting || isUploadingPhotos}>
                {isSubmitting ? "Zapisywanie…" : "Zapisz jako szkic"}
              </button>
              <button
                type="button"
                className="btn btn-secondary"
                disabled={isSubmitting || isUploadingPhotos || !canPublish}
                onClick={() => setIsScheduleModalOpen(true)}
              >
                Zaplanuj publikację
              </button>
              <button
                type="button"
                className="btn"
                disabled={isSubmitting || isUploadingPhotos || !canPublish}
                onClick={handlePublishNow}
              >
                {isSubmitting ? "Publikowanie…" : "Opublikuj teraz"}
              </button>
            </div>
          </div>
        </form>
      </section>

      <section className="card">
        <h2>Podgląd posta</h2>
        <PostPreview
          heading={heading}
          content={content}
          firstComment={firstComment}
          imageUrls={storyTemplate !== "none" && templatePreviewUrl ? [templatePreviewUrl] : photoPreviews}
        />
        {storyTemplate !== "none" && isLoadingTemplatePreview && (
          <p className="hint-text" style={{ marginTop: 8 }}>
            Generowanie podglądu szablonu…
          </p>
        )}
        {storyTemplate !== "none" && templatePreviewError && <p className="error-text">{templatePreviewError}</p>}
      </section>

      {isCarouselEditorOpen && (
        <CarouselSlideEditor
          initialSlides={carouselSlides}
          onClose={() => setIsCarouselEditorOpen(false)}
          onSave={(rendered, uploaded, slides) => {
            setCarouselSlides(slides);
            setPhotoPreviews(rendered);
            setMediaUrls(uploaded);
            setIsCarouselEditorOpen(false);
          }}
        />
      )}

      {isScheduleModalOpen && (
        <Modal title="Zaplanuj publikację" onClose={() => setIsScheduleModalOpen(false)}>
          <div className="field">
            <label htmlFor="scheduledFor">Data i godzina publikacji</label>
            <input
              id="scheduledFor"
              type="datetime-local"
              value={scheduledFor}
              min={nowLocal}
              onChange={(e) => setScheduledFor(e.target.value)}
              autoFocus
            />
          </div>
          {submitError && <p className="error-text">{submitError}</p>}
          <div className="modal-actions">
            <button type="button" className="btn btn-secondary" onClick={() => setIsScheduleModalOpen(false)}>
              Anuluj
            </button>
            <button type="button" className="btn" disabled={isSubmitting || !scheduledFor} onClick={handleSchedule}>
              {isSubmitting ? "Planowanie…" : "Zaplanuj"}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
