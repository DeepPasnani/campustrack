import { useState, useEffect, useRef, useCallback } from 'react';
import Editor from '@monaco-editor/react';
import { codeOpsAPI } from '../../services/api';
import { Btn, Spinner } from './UI';

const LANG_MAP = {
  python: 'python',
  javascript: 'javascript',
  java: 'java',
  cpp: 'cpp',
  c: 'c',
  sql: 'sql',
};

export default function CodePlayback({ submissionId }) {
  const [snapshots, setSnapshots] = useState([]);
  const [stats, setStats] = useState(null);
  const [currentIdx, setCurrentIdx] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const timerRef = useRef(null);

  useEffect(() => {
    if (!submissionId) return;
    setLoading(true);
    codeOpsAPI.getPlayback(submissionId)
      .then(data => {
        setSnapshots(data.snapshots || []);
        setStats(data.stats || null);
        setCurrentIdx(0);
      })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, [submissionId]);

  const stopPlayback = useCallback(() => {
    setPlaying(false);
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  const togglePlay = useCallback(() => {
    if (playing) {
      stopPlayback();
      return;
    }
    if (currentIdx >= snapshots.length - 1) {
      setCurrentIdx(0);
    }
    setPlaying(true);
  }, [playing, currentIdx, snapshots.length, stopPlayback]);

  useEffect(() => {
    if (!playing || snapshots.length < 2) return;

    const playNext = () => {
      setCurrentIdx(prev => {
        if (prev >= snapshots.length - 1) {
          setPlaying(false);
          return prev;
        }
        const next = prev + 1;
        const currentTime = new Date(snapshots[prev].created_at).getTime();
        const nextTime = new Date(snapshots[next].created_at).getTime();
        const diff = Math.max(50, Math.min(2000, (nextTime - currentTime) / speed));

        timerRef.current = setTimeout(playNext, diff);
        return next;
      });
    };

    const currentTime = new Date(snapshots[currentIdx].created_at).getTime();
    let nextTime;
    if (currentIdx + 1 < snapshots.length) {
      nextTime = new Date(snapshots[currentIdx + 1].created_at).getTime();
    } else {
      setPlaying(false);
      return;
    }
    const diff = Math.max(50, Math.min(2000, (nextTime - currentTime) / speed));
    timerRef.current = setTimeout(playNext, diff);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [playing, currentIdx, snapshots, speed]);

  const handleScrub = (e) => {
    const idx = parseInt(e.target.value);
    setCurrentIdx(idx);
    if (playing) stopPlayback();
  };

  if (loading) {
    return (
      <div className="flex justify-center py-12">
        <Spinner size={24} className="text-accent" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-center py-8 text-alert text-sm">
        Failed to load playback: {error}
      </div>
    );
  }

  if (!snapshots.length) {
    return (
      <div className="text-center py-8 text-annotation text-sm">
        No code snapshots available for this submission.
      </div>
    );
  }

  const current = snapshots[currentIdx];
  const lang = LANG_MAP[current?.language] || 'text';

  const formatTime = (ms) => {
    const totalSec = Math.floor(ms / 1000);
    const m = Math.floor(totalSec / 60);
    const s = totalSec % 60;
    return `${m}:${String(s).padStart(2, '0')}`;
  };

  return (
    <div className="flex flex-col">
      {/* Stats bar */}
      {stats && (
        <div className="grid grid-cols-5 gap-2 mb-3 p-3 bg-panel rounded-lg border border-rim text-xs">
          <div className="text-center">
            <div className="font-mono font-bold text-ink">{stats.totalSnapshots}</div>
            <div className="text-annotation/60 text-2xs">Snapshots</div>
          </div>
          <div className="text-center">
            <div className="font-mono font-bold text-ink">{stats.pasteCount}</div>
            <div className="text-annotation/60 text-2xs">Pastes</div>
          </div>
          <div className="text-center">
            <div className="font-mono font-bold text-ink">{formatTime(stats.timeSpentMs)}</div>
            <div className="text-annotation/60 text-2xs">Time</div>
          </div>
          <div className="text-center">
            <div className="font-mono font-bold text-verify">+{stats.linesAdded}</div>
            <div className="text-annotation/60 text-2xs">Added</div>
          </div>
          <div className="text-center">
            <div className="font-mono font-bold text-alert">-{stats.linesRemoved}</div>
            <div className="text-annotation/60 text-2xs">Removed</div>
          </div>
        </div>
      )}

      {/* Editor */}
      <div className="border border-rim rounded-lg overflow-hidden mb-3" style={{ minHeight: 300 }}>
        <Editor
          height="300px"
          language={lang}
          theme="light"
          value={current?.code || ''}
          options={{
            readOnly: true,
            minimap: { enabled: false },
            fontSize: 12,
            lineNumbers: 'on',
            scrollBeyondLastLine: false,
            automaticLayout: true,
            tabSize: 2,
            renderLineHighlight: 'none',
            glyphMargin: false,
            folding: true,
            lineDecorationsWidth: 8,
            lineNumbersMinChars: 3,
          }}
        />
      </div>

      {/* Timeline scrub bar */}
      <div className="flex items-center gap-3 mb-2">
        <Btn variant="ghost" size="xs" onClick={togglePlay}>
          {playing ? (
            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
              <rect x="6" y="4" width="4" height="16" />
              <rect x="14" y="4" width="4" height="16" />
            </svg>
          ) : (
            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
              <polygon points="5,3 19,12 5,21" />
            </svg>
          )}
        </Btn>

        <span className="text-2xs font-mono text-annotation min-w-[3rem]">
          {currentIdx + 1}/{snapshots.length}
        </span>

        <input
          type="range"
          min={0}
          max={snapshots.length - 1}
          value={currentIdx}
          onChange={handleScrub}
          className="flex-1 h-1 accent-accent cursor-pointer"
        />

        <span className="text-2xs font-mono text-annotation min-w-[3rem] text-right">
          {current?.created_at ? new Date(current.created_at).toLocaleTimeString() : ''}
        </span>

        {/* Speed control */}
        <select
          value={speed}
          onChange={e => setSpeed(parseFloat(e.target.value))}
          className="text-xs border border-rim rounded px-1 py-0.5 bg-panel text-ink"
        >
          <option value={0.5}>0.5x</option>
          <option value={1}>1x</option>
          <option value={2}>2x</option>
          <option value={4}>4x</option>
        </select>
      </div>

      {/* Snapshot type badges */}
      <div className="flex items-center gap-1 flex-wrap">
        {snapshots.slice(Math.max(0, currentIdx - 2), currentIdx + 3).map((s, i) => {
          const realIdx = Math.max(0, currentIdx - 2) + i;
          const isActive = realIdx === currentIdx;
          const typeColors = {
            keystroke: 'bg-accent/10 text-accent',
            paste: 'bg-verify/10 text-verify',
            auto: 'bg-annotation/10 text-annotation',
            manual: 'bg-clarify/10 text-clarify',
          };
          return (
            <span
              key={s.id}
              className={`text-2xs px-1.5 py-0.5 rounded font-mono ${typeColors[s.snapshot_type] || 'bg-annotation/10 text-annotation'} ${isActive ? 'ring-1 ring-accent' : ''}`}
            >
              {s.snapshot_type}
            </span>
          );
        })}
        {snapshots.length > 5 && <span className="text-2xs text-annotation/40">⋯</span>}
      </div>
    </div>
  );
}
