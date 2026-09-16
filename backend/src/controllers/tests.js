const { query, getClient } = require('../db');
const { cacheGet, cacheSet, cacheDel, cacheDelPattern } = require('../db/redis');
const { ALLOWED_DEPARTMENTS } = require('../config/departments');

const VALID_DEPARTMENTS = ALLOWED_DEPARTMENTS;

function normalizeDepartments({ department, departments }) {
  let list = Array.isArray(departments) ? departments.slice() : [];
  if (!list.length && department) list = [department];
  list = [...new Set(list.map((d) => String(d || '').trim()).filter(Boolean))];

  if (!list.length) {
    const err = new Error('At least one target department is required');
    err.status = 400;
    throw err;
  }

  if (list.includes('all')) {
    return { departments: ['all'], department: 'all' };
  }

  for (const d of list) {
    if (!VALID_DEPARTMENTS.includes(d)) {
      const err = new Error(`Invalid department: ${d}`);
      err.status = 400;
      throw err;
    }
  }

  return { departments: list, department: list[0] };
}

// ── Save-to-bank helper ──────────────────────────────────────
// If a question was ticked "Also save to Question Bank" in the
// Test Creator, mirror it into bank_questions and return that row's
// id so it can be stamped onto the questions/coding_problems row as
// bank_question_id. Questions that were themselves pulled in *from*
// the bank (q.bankQuestionId already set) just keep that link — no
// duplicate bank row gets created either way.
async function resolveBankLink(client, q, sectionType, userId) {
  if (q.bankQuestionId) return q.bankQuestionId;
  if (!q.saveToBank) return null;

  const type = sectionType === 'aptitude' ? 'mcq' : 'coding';
  const data = sectionType === 'aptitude'
    ? {
        type: q.type || 'mcq',
        text: q.text,
        imageUrl: q.imageUrl || q.image_url || '',
        options: q.options || [],
        optionImages: q.optionImages || q.option_images || [],
        correctAnswer: q.correctAnswer,
        explanation: q.explanation || '',
      }
    : {
        title: q.title,
        description: q.description,
        imageUrl: q.imageUrl || q.image_url || '',
        inputFormat: q.inputFormat || '',
        outputFormat: q.outputFormat || '',
        constraints: q.constraints || '',
        sampleInput: q.sampleInput || '',
        sampleOutput: q.sampleOutput || '',
        explanation: q.explanation || '',
        testCases: q.testCases || [],
        starterCode: q.starterCode || {},
        timeLimit: q.timeLimit || 2,
        memoryLimit: q.memoryLimit || 256,
      };

  const { rows: [bankQ] } = await client.query(
    `INSERT INTO bank_questions (type, data, genre, difficulty, marks, tags, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
    [type, JSON.stringify(data), q.genre || 'general', q.difficulty || 'medium',
     q.marks || (type === 'mcq' ? 2 : 10), q.tags || null, userId]
  );
  return bankQ.id;
}

function studentCanAccessTest(test, userDepartment, userClass, userYear) {
  // Department check
  const depts = Array.isArray(test.departments) && test.departments.length
    ? test.departments
    : (test.department ? [test.department] : []);
  if (depts.length && !depts.includes('all')) {
    const deptOk = depts.includes(userDepartment) || test.department === userDepartment;
    if (!deptOk) return false;
  }

  // Class check: if specific classes are selected, student must be in one.
  const classList = Array.isArray(test.classes) ? test.classes.filter(Boolean) : [];
  if (classList.length && !classList.includes('all')) {
    if (!userClass || !classList.includes(userClass)) return false;
  }

  // Year check: if specific years are selected, student's year must match.
  const years = Array.isArray(test.years) ? test.years.filter(y => y !== null && y !== '') : [];
  if (years.length && !years.includes('all')) {
    const yStr = String(userYear);
    if (!userYear || !years.map(String).includes(yStr)) return false;
  }

  return true;
}

// ── GET /api/tests (admin/super_admin: all tests, so every admin account can
// see tests created by teammates; student: published + their department)
async function listTests(req, res) {
  const userRole = req.user.role;
  const userDepartment = req.user.department;
  const userClass = req.user.class_name;
  const userYear = req.user.year_of_study;

  let whereClause = '';
  const params = [];

  if (userRole === 'super_admin' || userRole === 'admin') {
    whereClause = '';
  } else if (userRole === 'student') {
    whereClause = 'WHERE t.status = $1';
    params.push('published');

    const conditions = [];
    const addParam = (v) => {
      params.push(v);
      return `$${params.length}`;
    };

    if (userDepartment) {
      const p = addParam(userDepartment);
      conditions.push(`(t.department = 'all' OR t.department = ${p}
          OR COALESCE(t.departments, '[]'::jsonb) @> to_jsonb(${p}::text)
          OR COALESCE(t.departments, '[]'::jsonb) @> '"all"'::jsonb)`);
    } else {
      conditions.push(`(t.department = 'all' OR COALESCE(t.departments, '[]'::jsonb) @> '"all"'::jsonb)`);
    }

    if (userClass) {
      const p = addParam(userClass);
      conditions.push(`(COALESCE(t.classes, '[]'::jsonb) = '[]'::jsonb
          OR COALESCE(t.classes, '[]'::jsonb) @> '"all"'::jsonb
          OR COALESCE(t.classes, '[]'::jsonb) @> to_jsonb(${p}::text))`);
    } else {
      conditions.push(`(COALESCE(t.classes, '[]'::jsonb) = '[]'::jsonb
          OR COALESCE(t.classes, '[]'::jsonb) @> '"all"'::jsonb)`);
    }

    if (userYear) {
      const p = addParam(userYear);
      conditions.push(`(COALESCE(t.years, '[]'::jsonb) = '[]'::jsonb
          OR COALESCE(t.years, '[]'::jsonb) @> '"all"'::jsonb
          OR COALESCE(t.years, '[]'::jsonb) @> to_jsonb(${p}::text))`);
    } else {
      conditions.push(`(COALESCE(t.years, '[]'::jsonb) = '[]'::jsonb
          OR COALESCE(t.years, '[]'::jsonb) @> '"all"'::jsonb)`);
    }

    whereClause += ' AND ' + conditions.join(' AND ');
  }

  const { rows } = await query(`
    SELECT t.*,
      u.name as created_by_name,
      (SELECT COUNT(*) FROM sections s WHERE s.test_id = t.id) as section_count,
      (SELECT COUNT(*) FROM submissions sub WHERE sub.test_id = t.id) as submission_count
    FROM tests t
    LEFT JOIN users u ON t.created_by = u.id
    ${whereClause}
    ORDER BY t.created_at DESC
  `, params);

  res.json({ tests: rows });
}

// ── GET /api/tests/:id (with all sections + questions)
async function getTest(req, res) {
  const { id } = req.params;
  const userRole = req.user.role;
  const userDepartment = req.user.department;
  const isAdmin = userRole === 'admin' || userRole === 'super_admin';

  const cacheKey = `test:${id}:full:${isAdmin ? 'admin' : (req.user.class_name || 'none')}`;
  if (!isAdmin) {
    const cached = await cacheGet(cacheKey);
    if (cached) return res.json(cached);
  }

  const { rows: testRows } = await query('SELECT * FROM tests WHERE id = $1', [id]);
  if (!testRows.length) return res.status(404).json({ error: 'Test not found' });
  const test = testRows[0];

  // Check access permissions
  if (!isAdmin) {
    if (test.status !== 'published') {
      return res.status(403).json({ error: 'Test not available' });
    }
    if (!studentCanAccessTest(test, userDepartment, req.user.class_name, req.user.year_of_study)) {
      return res.status(403).json({ error: 'Test not available for your department' });
    }
    // Publishing a test only makes it visible on the dashboard with its
    // schedule — the question paper itself (this endpoint) must stay
    // inaccessible until the window actually opens, otherwise anyone who
    // calls the API directly (dev tools, curl) can read every question
    // before the exam starts.
    if (test.start_time && new Date() < new Date(test.start_time)) {
      return res.status(403).json({ error: 'Test has not started yet' });
    }
  }

  const { rows: sections } = await query(
    'SELECT * FROM sections WHERE test_id = $1 ORDER BY order_index',
    [id]
  );

  // Determine which MCQ "set" (A/B/C/D) this student's class should see,
  // if the admin has configured a class→set mapping for this test.
  let mySet = null;
  if (!isAdmin && req.user.class_name) {
    const { rows: mapRows } = await query(
      `SELECT tc.section_mapping FROM test_classes tc
       JOIN classes c ON tc.class_id = c.id
       WHERE tc.test_id = $1 AND c.name = $2 LIMIT 1`,
      [id, req.user.class_name]
    );
    mySet = mapRows[0]?.section_mapping?.set || null;
  }

  for (const section of sections) {
    if (section.type === 'aptitude') {
      const { rows: questions } = await query(
        `SELECT id, type, text, image_url, options, option_images, marks, difficulty, genre, question_set, order_index
         ${isAdmin ? ', correct_answer, explanation' : ''}
         FROM questions WHERE section_id = $1 ORDER BY order_index`,
        [section.id]
      );
      section.questions = isAdmin || !mySet
        ? questions
        : questions.filter(q => (q.question_set || 'A') === mySet);
    } else {
      const { rows: problems } = await query(
        `SELECT id, title, description, image_url, input_format, output_format, constraints,
         sample_input, sample_output, starter_code, marks, difficulty, tags, time_limit_seconds, memory_limit_mb
         ${isAdmin ? ', test_cases, explanation' : ", (SELECT jsonb_agg(tc) FROM jsonb_array_elements(test_cases) tc WHERE NOT (tc->>'isHidden')::boolean) as test_cases"}
         FROM coding_problems WHERE section_id = $1 ORDER BY order_index`,
        [section.id]
      );
      section.questions = problems;
    }
  }

  const result = { ...test, sections };
  if (!isAdmin) await cacheSet(cacheKey, result, 300);

  res.json(result);
}

// ── POST /api/tests (admin only)
async function createTest(req, res) {
  const { title, description, status, startTime, endTime, durationMinutes, settings, sections, department, departments, years, classes } = req.body;

  if (!title) return res.status(400).json({ error: 'Title required' });

  let norm;
  try {
    norm = normalizeDepartments({ department, departments });
  } catch (err) {
    return res.status(err.status || 400).json({ error: err.message });
  }
const finalDepartment = norm.department;
  const finalDepartments = norm.departments;
  const finalYears = Array.isArray(years) ? years.filter(y => y !== null && y !== '').map(String) : [];
  const finalClasses = Array.isArray(classes) ? classes.filter(c => c !== null && c !== '').map(String) : [];

  const client = await getClient();
  try {
    await client.query('BEGIN');

    const { rows: [test] } = await client.query(
      `INSERT INTO tests (title, description, status, start_time, end_time, duration_minutes, department, departments, years, classes, settings, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
      [title, description, status || 'draft', startTime || null, endTime || null,
       durationMinutes || 90, finalDepartment, JSON.stringify(finalDepartments),
       JSON.stringify(finalYears), JSON.stringify(finalClasses), JSON.stringify(settings || {}), req.user.id]
    );

    if (sections?.length) {
      for (let si = 0; si < sections.length; si++) {
        const sec = sections[si];
        const { rows: [section] } = await client.query(
          'INSERT INTO sections (test_id, name, type, order_index) VALUES ($1,$2,$3,$4) RETURNING *',
          [test.id, sec.name, sec.type, si]
        );

        if (sec.questions?.length) {
          for (let qi = 0; qi < sec.questions.length; qi++) {
            const q = sec.questions[qi];
            const bankQuestionId = await resolveBankLink(client, q, sec.type, req.user.id);
            if (sec.type === 'aptitude') {
              await client.query(
                `INSERT INTO questions (section_id, type, text, image_url, options, option_images, correct_answer, explanation, marks, difficulty, genre, question_set, order_index, bank_question_id)
                 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
                [section.id, q.type || 'mcq', q.text, q.imageUrl || q.image_url || null,
                 JSON.stringify(q.options || []), JSON.stringify(q.optionImages || q.option_images || []),
                 JSON.stringify(q.correctAnswer), q.explanation, q.marks || 2, q.difficulty || 'medium', q.genre || 'general', q.questionSet || 'A', qi, bankQuestionId]
              );
            } else {
              await client.query(
                `INSERT INTO coding_problems (section_id, title, description, image_url, input_format, output_format,
                 constraints, sample_input, sample_output, explanation, test_cases, starter_code,
                 time_limit_seconds, memory_limit_mb, marks, difficulty, tags, order_index, bank_question_id)
                 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)`,
                [section.id, q.title, q.description, q.imageUrl || q.image_url || null, q.inputFormat, q.outputFormat,
                 q.constraints, q.sampleInput, q.sampleOutput, q.explanation,
                 JSON.stringify(q.testCases || []), JSON.stringify(q.starterCode || {}),
                 q.timeLimit || 2, q.memoryLimit || 256, q.marks || 10, q.difficulty || 'medium', q.tags, qi, bankQuestionId]
              );
            }
          }
        }
      }
    }

    await client.query('COMMIT');
    res.status(201).json({ test, message: 'Test created successfully' });
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// ── PUT /api/tests/:id
async function updateTest(req, res) {
  const { id } = req.params;
  const { title, description, status, startTime, endTime, durationMinutes, settings, sections, department, departments, years, classes } = req.body;

  let norm;
  try {
    norm = normalizeDepartments({ department, departments });
  } catch (err) {
    return res.status(err.status || 400).json({ error: err.message });
  }
  const finalDepartment = norm.department;
  const finalDepartments = norm.departments;
  const finalYears = Array.isArray(years) ? years.filter(y => y !== null && y !== '').map(String) : [];
  const finalClasses = Array.isArray(classes) ? classes.filter(c => c !== null && c !== '').map(String) : [];

  // Editing sections/questions deletes and re-inserts every question with a
  // brand-new id (see below). Any student currently mid-test has answers
  // keyed to the *old* ids — swapping the question set out from under them
  // orphans those answers (they silently score 0 at grading time) and can
  // shuffle question order on their screen the moment their client refetches.
  // The same orphaning hits submitted/auto_submitted rows too, not just
  // in_progress ones: their stored answers/detailedResults still key off the
  // old question ids, so a later regrade (or just reviewing "what did I get
  // wrong") silently breaks. So once *any* submission exists for this test,
  // structural edits are refused; everything else (title, schedule, settings,
  // targeting) can still be saved.
  let sectionsSkipped = false;
  if (sections?.length) {
    const { rows: activeRows } = await query(
      "SELECT COUNT(*)::int AS n FROM submissions WHERE test_id=$1",
      [id]
    );
    if (activeRows[0]?.n > 0) sectionsSkipped = true;
  }

  const client = await getClient();
  try {
    await client.query('BEGIN');

    const { rows } = await client.query(
      `UPDATE tests SET title=$1, description=$2, status=$3, start_time=$4, end_time=$5,
       duration_minutes=$6, department=$7, departments=$8, years=$9, classes=$10, settings=$11, updated_at=NOW() WHERE id=$12 RETURNING *`,
      [title, description, status, startTime || null, endTime || null,
       durationMinutes, finalDepartment, JSON.stringify(finalDepartments),
       JSON.stringify(finalYears), JSON.stringify(finalClasses), JSON.stringify(settings || {}), id]
    );

    if (!rows.length) {
      await client.query('ROLLBACK');
      client.release();
      return res.status(404).json({ error: 'Test not found' });
    }

    // Delete existing sections (questions cascade-deleted) and re-insert
    if (sections?.length && !sectionsSkipped) {
      await client.query('DELETE FROM sections WHERE test_id = $1', [id]);

      for (let si = 0; si < sections.length; si++) {
        const sec = sections[si];
        const { rows: [section] } = await client.query(
          'INSERT INTO sections (test_id, name, type, order_index) VALUES ($1,$2,$3,$4) RETURNING *',
          [id, sec.name, sec.type, si]
        );

        if (sec.questions?.length) {
          for (let qi = 0; qi < sec.questions.length; qi++) {
            const q = sec.questions[qi];
            const bankQuestionId = await resolveBankLink(client, q, sec.type, req.user.id);
            if (sec.type === 'aptitude') {
              await client.query(
                `INSERT INTO questions (section_id, type, text, image_url, options, option_images, correct_answer, explanation, marks, difficulty, genre, question_set, order_index, bank_question_id)
                 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
                [section.id, q.type || 'mcq', q.text, q.imageUrl || q.image_url || null,
                 JSON.stringify(q.options || []), JSON.stringify(q.optionImages || q.option_images || []),
                 JSON.stringify(q.correctAnswer), q.explanation, q.marks || 2, q.difficulty || 'medium', q.genre || 'general', q.questionSet || 'A', qi, bankQuestionId]
              );
            } else {
              await client.query(
                `INSERT INTO coding_problems (section_id, title, description, image_url, input_format, output_format,
                 constraints, sample_input, sample_output, explanation, test_cases, starter_code,
                 time_limit_seconds, memory_limit_mb, marks, difficulty, tags, order_index, bank_question_id)
                 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)`,
                [section.id, q.title, q.description, q.imageUrl || q.image_url || null, q.inputFormat, q.outputFormat,
                 q.constraints, q.sampleInput, q.sampleOutput, q.explanation,
                 JSON.stringify(q.testCases || []), JSON.stringify(q.starterCode || {}),
                 q.timeLimit || 2, q.memoryLimit || 256, q.marks || 10, q.difficulty || 'medium', q.tags, qi, bankQuestionId]
              );
            }
          }
        }
      }
    }

    await client.query('COMMIT');
    client.release();

    await cacheDelPattern(`test:${id}:full:`);
    res.json({
      test: rows[0],
      message: sectionsSkipped
        ? 'Test details updated. Question/section changes were NOT applied because at least one student has already started or submitted this test — duplicate the test to create a new version instead.'
        : 'Test updated successfully',
      sectionsSkipped,
    });
  } catch (err) {
    await client.query('ROLLBACK');
    client.release();
    throw err;
  }
}

// ── DELETE /api/tests/:id
async function deleteTest(req, res) {
  const { id } = req.params;
  await query('DELETE FROM tests WHERE id = $1', [id]);
  await cacheDelPattern(`test:${id}:full:`);
  res.json({ message: 'Test deleted' });
}

// ── POST /api/tests/:id/duplicate
async function duplicateTest(req, res) {
  const { id } = req.params;
  const { rows: [orig] } = await query('SELECT * FROM tests WHERE id = $1', [id]);
  if (!orig) return res.status(404).json({ error: 'Test not found' });

  req.body = {
    ...orig,
    title: `${orig.title} (Copy)`,
    status: 'draft',
    settings: orig.settings,
    sections: (await buildTestData(id)).sections,
  };
  return createTest(req, res);
}

// createTest's INSERT reads camelCase fields off each question (q.testCases,
// q.correctAnswer, ...) because that's the shape the Test Creator frontend
// sends. Rows read straight back out of the DB are snake_case
// (q.test_cases, q.correct_answer, ...), so without this translation every
// one of those reads as undefined and gets silently dropped — which is
// exactly what made a duplicated test's coding problems come out with no
// test cases/starter code, and its MCQs with no correct answer. Same root
// cause TestCreator.jsx's own normalizeQuestion() already works around for
// the "load an existing question into the editor" path; this is that same
// fix for the "duplicate a test" path.
function normalizeQuestionRow(q, sectionType) {
  if (sectionType === 'aptitude') {
    return {
      ...q,
      correctAnswer: q.correct_answer,
      questionSet: q.question_set,
      bankQuestionId: q.bank_question_id,
    };
  }
  return {
    ...q,
    inputFormat: q.input_format,
    outputFormat: q.output_format,
    sampleInput: q.sample_input,
    sampleOutput: q.sample_output,
    testCases: q.test_cases,
    starterCode: q.starter_code,
    timeLimit: q.time_limit_seconds,
    memoryLimit: q.memory_limit_mb,
    bankQuestionId: q.bank_question_id,
  };
}

async function buildTestData(testId) {
  const { rows: sections } = await query('SELECT * FROM sections WHERE test_id=$1 ORDER BY order_index', [testId]);
  for (const s of sections) {
    if (s.type === 'aptitude') {
      const { rows } = await query('SELECT * FROM questions WHERE section_id=$1 ORDER BY order_index', [s.id]);
      s.questions = rows.map(q => normalizeQuestionRow(q, 'aptitude'));
    } else {
      const { rows } = await query('SELECT * FROM coding_problems WHERE section_id=$1 ORDER BY order_index', [s.id]);
      s.questions = rows.map(q => normalizeQuestionRow(q, 'coding'));
    }
  }
  return { sections };
}

async function schedulePublish(req, res) {
  const { scheduled_publish_at } = req.body;
  if (!scheduled_publish_at) return res.status(400).json({ error: 'scheduled_publish_at required' });

  const { rows } = await query(
    'UPDATE tests SET scheduled_publish_at=$1 WHERE id=$2 RETURNING *',
    [scheduled_publish_at, req.params.id]
  );
  if (!rows.length) return res.status(404).json({ error: 'Test not found' });

  res.json({ test: rows[0] });
}

module.exports = { listTests, getTest, createTest, updateTest, deleteTest, duplicateTest, schedulePublish };
