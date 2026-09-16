import { useState, useEffect, useRef } from 'react';

// A single failed load (slow/flaky exam-hall wifi, a transient CDN hiccup)
// used to just hide the image forever with no sign anything was wrong.
// Retry a couple of times with backoff first, and if it truly can't load,
// show a visible, clickable placeholder instead of silently vanishing.
export default function ImgWithFallback({ src, alt, className }) {
  const [attempt, setAttempt] = useState(0);
  const [failed, setFailed] = useState(false);
  const retryTimerRef = useRef(null);

  useEffect(() => {
    setAttempt(0);
    setFailed(false);
  }, [src]);

  useEffect(() => () => {
    if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
  }, []);

  if (!src) return null;

  const handleError = () => {
    if (attempt < 2) {
      retryTimerRef.current = setTimeout(() => setAttempt(a => a + 1), 1200 * (attempt + 1));
    } else {
      setFailed(true);
    }
  };

  if (failed) {
    return (
      <button
        type="button"
        onClick={() => { setFailed(false); setAttempt(a => a + 1); }}
        className="flex items-center gap-2 text-xs text-annotation border border-dashed border-rim rounded-lg px-3 py-2.5 hover:text-accent hover:border-accent transition-colors"
      >
        <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
        </svg>
        Image failed to load — tap to retry
      </button>
    );
  }

  // Cache-bust on retry so a flaky proxy that cached the failed response
  // doesn't just hand back the same failure.
  const attemptSrc = attempt === 0 ? src : `${src}${src.includes('?') ? '&' : '?'}_retry=${attempt}`;

  return <img key={attemptSrc} src={attemptSrc} alt={alt} loading="lazy" className={className} onError={handleError} />;
}
