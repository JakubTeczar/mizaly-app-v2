// Full-screen, uncropped image viewer - used wherever a thumbnail is shown
// with object-fit: cover (so part of the image is cut off) and the user
// needs to see the whole thing, e.g. the Inspiracje trending feed.
export function ImageLightbox({ src, alt, onClose }: { src: string; alt: string; onClose: () => void }) {
  return (
    <div className="lightbox-overlay" onClick={onClose}>
      <button type="button" className="lightbox-close" aria-label="Zamknij" onClick={onClose}>
        ×
      </button>
      <img src={src} alt={alt} className="lightbox-image" onClick={(e) => e.stopPropagation()} />
    </div>
  );
}
