import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { aiAPI } from '../../services/ai';
import { Btn, Spinner, Alert } from '../../components/shared/UI';
import toast from 'react-hot-toast';

const EXAMPLES = [
  'show me students who scored >80% in aptitude',
  'which class has the highest coding average',
  'students with the most tab switches in tests',
  'average score per genre across all submitted tests',
  'top 10 students by overall percentage',
  'how many students passed each test',
];

export default function AiNlQuery() {
  const [query, setQuery] = useState('');
  const [result, setResult] = useState(null);

  const queryMut = useMutation({
    mutationFn: aiAPI.nlQuery,
    onSuccess: (data) => setResult(data),
    onError: (e) => toast.error(e.response?.data?.error || 'Query failed'),
  });

  const submit = () => {
    if (!query.trim()) return toast.error('Enter a question');
    setResult(null);
    queryMut.mutate(query);
  };

  return (
    <div className="animate-fade-up space-y-5">
      <div className="section-header">
        <div>
          <h1 className="text-display">Natural Language Query</h1>
          <p className="section-subtitle">Ask questions about your placement data in plain English</p>
        </div>
      </div>

      <div className="panel p-5">
        <div className="space-y-4">
          <div>
            <label htmlFor="nlq-query" className="input-label">Ask a question about your data</label>
            <div className="flex gap-2">
              <input
                id="nlq-query"
                value={query}
                onChange={e => setQuery(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && submit()}
                placeholder="e.g. show me students who scored >80% in aptitude"
                className="input-field flex-1"
              />
              <Btn onClick={submit} disabled={queryMut.isLoading || !query.trim()}>
                {queryMut.isLoading ? <Spinner size={14} /> : 'Ask'}
              </Btn>
            </div>
          </div>

          <div>
            <label className="input-label text-xs text-annotation">Example queries</label>
            <div className="flex flex-wrap gap-1.5 mt-1">
              {EXAMPLES.map((ex, i) => (
                <button
                  key={i}
                  onClick={() => setQuery(ex)}
                  className="text-xs px-2.5 py-1 rounded-full bg-rim/30 text-annotation hover:bg-rim/60 hover:text-ink transition-colors"
                >
                  {ex}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {queryMut.error && (
        <Alert type="error">{queryMut.error.response?.data?.error || 'Query failed'}</Alert>
      )}

      {queryMut.isLoading && (
        <div className="panel p-8 text-center">
          <Spinner size={24} className="text-accent mx-auto mb-2" />
          <p className="text-xs text-annotation">Generating query...</p>
        </div>
      )}

      {result && (
        <div className="space-y-3 animate-fade-up">
          <div className="panel p-4">
            <h3 className="text-xs font-bold text-ink mb-1">Generated SQL</h3>
            <pre className="text-xs font-mono bg-deck p-3 rounded-lg overflow-x-auto text-annotation">{result.query}</pre>
          </div>

          <div className="panel p-4">
            <h3 className="text-xs font-bold text-ink mb-1">Explanation</h3>
            <p className="text-xs text-annotation">{result.explanation}</p>
          </div>

          <div className="panel p-4">
            <h3 className="text-xs font-bold text-ink mb-3">Results ({result.results?.length || 0} rows)</h3>
            {result.results?.length > 0 ? (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      {Object.keys(result.results[0]).map(k => (
                        <th key={k}>{k}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {result.results.map((row, i) => (
                      <tr key={i}>
                        {Object.values(row).map((v, j) => (
                          <td key={j} className="text-xs">{v === null ? '—' : String(v)}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="text-xs text-annotation/50 py-4 text-center">No results found</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
