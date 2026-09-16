import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { analyticsAPI, testsAPI, classesAPI } from '../../../services/api';
import { Btn, Spinner } from '../../../components/shared/UI';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, Legend, PieChart, Pie,
} from 'recharts';

const METRIC_OPTIONS = [
  { value: 'avg_score', label: 'Average Score' },
  { value: 'avg_percentage', label: 'Average Percentage' },
  { value: 'completion_rate', label: 'Completion Rate' },
  { value: 'genre_accuracy', label: 'Genre-wise Accuracy' },
];

const GROUP_OPTIONS = [
  { value: 'class', label: 'Class' },
  { value: 'department', label: 'Department' },
  { value: 'year', label: 'Year of Study' },
];

export default function ReportBuilder() {
  const [step, setStep] = useState(1);
  const [selectedMetrics, setSelectedMetrics] = useState(['avg_score', 'avg_percentage']);
  const [filters, setFilters] = useState({});
  const [groupBy, setGroupBy] = useState('class');
  const [reportName, setReportName] = useState('');
  const [dateStart, setDateStart] = useState('');
  const [dateEnd, setDateEnd] = useState('');
  const [drillDown, setDrillDown] = useState(null);

  const { data: testsData } = useQuery({ queryKey: ['tests'], queryFn: testsAPI.list });
  const { data: classesData } = useQuery({ queryKey: ['classes'], queryFn: classesAPI.list });

  const reportPayload = {
    metrics: selectedMetrics,
    filters: {
      ...filters,
      ...(dateStart || dateEnd ? { dateRange: { start: dateStart || undefined, end: dateEnd || undefined } } : {}),
    },
    groupBy,
  };

  const { data: reportData, isLoading, refetch } = useQuery({
    queryKey: ['report-builder', reportPayload],
    queryFn: () => analyticsAPI.reportBuilder(reportPayload),
    enabled: false,
  });

  const handlePreview = () => refetch();

  const toggleMetric = (m) => {
    setSelectedMetrics(prev =>
      prev.includes(m) ? prev.filter(x => x !== m) : [...prev, m]
    );
  };

  const renderStep = () => {
    switch (step) {
      case 1:
        return (
          <div className="space-y-3">
            <h3 className="text-sm font-bold text-ink">Select Metrics</h3>
            <div className="grid grid-cols-2 gap-2">
              {METRIC_OPTIONS.map(m => (
                <label key={m.value} className={`flex items-center gap-2 p-3 rounded-lg border cursor-pointer transition-colors ${selectedMetrics.includes(m.value) ? 'border-accent bg-accent/5' : 'border-rim hover:bg-panel'}`}>
                  <input type="checkbox" checked={selectedMetrics.includes(m.value)} onChange={() => toggleMetric(m.value)} className="accent-accent" />
                  <span className="text-xs font-medium text-ink">{m.label}</span>
                </label>
              ))}
            </div>
            <div className="flex justify-end">
              <Btn variant="primary" size="sm" onClick={() => setStep(2)} disabled={!selectedMetrics.length}>
                Next: Filters
              </Btn>
            </div>
          </div>
        );
      case 2:
        return (
          <div className="space-y-3">
            <h3 className="text-sm font-bold text-ink">Apply Filters</h3>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-2xs text-annotation/60 mb-1.5">Department</label>
                <select value={filters.department || ''} onChange={e => setFilters(f => ({ ...f, department: e.target.value || undefined }))} className="select-field">
                  <option value="">All departments</option>
                  {[...new Set((testsData?.tests || []).map(t => t.department).filter(Boolean))].map(d => (
                    <option key={d} value={d}>{d}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-2xs text-annotation/60 mb-1.5">Class</label>
                <select value={filters.class_id || ''} onChange={e => setFilters(f => ({ ...f, class_id: e.target.value || undefined }))} className="select-field">
                  <option value="">All classes</option>
                  {/* Grouped by department — every department has its own Class
                      1-4, so an ungrouped list would show "Class 1" repeated
                      eight times with no way to tell them apart. */}
                  {Object.entries(
                    (classesData?.classes || []).reduce((acc, c) => {
                      (acc[c.department] ||= []).push(c);
                      return acc;
                    }, {})
                  ).map(([dept, deptClasses]) => (
                    <optgroup key={dept} label={dept}>
                      {deptClasses.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </optgroup>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-2xs text-annotation/60 mb-1.5">Min Score</label>
                <input type="number" value={filters.min_score || ''} onChange={e => setFilters(f => ({ ...f, min_score: e.target.value ? Number(e.target.value) : undefined }))} className="input-field" />
              </div>
              <div>
                <label className="text-2xs text-annotation/60 mb-1.5">Max Score</label>
                <input type="number" value={filters.max_score || ''} onChange={e => setFilters(f => ({ ...f, max_score: e.target.value ? Number(e.target.value) : undefined }))} className="input-field" />
              </div>
              <div>
                <label className="text-2xs text-annotation/60 mb-1.5">Date From</label>
                <input type="date" value={dateStart} onChange={e => setDateStart(e.target.value)} className="input-field" />
              </div>
              <div>
                <label className="text-2xs text-annotation/60 mb-1.5">Date To</label>
                <input type="date" value={dateEnd} onChange={e => setDateEnd(e.target.value)} className="input-field" />
              </div>
            </div>
            <div className="flex justify-between">
              <Btn variant="ghost" size="sm" onClick={() => setStep(1)}>Back</Btn>
              <Btn variant="primary" size="sm" onClick={() => setStep(3)}>Next: Grouping</Btn>
            </div>
          </div>
        );
      case 3:
        return (
          <div className="space-y-3">
            <h3 className="text-sm font-bold text-ink">Choose Grouping</h3>
            <div className="grid grid-cols-3 gap-2">
              {GROUP_OPTIONS.map(g => (
                <label key={g.value} className={`flex items-center justify-center p-4 rounded-lg border cursor-pointer transition-colors ${groupBy === g.value ? 'border-accent bg-accent/5' : 'border-rim hover:bg-panel'}`}>
                  <input type="radio" name="groupBy" checked={groupBy === g.value} onChange={() => setGroupBy(g.value)} className="sr-only" />
                  <span className="text-sm font-medium text-ink">{g.label}</span>
                </label>
              ))}
            </div>
            <div className="flex justify-between">
              <Btn variant="ghost" size="sm" onClick={() => setStep(2)}>Back</Btn>
              <Btn variant="primary" size="sm" onClick={() => { setStep(4); handlePreview(); }}>Preview Report</Btn>
            </div>
          </div>
        );
      case 4:
        return (
          <div className="space-y-3">
            <h3 className="text-sm font-bold text-ink">Preview & Export</h3>
            {isLoading && <div className="flex justify-center py-8"><Spinner size={24} className="text-accent" /></div>}
            {reportData && !isLoading && renderReportData()}
            {!reportData && !isLoading && (
              <div className="text-center py-8 text-annotation text-xs">
                Click "Preview Report" to generate the report
              </div>
            )}
            <div className="flex justify-between">
              <Btn variant="ghost" size="sm" onClick={() => setStep(3)}>Back</Btn>
              <div className="flex gap-2">
                <Btn variant="ghost" size="sm" onClick={handlePreview} disabled={isLoading}>
                  Refresh
                </Btn>
                <Btn variant="primary" size="sm" onClick={exportCsv}>
                  Export CSV
                </Btn>
              </div>
            </div>
          </div>
        );
      default:
        return null;
    }
  };

  const renderReportData = () => {
    if (!reportData) return null;

    if (reportData.type === 'genre_accuracy') {
      const genres = [...new Set(reportData.data.map(d => d.genre))];
      const groups = [...new Set(reportData.data.map(d => d.group_label))];

      const chartData = groups.map(label => {
        const entry = { name: label };
        for (const g of genres) {
          const found = reportData.data.find(d => d.group_label === label && d.genre === g);
          entry[g] = found ? Math.round(parseFloat(found.accuracy || 0) * 100) : 0;
        }
        return entry;
      });

      return (
        <div className="panel p-3">
          <h4 className="text-xs font-bold text-ink mb-2">Genre Accuracy by {groupBy}</h4>
          <ResponsiveContainer width="100%" height={250}>
            <BarChart data={chartData} margin={{ top: 0, right: 0, bottom: 0, left: -16 }}>
              <XAxis dataKey="name" tick={{ fontSize: 10, fill: 'var(--ct-annotation)' }} />
              <YAxis domain={[0, 100]} tick={{ fontSize: 10, fill: 'var(--ct-annotation)' }} tickFormatter={v => `${v}%`} />
              <Tooltip contentStyle={{ background: 'var(--ct-panel)', border: '1px solid var(--ct-rim)', borderRadius: '8px', fontSize: '12px' }} />
              <Legend />
              {genres.map((g, i) => (
                <Bar key={g} dataKey={g} fill={['var(--ct-accent)', 'var(--ct-clarify)', 'var(--ct-verify)', 'var(--ct-alert)', '#8B5CF6', '#F59E0B'][i % 6]} radius={[3, 3, 0, 0]} />
              ))}
            </BarChart>
          </ResponsiveContainer>
        </div>
      );
    }

    const data = reportData.data || [];
    return (
      <div className="space-y-3">
        <div className="panel p-3">
          <h4 className="text-xs font-bold text-ink mb-2">Chart View</h4>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={data} margin={{ top: 0, right: 0, bottom: 0, left: -16 }}>
              <XAxis dataKey="group_label" tick={{ fontSize: 10, fill: 'var(--ct-annotation)' }} />
              <YAxis tick={{ fontSize: 10, fill: 'var(--ct-annotation)' }} />
              <Tooltip contentStyle={{ background: 'var(--ct-panel)', border: '1px solid var(--ct-rim)', borderRadius: '8px', fontSize: '12px' }} />
              {selectedMetrics.includes('avg_percentage') && (
                <Bar dataKey="avg_percentage" name="Avg %" fill="var(--ct-accent)" radius={[3, 3, 0, 0]} />
              )}
              {selectedMetrics.includes('avg_score') && (
                <Bar dataKey="avg_score" name="Avg Score" fill="var(--ct-clarify)" radius={[3, 3, 0, 0]} />
              )}
              {selectedMetrics.includes('completion_rate') && (
                <Bar dataKey="total_submissions" name="Submissions" fill="var(--ct-verify)" radius={[3, 3, 0, 0]} />
              )}
              <Legend />
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-rim">
                <th className="text-left py-2 font-medium text-annotation">{groupBy === 'class' ? 'Class' : groupBy === 'department' ? 'Department' : 'Year'}</th>
                {selectedMetrics.includes('avg_percentage') && <th className="text-right py-2 font-medium text-annotation">Avg %</th>}
                {selectedMetrics.includes('avg_score') && <th className="text-right py-2 font-medium text-annotation">Avg Score</th>}
                {selectedMetrics.includes('completion_rate') && <th className="text-right py-2 font-medium text-annotation">Submissions</th>}
                <th />
              </tr>
            </thead>
            <tbody>
              {data.map((row, i) => (
                <tr
                  key={i}
                  className="border-b border-rim/30 cursor-pointer hover:bg-panel/60"
                  onClick={() => setDrillDown(row.group_label)}
                >
                  <td className="py-1.5 font-medium text-ink">{row.group_label}</td>
                  {selectedMetrics.includes('avg_percentage') && <td className="text-right py-1.5 font-mono">{row.avg_percentage ?? '—'}</td>}
                  {selectedMetrics.includes('avg_score') && <td className="text-right py-1.5 font-mono">{row.avg_score ?? '—'}</td>}
                  {selectedMetrics.includes('completion_rate') && <td className="text-right py-1.5 font-mono">{row.total_submissions ?? '—'}</td>}
                  <td className="text-right">
                    <span className="text-2xs text-clarify">Drill down →</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  };

  const exportCsv = () => {
    if (!reportData?.data?.length) return;
    const data = reportData.data;
    const headers = [groupBy, ...selectedMetrics];
    const rows = data.map(row => [
      row.group_label,
      ...selectedMetrics.map(m => row[m] ?? ''),
    ]);
    const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `report-${groupBy}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="animate-fade-up space-y-5">
      <div className="section-header">
        <div>
          <h1 className="text-display">Report Builder</h1>
          <p className="section-subtitle">Create custom reports with drill-down</p>
        </div>
      </div>

      <div className="flex items-center gap-2 mb-4">
        {[1, 2, 3, 4].map(s => (
          <div key={s} className="flex items-center gap-2">
            <button
              onClick={() => setStep(s)}
              className={`w-7 h-7 rounded-full text-xs font-bold flex items-center justify-center transition-colors ${step >= s ? 'bg-accent text-panel' : 'bg-rim text-annotation'}`}
            >
              {s}
            </button>
            {s < 4 && <div className={`w-6 h-0.5 ${step > s ? 'bg-accent' : 'bg-rim'}`} />}
          </div>
        ))}
        <span className="text-xs text-annotation/60 ml-2">
          {step === 1 ? 'Select Metrics' : step === 2 ? 'Apply Filters' : step === 3 ? 'Choose Grouping' : 'Preview'}
        </span>
      </div>

      <div className="panel p-4">
        {renderStep()}
      </div>

      {drillDown && (
        <div className="panel p-4 mt-4 border-accent/30">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-bold text-ink">Drill Down: {drillDown}</h3>
            <Btn variant="ghost" size="sm" onClick={() => setDrillDown(null)}>Close</Btn>
          </div>
          <p className="text-xs text-annotation/60">
            In a full implementation, this would show individual student breakdown for {drillDown}.
            The data is available via the student analytics endpoints.
          </p>
        </div>
      )}
    </div>
  );
}
