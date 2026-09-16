const { query } = require('../db');

// ── CSV parsing (stdlib, no dependency) ──────────────────────
// Quote-aware across the *whole* file rather than split-by-newline-first,
// so a quoted field (e.g. a multi-line sample output/testCases blob) can
// contain literal commas and newlines without corrupting row boundaries —
// splitting on '\n' before parsing quotes would otherwise cut a shape like
// a printed triangle in half.
function tokenizeCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  const src = text.replace(/\r\n/g, '\n');

  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') { field += '"'; i++; }
        else { inQuotes = false; }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      row.push(field); field = '';
    } else if (ch === '\n') {
      row.push(field); field = '';
      rows.push(row); row = [];
    } else {
      field += ch;
    }
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }

  // Drop fully-blank lines (a trailing newline, or a blank spacer row)
  return rows.filter(r => !(r.length === 1 && r[0].trim() === ''));
}

function parseCsv(text) {
  const rows = tokenizeCsv(text);
  if (rows.length < 2) return { rows: [], errors: [] };

  const headers = rows[0].map(h => h.trim());
  const dataRows = [];
  const errors = [];

  for (let i = 1; i < rows.length; i++) {
    const values = rows[i];
    if (values.length !== headers.length) {
      errors.push({ row: i + 1, message: `Expected ${headers.length} columns, got ${values.length}` });
      continue;
    }
    const row = {};
    headers.forEach((h, j) => { row[h] = (values[j] || '').trim(); });
    dataRows.push(row);
  }

  return { rows: dataRows, errors };
}

/* ═══════════════════════════════════════════════════════════
 * Question Bank — reusable MCQ / coding questions that admins
 * can build up over time and pull into any test, instead of
 * re-typing the same aptitude/DSA questions for every drive.
 *
 * Ported over from the Next.js UI-redesign prototype and wired
 * to a real Postgres-backed endpoint here.
 * ═══════════════════════════════════════════════════════════ */

// ── GET /api/question-bank?type=mcq&genre=technical&search=heap ──
// Each row also comes back with `usedIn`: the tests (if any) whose
// questions/coding_problems still point back at this bank row via
// bank_question_id — either pulled in via "Add from Bank" or
// auto-saved here from the Test Creator's "Save to Question Bank"
// checkbox. This powers the "used in" clustering in the bank UI.
async function listBank(req, res) {
  const { type, genre, search } = req.query;
  const conditions = [];
  const params = [];

  if (type) { params.push(type); conditions.push(`bq.type = $${params.length}`); }
  if (genre && genre !== 'all') { params.push(genre); conditions.push(`bq.genre = $${params.length}`); }
  if (search) { params.push(`%${search}%`); conditions.push(`bq.data->>'text' ILIKE $${params.length} OR bq.data->>'title' ILIKE $${params.length}`); }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const { rows } = await query(
    `SELECT bq.*,
       COALESCE(usage.used_in, '[]'::json) AS used_in,
       COALESCE(usage.usage_count, 0) AS usage_count
     FROM bank_questions bq
     LEFT JOIN (
       SELECT bank_question_id,
              COUNT(*) AS usage_count,
              json_agg(DISTINCT jsonb_build_object('testId', t.id, 'testTitle', t.title)) AS used_in
       FROM (
         SELECT q.bank_question_id, s.test_id FROM questions q JOIN sections s ON s.id = q.section_id WHERE q.bank_question_id IS NOT NULL
         UNION ALL
         SELECT c.bank_question_id, s.test_id FROM coding_problems c JOIN sections s ON s.id = c.section_id WHERE c.bank_question_id IS NOT NULL
       ) usages
       JOIN tests t ON t.id = usages.test_id
       GROUP BY bank_question_id
     ) usage ON usage.bank_question_id = bq.id
     ${where}
     ORDER BY bq.created_at DESC`,
    params
  );
  res.json({ questions: rows });
}

// ── POST /api/question-bank ───────────────────────────────────
async function createBank(req, res) {
  const { type, data, genre, difficulty, marks, tags } = req.body;

  if (!type || !['mcq', 'coding'].includes(type)) {
    return res.status(400).json({ error: 'type must be "mcq" or "coding"' });
  }
  if (!data || typeof data !== 'object') {
    return res.status(400).json({ error: 'data payload is required' });
  }

  const { rows: [question] } = await query(
    `INSERT INTO bank_questions (type, data, genre, difficulty, marks, tags, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
    [type, JSON.stringify(data), genre || 'general', difficulty || 'medium', marks || (type === 'mcq' ? 2 : 10), tags || null, req.user.id]
  );

  res.status(201).json({ question });
}

// ── POST /api/question-bank/import  { type, items: [...] } ────
// Bulk JSON import, mirrors the "Import JSON" flow from the
// prototype's Question Bank UI.
async function bulkImportBank(req, res) {
  const { type, items } = req.body;

  if (!type || !['mcq', 'coding'].includes(type)) {
    return res.status(400).json({ error: 'type must be "mcq" or "coding"' });
  }
  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'items must be a non-empty array' });
  }

  const inserted = [];
  for (const item of items) {
    const { genre, difficulty, marks, tags, ...data } = item;
    const { rows: [question] } = await query(
      `INSERT INTO bank_questions (type, data, genre, difficulty, marks, tags, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [type, JSON.stringify(data), genre || 'general', difficulty || 'medium', marks || (type === 'mcq' ? 2 : 10), tags || null, req.user.id]
    );
    inserted.push(question);
  }

  res.status(201).json({ message: `Imported ${inserted.length} question(s)`, questions: inserted });
}

// ── DELETE /api/question-bank/:id ─────────────────────────────
async function deleteBank(req, res) {
  const { id } = req.params;
  await query('DELETE FROM bank_questions WHERE id = $1', [id]);
  res.json({ message: 'Question removed from bank' });
}

// ── POST /api/question-bank/import-csv ───────────────────────
async function importCsv(req, res) {
  const csvText = req.body.csv;
  if (!csvText) return res.status(400).json({ error: 'CSV content required' });

  const { rows, errors: parseErrors } = parseCsv(csvText);
  if (!rows.length) {
    return res.status(400).json({ error: 'No valid rows found', parseErrors });
  }

  const inserted = [];
  const importErrors = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    try {
      if (row.type === 'mcq') {
        if (!row.text || !row.optionA || !row.optionB || !row.optionC || !row.optionD || row.correctAnswer === undefined) {
          importErrors.push({ row: i + 2, message: 'MCQ requires: text, optionA-D, correctAnswer' });
          continue;
        }
        const data = {
          text: row.text,
          options: [row.optionA, row.optionB, row.optionC, row.optionD],
          correctAnswer: parseInt(row.correctAnswer),
        };
        // Optional columns: imageUrl (question figure) and per-option
        // optionAImage-optionDImage. A row that omits them is unaffected —
        // these only get attached when actually present in the CSV.
        if (row.imageUrl) data.imageUrl = row.imageUrl;
        if (row.explanation) data.explanation = row.explanation;
        const optionImages = [row.optionAImage, row.optionBImage, row.optionCImage, row.optionDImage];
        if (optionImages.some(Boolean)) data.optionImages = optionImages.map(v => v || '');

        const { rows: [q] } = await query(
          `INSERT INTO bank_questions (type, data, genre, difficulty, marks, tags, created_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
          ['mcq', JSON.stringify(data), row.genre || 'general', row.difficulty || 'medium',
           parseInt(row.marks) || 2, null, req.user.id]
        );
        inserted.push(q);
      } else if (row.type === 'coding') {
        if (!row.title || !row.description) {
          importErrors.push({ row: i + 2, message: 'Coding requires: title, description' });
          continue;
        }
        const data = {
          title: row.title,
          description: row.description,
          sampleInput: row.sampleInput || '',
          sampleOutput: row.sampleOutput || '',
          testCases: row.testCases ? JSON.parse(row.testCases) : [],
        };
        if (row.imageUrl) data.imageUrl = row.imageUrl;
        const { rows: [q] } = await query(
          `INSERT INTO bank_questions (type, data, genre, difficulty, marks, tags, created_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
          ['coding', JSON.stringify(data), row.genre || 'general', row.difficulty || 'medium',
           parseInt(row.marks) || 10, null, req.user.id]
        );
        inserted.push(q);
      } else {
        importErrors.push({ row: i + 2, message: `Unknown type "${row.type}" — must be "mcq" or "coding"` });
      }
    } catch (err) {
      importErrors.push({ row: i + 2, message: err.message });
    }
  }

  res.status(201).json({
    message: `Imported ${inserted.length} question(s)`,
    created: inserted.length,
    errors: [...parseErrors, ...importErrors],
  });
}

// ── POST /api/question-bank/import-json ──────────────────────
// Dedicated JSON import for MCQ questions with format validation.
// Intended to be used for bulk-importing MCQ questions directly
// without needing to specify type per-item.
async function importJson(req, res) {
  const { items } = req.body;
  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'items must be a non-empty array' });
  }

  const inserted = [];
  const errors = [];

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    try {
      if (!item.text || !Array.isArray(item.options) || item.options.length < 2 || item.correctAnswer === undefined) {
        errors.push({ row: i + 1, message: 'Each item requires "text", "options" (array, min 2), and "correctAnswer"' });
        continue;
      }
      const data = {
        text: item.text,
        options: item.options,
        correctAnswer: item.correctAnswer,
      };
      // Optional: a question figure (imageUrl) and/or per-option images
      // (optionImages, same length/order as options). Either can be a
      // hosted URL (e.g. /api/images/<id> from /api/upload/image) or a
      // data: URI — both render fine as an <img src>.
      if (item.imageUrl) data.imageUrl = item.imageUrl;
      if (Array.isArray(item.optionImages) && item.optionImages.some(Boolean)) data.optionImages = item.optionImages;
      if (item.explanation) data.explanation = item.explanation;

      const { rows: [question] } = await query(
        `INSERT INTO bank_questions (type, data, genre, difficulty, marks, tags, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
        ['mcq', JSON.stringify(data), item.genre || 'general', item.difficulty || 'medium',
         item.marks || 2, item.tags || null, req.user.id]
      );
      inserted.push(question);
    } catch (err) {
      errors.push({ row: i + 1, message: err.message });
    }
  }

  res.status(201).json({
    message: `Imported ${inserted.length} MCQ question(s)`,
    created: inserted.length,
    errors: errors.length ? errors : undefined,
    questions: inserted,
  });
}

// ── POST /api/question-bank/from-test/:testId ────────────────
async function importFromTest(req, res) {
  const { testId } = req.params;
  const { questionIds } = req.body;

  const { rows: [test] } = await query('SELECT id, title FROM tests WHERE id = $1', [testId]);
  if (!test) return res.status(404).json({ error: 'Test not found' });

  const { rows: sections } = await query('SELECT id, type FROM sections WHERE test_id = $1 ORDER BY order_index', [testId]);

  const inserted = [];
  const errors = [];

  for (const section of sections) {
    if (section.type === 'aptitude') {
      const { rows: questions } = await query(
        'SELECT * FROM questions WHERE section_id = $1 ORDER BY order_index',
        [section.id]
      );
      for (const q of questions) {
        if (questionIds && !questionIds.includes(q.id)) continue;
        const data = {
          text: q.text,
          options: q.options,
          correctAnswer: q.correct_answer,
          explanation: q.explanation || '',
        };
        try {
          const { rows: [bankQ] } = await query(
            `INSERT INTO bank_questions (type, data, genre, difficulty, marks, created_by)
             VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
            ['mcq', JSON.stringify(data), q.genre || 'general', q.difficulty || 'medium', q.marks || 2, req.user.id]
          );
          inserted.push(bankQ);
        } catch (err) {
          errors.push({ id: q.id, message: err.message });
        }
      }
    } else if (section.type === 'coding') {
      const { rows: problems } = await query(
        'SELECT * FROM coding_problems WHERE section_id = $1 ORDER BY order_index',
        [section.id]
      );
      for (const p of problems) {
        if (questionIds && !questionIds.includes(p.id)) continue;
        const data = {
          title: p.title,
          description: p.description,
          inputFormat: p.input_format || '',
          outputFormat: p.output_format || '',
          constraints: p.constraints || '',
          sampleInput: p.sample_input || '',
          sampleOutput: p.sample_output || '',
          explanation: p.explanation || '',
          testCases: p.test_cases || [],
          starterCode: p.starter_code || {},
          timeLimit: p.time_limit_seconds || 2,
          memoryLimit: p.memory_limit_mb || 256,
        };
        try {
          const { rows: [bankQ] } = await query(
            `INSERT INTO bank_questions (type, data, difficulty, marks, created_by)
             VALUES ($1,$2,$3,$4,$5) RETURNING *`,
            ['coding', JSON.stringify(data), p.difficulty || 'medium', p.marks || 10, req.user.id]
          );
          inserted.push(bankQ);
        } catch (err) {
          errors.push({ id: p.id, message: err.message });
        }
      }
    }
  }

  res.status(201).json({
    message: `Added ${inserted.length} question(s) from "${test.title}" to the bank`,
    count: inserted.length,
    questions: inserted,
    errors: errors.length ? errors : undefined,
  });
}

// ── POST /api/question-bank/import-images ────────────────────
// Quick-capture path for image-based questions (scanned worksheets,
// screenshotted quant/DI figures, etc.): each uploaded image becomes
// its own draft MCQ bank entry with the image attached and the
// text/options left blank for an admin to fill in afterwards, instead
// of requiring every field to be typed up front just to get the image
// into the bank.
async function importImages(req, res) {
  const files = req.files;
  if (!files || !files.length) {
    return res.status(400).json({ error: 'At least one image file is required' });
  }

  const inserted = [];
  for (const file of files) {
    const { rows: [img] } = await query(
      `INSERT INTO images (data, mimetype, filename, size_bytes, created_by)
       VALUES ($1,$2,$3,$4,$5) RETURNING id`,
      [file.buffer, file.mimetype, file.originalname || null, file.size || file.buffer.length, req.user.id]
    );
    const data = {
      text: '',
      imageUrl: `/api/images/${img.id}`,
      options: ['', '', '', ''],
      correctAnswer: 0,
    };
    const { rows: [question] } = await query(
      `INSERT INTO bank_questions (type, data, genre, difficulty, marks, status, created_by)
       VALUES ('mcq',$1,'general','medium',2,'draft',$2) RETURNING *`,
      [JSON.stringify(data), req.user.id]
    );
    inserted.push(question);
  }

  res.status(201).json({
    message: `Added ${inserted.length} draft question(s) from images — fill in the text and options before publishing`,
    questions: inserted,
  });
}

module.exports = { listBank, createBank, bulkImportBank, importCsv, importJson, deleteBank, importFromTest, importImages };
