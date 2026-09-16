function QuestionPalette({ sections, currentSection, currentQ, flagged, isAnswered, onNavigate, selectedProblems = [], questionOrder, optionOrders, timeBombs = {}, stacked = false }) {
  return (
    <div className={stacked ? 'w-full' : 'w-48 bg-panel border-l border-rim overflow-y-auto shrink-0 hidden md:block'}>
      <div className="p-3">
        <div className="eyebrow mb-3">
          Questions
        </div>
        {sections.map((sec, si) => {
          const isCodingWithSelection = sec.type === 'coding' && selectedProblems.length > 0;
          let displayQuestions = isCodingWithSelection
            ? sec.questions.filter(qq => selectedProblems.includes(qq.id))
            : sec.questions;

          const sectionQOrder = questionOrder?.[sec.id] || [];
          if (sec.type === 'aptitude' && sectionQOrder.length > 0) {
            displayQuestions = [...displayQuestions].sort(
              (a, b) => sectionQOrder.indexOf(a.id) - sectionQOrder.indexOf(b.id)
            );
          }

          return (
            <div key={sec.id} className="mb-4">
              <div className="text-xs font-medium text-annotation mb-2">{sec.name}</div>
              <div className="flex flex-wrap gap-1.5">
                {displayQuestions.map((qq, qi) => {
                  const ans = isAnswered(sec, qq);
                  const cur = si === currentSection && qi === currentQ;
                  const flg = flagged.has(qq.id);
                  const bomb = timeBombs[qq.id];
                  const expired = bomb?.enabled && bomb?.expired;
                  const cls = cur
                    ? 'q-grid-btn--current'
                    : ans
                    ? 'q-grid-btn--answered'
                    : flg
                    ? 'q-grid-btn--flagged'
                    : expired
                    ? 'q-grid-btn--default opacity-40'
                    : 'q-grid-btn--default';
                  return (
                    <button
                      key={qq.id}
                      onClick={() => !expired && onNavigate(si, qi)}
                      disabled={expired}
                      className={`q-grid-btn ${cls}`}
                      title={expired ? 'Time expired' : ''}
                    >
                      {qi + 1}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}

        <div className="mt-4 space-y-1.5 pt-3 border-t border-rim">
          {[
            ['q-grid-btn--current', 'Current'],
            ['q-grid-btn--answered', 'Answered'],
            ['q-grid-btn--flagged', 'Flagged'],
            ['q-grid-btn--default', 'Unanswered'],
          ].map(([cls, lbl]) => (
            <div key={lbl} className="flex items-center gap-1.5 text-xs text-annotation">
              <span className={`w-3 h-3 rounded border ${cls} inline-block shrink-0`} />
              {lbl}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export default QuestionPalette;
