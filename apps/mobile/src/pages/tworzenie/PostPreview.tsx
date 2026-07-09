import { useState } from "react";
import {
  BookmarkIcon,
  CommentIcon,
  GlobeIcon,
  HeartIcon,
  MoreIcon,
  RepeatIcon,
  SendIcon,
  ShareIcon,
  ThumbsUpIcon,
} from "../../components/SocialIcons";

interface PostPreviewProps {
  heading: string;
  content: string;
  firstComment: string;
  imageUrl?: string;
}

type PreviewPlatform = "instagram" | "facebook" | "linkedin" | "x";

const TABS: { key: PreviewPlatform; label: string }[] = [
  { key: "instagram", label: "Instagram" },
  { key: "facebook", label: "Facebook" },
  { key: "linkedin", label: "LinkedIn" },
  { key: "x", label: "X" },
];

// Mirrors how the backend actually builds the caption for Zernio (heading +
// content combined - see routes/posts.ts) since none of these 4 platforms
// have a separate visible "title" field for a normal post.
function combinedText(heading: string, content: string): string {
  return [heading, content].filter(Boolean).join("\n\n");
}

function Avatar({ label }: { label: string }) {
  return <div className="preview-avatar">{label}</div>;
}

function InstagramPreview({ heading, content, firstComment, imageUrl }: PostPreviewProps) {
  const text = combinedText(heading, content);
  return (
    <div className="preview-card preview-ig">
      <div className="preview-header">
        <Avatar label="M" />
        <div className="preview-header-text">
          <span className="preview-name">twojafirma</span>
        </div>
        <MoreIcon className="preview-icon" />
      </div>
      <div className="preview-ig-image">
        {imageUrl ? <img src={imageUrl} alt="" /> : <span className="preview-image-placeholder">Zdjęcie</span>}
      </div>
      <div className="preview-actions-row">
        <HeartIcon className="preview-icon" />
        <CommentIcon className="preview-icon" />
        <SendIcon className="preview-icon" />
        <BookmarkIcon className="preview-icon preview-icon-end" />
      </div>
      <p className="preview-likes">Bądź pierwszym, który to polubi</p>
      <p className="preview-text">
        <strong>twojafirma</strong> {text || "Treść posta pojawi się tutaj…"}
      </p>
      {firstComment && (
        <p className="preview-hint-inline">
          Pierwszy komentarz nie zostanie dodany automatycznie na Instagramie (Zernio tego nie obsługuje).
        </p>
      )}
    </div>
  );
}

function FacebookPreview({ heading, content, firstComment, imageUrl }: PostPreviewProps) {
  const text = combinedText(heading, content);
  return (
    <div className="preview-card preview-fb">
      <div className="preview-header">
        <Avatar label="M" />
        <div className="preview-header-text">
          <span className="preview-name">Twoja strona</span>
          <span className="preview-meta">Przed chwilą · 🌐</span>
        </div>
        <MoreIcon className="preview-icon" />
      </div>
      <p className="preview-text">{text || "Treść posta pojawi się tutaj…"}</p>
      {imageUrl && (
        <div className="preview-image-wrap">
          <img src={imageUrl} alt="" />
        </div>
      )}
      <div className="preview-actions-row preview-actions-row--bordered">
        <span className="preview-action">
          <ThumbsUpIcon className="preview-icon" /> Lubię to!
        </span>
        <span className="preview-action">
          <CommentIcon className="preview-icon" /> Komentarz
        </span>
        <span className="preview-action">
          <ShareIcon className="preview-icon" /> Udostępnij
        </span>
      </div>
      {firstComment && <p className="preview-hint-inline preview-comment">💬 Pierwszy komentarz: {firstComment}</p>}
    </div>
  );
}

function LinkedinPreview({ heading, content, firstComment, imageUrl }: PostPreviewProps) {
  const text = combinedText(heading, content);
  return (
    <div className="preview-card preview-li">
      <div className="preview-header">
        <Avatar label="M" />
        <div className="preview-header-text">
          <span className="preview-name">Twoja firma</span>
          <span className="preview-meta">Strona firmowa</span>
          <span className="preview-meta">
            Przed chwilą · <GlobeIcon className="preview-icon-inline" />
          </span>
        </div>
        <MoreIcon className="preview-icon" />
      </div>
      <p className="preview-text">{text || "Treść posta pojawi się tutaj…"}</p>
      {imageUrl && (
        <div className="preview-image-wrap">
          <img src={imageUrl} alt="" />
        </div>
      )}
      <div className="preview-actions-row preview-actions-row--bordered">
        <span className="preview-action">
          <ThumbsUpIcon className="preview-icon" /> Lubię to
        </span>
        <span className="preview-action">
          <CommentIcon className="preview-icon" /> Komentarz
        </span>
        <span className="preview-action">
          <RepeatIcon className="preview-icon" /> Udostępnij
        </span>
        <span className="preview-action">
          <SendIcon className="preview-icon" /> Wyślij
        </span>
      </div>
      {firstComment && <p className="preview-hint-inline preview-comment">💬 Pierwszy komentarz: {firstComment}</p>}
    </div>
  );
}

function XPreview({ heading, content, firstComment, imageUrl }: PostPreviewProps) {
  const text = combinedText(heading, content);
  return (
    <div className="preview-card preview-x">
      <div className="preview-header">
        <Avatar label="M" />
        <div className="preview-header-text preview-header-text--row">
          <span className="preview-name">Twoja firma</span>
          <span className="preview-meta">@twojafirma · teraz</span>
        </div>
      </div>
      <p className="preview-text">{text || "Treść posta pojawi się tutaj…"}</p>
      {imageUrl && (
        <div className="preview-image-wrap preview-image-wrap--rounded">
          <img src={imageUrl} alt="" />
        </div>
      )}
      <div className="preview-actions-row preview-actions-row--spread">
        <CommentIcon className="preview-icon" />
        <RepeatIcon className="preview-icon" />
        <HeartIcon className="preview-icon" />
        <ShareIcon className="preview-icon" />
      </div>
      {firstComment && (
        <p className="preview-hint-inline">Pierwszy komentarz nie jest obsługiwany przez Zernio na X.</p>
      )}
    </div>
  );
}

const PREVIEW_COMPONENTS: Record<PreviewPlatform, (props: PostPreviewProps) => JSX.Element> = {
  instagram: InstagramPreview,
  facebook: FacebookPreview,
  linkedin: LinkedinPreview,
  x: XPreview,
};

export function PostPreview(props: PostPreviewProps) {
  const [platform, setPlatform] = useState<PreviewPlatform>("instagram");
  const ActivePreview = PREVIEW_COMPONENTS[platform];

  return (
    <div>
      <div className="sub-tabs">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            type="button"
            className={platform === tab.key ? "active" : ""}
            onClick={() => setPlatform(tab.key)}
          >
            {tab.label}
          </button>
        ))}
      </div>
      <ActivePreview {...props} />
    </div>
  );
}
