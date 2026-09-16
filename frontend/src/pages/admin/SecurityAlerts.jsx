import { useState, useEffect, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { securityAPI, submissionsAPI } from '../../services/api';
import { Btn, Spinner, Badge, Modal, Select, ConfirmModal } from '../../components/shared/UI';
import toast from 'react-hot-toast';

const SEVERITY_COLORS = {
  critical: 'red',
  high: 'red',
  medium: 'yellow',
  low: 'blue',
};

const SEVERITY_BG = {
  critical: 'bg-alert/15 text-alert',
  high: 'bg-alert/10 text-alert',
  medium: 'bg-accent/15 text-accent',
  low: 'bg-clarify/15 text-clarify',
};

const FLAG_TYPE_LABELS = {
  face_absent: 'Face Absent',
  multiple_faces: 'Multiple Faces',
  gaze_deviation: 'Gaze Deviation',
  fingerprint_mismatch: 'Fingerprint Mismatch',
  tab_switch: 'Tab Switch',
  fullscreen_violation: 'Fullscreen Violation',
  paste_attempt: 'Paste Attempt',
  admin_disqualification: 'Admin Disqualification',
};

export default function SecurityAlerts() {
  const queryClient = useQueryClient();
  const [filterSeverity, setFilterSeverity] = useState('all');
  const [filterType, setFilterType] = useState('all');
  const [filterReviewed, setFilterReviewed] = useState('false');
  const [expandedAlert, setExpandedAlert] = useState(null);
  const [sessionModal, setSessionModal] = useState(null);
  const [disqualifyTarget, setDisqualifyTarget] = useState(null);

  const { data, isLoading } = useQuery({
    queryKey: ['security-alerts', filterSeverity, filterType, filterReviewed],
    queryFn: () => securityAPI.getAlerts({
      severity: filterSeverity,
      flagType: filterType,
      reviewed: filterReviewed === 'all' ? undefined : filterReviewed,
      limit: 100,
    }),
    refetchInterval: 5000,
  });

  const { data: stats } = useQuery({
    queryKey: ['security-alert-stats'],
    queryFn: () => securityAPI.getAlertStats(),
    refetchInterval: 10000,
  });

  const reviewMut = useMutation({
    mutationFn: ({ id, action }) => securityAPI.reviewAlert(id, action),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['security-alerts'] });
      queryClient.invalidateQueries({ queryKey: ['security-alert-stats'] });
      toast.success('Alert reviewed');
    },
    onError: (e) => toast.error(e.response?.data?.error || 'Failed to review'),
  });

  const disqualifyMut = useMutation({
    mutationFn: (submissionId) => securityAPI.disqualifySubmission(submissionId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['security-alerts'] });
      queryClient.invalidateQueries({ queryKey: ['security-alert-stats'] });
      toast.success('Submission disqualified');
    },
    onError: (e) => toast.error(e.response?.data?.error || 'Failed to disqualify'),
  });

  const alerts = data?.alerts || [];

  return (
    <div className="animate-fade-up space-y-5">
      <div className="section-header">
        <div className="flex items-center gap-3">
          <div>
            <h1 className="text-display">Security Alerts</h1>
            <p className="section-subtitle">Monitor anti-cheating signals in real-time</p>
          </div>
          {stats && (
            <div className="flex gap-2 ml-auto">
              {[
                { label: 'Critical', count: stats.critical, color: 'bg-alert/15 text-alert' },
                { label: 'High', count: stats.high, color: 'bg-alert/10 text-alert' },
                { label: 'Medium', count: stats.medium, color: 'bg-accent/15 text-accent' },
                { label: 'Low', count: stats.low, color: 'bg-clarify/15 text-clarify' },
              ].map(s => (
                <div key={s.label} className={`px-2 py-1 rounded-md text-2xs font-mono font-bold ${s.color}`}>
                  {s.count} {s.label}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="panel p-3 flex flex-wrap gap-3 items-end">
        <div>
          <label className="text-2xs text-annotation/60 mb-1.5">Severity</label>
          <select className="select-field" value={filterSeverity}
            onChange={e => setFilterSeverity(e.target.value)}>
            <option value="all">All Severities</option>
            <option value="critical">Critical</option>
            <option value="high">High</option>
            <option value="medium">Medium</option>
            <option value="low">Low</option>
          </select>
        </div>
        <div>
          <label className="text-2xs text-annotation/60 mb-1.5">Flag Type</label>
          <select className="select-field" value={filterType}
            onChange={e => setFilterType(e.target.value)}>
            <option value="all">All Types</option>
            {Object.entries(FLAG_TYPE_LABELS).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="text-2xs text-annotation/60 mb-1.5">Status</label>
          <select className="select-field" value={filterReviewed}
            onChange={e => setFilterReviewed(e.target.value)}>
            <option value="false">Unresolved</option>
            <option value="true">Reviewed</option>
            <option value="all">All</option>
          </select>
        </div>
        {data && (
          <div className="text-xs text-annotation/60 ml-auto">
            {data.unresolved} unresolved · {data.total} total
          </div>
        )}
      </div>

      {isLoading && (
        <div className="flex justify-center py-16"><Spinner size={28} className="text-accent" /></div>
      )}

      {!isLoading && alerts.length === 0 && (
        <div className="empty-state">
          <svg className="empty-state-icon" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <p className="empty-state-title">No alerts</p>
          <p className="empty-state-desc">No security alerts match your current filters.</p>
        </div>
      )}

      {alerts.length > 0 && (
        <div className="space-y-2">
          {alerts.map((alert) => (
            <div
              key={alert.id}
              className={`panel p-3 transition-all ${alert.reviewed ? 'opacity-60' : 'hover:ring-1 hover:ring-accent/20'}`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1 flex-wrap">
                    <span className={`px-2 py-0.5 rounded text-2xs font-mono font-bold ${SEVERITY_BG[alert.severity] || 'bg-annotation/10 text-annotation'}`}>
                      {alert.severity}
                    </span>
                    <span className="badge-annotation text-2xs">{FLAG_TYPE_LABELS[alert.flag_type] || alert.flag_type}</span>
                    {alert.reviewed && (
                      <span className="text-2xs text-verify font-mono">Reviewed</span>
                    )}
                    <span className="text-2xs text-annotation/50 font-mono ml-auto">
                      {new Date(alert.created_at).toLocaleString()}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 text-xs">
                    <span className="font-semibold text-ink">{alert.user_name}</span>
                    <span className="text-annotation/60">{alert.email}</span>
                    {alert.roll_number && <span className="text-annotation/50">({alert.roll_number})</span>}
                  </div>
                  <div className="text-2xs text-annotation/50 mt-0.5">Test: {alert.test_title}</div>

                  {expandedAlert === alert.id && (
                    <div className="mt-2 p-2 bg-deck rounded border border-rim">
                      <pre className="text-2xs text-annotation whitespace-pre-wrap break-all font-mono">
                        {JSON.stringify(alert.details, null, 2)}
                      </pre>
                    </div>
                  )}
                </div>

                <div className="flex items-center gap-1.5 shrink-0">
                  <button
                    onClick={() => setExpandedAlert(expandedAlert === alert.id ? null : alert.id)}
                    className="btn-ghost-icon"
                    title="Details"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" d={expandedAlert === alert.id ? 'M5 15l7-7 7 7' : 'M19 9l-7 7-7-7'} />
                    </svg>
                  </button>

                  {!alert.reviewed && (
                    <>
                      <Btn variant="ghost" size="sm" onClick={() => reviewMut.mutate({ id: alert.id, action: 'warn' })}>
                        Warn
                      </Btn>
                      <Btn variant="danger" size="sm" onClick={() => setDisqualifyTarget(alert)}>
                        Disqualify
                      </Btn>
                      <Btn variant="ghost" size="sm" onClick={() => reviewMut.mutate({ id: alert.id, action: 'ignore' })}>
                        Ignore
                      </Btn>
                    </>
                  )}

                  <button
                    onClick={async () => {
                      try {
                        const data = await securityAPI.getSessionDetails(alert.submission_id);
                        setSessionModal(data);
                      } catch {
                        toast.error('Failed to load session details');
                      }
                    }}
                    className="btn-ghost-icon"
                    title="Session details"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <Modal isOpen={!!sessionModal} onClose={() => setSessionModal(null)} title="Session Details" width="max-w-3xl">
        {sessionModal && (
          <div className="space-y-4 max-h-96 overflow-y-auto">
            <div className="grid grid-cols-2 gap-3">
              <div className="p-2 bg-deck rounded border border-rim">
                <span className="text-2xs text-annotation/60">Tab Switches</span>
                <p className="text-sm font-mono font-bold">{sessionModal.submission?.tab_switch_count || 0}</p>
              </div>
              <div className="p-2 bg-deck rounded border border-rim">
                <span className="text-2xs text-annotation/60">Fullscreen Exits</span>
                <p className="text-sm font-mono font-bold">{sessionModal.submission?.fullscreen_exit_count || 0}</p>
              </div>
              <div className="p-2 bg-deck rounded border border-rim">
                <span className="text-2xs text-annotation/60">Paste Attempts</span>
                <p className="text-sm font-mono font-bold">{sessionModal.submission?.paste_attempts || 0}</p>
              </div>
              <div className="p-2 bg-deck rounded border border-rim">
                <span className="text-2xs text-annotation/60">Status</span>
                <p className="text-sm font-mono font-bold">{sessionModal.submission?.status || 'N/A'}</p>
              </div>
            </div>

            {sessionModal.suspiciousFlags?.length > 0 && (
              <div>
                <h4 className="text-xs font-bold text-ink mb-2">Suspicious Flags ({sessionModal.suspiciousFlags.length})</h4>
                <div className="space-y-1">
                  {sessionModal.suspiciousFlags.map(f => (
                    <div key={f.id} className="text-2xs p-1.5 bg-deck rounded border border-rim flex items-center gap-2">
                      <span className={`px-1 py-0.5 rounded font-mono ${SEVERITY_BG[f.severity] || ''}`}>{f.severity}</span>
                      <span>{f.flag_type}</span>
                      <span className="text-annotation/50 ml-auto">{new Date(f.created_at).toLocaleTimeString()}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {sessionModal.proctoringFlags?.length > 0 && (
              <div>
                <h4 className="text-xs font-bold text-ink mb-2">Proctoring Events ({sessionModal.proctoringFlags.length})</h4>
                <div className="space-y-1 max-h-40 overflow-y-auto">
                  {sessionModal.proctoringFlags.slice(0, 30).map(f => (
                    <div key={f.id} className="text-2xs p-1.5 bg-deck rounded border border-rim flex items-center gap-2">
                      <span className="font-mono text-annotation">{f.flag_type}</span>
                      <span className="text-annotation/50 ml-auto">{new Date(f.timestamp).toLocaleTimeString()}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </Modal>

      <ConfirmModal
        isOpen={!!disqualifyTarget}
        onClose={() => setDisqualifyTarget(null)}
        onConfirm={() => disqualifyMut.mutate(disqualifyTarget.submission_id)}
        title="Disqualify Student"
        confirmLabel="Disqualify"
        message={disqualifyTarget ? `Disqualify ${disqualifyTarget.user_name}? This action cannot be undone.` : ''}
      />
    </div>
  );
}
