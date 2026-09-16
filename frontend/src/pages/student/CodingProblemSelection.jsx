import { Btn } from '../../components/shared/UI';
import toast from 'react-hot-toast';

function DifficultyBadge({ level }) {
  const map = {
    easy:   'badge-verify',
    medium: 'badge-accent',
    hard:   'badge-alert',
  };
  const cls = map[level] || 'badge-annotation';
  return <span className={cls}>{level}</span>;
}

function CodingProblemSelection({ section, selectedProblems, setSelectedProblems, codeSolutions, onConfirm }) {
  const problems = section.questions;
  const selectedEasy = problems.filter(p => selectedProblems.includes(p.id) && p.difficulty === 'easy').length;
  const selectedHard = problems.filter(p => selectedProblems.includes(p.id) && p.difficulty === 'hard').length;
  const remainingPicks = 3 - selectedProblems.length;

  const isDisabled = (id, difficulty) => {
    if (selectedProblems.includes(id)) return false;
    if (selectedProblems.length >= 3) return true;
    if (difficulty === 'easy' && selectedEasy >= 2) return true;
    if (difficulty === 'hard' && selectedHard >= 1) return true;
    return false;
  };

  const getDisabledReason = (difficulty) => {
    if (selectedProblems.length >= 3) return 'Maximum 3 problems selected';
    if (difficulty === 'easy' && selectedEasy >= 2) return 'Maximum 2 easy problems';
    if (difficulty === 'hard' && selectedHard >= 1) return 'Maximum 1 hard problem';
    return '';
  };

  const toggleProblem = (id, difficulty) => {
    setSelectedProblems(prev => {
      if (prev.includes(id)) return prev.filter(pid => pid !== id);
      if (prev.length >= 3) {
        toast.error('You can select at most 3 problems.');
        return prev;
      }
      if (difficulty === 'easy' && selectedEasy >= 2) {
        toast.error('Maximum 2 easy problems allowed.');
        return prev;
      }
      if (difficulty === 'hard' && selectedHard >= 1) {
        toast.error('Maximum 1 hard problem allowed.');
        return prev;
      }
      return [...prev, id];
    });
  };

  const alreadyHasCode = (id) =>
    Object.values(codeSolutions[id] || {}).some(c => c?.trim());

  const canConfirm = selectedProblems.length >= 1 && selectedProblems.length <= 3;

  const easyTotal = problems.filter(p => p.difficulty === 'easy').length;
  const hardTotal = problems.filter(p => p.difficulty === 'hard').length;
  const easyLeft = Math.max(0, 2 - selectedEasy);
  const hardLeft = Math.max(0, 1 - selectedHard);
  const totalLeft = Math.max(0, 3 - selectedProblems.length);

  const quotaLeftFor = (difficulty) =>
    difficulty === 'easy' ? `${easyLeft} easy left`
    : difficulty === 'hard' ? `${hardLeft} hard left`
    : `${totalLeft} picks left`;

  return (
    <div className="flex-1 flex items-start justify-center p-6 overflow-y-auto">
      <div className="max-w-2xl w-full animate-fade-up">
        <div className="mb-6">
          <h2 className="text-lg font-display font-bold text-ink mb-1">
            Select Your Coding Problems
          </h2>
          <p className="text-sm text-annotation">
            Choose <strong className="text-ink">up to 3</strong> out of {problems.length} problems.
            You may select at most 2 easy and at most 1 hard problem.
          </p>
        </div>

        {/* Selection progress bar */}
        <div className="flex items-center gap-3 mb-4 p-3 bg-panel rounded-lg border border-rim">
          <div className="flex-1">
            <div className="flex items-center justify-between text-xs text-annotation mb-1">
              <span className="font-medium">Selection progress</span>
              <span className="font-mono font-bold">{selectedProblems.length} / 3 selected</span>
            </div>
            <div className="h-1.5 bg-deck rounded-full overflow-hidden">
              <div
                className="h-full bg-accent rounded-full transition-all duration-300"
                style={{ width: `${(selectedProblems.length / 3) * 100}%` }}
              />
            </div>
          </div>
          <div className="flex gap-3 text-2xs font-mono text-annotation">
            <span className={selectedEasy >= 2 ? 'text-alert font-bold' : ''}>Easy: {selectedEasy}/{easyTotal > 2 ? 2 : easyTotal}</span>
            <span className={selectedHard >= 1 ? 'text-alert font-bold' : ''}>Hard: {selectedHard}/1</span>
          </div>
        </div>

        <div className="space-y-2.5 mb-6">
          {problems.map((p, i) => {
            const selected = selectedProblems.includes(p.id);
            const hasCode = alreadyHasCode(p.id);
            const disabled = !selected && isDisabled(p.id, p.difficulty);
            const disabledReason = disabled ? getDisabledReason(p.difficulty) : '';

            return (
              <label
                key={p.id}
                className={`flex items-start gap-4 p-4 rounded-xl border transition-all ${
                  selected
                    ? 'border-accent bg-accent/8'
                    : disabled
                      ? 'border-rim/30 bg-deck/30 opacity-50 cursor-not-allowed'
                      : 'border-rim bg-panel hover:border-annotation/40 cursor-pointer'
                }`}
                title={disabled ? disabledReason : undefined}
              >
                <input
                  type="checkbox"
                  checked={selected}
                  disabled={disabled}
                  onChange={() => !disabled && toggleProblem(p.id, p.difficulty)}
                  className="mt-1 accent-accent w-4 h-4 shrink-0"
                />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className="text-sm font-medium text-ink">
                      {p.title || `Problem ${i + 1}`}
                    </span>
                    {hasCode && (
                      <span className="badge-accent text-2xs">Has code</span>
                    )}
                  </div>
                  <div className="flex items-center gap-3 text-xs text-annotation">
                    <DifficultyBadge level={p.difficulty} />
                    <span className="font-mono">{p.marks} marks</span>
                    {p.tags && (
                      <span>{p.tags.split(',').slice(0, 2).join(', ')}</span>
                    )}
                  </div>
                </div>
                <div className="shrink-0 text-right">
                  {selected ? (
                    <span className="text-xs font-medium text-verify">Selected</span>
                  ) : disabled && disabledReason ? (
                    <span className="text-xs text-annotation italic">{disabledReason}</span>
                  ) : (
                    <span className="text-xs font-mono text-annotation/70">{quotaLeftFor(p.difficulty)}</span>
                  )}
                </div>
              </label>
            );
          })}
        </div>

        <div className="flex items-center justify-between border-t border-rim pt-4">
          <div className="text-sm text-annotation">
            {remainingPicks > 0 && selectedProblems.length < 3 ? (
              <span>Pick <strong className="text-accent font-mono">{remainingPicks}</strong> more</span>
            ) : selectedProblems.length >= 3 ? (
              <span className="text-verify font-medium">Maximum selected</span>
            ) : (
              <span className="text-annotation">Select at least 1 problem</span>
            )}
          </div>
          <div className="flex gap-2">
            {selectedProblems.length > 0 && (
              <Btn variant="ghost" size="sm" onClick={() => setSelectedProblems([])}>
                Clear All
              </Btn>
            )}
            <Btn
              variant="primary"
              size="sm"
              disabled={!canConfirm}
              onClick={onConfirm}
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" d="M5 13l4 4L19 7" />
              </svg>
              Confirm & Start Coding
            </Btn>
          </div>
        </div>
      </div>
    </div>
  );
}

export default CodingProblemSelection;
