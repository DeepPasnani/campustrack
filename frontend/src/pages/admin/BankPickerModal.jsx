import { useState, useEffect } from 'react';
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import { Btn, Modal, ConfirmModal, Spinner, Badge } from '../../components/shared/UI';
import { questionBankAPI } from '../../services/api';
import { McqCreateModal, CodingCreateModal } from './QuestionBank';
import toast from 'react-hot-toast';

export default function BankPickerModal({ open, onClose, type, onPick, alreadyAddedIds = [] }) {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ['question-bank', type],
    queryFn: () => questionBankAPI.list({ type }),
    enabled: open,
  });
  const allQuestions = data?.questions || [];
  const alreadyAdded = new Set(alreadyAddedIds);
  // Questions already in this section have nothing useful to do here —
  // picking them again would just clone a duplicate — so they're excluded
  // from the picker entirely rather than shown disabled.
  const questions = allQuestions.filter(q => !alreadyAdded.has(q.id));
  const hiddenCount = allQuestions.length - questions.length;

  const [selected, setSelected] = useState(() => new Set());
  const [createOpen, setCreateOpen] = useState(false);
  const [deleteId, setDeleteId] = useState(null);

  // Reset selection each time the modal is (re)opened.
  useEffect(() => {
    if (open) setSelected(new Set());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const toggle = (id) => {
    setSelected(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const allSelected = questions.length > 0 && selected.size === questions.length;
  const toggleAll = () => {
    setSelected(allSelected ? new Set() : new Set(questions.map(q => q.id)));
  };

  const deleteMut = useMutation({
    mutationFn: questionBankAPI.delete,
    onSuccess: () => {
      toast.success('Removed from bank');
      qc.invalidateQueries({ queryKey: ['question-bank', type] });
      setDeleteId(null);
    },
  });

  const addSelected = () => {
    const picked = questions.filter(q => selected.has(q.id));
    if (!picked.length) return onClose();
    onPick(picked);
    onClose();
  };

  return (
    <>
      <Modal isOpen={open} onClose={onClose} title={`Add from Bank — ${type === 'mcq' ? 'MCQ' : 'Coding'} Questions`} width="max-w-2xl">
        <div className="flex items-center justify-between mb-3 gap-3">
          {hiddenCount > 0 && (
            <span className="text-2xs text-annotation/60">
              {hiddenCount} question{hiddenCount !== 1 ? 's' : ''} already in this section {hiddenCount !== 1 ? 'are' : 'is'} hidden.
            </span>
          )}
          <Btn variant="ghost" size="sm" onClick={() => setCreateOpen(true)} className="ml-auto">
            + New Question
          </Btn>
        </div>

        {isLoading ? (
          <div className="flex justify-center py-8"><Spinner /></div>
        ) : questions.length === 0 ? (
          <div className="empty-state">
            <p className="empty-state-title">
              {allQuestions.length === 0
                ? `No ${type === 'mcq' ? 'MCQ' : 'coding'} questions in the bank yet.`
                : 'Every question in the bank is already in this section.'}
            </p>
            <p className="text-xs text-annotation/60 mt-1">Use "+ New Question" above to add one.</p>
          </div>
        ) : (
          <>
            <label className="flex items-center gap-2 mb-2 text-xs text-annotation/70 cursor-pointer select-none">
              <input type="checkbox" checked={allSelected} onChange={toggleAll} />
              Select all ({questions.length})
            </label>
            <div className="max-h-96 overflow-y-auto space-y-2">
              {questions.map(q => (
                <div
                  key={q.id}
                  className="flex items-start gap-3 w-full text-left panel p-3 hover:border-accent/50 transition-colors"
                >
                  <label className="flex items-start gap-3 flex-1 min-w-0 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={selected.has(q.id)}
                      onChange={() => toggle(q.id)}
                      className="mt-1 shrink-0"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-2">
                        <span className="text-sm text-ink line-clamp-2">{type === 'mcq' ? q.data?.text : q.data?.title}</span>
                        <Badge color={q.difficulty === 'hard' ? 'alert' : q.difficulty === 'easy' ? 'verify' : 'accent'}>{q.difficulty}</Badge>
                      </div>
                      <div className="text-xs text-annotation/60 mt-1">{q.marks} marks{q.genre ? ` · ${q.genre}` : ''}</div>
                    </div>
                  </label>
                  <button
                    type="button"
                    onClick={() => setDeleteId(q.id)}
                    className="shrink-0 text-annotation/40 hover:text-alert transition-colors p-1"
                    title="Remove from bank"
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                  </button>
                </div>
              ))}
            </div>
            <div className="flex items-center justify-between gap-3 mt-4 pt-4 border-t border-rim">
              <span className="text-xs text-annotation/60">
                {selected.size} selected
              </span>
              <Btn onClick={addSelected} disabled={selected.size === 0}>
                Add Selected{selected.size > 0 ? ` (${selected.size})` : ''}
              </Btn>
            </div>
          </>
        )}
      </Modal>

      {type === 'mcq' ? (
        <McqCreateModal open={createOpen} onClose={() => setCreateOpen(false)} />
      ) : (
        <CodingCreateModal open={createOpen} onClose={() => setCreateOpen(false)} />
      )}

      <ConfirmModal
        isOpen={!!deleteId}
        onClose={() => setDeleteId(null)}
        onConfirm={() => deleteMut.mutate(deleteId)}
        title="Remove from bank"
        message="Remove this question from the bank? Tests that already used it are unaffected."
      />
    </>
  );
}
