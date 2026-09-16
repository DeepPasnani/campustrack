import { useState } from 'react';
import { codeOpsAPI } from '../../services/api';
import { Btn, Spinner } from './UI';
import toast from 'react-hot-toast';

export default function CustomTestExplorer({ code, language, problemId }) {
  const [stdin, setStdin] = useState('');
  const [expectedOutput, setExpectedOutput] = useState('');
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [savedTests, setSavedTests] = useState([]);
  const [showSaved, setShowSaved] = useState(false);
  const [testName, setTestName] = useState('');

  const handleRun = async () => {
    if (!code?.trim()) {
      toast.error('Write some code first.');
      return;
    }
    setLoading(true);
    setResult(null);
    try {
      const res = await codeOpsAPI.runCustomTest({
        code,
        language,
        stdin,
        expectedOutput: expectedOutput || undefined,
      });
      setResult(res);
    } catch {
      toast.error('Custom test execution failed.');
    }
    setLoading(false);
  };

  const handleSave = async () => {
    try {
      await codeOpsAPI.saveCustomTest({
        problemId,
        input: stdin,
        expectedOutput: expectedOutput || null,
        name: testName || null,
      });
      toast.success('Test case saved!');
      setTestName('');
    } catch {
      toast.error('Failed to save test case.');
    }
  };

  const loadSavedTests = async () => {
    if (!problemId) return;
    setShowSaved(v => !v);
    if (!showSaved) {
      try {
        const data = await codeOpsAPI.getCustomTests(problemId);
        setSavedTests(data.customTests || []);
      } catch {}
    }
  };

  const loadTest = (t) => {
    setStdin(t.input);
    setExpectedOutput(t.expected_output || '');
    setShowSaved(false);
  };

  const deleteTest = async (id) => {
    try {
      await codeOpsAPI.deleteCustomTest(id);
      setSavedTests(prev => prev.filter(t => t.id !== id));
      toast.success('Test case deleted.');
    } catch {
      toast.error('Failed to delete.');
    }
  };

  const renderDiff = (expected, actual) => {
    const expLines = (expected || '').split('\n');
    const actLines = (actual || '').split('\n');
    const maxLen = Math.max(expLines.length, actLines.length);
    const diffLines = [];

    for (let i = 0; i < maxLen; i++) {
      const e = expLines[i] || '';
      const a = actLines[i] || '';
      if (e !== a) {
        diffLines.push(
          <div key={i} className="font-mono text-xs leading-5">
            <div className="bg-verify/10 text-verify px-2">+ {e}</div>
            <div className="bg-alert/10 text-alert px-2">- {a}</div>
          </div>
        );
      } else {
        diffLines.push(
          <div key={i} className="font-mono text-xs text-ink/60 px-2 leading-5 bg-panel">{e}</div>
        );
      }
    }

    if (diffLines.length === 0) {
      return <div className="text-xs text-annotation text-center py-2">Outputs match</div>;
    }

    return diffLines;
  };

  return (
    <div className="panel p-3 border border-rim rounded-lg">
      <div className="flex items-center justify-between mb-3">
        <h4 className="text-xs font-bold font-display text-ink">Custom Test</h4>
        <div className="flex gap-1">
          <Btn variant="ghost" size="xs" onClick={loadSavedTests}>
            {showSaved ? 'Close' : 'Saved'}
          </Btn>
        </div>
      </div>

      {/* Saved tests panel */}
      {showSaved && (
        <div className="mb-3 max-h-40 overflow-y-auto border border-rim rounded p-2 bg-panel">
          {savedTests.length === 0 ? (
            <p className="text-xs text-annotation text-center py-2">No saved tests</p>
          ) : (
            <div className="space-y-1">
              {savedTests.map(t => (
                <div key={t.id} className="flex items-center justify-between gap-2 p-1.5 hover:bg-deck rounded cursor-pointer" onClick={() => loadTest(t)}>
                  <div className="min-w-0 flex-1">
                    <div className="text-xs font-medium text-ink truncate">{t.name || 'Unnamed'}</div>
                    <div className="text-2xs text-annotation/60 font-mono truncate">{t.input}</div>
                  </div>
                  <button
                    onClick={(e) => { e.stopPropagation(); deleteTest(t.id); }}
                    className="text-alert/60 hover:text-alert shrink-0"
                    title="Delete"
                  >
                    <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Input */}
      <div className="mb-2">
        <label htmlFor="cte-input" className="text-2xs text-annotation/60 font-mono uppercase mb-1 block">Input</label>
        <textarea
          id="cte-input"
          value={stdin}
          onChange={e => setStdin(e.target.value)}
          rows={3}
          className="w-full text-xs font-mono bg-deck border border-rim rounded p-2 text-ink resize-none focus:border-accent outline-none"
          placeholder="Enter test input..."
        />
      </div>

      {/* Expected output */}
      <div className="mb-3">
        <label htmlFor="cte-expected" className="text-2xs text-annotation/60 font-mono uppercase mb-1 block">Expected Output (optional)</label>
        <textarea
          id="cte-expected"
          value={expectedOutput}
          onChange={e => setExpectedOutput(e.target.value)}
          rows={2}
          className="w-full text-xs font-mono bg-deck border border-rim rounded p-2 text-ink resize-none focus:border-accent outline-none"
          placeholder="Expected output..."
        />
      </div>

      {/* Actions */}
      <div className="flex items-center gap-2 mb-3">
        <Btn variant="primary" size="xs" onClick={handleRun} disabled={loading}>
          {loading ? <Spinner size={12} /> : '▶ Run'}
        </Btn>
        {result && (
          <>
            <span className={`text-2xs font-mono font-bold ${result.matchesExpected === true ? 'text-verify' : result.matchesExpected === false ? 'text-alert' : 'text-annotation'}`}>
              {result.matchesExpected === true ? '✓ Match' : result.matchesExpected === false ? '✗ Mismatch' : ''}
            </span>
            <span className="text-2xs text-annotation/60 font-mono">{result.time != null ? `${result.time}s` : '—'} / {result.memory ? `${Math.round(result.memory / 1024)}MB` : '—'}</span>
            <div className="flex-1" />
            <input
              value={testName}
              onChange={e => setTestName(e.target.value)}
              placeholder="Name..."
              aria-label="Saved test name"
              className="text-xs border border-rim rounded px-1.5 py-0.5 bg-panel text-ink w-24 outline-none focus:border-accent"
            />
            <Btn variant="ghost" size="xs" onClick={handleSave}>Save</Btn>
          </>
        )}
      </div>

      {/* Result */}
      {result && (
        <div className="border border-rim rounded overflow-hidden">
          {/* stdout */}
          <div className="p-2 border-b border-rim">
            <div className="text-2xs text-annotation/60 font-mono mb-1">stdout</div>
            <pre className="font-mono text-xs text-ink whitespace-pre-wrap max-h-20 overflow-y-auto">
              {result.stdout || '(empty)'}
            </pre>
          </div>

          {/* stderr */}
          {result.stderr && (
            <div className="p-2 border-b border-rim bg-alert/5">
              <div className="text-2xs text-alert font-mono mb-1">stderr</div>
              <pre className="font-mono text-xs text-alert whitespace-pre-wrap max-h-16 overflow-y-auto">
                {result.stderr}
              </pre>
            </div>
          )}

          {/* Diff view */}
          {expectedOutput && result.matchesExpected === false && (
            <div className="border-t border-rim">
              <div className="text-2xs text-annotation/60 font-mono px-2 pt-1">Diff (expected vs actual)</div>
              {renderDiff(expectedOutput, result.stdout)}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
