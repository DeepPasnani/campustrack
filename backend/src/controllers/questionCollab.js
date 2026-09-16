const { query } = require('../db');

async function updateQuestionStatus(req, res) {
  const { id } = req.params;
  const { status } = req.body;
  const valid = ['draft', 'review', 'published', 'archived'];
  if (!valid.includes(status)) return res.status(400).json({ error: `Invalid status. Must be one of: ${valid.join(', ')}` });

  const { rows: [q] } = await query('SELECT * FROM bank_questions WHERE id=$1', [id]);
  if (!q) return res.status(404).json({ error: 'Question not found' });

  const oldStatus = q.status || 'draft';

  if (oldStatus === 'draft' && status !== 'review') {
    return res.status(400).json({ error: 'Draft must go to review first' });
  }
  if (oldStatus === 'review' && status !== 'published' && status !== 'draft') {
    return res.status(400).json({ error: 'Review must go to published or back to draft' });
  }

  await query('UPDATE bank_questions SET status=$1, version=version+1 WHERE id=$2', [status, id]);

  await query(
    'INSERT INTO question_versions (question_id, source_type, data, version, changed_by) VALUES ($1,$2,$3,$4,$5)',
    [id, 'bank', JSON.stringify(q), q.version + 1 || 1, req.user.id]
  );

  await query(
    `INSERT INTO audit_log (user_id, action, entity_type, entity_id, metadata)
     VALUES ($1,'question_status_change','bank_question',$2,$3)`,
    [req.user.id, id, JSON.stringify({ from: oldStatus, to: status })]
  );

  res.json({ message: `Status changed to ${status}` });
}

async function getReviewQueue(req, res) {
  const { rows } = await query(
    `SELECT bq.*, u.name as created_by_name
     FROM bank_questions bq
     LEFT JOIN users u ON bq.created_by = u.id
     WHERE bq.status = 'review'
     ORDER BY bq.created_at ASC`
  );
  res.json({ questions: rows });
}

async function submitReviewFeedback(req, res) {
  const { id } = req.params;
  const { feedback, action } = req.body;

  if (!action || !['approve', 'reject'].includes(action)) {
    return res.status(400).json({ error: 'Action must be approve or reject' });
  }

  const newStatus = action === 'approve' ? 'published' : 'draft';

  await query('UPDATE bank_questions SET status=$1 WHERE id=$2', [newStatus, id]);

  await query(
    `INSERT INTO audit_log (user_id, action, entity_type, entity_id, metadata)
     VALUES ($1,'question_review','bank_question',$2,$3)`,
    [req.user.id, id, JSON.stringify({ action, feedback: feedback || '' })]
  );

  res.json({ message: `Question ${action}d`, status: newStatus });
}

async function getVersionHistory(req, res) {
  const { id } = req.params;
  const { rows } = await query(
    `SELECT qv.*, u.name as changed_by_name
     FROM question_versions qv
     LEFT JOIN users u ON qv.changed_by = u.id
     WHERE qv.question_id = $1
     ORDER BY qv.version DESC`,
    [id]
  );
  res.json({ versions: rows });
}

async function generateQuestionVariant(req, res) {
  const { questionId } = req.params;
  const isAdmin = req.user.role === 'admin' || req.user.role === 'super_admin';

  const { rows: [q] } = await query(
    `SELECT q.*, sec.test_id
     FROM questions q JOIN sections sec ON q.section_id = sec.id
     WHERE q.id=$1`,
    [questionId]
  );
  if (!q) return res.status(404).json({ error: 'Question not found' });

  // Only requiring `authenticate` here would let any student read any
  // question's text/options by id, including ones outside their assigned
  // test — no correct_answer is exposed, but the content itself shouldn't
  // be. Require at least a submission for the owning test (i.e. they've
  // actually been assigned/started it), same gate runCode uses for coding
  // problems.
  if (!isAdmin) {
    const { rows: subRows } = await query(
      'SELECT 1 FROM submissions WHERE test_id=$1 AND user_id=$2 LIMIT 1',
      [q.test_id, req.user.id]
    );
    if (!subRows.length) return res.status(403).json({ error: 'Not authorized for this question' });
  }

  const template = q.template;
  if (!template || !template.variables || !template.variables.length) {
    return res.status(400).json({ error: 'Question is not parameterized' });
  }

  let text = template.template_text || q.text;
  const seed = req.query.seed || Math.floor(Math.random() * 100000);

  const seededRandom = (s) => {
    let x = Math.sin(s) * 10000;
    return x - Math.floor(x);
  };

  const variables = {};
  template.variables.forEach((v, i) => {
    if (v.type === 'number') {
      const min = v.min || 1;
      const max = v.max || 100;
      const step = v.step || 1;
      const rand = seededRandom(seed + i);
      const val = min + Math.floor(rand * ((max - min) / step + 1)) * step;
      variables[v.name] = val;
    } else {
      variables[v.name] = v.default || '';
    }
  });

  Object.entries(variables).forEach(([key, val]) => {
    text = text.replace(new RegExp(`\\{${key}\\}`, 'g'), val);
  });

  res.json({
    variant: {
      id: q.id,
      text,
      type: q.type,
      options: q.options,
      template_variables: variables,
    },
    seed,
  });
}

module.exports = { updateQuestionStatus, getReviewQueue, submitReviewFeedback, getVersionHistory, generateQuestionVariant };
