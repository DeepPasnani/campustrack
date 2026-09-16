import { useState, useEffect, useCallback, useRef } from 'react';
import { Btn } from './UI';

const FULLSCREEN_THRESHOLD = 3;
const COUNTDOWN_SECONDS = 10;

export default function FullScreenEnforcer({ onViolation, onThresholdExceeded, enabled }) {
  const [fsWarning, setFsWarning] = useState(false);
  const [countdown, setCountdown] = useState(COUNTDOWN_SECONDS);
  const [exitCount, setExitCount] = useState(0);
  const countdownRef = useRef(null);
  const hasSubmittedRef = useRef(false);

  const requestFullscreen = useCallback(() => {
    try {
      const el = document.documentElement;
      if (el.requestFullscreen) {
        el.requestFullscreen();
      } else if (el.webkitRequestFullscreen) {
        el.webkitRequestFullscreen();
      } else if (el.msRequestFullscreen) {
        el.msRequestFullscreen();
      }
    } catch {
      // Fullscreen may not be available
    }
  }, []);

  const exitFullscreen = useCallback(() => {
    try {
      if (document.fullscreenElement) {
        document.exitFullscreen();
      }
    } catch {}
  }, []);

  useEffect(() => {
    if (!enabled) return;
    requestFullscreen();
  }, [enabled, requestFullscreen]);

  useEffect(() => {
    if (!enabled) return;

    const handleFSChange = () => {
      const isFS = !!(
        document.fullscreenElement ||
        document.webkitFullscreenElement ||
        document.msFullscreenElement
      );

      if (!isFS && !hasSubmittedRef.current) {
        const newCount = exitCount + 1;
        setExitCount(newCount);
        onViolation?.(newCount);

        if (newCount >= FULLSCREEN_THRESHOLD) {
          hasSubmittedRef.current = true;
          onThresholdExceeded?.();
          return;
        }

        setFsWarning(true);
        setCountdown(COUNTDOWN_SECONDS);

        if (countdownRef.current) clearInterval(countdownRef.current);
        countdownRef.current = setInterval(() => {
          setCountdown(prev => {
            if (prev <= 1) {
              clearInterval(countdownRef.current);
              countdownRef.current = null;
              if (!hasSubmittedRef.current) {
                hasSubmittedRef.current = true;
                onThresholdExceeded?.();
              }
              return 0;
            }
            return prev - 1;
          });
        }, 1000);
      }
    };

    document.addEventListener('fullscreenchange', handleFSChange);
    document.addEventListener('webkitfullscreenchange', handleFSChange);
    document.addEventListener('msfullscreenchange', handleFSChange);

    return () => {
      document.removeEventListener('fullscreenchange', handleFSChange);
      document.removeEventListener('webkitfullscreenchange', handleFSChange);
      document.removeEventListener('msfullscreenchange', handleFSChange);
      if (countdownRef.current) clearInterval(countdownRef.current);
    };
  }, [enabled, exitCount, onViolation, onThresholdExceeded]);

  const handleReturnToFullscreen = () => {
    requestFullscreen();
    setFsWarning(false);
    if (countdownRef.current) {
      clearInterval(countdownRef.current);
      countdownRef.current = null;
    }
  };

  if (!fsWarning) return null;

  return (
    <div className="fixed inset-0 z-[9999] bg-black/90 flex flex-col items-center justify-center gap-6 animate-fade-in">
      <div className="w-16 h-16 rounded-full bg-alert/20 flex items-center justify-center">
        <svg className="w-8 h-8 text-alert" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" />
        </svg>
      </div>
      <h2 className="text-xl font-display font-bold text-white">Return to Full Screen</h2>
      <p className="text-sm text-white/60 text-center max-w-xs">
        Exiting fullscreen is not allowed during the test.
        {exitCount >= 2 && (
          <span className="block mt-1 text-alert font-bold">
            Warning {exitCount}/{FULLSCREEN_THRESHOLD} — auto-submit on next exit
          </span>
        )}
      </p>

      <div className="flex flex-col items-center gap-2">
        <Btn
          variant="primary"
          size="lg"
          onClick={handleReturnToFullscreen}
          className="min-w-[200px]"
        >
          Return to Full Screen ({countdown}s)
        </Btn>
        <p className="text-sm text-white/85 font-medium">
          Test will auto-submit in {countdown} seconds
        </p>
      </div>
    </div>
  );
}
