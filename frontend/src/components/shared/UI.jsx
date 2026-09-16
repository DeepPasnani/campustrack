import { useState, useRef, useEffect, forwardRef, useId } from 'react';
import { createPortal } from 'react-dom';

/* ═══════════════════════════════════════════════════════════
 * CampusTrack — Shared Component Library
 *
 * Every component here uses the CT token system (classes
 * defined in index.css). No hardcoded colors.
 * ═══════════════════════════════════════════════════════════ */

// ── Button ─────────────────────────────────────────────────
export function Btn({ variant = 'primary', size = 'md', className = '', children, ...props }) {
  const map = {
    primary: 'btn-primary',
    ghost:   'btn-ghost',
    success: 'btn-verify',
    danger:  'btn-alert',
    warning: 'btn-accent',
    clarify: 'btn-clarify',
    'ghost-icon': 'btn-ghost-icon',
  };
  const sizes = {
    sm: 'btn-sm',
    md: '',
    lg: 'btn-lg',
  };
  const cls = map[variant] || 'btn-primary';
  const sz  = sizes[size] || '';
  return (
    <button className={`btn ${cls} ${sz} ${className}`} {...props}>
      {children}
    </button>
  );
}

// ── Input ──────────────────────────────────────────────────
export const Input = forwardRef(({ label, error, hint, className = '', ...props }, ref) => {
  const id = useId();
  return (
    <div className="w-full">
      {label && (
        <label className="input-label" htmlFor={id}>
          {label}{props.required && <span className="text-alert ml-0.5">*</span>}
        </label>
      )}
      <input
        id={id}
        ref={ref}
        className={`input-field ${error ? 'input-error' : ''} ${className}`}
        {...props}
      />
      {error && <p className="text-xs text-alert mt-1">{error}</p>}
      {hint && !error && <p className="input-hint">{hint}</p>}
    </div>
  );
});
Input.displayName = 'Input';

// ── Select ─────────────────────────────────────────────────
export function Select({ label, hint, className = '', children, ...props }) {
  const id = useId();
  return (
    <div className="w-full">
      {label && <label className="input-label" htmlFor={id}>{label}</label>}
      <select id={id} className={`select-field ${className}`} {...props}>
        {children}
      </select>
      {hint && <p className="input-hint">{hint}</p>}
    </div>
  );
}

// ── Textarea ───────────────────────────────────────────────
export function Textarea({ label, hint, className = '', ...props }) {
  const id = useId();
  return (
    <div className="w-full">
      {label && <label className="input-label" htmlFor={id}>{label}</label>}
      <textarea id={id} className={`textarea-field ${className}`} {...props} />
      {hint && <p className="input-hint">{hint}</p>}
    </div>
  );
}

// ── Modal ──────────────────────────────────────────────────
export function Modal({ isOpen, onClose, title, children, width = 'max-w-lg', footer }) {
  const contentRef = useRef(null);
  const lastActive = useRef(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

useEffect(() => {
    if (!isOpen) return;
    lastActive.current = document.activeElement;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    // Move focus into the dialog
    const timer = requestAnimationFrame(() => contentRef.current?.focus?.());

    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onCloseRef.current?.();
        return;
      }
      if (e.key !== 'Tab') return;
      // Simple focus trap across focusable elements inside the dialog
      const nodes = contentRef.current?.querySelectorAll(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
      );
      if (!nodes || nodes.length === 0) return;
      const list = Array.from(nodes);
      const first = list[0];
      const last = list[list.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
      cancelAnimationFrame(timer);
      if (lastActive.current && typeof lastActive.current.focus === 'function') {
        lastActive.current.focus();
      }
    };
  }, [isOpen]);

  if (!isOpen) return null;
  // Rendered via a portal straight onto <body> — position:fixed only
  // measures against the true viewport if no ancestor establishes a new
  // containing block. Page wrappers across the app use the `animate-fade-up`
  // utility, whose keyframes hold a non-`none` `transform` (translateY)
  // after finishing (animation-fill-mode: both) — that alone creates a
  // containing block, which silently confines any inline `position:fixed`
  // overlay to that ancestor's box instead of the viewport, clipping the
  // modal with no way to scroll to the hidden part. A portal sidesteps the
  // whole class of bug regardless of what CSS any ancestor uses.
  return createPortal((
    <div className="modal-overlay" onClick={e => { if (e.target === e.currentTarget) onClose?.(); }}>
      <div ref={contentRef} className={`modal-content ${width}`} role="dialog" aria-modal="true"
        aria-label={typeof title === 'string' ? title : undefined} tabIndex={-1}>
        <div className="modal-header">
          <h3 className="text-base font-display font-bold text-ink">{title}</h3>
          <button onClick={onClose} className="btn-ghost-icon text-annotation hover:text-ink" aria-label="Close">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-footer">{footer}</div>}
      </div>
    </div>
  ), document.body);
}

// ── Alert ──────────────────────────────────────────────────
export function Alert({ type = 'info', children, className = '' }) {
  const map = {
    info:    'alert-box--info',
    success: 'alert-box--success',
    error:   'alert-box--alert',
    warning: 'alert-box--accent',
  };
  const icons = {
    info:    'M13 16h-1v-4h-1m1-4h.01M12 2a10 10 0 100 20 10 10 0 000-20z',
    success: 'M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z',
    error:   'M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z',
    warning: 'M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z',
  };
  return (
    <div className={`alert-box ${map[type] || map.info} ${className}`}>
      <svg className="w-4 h-4 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d={icons[type] || icons.info} />
      </svg>
      <span>{children}</span>
    </div>
  );
}

// ── Badge ──────────────────────────────────────────────────
export function Badge({ color = 'annotation', children }) {
  const map = {
    accent:     'badge-accent',
    verify:     'badge-verify',
    alert:      'badge-alert',
    clarify:    'badge-clarify',
    annotation: 'badge-annotation',
  };
  return <span className={`${map[color] || map.annotation}`}>{children}</span>;
}

// ── Stat Card ──────────────────────────────────────────────
export function StatCard({ label, value, icon: Icon, color = 'blue', sub }) {
  const accentStyles = {
    blue:   { bg: 'bg-clarify/10', text: 'text-clarify' },
    green:  { bg: 'bg-verify/10',  text: 'text-verify' },
    purple: { bg: 'bg-clarify/10', text: 'text-clarify' },
    yellow: { bg: 'bg-accent/10',  text: 'text-accent' },
    red:    { bg: 'bg-alert/10',   text: 'text-alert' },
  };
  const s = accentStyles[color] || accentStyles.blue;
  return (
    <div className="panel p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs text-annotation font-medium">{label}</p>
          <p className="text-2xl font-display font-bold text-ink mt-0.5 score-digit">{value}</p>
          {sub && <p className="text-xs text-annotation/60 mt-0.5">{sub}</p>}
        </div>
        {Icon && (
          <div className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${s.bg}`}>
            <Icon size={18} className={s.text} />
          </div>
        )}
      </div>
    </div>
  );
}

// ── Table ──────────────────────────────────────────────────
export function Table({ columns, data, emptyMessage = 'No data found.' }) {
  if (!data?.length) {
    return (
      <div className="empty-state">
        <svg className="empty-state-icon" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-3-3v6m-7 4h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
        </svg>
        <p className="empty-state-title">{emptyMessage}</p>
      </div>
    );
  }
  return (
    <div className="table-wrap">
      <div className="overflow-x-auto">
        <table>
          <thead>
            <tr>
              {columns.map(c => (
                <th key={c.key} className={c.align || ''}>{c.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.map((row, i) => (
              <tr key={row.id || i}>
                {columns.map(c => (
                  <td key={c.key}>{c.render ? c.render(row, i) : row[c.key]}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Confirm Dialog ─────────────────────────────────────────
export function ConfirmModal({ isOpen, onClose, onConfirm, title, message, confirmLabel = 'Delete', variant = 'danger' }) {
  return (
    <Modal isOpen={isOpen} onClose={onClose} title={title} width="max-w-sm"
      footer={
        <>
          <Btn variant="ghost" onClick={onClose}>Cancel</Btn>
          <Btn variant={variant} onClick={() => { onConfirm(); onClose(); }}>{confirmLabel}</Btn>
        </>
      }>
      <p className="text-sm text-annotation">{message}</p>
    </Modal>
  );
}

// ── Loading Spinner ────────────────────────────────────────
export function Spinner({ size = 20, className = '' }) {
  return (
    <svg className={`spinner ${className}`} width={size} height={size} viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeOpacity="0.15" />
      <path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

// ── Image Upload ───────────────────────────────────────────
export function ImageUpload({ value, onChange, label = 'Add Image', uploading = false }) {
  const fileRef = useRef();

  const handleFile = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (onChange.length > 0) {
      onChange(file);
    } else {
      const reader = new FileReader();
      reader.onload = ev => onChange(ev.target.result);
      reader.readAsDataURL(file);
    }
  };

  return (
    <div className="flex flex-col gap-2">
      {value && (
        <div className="relative inline-block">
          <img src={value} alt="uploaded" className="max-h-36 rounded-lg border border-rim object-contain bg-deck" />
          <button onClick={() => onChange('')} className="absolute top-1 right-1 bg-alert text-white rounded-full w-5 h-5 flex items-center justify-center hover:bg-alert-dark transition-colors" aria-label="Remove image">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><path d="M18 6L6 18M6 6l12 12" /></svg>
          </button>
        </div>
      )}
      <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleFile} />
      <Btn variant="ghost" size="sm" onClick={() => fileRef.current?.click()} className="w-fit" disabled={uploading}>
        {uploading ? <Spinner size={13} /> : (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M12 4v16m8-8H4" strokeLinecap="round" />
          </svg>
        )}
        {label}
      </Btn>
    </div>
  );
}

// ── Help Tip (inline question-mark tooltip) ────────────────
export function HelpTip({ text }) {
  const [show, setShow] = useState(false);
  return (
    <span className="relative inline-flex items-center">
      <button
        type="button"
        onMouseEnter={() => setShow(true)}
        onMouseLeave={() => setShow(false)}
        onFocus={() => setShow(true)}
        onBlur={() => setShow(false)}
        onClick={() => setShow(!show)}
        className="inline-flex items-center justify-center w-3.5 h-3.5 rounded-full bg-rim text-annotation/70 hover:text-ink hover:bg-annotation/30 transition-colors text-2xs font-bold leading-none cursor-pointer"
        aria-label={text}
      >
        ?
      </button>
      {show && (
        <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 px-2.5 py-1.5 rounded-lg bg-panel border border-rim text-xs text-ink shadow-raised whitespace-nowrap max-w-[18rem] z-50 pointer-events-none">
          {text}
          <div className="absolute top-full left-1/2 -translate-x-1/2 -mt-px w-2 h-2 bg-panel border-r border-b border-rim rotate-45" />
        </div>
      )}
    </span>
  );
}

// ── Progress Bar ───────────────────────────────────────────
export function ProgressBar({ value, max, color = 'bg-accent', className = '' }) {
  const pct = max > 0 ? Math.round((value / max) * 100) : 0;
  return (
    <div className={`progress ${className}`}>
      <div
        className={`progress-bar ${color}`}
        style={{ width: `${Math.min(pct, 100)}%` }}
        role="progressbar"
        aria-valuenow={value}
        aria-valuemin={0}
        aria-valuemax={max}
      />
    </div>
  );
}

// ── Tabs ───────────────────────────────────────────────────
export function Tabs({ tabs, active, onChange }) {
  return (
    <div className="tab-bar">
      {tabs.map(t => (
        <button
          key={t.id}
          onClick={() => onChange(t.id)}
          className={`tab-btn ${active === t.id ? 'tab-btn--active' : ''}`}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}
