import { Btn, Modal, Alert, Spinner } from '../../components/shared/UI';

function ConfirmSubmitModal({ isOpen, onClose, answeredCount, totalQ, submitting, onSubmit, tabSwitchCount, fullscreenExitCount }) {
  const remaining = totalQ - answeredCount;
  const tabSwitches = Math.max(0, tabSwitchCount || 0);
  const fullscreenExits = Math.max(0, fullscreenExitCount || 0);
  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Submit Test?" width="max-w-sm">
      <Alert type="warning" className="mb-4">
        This will permanently submit your test. You cannot make changes after submission.
      </Alert>
      <div className="grid grid-cols-2 gap-3 mb-4">
        <div className="panel p-4 text-center">
          <div className="eyebrow mb-1">Answered</div>
          <div className="text-2xl font-display font-bold text-verify score-digit">{answeredCount}</div>
        </div>
        <div className="panel p-4 text-center">
          <div className="eyebrow mb-1">Remaining</div>
          <div className={`text-2xl font-display font-bold score-digit ${remaining > 0 ? 'text-accent' : 'text-annotation'}`}>{remaining}</div>
        </div>
      </div>
      {tabSwitches > 0 && (
        <div className="flex items-center gap-2 mb-3 text-xs text-annotation">
          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          {tabSwitches} tab switches{fullscreenExits > 0 ? ` · ${fullscreenExits} fullscreen exits` : ''}
        </div>
      )}
      <div className="flex gap-2 justify-end">
        <Btn variant="ghost" onClick={onClose} disabled={submitting}>
          Continue Test
        </Btn>
        <Btn variant="success" onClick={onSubmit} disabled={submitting}>
          {submitting ? (
            <><Spinner size={14} className="text-deck" /> Submitting…</>
          ) : (
            <><svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" d="M5 13l4 4L19 7" /></svg> Confirm Submit</>
          )}
        </Btn>
      </div>
    </Modal>
  );
}

export default ConfirmSubmitModal;
