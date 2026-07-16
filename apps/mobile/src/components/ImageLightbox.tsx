// Full-screen, uncropped image viewer - used wherever a thumbnail is shown
// with object-fit: cover (so part of the image is cut off) and the user
// needs to see the whole thing, e.g. the Inspiracje trending feed. `caption`
// is optional so callers with nothing to show (e.g. no post text) can omit it.
export function ImageLightbox({
  src,
  alt,
  caption,
  onClose,
}: {
  src: string;
  alt: string;
  caption?: string;
  onClose: () => void;
}) {
  return (
    <div className="lightbox-overlay" onClick={onClose}>
      <button type="button" className="lightbox-close" aria-label="Zamknij" onClick={onClose}>
        ×
      </button>
      <div className="lightbox-content" onClick={(e) => e.stopPropagation()}>
        <img src={src} alt={alt} className="lightbox-image" />
        {caption && <p className="lightbox-caption">{caption}</p>}
      </div>
    </div>
  );
}
