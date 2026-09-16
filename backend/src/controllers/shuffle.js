const { query } = require('../db');
const logger = require('../services/logger');

function seededRandom(seed) {
  let s = seed;
  return function () {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s / 0x7fffffff;
  };
}

function shuffleArray(arr, rng) {
  const shuffled = [...arr];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

function generateSeed(userId, testId) {
  const str = `${userId}-${testId}`;
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return Math.abs(hash).toString(36);
}

// POST /api/tests/:id/assign-shuffle
async function assignShuffle(req, res) {
  const testId = req.params.id;
  const userId = req.user.id;

  const seed = generateSeed(userId, testId);
  const rng = seededRandom(parseInt(seed, 36) || 1);

  const { rows: sections } = await query(
    'SELECT id, type FROM sections WHERE test_id=$1 ORDER BY order_index',
    [testId]
  );

  const questionOrder = {};
  const optionOrders = {};

  for (const section of sections) {
    if (section.type === 'aptitude') {
      const { rows: questions } = await query(
        'SELECT id FROM questions WHERE section_id=$1 ORDER BY order_index',
        [section.id]
      );
      const qIds = questions.map(q => q.id);
      questionOrder[section.id] = shuffleArray(qIds, rng);

      for (const qId of qIds) {
        const { rows: [q] } = await query('SELECT options FROM questions WHERE id=$1', [qId]);
        if (q?.options && Array.isArray(q.options) && q.options.length > 0) {
          const indices = q.options.map((_, i) => i);
          optionOrders[qId] = shuffleArray(indices, rng);
        }
      }
    }
  }

  await query(
    `INSERT INTO test_shuffles (test_id, user_id, question_order, option_orders, seed)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (test_id, user_id) DO UPDATE
     SET question_order = $3, option_orders = $4, seed = $5`,
    [testId, userId, JSON.stringify(questionOrder), JSON.stringify(optionOrders), seed]
  );

  res.json({ seed, questionOrder, optionOrders });
}

// GET /api/tests/:id/shuffle
async function getShuffle(req, res) {
  const testId = req.params.id;
  const userId = req.user.id;

  const { rows } = await query(
    'SELECT * FROM test_shuffles WHERE test_id=$1 AND user_id=$2',
    [testId, userId]
  );

  if (!rows.length) {
    return res.json({ shuffled: false });
  }

  res.json({
    shuffled: true,
    seed: rows[0].seed,
    questionOrder: rows[0].question_order,
    optionOrders: rows[0].option_orders,
  });
}

module.exports = { assignShuffle, getShuffle };
