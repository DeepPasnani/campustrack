export function Skeleton({ className = '', lines = 1 }) {
  if (lines > 1) {
    return (
      <div className="space-y-2 animate-pulse" role="status" aria-label="Loading">
        {Array.from({ length: lines }).map((_, i) => (
          <div key={i} className={`h-4 bg-sunken rounded ${className}`} style={{ width: `${[78, 62, 88, 70, 84, 66][i % 6]}%` }} />
        ))}
        <span className="sr-only">Loading...</span>
      </div>
    );
  }
  return (
    <div className={`animate-pulse bg-sunken rounded ${className}`} role="status" aria-label="Loading">
      <span className="sr-only">Loading...</span>
    </div>
  );
}

export function TableSkeleton({ rows = 5, cols = 4 }) {
  return (
    <div className="table-wrap animate-pulse" role="status" aria-label="Loading table">
      <table className="w-full">
        <thead>
          <tr>
            {Array.from({ length: cols }).map((_, i) => (
              <th key={i} className="p-3"><div className="h-3 bg-sunken rounded w-16" /></th>
            ))}
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: rows }).map((_, r) => (
            <tr key={r}>
              {Array.from({ length: cols }).map((_, c) => (
                <td key={c} className="p-3"><div className="h-4 bg-sunken rounded w-full" /></td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <span className="sr-only">Loading...</span>
    </div>
  );
}

export function CardSkeleton({ count = 3 }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="panel p-4 animate-pulse" role="status" aria-label="Loading card">
          <div className="flex items-start justify-between gap-3">
            <div className="flex-1 space-y-2">
              <div className="h-3 bg-sunken rounded w-24" />
              <div className="h-5 bg-sunken rounded w-16" />
            </div>
            <div className="w-9 h-9 rounded-lg bg-sunken shrink-0" />
          </div>
          <span className="sr-only">Loading...</span>
        </div>
      ))}
    </div>
  );
}
