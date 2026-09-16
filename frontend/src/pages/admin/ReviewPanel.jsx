import { Btn } from '../../components/shared/UI';

export default function ReviewPanel({ form, totalQ, totalM, handleSave, saveMut, setStep }) {
  return (
    <div className="panel p-5">
      <h2 className="text-sm font-display font-bold text-ink mb-5">
        Review & Publish
      </h2>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
        {[
          ['Title', form.title || 'Untitled'],
          ['Duration', `${form.durationMinutes} min`],
          ['Questions', totalQ],
          ['Total Marks', totalM],
        ].map(([k, v]) => (
          <div key={k} className="panel-muted p-3 text-center">
            <div className="text-2xs text-annotation/60 font-mono uppercase tracking-wider mb-0.5">
              {k}
            </div>
            <div className="text-base font-display font-bold text-ink score-digit">
              {v}
            </div>
          </div>
        ))}
      </div>

      <div className="panel-muted p-3 text-sm mb-5">
        <p className="text-2xs text-annotation/60 font-mono uppercase tracking-wider mb-1.5">
          Target Audience
        </p>
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink">
          <span><span className="text-annotation/60">Departments:</span> {form.departments?.includes('all') ? 'All departments' : (form.departments?.length ? form.departments.join(', ') : 'All departments')}</span>
          <span><span className="text-annotation/60">Years:</span> {form.years?.includes('all') || !form.years?.length ? 'All years' : 'Year ' + [...form.years].sort().join(', Year ')}</span>
          <span><span className="text-annotation/60">Classes:</span> {form.classes?.includes('all') || !form.classes?.length ? 'All classes' : form.classes.join(', ')}</span>
        </div>
      </div>

      {form.sections.map(s => (
        <div key={s._id || s.id} className="mb-3 panel-muted overflow-hidden">
          <div className="bg-panel px-4 py-2.5 flex items-center justify-between">
            <span className="text-sm font-semibold text-ink">{s.name}</span>
            <span className="text-xs text-annotation/60 font-mono">
              {s.questions.length} questions ·{' '}
              {s.questions.reduce((m, q) => m + (q.marks || 0), 0)} marks
            </span>
          </div>
          {s.questions.map((q, i) => (
            <div
              key={q._id || q.id}
              className="flex items-center gap-3 px-4 py-2 border-t border-rim/30 text-sm"
            >
              <span className="font-mono text-xs text-annotation/40 w-6">
                Q{i + 1}
              </span>
              <span className="flex-1 text-ink truncate">
                {s.type === 'coding' ? q.title : q.text || '(empty)'}
              </span>
              <span className="text-xs text-annotation/60 font-mono">
                {q.marks}m
              </span>
              <span
                className={`text-2xs font-semibold px-2 py-0.5 rounded-md font-mono ${
                  q.difficulty === 'easy'
                    ? 'bg-verify/10 text-verify'
                    : q.difficulty === 'hard'
                    ? 'bg-alert/10 text-alert'
                    : 'bg-accent/10 text-accent'
                }`}
              >
                {q.difficulty}
              </span>
            </div>
          ))}
        </div>
      ))}

      <div className="flex gap-3 justify-end mt-5 border-t border-rim pt-4">
        <Btn variant="ghost" onClick={() => setStep(1)}>
          ← Edit Questions
        </Btn>
        <Btn
          variant="ghost"
          onClick={() => handleSave('draft')}
          disabled={saveMut.isLoading}
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4" />
          </svg>
          Save as Draft
        </Btn>
        <Btn
          variant="primary"
          onClick={() => handleSave('published')}
          disabled={saveMut.isLoading}
        >
          {saveMut.isLoading ? 'Publishing…' : 'Publish Test'}
        </Btn>
      </div>
    </div>
  );
}
