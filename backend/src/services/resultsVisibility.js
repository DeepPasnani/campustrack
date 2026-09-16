// Shared by any endpoint that returns a score/rank derived from
// submissions — submissions.js's own detail/list views, and
// gamification.js's leaderboard, which independently queries the same
// scores and must honor the same release rule instead of leaking them
// early through a different route.
//
// Whether a student is allowed to see their score/breakdown for this test
// right now, per test.settings.showResults:
//  - 'after_submit' (default): as soon as they've submitted.
//  - 'after_end': once the test's end_time has passed (or, if no end_time
//    was set, once an admin manually publishes — same as 'manual').
//  - 'manual': only once an admin explicitly publishes via results_published_at.
//  - 'never': not to students at all, ever.
function resultsVisibleToStudent(test) {
  const mode = test.settings?.showResults || 'after_submit';
  if (mode === 'never') return false;
  if (mode === 'after_submit') return true;
  if (test.results_published_at) return true;
  if (mode === 'after_end' && test.end_time && new Date() >= new Date(test.end_time)) return true;
  return false;
}

module.exports = { resultsVisibleToStudent };
