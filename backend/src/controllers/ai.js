const aiService = require('../services/aiService');
const { query } = require('../db');
const logger = require('../services/logger');

async function generateMCQs(req, res) {
  try {
    const { topic, count, difficulty, genre } = req.body;
    let questions;

    if (req.file) {
      questions = await aiService.generateMCQFromPDF(req.file.buffer);
    } else if (topic) {
      questions = await aiService.generateMCQFromTopic(topic, parseInt(count) || 5, difficulty || 'medium', genre || 'general');
    } else {
      return res.status(400).json({ error: 'Provide topic or PDF file' });
    }

    res.json({ questions });
  } catch (err) {
    logger.error({ err }, 'generateMCQs failed');
    res.status(500).json({ error: err.message || 'AI generation failed' });
  }
}

async function saveGeneratedMCQs(req, res) {
  try {
    const { questions } = req.body;
    if (!Array.isArray(questions) || !questions.length) {
      return res.status(400).json({ error: 'questions array required' });
    }

    const inserted = [];
    for (const q of questions) {
      const { rows: [saved] } = await query(
        `INSERT INTO bank_questions (type, data, genre, difficulty, marks, tags, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
        ['mcq', JSON.stringify(q.data), q.genre || 'general', q.difficulty || 'medium',
         q.marks || 2, q.tags || null, req.user.id]
      );
      inserted.push(saved);
    }

    res.status(201).json({ message: `Saved ${inserted.length} question(s)`, questions: inserted });
  } catch (err) {
    logger.error({ err }, 'saveGeneratedMCQs failed');
    res.status(500).json({ error: err.message });
  }
}

async function generateCodingHints(req, res) {
  try {
    const { problemId, studentCode, hintLevel } = req.body;
    if (!problemId) return res.status(400).json({ error: 'problemId required' });

    const result = await aiService.getCodingHint(problemId, studentCode || '', parseInt(hintLevel) || 1);

    await query(
      `INSERT INTO audit_log (user_id, action, entity_type, entity_id, metadata)
       VALUES ($1, 'coding_hint', 'coding_problem', $2, $3)`,
      [req.user.id, problemId, JSON.stringify({ hintLevel: parseInt(hintLevel) || 1 })]
    );

    res.json(result);
  } catch (err) {
    logger.error({ err }, 'generateCodingHints failed');
    res.status(500).json({ error: err.message });
  }
}

async function adaptiveDifficulty(req, res) {
  try {
    const { testId } = req.body;
    if (!testId) return res.status(400).json({ error: 'testId required' });

    const result = await aiService.adaptiveNextDifficulty(req.user.id, testId);
    res.json(result);
  } catch (err) {
    logger.error({ err }, 'adaptiveDifficulty failed');
    res.status(500).json({ error: err.message });
  }
}

async function autoTagQuestions(req, res) {
  try {
    const { questionId } = req.body;
    if (!questionId) return res.status(400).json({ error: 'questionId required' });

    const { rows: [q] } = await query('SELECT * FROM bank_questions WHERE id=$1', [questionId]);
    if (!q) return res.status(404).json({ error: 'Question not found' });

    const text = q.data?.text || q.data?.title || '';
    const tags = await aiService.autoTagQuestion(text, q.data?.options);

    await query(
      `UPDATE bank_questions SET genre=$1, difficulty=$2, tags=$3 WHERE id=$4`,
      [tags.genre || q.genre, tags.difficulty || q.difficulty, tags.tags ? tags.tags.join(', ') : q.tags, questionId]
    );

    res.json({ question: { ...q, genre: tags.genre, difficulty: tags.difficulty, tags: tags.tags?.join(', ') }, suggested_tags: tags });
  } catch (err) {
    logger.error({ err }, 'autoTagQuestions failed');
    res.status(500).json({ error: err.message });
  }
}

async function autoTagBatch(req, res) {
  try {
    const { rows: untagged } = await query(
      'SELECT * FROM bank_questions WHERE tags IS NULL OR tags = \'\' OR genre = \'general\''
    );

    const results = [];
    for (const q of untagged) {
      try {
        const text = q.data?.text || q.data?.title || '';
        const tags = await aiService.autoTagQuestion(text, q.data?.options);
        await query(
          `UPDATE bank_questions SET genre=$1, difficulty=$2, tags=$3 WHERE id=$4`,
          [tags.genre || q.genre, tags.difficulty || q.difficulty, tags.tags ? tags.tags.join(', ') : q.tags, q.id]
        );
        results.push({ id: q.id, status: 'tagged', tags });
      } catch (e) {
        results.push({ id: q.id, status: 'error', error: e.message });
      }
    }

    res.json({ total: untagged.length, processed: results.length, results });
  } catch (err) {
    logger.error({ err }, 'autoTagBatch failed');
    res.status(500).json({ error: err.message });
  }
}

async function generateFeedback(req, res) {
  try {
    const { userId, testId } = req.body;
    const targetUserId = userId || req.user.id;
    const targetTestId = testId;

    if (!targetTestId) return res.status(400).json({ error: 'testId required' });

    const feedback = await aiService.generatePerformanceFeedback(targetUserId, targetTestId);
    res.json({ feedback });
  } catch (err) {
    logger.error({ err }, 'generateFeedback failed');
    res.status(500).json({ error: err.message });
  }
}

async function naturalLanguageQueryHandler(req, res) {
  try {
    const { query: queryText } = req.body;
    if (!queryText) return res.status(400).json({ error: 'query text required' });

    const result = await aiService.naturalLanguageQuery(queryText, req.user.id);
    res.json(result);
  } catch (err) {
    logger.error({ err }, 'naturalLanguageQuery failed');
    res.status(500).json({ error: err.message });
  }
}

async function logKeystroke(req, res) {
  try {
    const { submissionId, questionId, eventType, metadata } = req.body;
    if (!submissionId || !eventType) return res.status(400).json({ error: 'submissionId and eventType required' });

    const { rows: [sub] } = await query('SELECT test_id FROM submissions WHERE id=$1', [submissionId]);
    if (!sub) return res.status(404).json({ error: 'Submission not found' });

    await query(
      `INSERT INTO keystroke_logs (submission_id, question_id, test_id, event_type, metadata)
       VALUES ($1,$2,$3,$4,$5)`,
      [submissionId, questionId || null, sub.test_id, eventType, metadata ? JSON.stringify(metadata) : '{}']
    );

    res.status(201).json({ logged: true });
  } catch (err) {
    logger.error({ err }, 'logKeystroke failed');
    res.status(500).json({ error: err.message });
  }
}

async function getCheatingAnalysis(req, res) {
  try {
    const { testId } = req.params;
    const flags = await aiService.analyzeCheating(testId);
    res.json({ test_id: testId, total_flags: flags.length, flags });
  } catch (err) {
    logger.error({ err }, 'getCheatingAnalysis failed');
    res.status(500).json({ error: err.message });
  }
}

async function getStoredCheatingFlags(req, res) {
  try {
    const { testId } = req.params;
    const { rows } = await query(
      'SELECT * FROM suspicious_flags WHERE test_id=$1 ORDER BY suspicion_score DESC',
      [testId]
    );
    res.json({ flags: rows });
  } catch (err) {
    logger.error({ err }, 'getStoredCheatingFlags failed');
    res.status(500).json({ error: err.message });
  }
}

module.exports = {
  generateMCQs,
  saveGeneratedMCQs,
  generateCodingHints,
  adaptiveDifficulty,
  autoTagQuestions,
  autoTagBatch,
  generateFeedback,
  naturalLanguageQueryHandler,
  logKeystroke,
  getCheatingAnalysis,
  getStoredCheatingFlags,
};
