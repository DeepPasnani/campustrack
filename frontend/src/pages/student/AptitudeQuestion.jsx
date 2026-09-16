import { useState } from 'react';
import { Btn } from '../../components/shared/UI';
import ImgWithFallback from '../../components/shared/ImgWithFallback';

function DifficultyBadge({ level }) {
  const map = {
    easy:   'badge-verify',
    medium: 'badge-accent',
    hard:   'badge-alert',
  };
  const cls = map[level] || 'badge-annotation';
  return <span className={cls}>{level}</span>;
}

function CodeBlock({ text }) {
  const parts = text.split(/(```[\s\S]*?```)/g);
  return parts.map((part, i) => {
    if (part.startsWith('```') && part.endsWith('```')) {
      const inner = part.slice(3, -3).trim();
      const langMatch = inner.match(/^(\w+)\n/);
      const lang = langMatch ? langMatch[1] : '';
      const code = langMatch ? inner.slice(langMatch[0].length) : inner;
      return (
        <pre key={i} className="bg-deck border border-rim rounded-lg p-3 my-2 overflow-x-auto text-sm">
          {lang && <div className="text-2xs text-annotation font-mono mb-1">{lang}</div>}
          <code className="text-ink leading-relaxed whitespace-pre font-mono text-xs">{code}</code>
        </pre>
      );
    }
    return <span key={i}>{part}</span>;
  });
}

function AptitudeQuestion({
  q, qi, answers, setAnswer, flagged, toggleFlag,
  isAnswered, onPrev, onNext, isLast, onConfirmSubmit,
  optionOrders, sectionId, timeBomb,
}) {
  const optOrder = optionOrders?.[sectionId]?.[q.id];
  const options = q.options || [];
  const displayOptions = optOrder ? optOrder.map(i => options[i]) : options;
  const displayIndices = optOrder || options.map((_, i) => i);

  return (
    <div className="max-w-3xl mx-auto p-4 sm:p-5 animate-fade-up">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <span className="text-xs font-mono font-bold text-annotation">Q{qi + 1}</span>
          <DifficultyBadge level={q.difficulty} />
          <span className="badge-clarify">{q.marks} marks</span>
          {q.type === 'msq' && <span className="badge-accent">multi-select</span>}
          {timeBomb?.enabled && !timeBomb.expired && (
            <span className={`flex items-center gap-1 px-1.5 py-0.5 rounded text-2xs font-mono font-bold ${
              timeBomb.expiresInSeconds <= 30 ? 'bg-alert/15 text-alert animate-pulse' : 'bg-accent/15 text-accent'
            }`}>
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              {Math.floor(timeBomb.expiresInSeconds / 60)}:{String(timeBomb.expiresInSeconds % 60).padStart(2, '0')}
            </span>
          )}
        </div>
        <button
          onClick={() => toggleFlag(q.id)}
          className={`flex items-center gap-1 text-xs px-2 py-1 rounded-md transition-colors font-medium ${
            flagged.has(q.id)
              ? 'bg-accent/15 text-accent'
              : 'text-annotation hover:bg-panel hover:text-ink'
          }`}
        >
          <svg className="w-3.5 h-3.5" fill={flagged.has(q.id) ? 'currentColor' : 'none'} viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" d="M3 21V4a1 1 0 011-1h12a1 1 0 01.8.4l2 2.6a1 1 0 010 1.2l-2 2.6A1 1 0 0116 10H4m7 11l-3-3m0 0l3-3m-3 3h10" />
          </svg>
          {flagged.has(q.id) ? 'Flagged' : 'Flag'}
        </button>
      </div>

      <div className="panel p-4 mb-4">
        <div className="text-sm leading-relaxed whitespace-pre-wrap text-ink">
          <CodeBlock text={q.text} />
        </div>
        <ImgWithFallback
          src={q.image_url}
          alt="Question reference"
          className="mt-3 max-w-full max-h-56 rounded-lg object-contain border border-rim"
        />
      </div>

      {timeBomb?.expired && (q.type === 'mcq' || q.type === 'msq') && (
        <div className="p-4 mb-4 bg-alert/5 rounded-lg border border-alert/20 text-center">
          <p className="text-sm text-alert font-medium">This question has expired</p>
          <p className="text-xs text-annotation mt-1">The time limit for this question has passed.</p>
        </div>
      )}

      {!timeBomb?.expired && (q.type === 'mcq' || q.type === 'msq') && (
        <div className="space-y-2 mb-4">
          {displayOptions.map((opt, i) => {
            const originalIdx = displayIndices[i];
            const sel =
              q.type === 'msq'
                ? Array.isArray(answers[q.id]) && answers[q.id].includes(originalIdx)
                : answers[q.id] === originalIdx;
            return (
              <label
                key={i}
                className={`flex items-start gap-3 p-3.5 rounded-lg border cursor-pointer transition-all ${
                  sel
                    ? 'border-accent bg-accent/8'
                    : 'border-rim bg-panel hover:border-annotation/30'
                }`}
              >
                <input
                  type={q.type === 'msq' ? 'checkbox' : 'radio'}
                  name={`q_${q.id}`}
                  checked={sel}
                  onChange={() => {
                    if (q.type === 'msq') {
                      const cur = Array.isArray(answers[q.id]) ? [...answers[q.id]] : [];
                      const idx = cur.indexOf(originalIdx);
                      idx > -1 ? cur.splice(idx, 1) : cur.push(originalIdx);
                      setAnswer(q.id, cur);
                    } else {
                      setAnswer(q.id, originalIdx);
                    }
                  }}
                  className="mt-0.5 accent-accent shrink-0 w-4 h-4"
                />
                <div className="min-w-0">
                  <span className="text-sm text-ink">
                    <span className="font-mono text-annotation mr-1.5">{String.fromCharCode(65 + i)}.</span>
                    {opt}
                  </span>
                  <ImgWithFallback
                    src={q.option_images?.[originalIdx]}
                    alt=""
                    className="mt-2 max-h-20 rounded-lg object-contain"
                  />
                </div>
              </label>
            );
          })}
        </div>
      )}

      {!timeBomb?.expired && q.type === 'truefalse' && (
        <div className="flex gap-2 mb-4">
          {['True', 'False'].map(v => (
            <label
              key={v}
              className={`flex-1 flex items-center justify-center gap-2 p-3.5 rounded-lg border cursor-pointer transition-all text-sm font-medium ${
                answers[q.id] === v
                  ? 'border-accent bg-accent/8 text-accent'
                  : 'border-rim text-annotation hover:border-annotation/30'
              }`}
            >
              <input
                type="radio"
                name={`q_${q.id}`}
                checked={answers[q.id] === v}
                onChange={() => setAnswer(q.id, v)}
                className="accent-accent"
              />
              {v}
            </label>
          ))}
        </div>
      )}

      {!timeBomb?.expired && (q.type === 'fillblank' || q.type === 'numerical') && (
        <div className="mb-4">
          <input
            value={answers[q.id] || ''}
            onChange={e => setAnswer(q.id, e.target.value)}
            placeholder={q.type === 'numerical' ? 'Enter numeric answer…' : 'Type your answer…'}
            aria-label="Your answer"
            className="input-field max-w-xs"
            autoComplete="off"
          />
        </div>
      )}

      <div className="flex items-center justify-between pt-4 border-t border-rim">
        <button
          onClick={() => setAnswer(q.id, undefined)}
          className="text-xs text-annotation hover:text-alert transition-colors"
        >
          Clear response
        </button>
        <div className="flex gap-2">
          <Btn variant="ghost" size="sm" onClick={onPrev}>
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" d="M15 19l-7-7 7-7" />
            </svg>
            Prev
          </Btn>
          {isLast ? (
            <Btn variant="success" size="sm" onClick={onConfirmSubmit}>
              Submit
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" d="M5 13l4 4L19 7" />
              </svg>
            </Btn>
          ) : (
            <Btn variant="primary" size="sm" onClick={onNext}>
              Next
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" d="M9 5l7 7-7 7" />
              </svg>
            </Btn>
          )}
        </div>
      </div>
    </div>
  );
}

export default AptitudeQuestion;
