import { useState, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { emailAPI, emailPreferencesAPI, usersAPI, classesAPI } from '../../services/api';
import { Btn, Modal, Alert, Spinner, Badge, Tabs } from '../../components/shared/UI';
import { ALLOWED_DEPARTMENTS as DEPARTMENTS } from '../../lib/departments';
import { useStore } from '../../store';
import toast from 'react-hot-toast';

const TEMPLATES = {
  blank: { label: 'Blank', subject: '', body: '' },
  welcome: { label: 'Welcome', subject: 'Welcome to CampusTrack!', body: '<p>Hi {name},</p><p>Your account has been successfully created on <strong>CampusTrack</strong>.</p><p>Best of luck with your placement journey!</p>' },
  testScheduled: { label: 'Test Scheduled', subject: 'New Test Scheduled', body: '<p>Hi {name},</p><p>A new placement test has been scheduled. Log in for details.</p>' },
  testResults: { label: 'Test Results', subject: 'Your Results', body: '<p>Hi {name},</p><p>Your results are now available. Log in to view.</p>' },
  passwordReset: { label: 'Password Reset', subject: 'Password Reset OTP', body: '<p>Hi {name},</p><p>Use the OTP provided to reset your password.</p>' },
};

export default function SendEmail() {
  const [activeTab, setActiveTab] = useState('compose');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [allStudents, setAllStudents] = useState(false);
  const [selectedDepts, setSelectedDepts] = useState([]);
  const [selectedClasses, setSelectedClasses] = useState([]);
  const [selectedStudents, setSelectedStudents] = useState([]);
  const [showConfirm, setShowConfirm] = useState(false);
  const [template, setTemplate] = useState('blank');
  const [studentSearch, setStudentSearch] = useState('');
  const bodyRef = useRef(null);

  const { data: classData } = useQuery({ queryKey: ['classes'], queryFn: classesAPI.list });

  const { data: studentResults } = useQuery({
    queryKey: ['students-search', studentSearch],
    queryFn: () => usersAPI.list({ role: 'student', search: studentSearch, limit: 10 }),
    enabled: studentSearch.length >= 2,
  });

  const sendMut = useMutation({
    mutationFn: emailAPI.send,
    onSuccess: (data) => {
      toast.success(`Email sent to ${data.sent} student(s)`);
      setShowConfirm(false);
    },
    onError: (e) => toast.error(e.response?.data?.error || 'Failed to send'),
  });

  const handleTemplateChange = (tplKey) => {
    setTemplate(tplKey);
    const tpl = TEMPLATES[tplKey] || TEMPLATES.blank;
    setSubject(tpl.subject);
    setBody(tpl.body);
  };

  const toggleDept = (dept) => {
    setSelectedDepts(prev =>
      prev.includes(dept) ? prev.filter(d => d !== dept) : [...prev, dept]
    );
  };

  const toggleClass = (id) => {
    setSelectedClasses(prev =>
      prev.includes(id) ? prev.filter(c => c !== id) : [...prev, id]
    );
  };

  const toggleStudent = (id) => {
    setSelectedStudents(prev =>
      prev.includes(id) ? prev.filter(s => s !== id) : [...prev, id]
    );
  };

  const getRecipientSummary = () => {
    if (allStudents) return 'All students';
    const parts = [];
    if (selectedDepts.length) parts.push(`${selectedDepts.length} dept(s)`);
    if (selectedClasses.length) parts.push(`${selectedClasses.length} class(es)`);
    if (selectedStudents.length) parts.push(`${selectedStudents.length} student(s)`);
    return parts.join(', ') || 'No recipients selected';
  };

  const handleSend = () => {
    if (!subject.trim() || !body.trim()) {
      toast.error('Subject and body are required');
      return;
    }
    sendMut.mutate({
      subject: subject.trim(),
      html: body,
      recipients: {
        allStudents: allStudents || undefined,
        departments: selectedDepts.length ? selectedDepts : undefined,
        classes: selectedClasses.length ? selectedClasses : undefined,
        studentIds: selectedStudents.length ? selectedStudents : undefined,
      },
    });
  };

  // Insert an HTML snippet at the cursor position in the body textarea
  const insertAtCursor = (snippet) => {
    const el = bodyRef.current;
    if (!el) {
      setBody(b => b + snippet);
      return;
    }
    const start = el.selectionStart ?? body.length;
    const end = el.selectionEnd ?? body.length;
    const next = body.slice(0, start) + snippet + body.slice(end);
    setBody(next);
    requestAnimationFrame(() => {
      el.focus();
      const caret = start + snippet.length;
      el.setSelectionRange(caret, caret);
    });
  };

  return (
    <div className="page-enter">
      <div className="section-header">
        <div>
          <h1 className="section-title">Send Email</h1>
          <p className="section-subtitle">Compose emails and manage the platform's automated emails</p>
        </div>
      </div>

      <Tabs
        tabs={[{ id: 'compose', label: 'Compose' }, { id: 'automated', label: 'Automated Emails' }]}
        active={activeTab}
        onChange={setActiveTab}
      />

      {activeTab === 'automated' ? (
        <div className="mt-5">
          <AutomatedEmailPreferences />
        </div>
      ) : (
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6 mt-5">
        {/* ── Left: Composer ───────────────────────────────── */}
        <div className="lg:col-span-3 space-y-5">
          {/* Template selector */}
          <div>
            <label className="input-label" htmlFor="email-template">Template</label>
            <select
              id="email-template"
              value={template}
              onChange={e => handleTemplateChange(e.target.value)}
              className="select-field"
            >
              {Object.entries(TEMPLATES).map(([key, tpl]) => (
                <option key={key} value={key}>{tpl.label}</option>
              ))}
            </select>
          </div>

          {/* Subject */}
          <div>
            <label className="input-label" htmlFor="email-subject">Subject</label>
            <input
              id="email-subject"
              value={subject}
              onChange={e => setSubject(e.target.value)}
              className="input-field"
              placeholder="Email subject…"
            />
          </div>

          {/* Body */}
          <div>
            <label className="input-label" htmlFor="email-body">Body (HTML)</label>
            <div className="flex gap-1 mb-2">
              <button
                type="button"
                className="btn-ghost-icon text-sm leading-none px-2"
                onClick={() => insertAtCursor('<strong></strong>')}
                title="Bold"
                aria-label="Insert bold tags"
              ><strong>B</strong></button>
              <button
                type="button"
                className="btn-ghost-icon text-sm leading-none px-2"
                onClick={() => insertAtCursor('<em></em>')}
                title="Italic"
                aria-label="Insert italic tags"
              ><em>I</em></button>
              <button
                type="button"
                className="btn-ghost-icon text-sm leading-none px-2"
                onClick={() => insertAtCursor('<a href=""></a>')}
                title="Link"
                aria-label="Insert link tag"
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M13.828 10.172a4 4 0 010 5.656l-4 4a4 4 0 01-5.656-5.656l1.5-1.5M10.172 13.828a4 4 0 010-5.656l4-4a4 4 0 015.656 5.656l-1.5 1.5" /></svg>
              </button>
              <button
                type="button"
                className="btn-ghost-icon text-sm leading-none px-2"
                onClick={() => insertAtCursor('<ul>\n<li></li>\n</ul>')}
                title="List"
                aria-label="Insert list tags"
              >•</button>
            </div>
            <textarea
              id="email-body"
              ref={bodyRef}
              value={body}
              onChange={e => setBody(e.target.value)}
              className="textarea-field"
              rows={14}
              placeholder="<p>Hello {name},</p>..."
            />
          </div>

          {/* Preview */}
          {body && (
            <div className="panel p-4">
              <div className="text-xs text-annotation font-medium mb-2">Preview</div>
              <div className="panel-muted p-4 text-ink max-h-64 overflow-y-auto">
                <div
                  className="text-sm leading-relaxed"
                  dangerouslySetInnerHTML={{ __html: body }}
                />
              </div>
            </div>
          )}

          {/* Send button */}
          <div className="flex justify-end">
            <Btn
              variant="primary"
              onClick={() => setShowConfirm(true)}
              disabled={!subject.trim() || !body.trim()}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
              </svg>
              Send Email
            </Btn>
          </div>
        </div>

        {/* ── Right: Recipients ────────────────────────────── */}
        <div className="lg:col-span-2">
          <div className="panel p-4 space-y-4">
            <h3 className="text-sm font-display font-semibold text-ink">Recipients</h3>

            {/* All students */}
            <label className="flex items-center gap-2.5 pb-3 border-b border-rim">
              <input
                type="checkbox"
                checked={allStudents}
                onChange={e => setAllStudents(e.target.checked)}
                className="focus-ring accent-accent w-4 h-4"
              />
              <span className="text-sm text-ink">All Students</span>
            </label>

            {!allStudents && (
              <>
                {/* Departments */}
                <div>
                  <p className="text-xs text-annotation font-medium mb-2">Departments</p>
                  <div className="flex flex-wrap gap-1.5">
                    {DEPARTMENTS.map(dept => {
                      const active = selectedDepts.includes(dept);
                      return (
                        <button
                          key={dept}
                          type="button"
                          onClick={() => toggleDept(dept)}
                          className={`focus-ring text-xs px-1.5 py-1 rounded-sm border cursor-pointer transition-all ${
                            active
                              ? 'border-accent bg-accent/10 text-accent'
                              : 'border-rim text-annotation hover:bg-panel hover:text-ink'
                          }`}
                        >
                          {dept}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Classes */}
                <div>
                  <p className="text-xs text-annotation font-medium mb-2">Classes</p>
                  <div className="flex flex-wrap gap-1.5">
                    {(classData?.classes || []).map(b => {
                      const active = selectedClasses.includes(b.id);
                      return (
                        <button
                          key={b.id}
                          type="button"
                          onClick={() => toggleClass(b.id)}
                          className={`focus-ring text-xs px-1.5 py-1 rounded-sm border cursor-pointer transition-all ${
                            active
                              ? 'border-accent bg-accent/10 text-accent'
                              : 'border-rim text-annotation hover:bg-panel hover:text-ink'
                          }`}
                        >
                          {b.name}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Individual students */}
                <div>
                  <p className="text-xs text-annotation font-medium mb-2">Individual Students</p>
                  <input
                    value={studentSearch}
                    onChange={e => setStudentSearch(e.target.value)}
                    placeholder="Search by name or email…"
                    aria-label="Search students by name or email"
                    className="input-field text-sm mb-2"
                  />
                  <div className="rounded-sm max-h-40 overflow-y-auto">
                    {(studentResults?.users || []).map(s => {
                      const selected = selectedStudents.includes(s.id);
                      return (
                        <label
                          key={s.id}
                          className={`flex items-center gap-2 px-2 py-1.5 rounded-sm cursor-pointer transition-colors ${
                            selected ? 'bg-accent/[0.06]' : 'hover:bg-sunken'
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={selected}
                            onChange={() => toggleStudent(s.id)}
                            className="accent-accent w-3.5 h-3.5 shrink-0"
                          />
                          <div className="min-w-0">
                            <div className="text-sm text-ink truncate">
                              {s.name || s.email}
                            </div>
                            <div className="text-2xs text-annotation/70 truncate">
                              {s.email}
                            </div>
                          </div>
                        </label>
                      );
                    })}
                    {studentSearch.length >= 2 && (studentResults?.users || []).length === 0 && (
                      <p className="text-2xs text-annotation px-2 py-3">No students found</p>
                    )}
                  </div>
                </div>
              </>
            )}

            {/* Summary */}
            <div className="pt-3 border-t border-rim">
              <div className="text-2xs text-annotation">
                Recipients: <strong className="text-ink">{getRecipientSummary()}</strong>
              </div>
            </div>
          </div>
        </div>
      </div>
      )}

      {/* ── Confirm modal ─────────────────────────────────── */}
      <Modal
        isOpen={showConfirm}
        onClose={() => setShowConfirm(false)}
        title="Send Email?"
        width="max-w-sm"
        footer={
          <>
            <Btn variant="ghost" onClick={() => setShowConfirm(false)} disabled={sendMut.isLoading}>Cancel</Btn>
            <Btn variant="primary" onClick={handleSend} disabled={sendMut.isLoading}>
              {sendMut.isLoading ? <><Spinner size={14} /> Sending…</> : 'Send'}
            </Btn>
          </>
        }
      >
        <Alert type="warning" className="mb-3">
          This will email all selected recipients immediately.
        </Alert>
        <div className="space-y-2 text-sm text-ink">
          <p><strong>Subject:</strong> {subject}</p>
          <p><strong>Recipients:</strong> {getRecipientSummary()}</p>
        </div>
      </Modal>
    </div>
  );
}

/* ── Automated Email Preferences ─────────────────────────────────
 * Controls the emails the platform sends on its own (drive reminders,
 * the 1hr test-start reminder, result announcements, weekly digest) —
 * separate from the manual Compose tab above. A department admin can
 * only narrow things down within their own department; a super admin
 * can also disable an email globally or by year of study. */
const SCOPE_LABELS = {
  global: 'Everyone',
  department: 'Department',
  class: 'Class',
  year_of_study: 'Year of Study',
  student: 'Individual Student',
};

function AutomatedEmailPreferences() {
  const qc = useQueryClient();
  const { user: me } = useStore();
  const isSuperAdmin = me?.role === 'super_admin';

  const { data, isLoading } = useQuery({ queryKey: ['email-preferences'], queryFn: emailPreferencesAPI.list });
  const { data: classData } = useQuery({ queryKey: ['classes'], queryFn: classesAPI.list });

  const scopeTypeOptions = isSuperAdmin
    ? ['global', 'department', 'class', 'year_of_study', 'student']
    : ['department', 'class', 'student'];

  const [emailType, setEmailType] = useState('test_reminder');
  const [scopeType, setScopeType] = useState(scopeTypeOptions[0]);
  const [scopeValue, setScopeValue] = useState(isSuperAdmin ? '' : (me?.department || ''));
  const [studentSearch, setStudentSearch] = useState('');

  const { data: studentResults } = useQuery({
    queryKey: ['students-search-email-pref', studentSearch],
    queryFn: () => usersAPI.list({ role: 'student', search: studentSearch, limit: 10 }),
    enabled: scopeType === 'student' && studentSearch.length >= 2,
  });

  const changeScopeType = (val) => {
    setScopeType(val);
    setScopeValue(val === 'department' && !isSuperAdmin ? (me?.department || '') : '');
    setStudentSearch('');
  };

  const classes = (classData?.classes || []).filter(c => isSuperAdmin || c.department === me?.department);

  const createMut = useMutation({
    mutationFn: (payload) => emailPreferencesAPI.create(payload),
    onSuccess: () => {
      toast.success('Disabled');
      qc.invalidateQueries({ queryKey: ['email-preferences'] });
      setScopeValue(scopeType === 'department' && !isSuperAdmin ? (me?.department || '') : '');
      setStudentSearch('');
    },
    onError: (e) => toast.error(e.response?.data?.error || 'Failed to disable'),
  });

  const deleteMut = useMutation({
    mutationFn: (id) => emailPreferencesAPI.delete(id),
    onSuccess: () => {
      toast.success('Re-enabled');
      qc.invalidateQueries({ queryKey: ['email-preferences'] });
    },
    onError: (e) => toast.error(e.response?.data?.error || 'Failed to re-enable'),
  });

  const rules = data?.rules || [];
  const emailTypes = data?.emailTypes || [];

  const handleDisable = () => {
    if (scopeType !== 'global' && !scopeValue) {
      toast.error('Choose a value for this scope');
      return;
    }
    createMut.mutate({ emailType, scopeType, scopeValue: scopeType === 'global' ? '' : scopeValue });
  };

  const describeRule = (r) => {
    if (r.scope_type === 'global') return 'Everyone';
    if (r.scope_type === 'year_of_study') return `Year ${r.scope_value}`;
    if (r.scope_type === 'student') return r.student ? `${r.student.name} (${r.student.email})` : 'Unknown student';
    return r.scope_value;
  };

  return (
    <div className="space-y-5">
      <Alert type="info">
        These control the emails CampusTrack sends on its own — drive reminders, the 1-hour test-start
        reminder, result announcements, and the weekly digest. The Compose tab is unaffected.
      </Alert>

      <div className="panel p-4 space-y-4">
        <h3 className="text-sm font-display font-semibold text-ink">Disable an automated email</h3>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 items-start">
          <div>
            <label className="input-label">Email type</label>
            <select className="select-field" value={emailType} onChange={e => setEmailType(e.target.value)}>
              {emailTypes.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </div>
          <div>
            <label className="input-label">For</label>
            <select className="select-field" value={scopeType} onChange={e => changeScopeType(e.target.value)}>
              {scopeTypeOptions.map(s => <option key={s} value={s}>{SCOPE_LABELS[s]}</option>)}
            </select>
          </div>
          <div>
            {scopeType === 'global' && (
              <p className="text-xs text-annotation/60 mt-6">Applies to every student, every department.</p>
            )}
            {scopeType === 'department' && (
              isSuperAdmin ? (
                <>
                  <label className="input-label">Department</label>
                  <select className="select-field" value={scopeValue} onChange={e => setScopeValue(e.target.value)}>
                    <option value="">— Select —</option>
                    {DEPARTMENTS.map(d => <option key={d} value={d}>{d}</option>)}
                  </select>
                </>
              ) : (
                <p className="text-xs text-annotation/60 mt-6">{me?.department}</p>
              )
            )}
            {scopeType === 'class' && (
              <>
                <label className="input-label">Class</label>
                <select className="select-field" value={scopeValue} onChange={e => setScopeValue(e.target.value)}>
                  <option value="">— Select —</option>
                  {classes.map(c => (
                    <option key={c.id} value={c.name}>{c.name}{isSuperAdmin ? ` — ${c.department}` : ''}</option>
                  ))}
                </select>
              </>
            )}
            {scopeType === 'year_of_study' && (
              <>
                <label className="input-label">Year</label>
                <select className="select-field" value={scopeValue} onChange={e => setScopeValue(e.target.value)}>
                  <option value="">— Select —</option>
                  {[1, 2, 3, 4].map(y => <option key={y} value={y}>{y}</option>)}
                </select>
              </>
            )}
            {scopeType === 'student' && (
              <>
                <label className="input-label">Student</label>
                <input
                  value={studentSearch}
                  onChange={e => { setStudentSearch(e.target.value); setScopeValue(''); }}
                  placeholder="Search by name or email…"
                  aria-label="Search students by name or email"
                  className="input-field text-sm"
                />
                {studentSearch.length >= 2 && !scopeValue && (
                  <div className="mt-1 max-h-32 overflow-y-auto rounded-sm border border-rim">
                    {(studentResults?.users || []).map(s => (
                      <button
                        key={s.id}
                        type="button"
                        onClick={() => { setScopeValue(s.id); setStudentSearch(`${s.name || s.email}`); }}
                        className="block w-full text-left px-2 py-1.5 text-xs text-ink hover:bg-sunken"
                      >
                        {s.name || s.email} <span className="text-annotation/60">{s.email}</span>
                      </button>
                    ))}
                    {(studentResults?.users || []).length === 0 && (
                      <p className="px-2 py-1.5 text-2xs text-annotation">No students found</p>
                    )}
                  </div>
                )}
              </>
            )}
          </div>
        </div>
        <div className="flex justify-end">
          <Btn
            variant="danger"
            size="sm"
            onClick={handleDisable}
            disabled={createMut.isLoading || (scopeType !== 'global' && !scopeValue)}
          >
            Disable
          </Btn>
        </div>
      </div>

      <div className="panel p-4">
        <h3 className="text-sm font-display font-semibold text-ink mb-3">Currently disabled</h3>
        {isLoading ? (
          <div className="flex justify-center py-8"><Spinner size={22} className="text-accent" /></div>
        ) : rules.length === 0 ? (
          <p className="text-xs text-annotation/60">Nothing disabled — all automated emails are going out normally.</p>
        ) : (
          <div className="space-y-1.5">
            {rules.map(r => (
              <div key={r.id} className="flex items-center justify-between gap-3 px-2 py-1.5 rounded-sm hover:bg-sunken text-xs">
                <div className="min-w-0 flex flex-wrap items-center gap-1.5">
                  <Badge color="alert">{emailTypes.find(t => t.value === r.email_type)?.label || r.email_type}</Badge>
                  <span className="text-annotation">disabled for</span>
                  <span className="text-ink font-medium">{describeRule(r)}</span>
                </div>
                <button
                  onClick={() => deleteMut.mutate(r.id)}
                  disabled={deleteMut.isLoading}
                  className="text-2xs text-accent hover:underline shrink-0"
                >
                  Re-enable
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
