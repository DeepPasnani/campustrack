import { useState, useRef, useCallback, useEffect } from 'react';
import { Btn, Spinner } from '../../components/shared/UI';
import Editor from '@monaco-editor/react';
import CustomTestExplorer from '../../components/shared/CustomTestExplorer';
import ImgWithFallback from '../../components/shared/ImgWithFallback';
import { codeOpsAPI } from '../../services/api';
import toast from 'react-hot-toast';

// If the CDN-hosted Monaco bundle hasn't finished mounting within this
// window (blocked/slow network, e.g. campus wifi filtering jsdelivr), stop
// showing an indefinite spinner and offer a fallback so a student is never
// simply unable to write code.
const MONACO_LOAD_TIMEOUT = 12000;

const LANG_MAP = {
  python: 'python',
  javascript: 'javascript',
  java: 'java',
  cpp: 'cpp',
  c: 'c',
  sql: 'sql',
};

const SNIPPETS = {
  python: 'def solve():\n    # Write your code here\n    pass\n\nif __name__ == "__main__":\n    solve()',
  javascript: 'function solve() {\n  // Write your code here\n}\n\nsolve();',
  java: 'public class Main {\n  public static void main(String[] args) {\n    // Write your code here\n  }\n}',
  cpp: '#include <iostream>\nusing namespace std;\n\nint main() {\n  // Write your code here\n  return 0;\n}',
  c: '#include <stdio.h>\n\nint main() {\n  // Write your code here\n  return 0;\n}',
  sql: '-- Write your SQL query here\nSELECT *\nFROM table_name;\n',
};

function DifficultyBadge({ level }) {
  const map = { easy: 'badge-verify', medium: 'badge-accent', hard: 'badge-alert' };
  const cls = map[level] || 'badge-annotation';
  return <span className={cls}>{level}</span>;
}

function CodingQuestion({
  q, qi, section, codeSolutions, setCode, activeLang, setActiveLang,
  allowedLangs,   flagged, toggleFlag, runResult, runLoading, onRunCode, testResults, testSummary, testLoading, onRunAllTests,
  onPrev, onNext, isLast, onConfirmSubmit, submissionId, timeBomb,
}) {
  const code = codeSolutions[q.id]?.[activeLang] || q.starter_code?.[activeLang] || '';
  const totalTestCases = (q.test_cases || []).length;
  const visibleTestCount = (q.test_cases || []).filter(tc => !tc.isHidden).length;
  const [activeTab, setActiveTab] = useState('code');
  const [formatLoading, setFormatLoading] = useState(false);
  const editorRef = useRef(null);
  const snapshotTimerRef = useRef(null);
  const [lints, setLints] = useState([]);

  // Monaco is fetched from a CDN at runtime (see lib/monaco.js) — on a
  // network that blocks/throttles it, @monaco-editor/react just sits on
  // its loading spinner forever with no error surfaced. Time it out and
  // offer a retry, or a plain-textarea fallback so writing code is never
  // entirely blocked.
  const [monacoReady, setMonacoReady] = useState(false);
  const [monacoTimedOut, setMonacoTimedOut] = useState(false);
  const [useFallbackEditor, setUseFallbackEditor] = useState(false);
  const [editorAttempt, setEditorAttempt] = useState(0);
  const monacoTimerRef = useRef(null);

  useEffect(() => {
    if (useFallbackEditor) return undefined;
    setMonacoReady(false);
    setMonacoTimedOut(false);
    monacoTimerRef.current = setTimeout(() => setMonacoTimedOut(true), MONACO_LOAD_TIMEOUT);
    return () => clearTimeout(monacoTimerRef.current);
  }, [editorAttempt, useFallbackEditor]);

  const retryEditor = useCallback(() => {
    setEditorAttempt(a => a + 1);
  }, []);

  const handleChange = useCallback((value) => {
    setCode(q.id, activeLang, value);
  }, [q.id, activeLang, setCode]);

  const handleEditorMount = useCallback((editor) => {
    editorRef.current = editor;
    clearTimeout(monacoTimerRef.current);
    setMonacoReady(true);
    setMonacoTimedOut(false);
  }, []);

  const saveSnapshot = useCallback((type) => {
    if (!submissionId) return;
    codeOpsAPI.saveSnapshot({
      submissionId,
      problemId: q.id,
      code,
      language: activeLang,
      snapshotType: type || 'auto',
    }).catch(() => {});
  }, [submissionId, q.id, code, activeLang]);

  useEffect(() => {
    if (!code || !submissionId) return;
    if (snapshotTimerRef.current) clearTimeout(snapshotTimerRef.current);
    snapshotTimerRef.current = setTimeout(() => {
      saveSnapshot('keystroke');
    }, 500);
    return () => {
      if (snapshotTimerRef.current) clearTimeout(snapshotTimerRef.current);
    };
  }, [code]);

  const handlePaste = useCallback(() => {
    setTimeout(() => saveSnapshot('paste'), 100);
  }, [saveSnapshot]);

  const handleFormat = async () => {
    if (!code?.trim()) return;
    setFormatLoading(true);
    try {
      const result = await codeOpsAPI.format({ code, language: activeLang });
      if (result.formatted && result.formatted !== code) {
        setCode(q.id, activeLang, result.formatted);
        toast.success('Code formatted');
      }
    } catch {
      toast.error('Format failed');
    }
    setFormatLoading(false);
  };

  const handleLint = async () => {
    if (!code?.trim()) return;
    try {
      const result = await codeOpsAPI.lint({ code, language: activeLang });
      setLints(result.warnings || []);
    } catch {}
  };

  const getMonacoOptions = () => ({
    minimap: { enabled: true, scale: 1 },
    fontSize: 13,
    lineNumbers: 'on',
    folding: true,
    scrollBeyondLastLine: false,
    automaticLayout: true,
    tabSize: activeLang === 'python' ? 4 : 2,
    cursorBlinking: 'phase',
    renderLineHighlight: 'line',
    quickSuggestions: true,
    suggestOnTriggerCharacters: true,
    formatOnType: true,
    autoClosingBrackets: 'always',
    autoClosingQuotes: 'always',
    parameterHints: { enabled: true },
    hover: { enabled: true },
    bracketPairColorization: { enabled: true },
    semanticHighlighting: { enabled: true },
  });

  if (!q) return null;

  return (
    <div className="max-w-7xl mx-auto flex flex-col flex-1 p-4 sm:p-5 animate-fade-up">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <span className="text-xs font-mono font-bold text-annotation">Q{qi + 1}</span>
          <DifficultyBadge level={q.difficulty} />
          <span className="badge-clarify">{q.marks} marks</span>
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

      <div className="flex flex-col lg:flex-row lg:items-start lg:gap-5 flex-1 min-h-0">
        {/* Left: problem statement (scrolls independently on desktop) */}
        <div className="lg:w-[44%] xl:w-[40%] lg:shrink-0 lg:max-h-[calc(100vh-12.5rem)] lg:overflow-y-auto lg:sticky lg:top-0 lg:pr-1 motion-safe:lg:max-h-[calc(100vh-12.5rem)]">
          <div className="panel p-4 mb-4">
            <h3 className="font-display font-bold text-base text-ink mb-2">{q.title || `Problem ${qi + 1}`}</h3>
            {q.image_url && (
              <ImgWithFallback
                src={q.image_url}
                alt={`${q.title || 'Problem'} illustration`}
                className="max-w-full rounded-lg border border-rim mb-3"
              />
            )}
            <p className="text-sm leading-relaxed whitespace-pre-wrap text-ink mb-3">{q.description}</p>
            {q.input_format && (
              <div className="space-y-1 text-xs">
                <p className="font-mono text-annotation font-semibold">Input Format</p>
                <p className="font-mono text-ink bg-deck p-2 rounded whitespace-pre-wrap">{q.input_format}</p>
              </div>
            )}
            {q.output_format && (
              <div className="space-y-1 text-xs mt-2">
                <p className="font-mono text-annotation font-semibold">Output Format</p>
                <p className="font-mono text-ink bg-deck p-2 rounded whitespace-pre-wrap">{q.output_format}</p>
              </div>
            )}
            {q.constraints && (
              <div className="space-y-1 text-xs mt-2">
                <p className="font-mono text-annotation font-semibold">Constraints</p>
                <p className="font-mono text-ink bg-deck p-2 rounded whitespace-pre-wrap">{q.constraints}</p>
              </div>
            )}
            {q.sample_input && q.sample_output && (
              <div className="grid grid-cols-2 gap-2 mt-2 text-xs">
                <div>
                  <p className="font-mono text-annotation font-semibold mb-1">Sample Input</p>
                  <pre className="font-mono text-ink bg-deck p-2 rounded whitespace-pre-wrap">{q.sample_input}</pre>
                </div>
                <div>
                  <p className="font-mono text-annotation font-semibold mb-1">Sample Output</p>
                  <pre className="font-mono text-verify bg-deck p-2 rounded whitespace-pre-wrap">{q.sample_output}</pre>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Right: editor pane (sticky on desktop) */}
        <div className="flex-1 min-w-0 flex flex-col">
          {/* Tab bar: Code / Custom Test */}
          <div className="flex items-center gap-1 mb-3 border-b border-rim">
            {['code', 'custom_test'].map(tab => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`px-3 py-1.5 text-xs font-medium transition-colors border-b-2 -mb-[1px] ${
                  activeTab === tab
                    ? 'border-accent text-accent'
                    : 'border-transparent text-annotation hover:text-ink'
                }`}
              >
                {tab === 'code' ? 'Code' : 'Custom Test'}
              </button>
            ))}
          </div>

          {activeTab === 'code' && (
        <>
          {/* Language selector + toolbar */}
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <label className="text-xs font-medium text-annotation">Language</label>
              <select
                value={activeLang}
                onChange={e => setActiveLang(e.target.value)}
                className="select-field w-auto min-w-[160px] text-sm"
              >
                {(allowedLangs || Object.keys(LANG_MAP)).map(l => (
                  <option key={l} value={l}>{l.charAt(0).toUpperCase() + l.slice(1)}</option>
                ))}
              </select>
            </div>
            <div className="flex items-center gap-1">
              <button
                onClick={handleLint}
                className="btn-ghost-icon text-xs text-annotation hover:text-ink px-2 py-1 rounded"
                title="Lint code"
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                Lint
              </button>
              <button
                onClick={handleFormat}
                disabled={formatLoading}
                className="btn-ghost-icon text-xs text-annotation hover:text-ink px-2 py-1 rounded"
                title="Format code"
              >
                {formatLoading ? <Spinner size={12} /> : (
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" d="M4 6h16M4 10h16m-8 4h8m-8 4h8m-12 0l-3-3m0 0l3-3m-3 3h12" />
                  </svg>
                )}
                Format
              </button>
            </div>
          </div>

          {/* Monaco Editor */}
          <div className="flex flex-col h-[65vh] min-h-[420px]">
            {useFallbackEditor ? (
              <div className="flex flex-col h-full">
                <div className="text-2xs text-annotation bg-sunken border border-rim rounded-t-lg px-2.5 py-1.5 flex items-center justify-between">
                  <span>Plain text editor (no syntax highlighting) — your code still saves normally.</span>
                  <button
                    type="button"
                    onClick={() => { setUseFallbackEditor(false); retryEditor(); }}
                    className="text-accent hover:underline shrink-0 ml-2"
                  >
                    Try code editor again
                  </button>
                </div>
                <textarea
                  value={code}
                  onChange={(e) => handleChange(e.target.value)}
                  spellCheck={false}
                  className="flex-1 w-full font-mono text-xs p-3 bg-deck border border-t-0 border-rim rounded-b-lg resize-none focus:outline-none focus:ring-1 focus:ring-accent"
                />
              </div>
            ) : (
              <>
                <Editor
                  key={editorAttempt}
                  height="100%"
                  language={LANG_MAP[activeLang] || 'text'}
                  theme="light"
                  value={code}
                  onChange={handleChange}
                  onMount={handleEditorMount}
                  options={getMonacoOptions()}
                />
                {monacoTimedOut && !monacoReady && (
                  <div className="mt-2 panel p-3 border border-alert/30 bg-alert/5 flex items-center justify-between gap-3 flex-wrap">
                    <span className="text-xs text-ink">
                      Code editor is taking a long time to load — this can happen on a slow or restricted network.
                    </span>
                    <div className="flex gap-2 shrink-0">
                      <Btn variant="ghost" size="sm" onClick={retryEditor}>Retry</Btn>
                      <Btn variant="ghost" size="sm" onClick={() => setUseFallbackEditor(true)}>Use plain text editor</Btn>
                    </div>
                  </div>
                )}
              </>
            )}

            {/* Lint warnings */}
            {lints.length > 0 && (
              <div className="panel mt-2 p-2 border border-accent/30 rounded-lg max-h-28 overflow-y-auto">
                <div className="text-2xs font-mono text-annotation mb-1">Diagnostics</div>
                {lints.map((l, i) => (
                  <div key={i} className="flex items-start gap-1.5 text-xs py-0.5">
                    <span className={`shrink-0 w-2 h-2 rounded-full mt-0.5 ${
                      l.severity === 'error' ? 'bg-alert' : l.severity === 'warning' ? 'bg-accent' : 'bg-annotation/40'
                    }`} />
                    <span className="text-ink font-mono">{l.message}</span>
                  </div>
                ))}
              </div>
            )}

            {/* Run result */}
            {runResult && (
              <div className={`panel mt-3 p-3 rounded-lg border animate-fade-in ${
                runResult.output?.includes('error') || runResult.stderr
                  ? 'border-alert/30 bg-alert/5'
                  : 'border-verify/30 bg-verify/5'
              }`}>
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-xs font-mono font-bold text-annotation">Output</span>
                  <span className={`text-2xs font-mono ${runResult.output?.includes('error') || runResult.stderr ? 'text-alert' : 'text-verify'}`}>
                    {runResult.output?.includes('error') || runResult.stderr ? 'Error' : 'Success'}
                  </span>
                </div>
                <pre className="font-mono text-xs text-ink/90 bg-deck p-2 rounded max-h-32 overflow-auto whitespace-pre-wrap">
                  {runResult.stdout || runResult.output || runResult.stderr || 'No output'}
                </pre>
                {runResult.time && (
                  <p className="text-2xs text-annotation mt-1 font-mono">
                    Time: {runResult.time}s · Memory: {runResult.memory ? Math.round(runResult.memory / 1024) : 0} MB
                  </p>
                )}
              </div>
            )}
          </div>

          {/* Run All Tests button + results */}
          <div className="flex flex-wrap items-center gap-3 mt-3">
            <Btn variant="primary" size="sm" onClick={onRunAllTests} disabled={testLoading || runLoading}>
              {testLoading ? <Spinner size={14} /> : '▶ Run All Tests'}
            </Btn>
          </div>

          {testResults && testResults.length > 0 && (
            <div className="panel rounded-lg mt-2 animate-fade-in overflow-hidden">
              {/* Summary banner */}
              {(() => {
                const summary = testSummary || null;
                const passed = summary ? summary.passed : testResults.filter(r => r.passed).length;
                const total = summary ? summary.total : testResults.length;
                const allPassed = passed === total;
                const pct = Math.round((passed / total) * 100);
                return (
                  <div className={`px-4 py-3 border-b ${
                    allPassed ? 'bg-verify/8 border-verify/20' : 'bg-alert/5 border-alert/15'
                  }`}>
                    <div className="flex items-center justify-between mb-2">
                      <div>
                        <span className="text-sm font-display font-bold text-ink">
                          {passed}<span className="text-annotation font-normal">/{total}</span>
                        </span>
                        <span className="text-xs text-annotation ml-2">test cases passed</span>
                        {summary && (
                          <span className="text-xs text-annotation ml-2 font-mono" title="Total includes hidden test cases">
                            (hidden + visible)
                          </span>
                        )}
                      </div>
                      <span className={`text-xs font-mono font-bold px-2 py-0.5 rounded ${
                        allPassed ? 'text-verify bg-verify/10' : pct >= 50 ? 'text-accent bg-accent/10' : 'text-alert bg-alert/10'
                      }`}>
                        {pct}%
                      </span>
                    </div>
                    <div className="w-full h-1.5 bg-rim/50 rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all duration-500 ${
                          allPassed ? 'bg-verify' : 'bg-alert'
                        }`}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    {summary && (
                      <div className="flex items-center gap-3 mt-2 text-2xs font-mono">
                        <span className="text-annotation">Visible <b className={summary.visiblePassed === summary.visibleTotal ? 'text-verify' : 'text-ink'}>{summary.visiblePassed}/{summary.visibleTotal}</b></span>
                        <span className="text-annotation">Hidden <b className={summary.hiddenPassed === summary.hiddenTotal ? 'text-verify' : 'text-ink'}>{summary.hiddenPassed}/{summary.hiddenTotal}</b></span>
                      </div>
                    )}
                  </div>
                );
              })()}

              <div className="p-3 overflow-x-auto">
                <table className="w-full text-xs font-mono">
                  <thead>
                    <tr className="text-annotation border-b border-rim">
                      <th className="text-left py-1 pr-2">#</th>
                      <th className="text-left py-1 pr-2">Input</th>
                      <th className="text-left py-1 pr-2">Expected</th>
                      <th className="text-left py-1 pr-2">Got</th>
                      <th className="text-right py-1">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {testResults.map((tr, i) => (
                      <tr key={i} className="border-b border-rim/50 transition-colors hover:bg-sunken">
                        <td className="py-1.5 pr-2 text-annotation">{i + 1}</td>
                        <td className="py-1.5 pr-2 text-ink max-w-32 align-top font-medium">
                          <pre className="whitespace-pre-wrap break-words font-mono max-h-20 overflow-y-auto">{tr.input}</pre>
                        </td>
                        <td className="py-1.5 pr-2 text-ink max-w-32 align-top">
                          <pre className="whitespace-pre-wrap break-words font-mono max-h-20 overflow-y-auto">{tr.expected}</pre>
                        </td>
                        <td className="py-1.5 pr-2 text-ink max-w-32 align-top">
                          <pre className="whitespace-pre-wrap break-words font-mono max-h-20 overflow-y-auto">{tr.actual}</pre>
                        </td>
                        <td className="py-1.5 text-right">
                          <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-2xs font-bold uppercase tracking-wider ${
                            tr.passed ? 'bg-verify/12 text-verify' : 'bg-alert/12 text-alert'
                          }`}>
                            {tr.passed ? 'Pass' : 'Fail'}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}

      {activeTab === 'custom_test' && (
        <div className="flex-1 overflow-y-auto">
          <CustomTestExplorer code={code} language={activeLang} problemId={q.id} />
        </div>
      )}

      {/* Navigation */}
      <div className="flex items-center justify-between pt-4 border-t border-rim mt-3">
        <button
          onClick={() => {
            setCode(q.id, activeLang, SNIPPETS[activeLang] || '');
            if (submissionId) saveSnapshot('manual');
          }}
          className="text-xs text-annotation hover:text-alert transition-colors"
        >
          Reset code
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
      </div>
    </div>
  );
}

export default CodingQuestion;
