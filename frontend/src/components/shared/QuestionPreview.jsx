import { useState } from 'react';

/* ═══════════════════════════════════════════════════════════
 * QuestionPreview — read-only renderers that mirror exactly how
 * AptitudeQuestion.jsx / CodingQuestion.jsx present a question to
 * a student. Used inside the Test Creator's editors as a live
 * "what the student will see" preview, kept intentionally in sync
 * with the real student-facing markup (same CodeBlock parsing,
 * same option layout, same badge classes).
 * ═══════════════════════════════════════════════════════════ */

function ImgWithFallback({ src, alt, className }) {
  const [error, setError] = useState(false);
  if (!src || error) return null;
  return <img src={src} alt={alt} loading="lazy" className={className} onError={() => setError(true)} />;
}

function DifficultyBadge({ level }) {
  const map = { easy: 'badge-verify', medium: 'badge-accent', hard: 'badge-alert' };
  return <span className={map[level] || 'badge-annotation'}>{level}</span>;
}

function CodeBlock({ text }) {
  const parts = (text || '').split(/(```[\s\S]*?```)/g);
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

// ── Aptitude / MCQ preview ────────────────────────────────────
export function AptitudeQuestionPreview({ q, qi = 0 }) {
  const options = q.options || [];
  return (
    <div className="max-w-2xl mx-auto animate-fade-up">
      <div className="flex items-center gap-2 mb-3">
        <span className="text-xs font-mono font-bold text-annotation">Q{qi + 1}</span>
        <DifficultyBadge level={q.difficulty} />
        <span className="badge-clarify">{q.marks || 0} marks</span>
        {q.type === 'msq' && <span className="badge-accent">multi-select</span>}
      </div>

      <div className="panel p-4 mb-4">
        <div className="text-sm leading-relaxed whitespace-pre-wrap text-ink">
          <CodeBlock text={q.text} />
          {!q.text && <span className="text-annotation/40 italic">Question text will appear here…</span>}
        </div>
        <ImgWithFallback
          src={q.imageUrl}
          alt="Question reference"
          className="mt-3 max-w-full max-h-56 rounded-lg object-contain border border-rim"
        />
      </div>

      {(q.type === 'mcq' || q.type === 'msq') && (
        <div className="space-y-2 mb-2">
          {options.map((opt, i) => (
            <div key={i} className="flex items-start gap-3 p-3.5 rounded-lg border border-rim bg-panel">
              <input type={q.type === 'msq' ? 'checkbox' : 'radio'} disabled className="mt-0.5 accent-accent shrink-0 w-4 h-4" />
              <div className="min-w-0">
                <span className="text-sm text-ink">
                  <span className="font-mono text-annotation mr-1.5">{String.fromCharCode(65 + i)}.</span>
                  {opt || <span className="text-annotation/40 italic">Option {String.fromCharCode(65 + i)}</span>}
                </span>
                <ImgWithFallback src={(q.optionImages || [])[i]} alt="" className="mt-2 max-h-20 rounded-lg object-contain" />
              </div>
            </div>
          ))}
        </div>
      )}

      {q.type === 'truefalse' && (
        <div className="flex gap-2 mb-2">
          {['True', 'False'].map(v => (
            <div key={v} className="flex-1 flex items-center justify-center gap-2 p-3.5 rounded-lg border border-rim text-sm font-medium text-annotation">
              <input type="radio" disabled className="accent-accent" />
              {v}
            </div>
          ))}
        </div>
      )}

      {(q.type === 'fillblank' || q.type === 'numerical') && (
        <input
          disabled
          placeholder={q.type === 'numerical' ? 'Enter numeric answer…' : 'Type your answer…'}
          className="input-field max-w-xs mb-2"
        />
      )}
    </div>
  );
}

// ── Coding preview ────────────────────────────────────────────
export function CodingQuestionPreview({ q }) {
  return (
    <div className="max-w-2xl mx-auto animate-fade-up">
      <div className="flex items-center gap-2 mb-3">
        <span className="font-display font-bold text-sm text-ink">{q.title || 'Untitled Problem'}</span>
        <DifficultyBadge level={q.difficulty} />
        <span className="badge-clarify">{q.marks || 0} marks</span>
      </div>

      <div className="panel p-4 mb-3">
        <div className="text-sm leading-relaxed whitespace-pre-wrap text-ink">
          <CodeBlock text={q.description} />
          {!q.description && <span className="text-annotation/40 italic">Problem description will appear here…</span>}
        </div>
        <ImgWithFallback
          src={q.imageUrl}
          alt="Diagram"
          className="mt-3 max-w-full max-h-56 rounded-lg object-contain border border-rim"
        />
      </div>

      {(q.inputFormat || q.outputFormat) && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
          {q.inputFormat && (
            <div className="panel-muted p-3">
              <p className="text-2xs text-annotation/70 uppercase tracking-wider mb-1 font-mono">Input Format</p>
              <p className="text-xs text-ink whitespace-pre-wrap">{q.inputFormat}</p>
            </div>
          )}
          {q.outputFormat && (
            <div className="panel-muted p-3">
              <p className="text-2xs text-annotation/70 uppercase tracking-wider mb-1 font-mono">Output Format</p>
              <p className="text-xs text-ink whitespace-pre-wrap">{q.outputFormat}</p>
            </div>
          )}
        </div>
      )}

      {q.constraints && (
        <div className="panel-muted p-3 mb-3">
          <p className="text-2xs text-annotation/70 uppercase tracking-wider mb-1 font-mono">Constraints</p>
          <p className="text-xs text-ink whitespace-pre-wrap">{q.constraints}</p>
        </div>
      )}

      {(q.sampleInput || q.sampleOutput) && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <p className="text-2xs text-annotation/70 uppercase tracking-wider mb-1 font-mono">Sample Input</p>
            <pre className="bg-deck border border-rim rounded-lg p-2.5 text-xs font-mono text-verify whitespace-pre-wrap">{q.sampleInput || '—'}</pre>
          </div>
          <div>
            <p className="text-2xs text-annotation/70 uppercase tracking-wider mb-1 font-mono">Sample Output</p>
            <pre className="bg-deck border border-rim rounded-lg p-2.5 text-xs font-mono text-verify whitespace-pre-wrap">{q.sampleOutput || '—'}</pre>
          </div>
        </div>
      )}
    </div>
  );
}
