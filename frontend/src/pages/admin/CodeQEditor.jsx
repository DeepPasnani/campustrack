import { useState } from 'react';
import { Btn, Input, Select, Textarea, Alert, ImageUpload } from '../../components/shared/UI';
import { CodingQuestionPreview } from '../../components/shared/QuestionPreview';
import { uploadAPI } from '../../services/api';
import Editor from '@monaco-editor/react';

export default function CodeQEditor({ q, onChange, onRemove }) {
  const [tab, setTab] = useState('desc');
  const [codeLang, setCodeLang] = useState('python');
  const [uploading, setUploading] = useState(false);
  const update = (f, v) => onChange({ ...q, [f]: v });
  const TABS = [
    { id: 'desc', label: 'Description' },
    { id: 'io', label: 'I/O & Format' },
    { id: 'tests', label: 'Test Cases' },
    { id: 'code', label: 'Starter Code' },
    { id: 'settings', label: 'Settings' },
    { id: 'preview', label: 'Preview' },
  ];

  return (
    <div className="panel p-4 mb-3">
      <div className="flex items-start justify-between gap-3 mb-4">
        <div className="flex gap-2 flex-wrap items-center flex-1">
          <Input
            value={q.title}
            onChange={e => update('title', e.target.value)}
            placeholder="Problem Title"
            className="w-48 text-sm py-1.5"
          />
          <Input
            type="number"
            value={q.marks}
            onChange={e => update('marks', +e.target.value)}
            min={1}
            className="w-16 text-sm py-1.5"
            placeholder="Marks"
          />
          <Select
            value={q.difficulty}
            onChange={e => update('difficulty', e.target.value)}
            className="w-24 text-sm py-1.5"
          >
            <option value="easy">Easy</option>
            <option value="medium">Medium</option>
            <option value="hard">Hard</option>
          </Select>
          <Input
            value={q.tags}
            onChange={e => update('tags', e.target.value)}
            placeholder="Tags (e.g. arrays, dp)"
            className="w-36 text-sm py-1.5"
          />
        </div>
        <Btn variant="danger" size="sm" onClick={onRemove} aria-label="Remove problem">
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
          </svg>
        </Btn>
      </div>

      <label className="flex items-center gap-1.5 text-xs text-annotation mb-3 cursor-pointer w-fit">
        <input
          type="checkbox"
          checked={!!q.saveToBank}
          disabled={!!q.bankQuestionId}
          onChange={e => update('saveToBank', e.target.checked)}
          className="accent-accent"
        />
        {q.bankQuestionId ? 'Linked to Question Bank' : 'Also save to Question Bank'}
      </label>

      <div className="tab-bar mb-4 overflow-x-auto">
        {TABS.map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`tab-btn ${tab === t.id ? 'tab-btn--active' : ''}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'desc' && (
        <div className="space-y-3">
          <Textarea
            value={q.description}
            onChange={e => update('description', e.target.value)}
            placeholder="Full problem description..."
            rows={12}
            className="text-sm"
          />
          <ImageUpload
            value={q.imageUrl}
            uploading={uploading}
            onChange={async (file) => {
              if (typeof file === 'string') { update('imageUrl', file); return; }
              setUploading(true);
              try { const r = await uploadAPI.image(file); update('imageUrl', r.url); } catch {} finally { setUploading(false); }
            }}
            label="Attach Diagram"
          />
        </div>
      )}

      {tab === 'io' && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <Textarea
            label="Input Format"
            value={q.inputFormat}
            onChange={e => update('inputFormat', e.target.value)}
            rows={5}
            className="text-sm"
          />
          <Textarea
            label="Output Format"
            value={q.outputFormat}
            onChange={e => update('outputFormat', e.target.value)}
            rows={5}
            className="text-sm"
          />
          <Textarea
            label="Constraints"
            value={q.constraints}
            onChange={e => update('constraints', e.target.value)}
            rows={4}
            className="text-sm"
          />
          <Textarea
            label="Explanation (after submit)"
            value={q.explanation}
            onChange={e => update('explanation', e.target.value)}
            rows={4}
            className="text-sm"
          />
          <div>
            <label htmlFor="cqe-sample-input" className="input-label">Sample Input</label>
            <textarea
              id="cqe-sample-input"
              value={q.sampleInput}
              onChange={e => update('sampleInput', e.target.value)}
              rows={4}
              className="textarea-field font-mono text-xs bg-deck text-verify"
            />
          </div>
          <div>
            <label htmlFor="cqe-sample-output" className="input-label">Sample Output</label>
            <textarea
              id="cqe-sample-output"
              value={q.sampleOutput}
              onChange={e => update('sampleOutput', e.target.value)}
              rows={4}
              className="textarea-field font-mono text-xs bg-deck text-verify"
            />
          </div>
        </div>
      )}

      {tab === 'tests' && (
        <div>
          <Alert type="info" className="mb-3">
            Hidden test cases are used for final grading. Visible ones serve as examples.
          </Alert>
          <div className="mb-4 text-xs text-annotation bg-panel rounded-lg p-3">
            <div className="font-semibold text-ink mb-1">How marks are awarded</div>
            <p>
              Leave the <span className="font-mono">marks</span> column blank to split this
              problem's {q.marks || 0} marks equally across all test cases. To award custom
              marks per case instead, enter a value on each test case (the sum typically
              matches the problem's total marks).
            </p>
          </div>
          <div className="space-y-3">
            {q.testCases.map((tc, i) => (
              <div key={i} className="panel-muted p-3">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-semibold text-annotation font-mono">
                    Test Case {i + 1}
                  </span>
                  <div className="flex items-center gap-3">
                    <label className="flex items-center gap-1.5 text-2xs text-annotation/70 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={tc.isHidden}
                        onChange={e => {
                          const t = [...q.testCases];
                          t[i] = { ...t[i], isHidden: e.target.checked };
                          update('testCases', t);
                        }}
                        className="accent-accent"
                      />
                      Hidden
                    </label>
                    <button
                      onClick={() =>
                        update('testCases', q.testCases.filter((_, j) => j !== i))
                      }
                      className="btn-ghost-icon text-annotation hover:text-alert"
                      aria-label={`Remove test case ${i + 1}`}
                    >
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                    </button>
                  </div>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-[1fr_1fr_88px] gap-2">
                  <textarea
                    value={tc.input}
                    onChange={e => {
                      const t = [...q.testCases];
                      t[i] = { ...t[i], input: e.target.value };
                      update('testCases', t);
                    }}
                    rows={3}
                    placeholder="Input"
                    aria-label={`Test case ${i + 1} input`}
                    className="textarea-field font-mono text-xs bg-deck text-verify"
                  />
                  <textarea
                    value={tc.output}
                    onChange={e => {
                      const t = [...q.testCases];
                      t[i] = { ...t[i], output: e.target.value };
                      update('testCases', t);
                    }}
                    rows={3}
                    placeholder="Expected Output"
                    aria-label={`Test case ${i + 1} expected output`}
                    className="textarea-field font-mono text-xs bg-deck text-verify"
                  />
                  <div>
                    <label htmlFor={`cqe-${i}-marks`} className="input-label">Marks (blank = equal share)</label>
                    <input
                      id={`cqe-${i}-marks`}
                      type="number"
                      min={0}
                      step={0.5}
                      value={tc.marks ?? ''}
                      onChange={e => {
                        const t = [...q.testCases];
                        t[i] = { ...t[i], marks: e.target.value === '' ? '' : Number(e.target.value) };
                        update('testCases', t);
                      }}
                      placeholder="auto"
                      aria-label={`Test case ${i + 1} marks`}
                      className="input-field font-mono text-xs py-1.5"
                    />
                  </div>
                </div>
              </div>
            ))}
          </div>
          <Btn
            variant="outline"
            size="sm"
            className="mt-3"
            onClick={() =>
              update('testCases', [
                ...q.testCases,
                { input: '', output: '', isHidden: false, marks: '' },
              ])
            }
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" d="M12 4v16m8-8H4" />
            </svg>
            Add Test Case
          </Btn>
        </div>
      )}

      {tab === 'code' && (
        <div>
          <div className="flex gap-2 mb-3">
            {Object.keys(q.starterCode).map(lang => (
              <button
                key={lang}
                onClick={() => setCodeLang(lang)}
                className={`tab-btn ${
                  codeLang === lang ? 'tab-btn--active' : 'tab-btn--inactive'
                }`}
              >
                {lang}
              </button>
            ))}
          </div>
          <Editor
            height="200px"
            language={
              codeLang === 'cpp'
                ? 'cpp'
                : codeLang === 'java'
                ? 'java'
                : codeLang
            }
            value={q.starterCode[codeLang]}
            theme="vs-dark"
            onChange={v =>
              update('starterCode', {
                ...q.starterCode,
                [codeLang]: v || '',
              })
            }
            options={{
              minimap: { enabled: false },
              fontSize: 13,
              lineNumbers: 'on',
              scrollBeyondLastLine: false,
            }}
          />
        </div>
      )}

      {tab === 'settings' && (
        <div className="grid grid-cols-2 gap-4">
          <Input
            label="Time Limit (seconds)"
            type="number"
            min={1}
            max={30}
            value={q.timeLimit}
            onChange={e => update('timeLimit', +e.target.value)}
            hint="Max execution time per test case"
          />
          <Input
            label="Memory Limit (MB)"
            type="number"
            min={32}
            max={512}
            value={q.memoryLimit}
            onChange={e => update('memoryLimit', +e.target.value)}
            hint="Max memory usage"
          />
        </div>
      )}
      {tab === 'preview' && (
        <div className="panel-muted p-5 border-2 border-dashed border-accent/30">
          <p className="text-2xs text-annotation/70 font-mono uppercase tracking-wider mb-3">
            Student view preview
          </p>
          <CodingQuestionPreview q={q} />
        </div>
      )}
    </div>
  );
}
