import { useState, useEffect } from 'react';
import { codeOpsAPI } from '../../services/api';
import { Spinner } from './UI';

export default function CodeQualityCard({ submissionId }) {
  const [reports, setReports] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!submissionId) return;
    setLoading(true);
    codeOpsAPI.qualityReport(submissionId)
      .then(data => {
        const r = data.reports || (data.report ? [data.report] : []);
        setReports(r);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [submissionId]);

  if (loading) {
    return (
      <div className="flex justify-center py-6">
        <Spinner size={20} className="text-accent" />
      </div>
    );
  }

  if (!reports || reports.length === 0) {
    return (
      <div className="text-center py-6 text-annotation text-xs">
        No quality data available.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {reports.map((r, i) => (
        <div key={r.id || i} className="panel p-4 border border-rim rounded-lg">
          <div className="flex items-center justify-between mb-3">
            <h4 className="text-xs font-bold font-display text-ink">
              Code Quality Report {reports.length > 1 ? `#${i + 1}` : ''}
            </h4>
            <span className={`text-lg font-bold font-mono ${
              r.readability_score >= 80 ? 'text-verify' : r.readability_score >= 50 ? 'text-accent' : 'text-alert'
            }`}>
              {r.readability_score}/100
            </span>
          </div>

          <div className="grid grid-cols-2 gap-2 text-xs mb-3">
            <div className="bg-panel p-2 rounded">
              <div className="text-annotation/60 text-2xs">Lines of Code</div>
              <div className="font-mono font-bold text-ink">{r.lines_of_code}</div>
            </div>
            <div className="bg-panel p-2 rounded">
              <div className="text-annotation/60 text-2xs">Total Lines</div>
              <div className="font-mono font-bold text-ink">{r.total_lines}</div>
            </div>
            <div className="bg-panel p-2 rounded">
              <div className="text-annotation/60 text-2xs">Comment Ratio</div>
              <div className="font-mono font-bold text-ink">{r.comment_ratio}%</div>
            </div>
            <div className="bg-panel p-2 rounded">
              <div className="text-annotation/60 text-2xs">Functions</div>
              <div className="font-mono font-bold text-ink">{r.num_functions}</div>
            </div>
            <div className="bg-panel p-2 rounded">
              <div className="text-annotation/60 text-2xs">Complexity</div>
              <div className={`font-mono font-bold ${r.cyclomatic_complexity > 10 ? 'text-alert' : 'text-ink'}`}>
                {r.cyclomatic_complexity}
              </div>
            </div>
            <div className="bg-panel p-2 rounded">
              <div className="text-annotation/60 text-2xs">Nesting</div>
              <div className={`font-mono font-bold ${r.max_nesting_depth > 4 ? 'text-alert' : 'text-ink'}`}>
                {r.max_nesting_depth}
              </div>
            </div>
          </div>

          <div className="text-xs">
            <div className="flex items-center justify-between mb-1">
              <span className="text-annotation/60">Maintainability Index</span>
              <span className={`font-mono font-bold ${
                r.maintainability_index >= 80 ? 'text-verify' : r.maintainability_index >= 50 ? 'text-accent' : 'text-alert'
              }`}>
                {r.maintainability_index}
              </span>
            </div>
            <div className="h-1.5 bg-deck rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full transition-all ${
                  r.maintainability_index >= 80 ? 'bg-verify' : r.maintainability_index >= 50 ? 'bg-accent' : 'bg-alert'
                }`}
                style={{ width: `${r.maintainability_index}%` }}
              />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
