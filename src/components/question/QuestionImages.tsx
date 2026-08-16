/**
 * For 194 of the 440 cards the image *is* the question — the options and the
 * answer area were never in the text. So these render large, and any of them
 * can be opened full-size in an in-page overlay. No browser dialog, no new tab.
 */
import { useEffect, useRef, useState } from 'react';
import { imageUrl } from '../../lib/bank';

interface Props {
  images: string[];
  questionId: number;
  /** Overridden for the case where the image carries the options, not the answer. */
  caption?: string;
}

const altFor = (questionId: number, index: number, total: number): string =>
  total > 1
    ? `Answer area for question ${questionId}, image ${index + 1} of ${total}`
    : `Answer area for question ${questionId}`;

export function QuestionImages({ images, questionId, caption }: Props) {
  const [zoomed, setZoomed] = useState<number | null>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const openerRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (zoomed === null) return;
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setZoomed(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [zoomed]);

  if (images.length === 0) return null;

  const close = () => {
    setZoomed(null);
    openerRef.current?.focus();
  };

  return (
    <div className="qimages">
      {caption ? <span className="label">{caption}</span> : null}
      {images.map((path, i) => (
        <button
          key={path}
          type="button"
          className="qimage-btn"
          title="Open full size"
          onClick={(e) => {
            openerRef.current = e.currentTarget;
            setZoomed(i);
          }}
        >
          <img
            className="qimage"
            src={imageUrl(path)}
            alt={altFor(questionId, i, images.length)}
            loading="lazy"
          />
        </button>
      ))}

      {zoomed !== null && images[zoomed] ? (
        <div
          className="qzoom"
          role="dialog"
          aria-modal="true"
          aria-label={`Full size ${altFor(questionId, zoomed, images.length)}`}
          onClick={close}
        >
          <div className="qzoom-bar" onClick={(e) => e.stopPropagation()}>
            <button ref={closeRef} type="button" className="btn btn-sm" onClick={close}>
              Close
            </button>
            <span className="tiny faint">
              Question {questionId}
              {images.length > 1 ? ` — image ${zoomed + 1} of ${images.length}` : ''}. Press{' '}
              <kbd>Esc</kbd> or click anywhere to close.
            </span>
          </div>
          <img
            src={imageUrl(images[zoomed])}
            alt={altFor(questionId, zoomed, images.length)}
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      ) : null}
    </div>
  );
}
