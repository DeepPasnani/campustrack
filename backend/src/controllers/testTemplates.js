const { query } = require('../db');

async function listTemplates(req, res) {
  const { rows } = await query(
    'SELECT * FROM test_templates ORDER BY created_at DESC'
  );
  res.json({ templates: rows });
}

async function createTemplate(req, res) {
  const { name, description, config } = req.body;
  if (!name || !config) return res.status(400).json({ error: 'Name and config required' });

  const { rows } = await query(
    'INSERT INTO test_templates (name, description, config, created_by) VALUES ($1,$2,$3,$4) RETURNING *',
    [name, description || '', JSON.stringify(config), req.user.id]
  );
  res.status(201).json({ template: rows[0] });
}

async function deleteTemplate(req, res) {
  const { rows } = await query('DELETE FROM test_templates WHERE id=$1 RETURNING id', [req.params.id]);
  if (!rows.length) return res.status(404).json({ error: 'Template not found' });
  res.json({ message: 'Template deleted' });
}

async function createTestFromTemplate(req, res) {
  const { rows: [template] } = await query('SELECT * FROM test_templates WHERE id=$1', [req.params.templateId]);
  if (!template) return res.status(404).json({ error: 'Template not found' });

  const config = template.config;
  const { rows: [test] } = await query(
    `INSERT INTO tests (title, description, duration_minutes, department, settings, status, created_by)
     VALUES ($1,$2,$3,$4,$5,'draft',$6) RETURNING *`,
    [config.title || template.name, config.description || template.description || '', config.duration_minutes || 60, config.department || 'General', JSON.stringify(config.settings || {}), req.user.id]
  );

  if (config.sections && Array.isArray(config.sections)) {
    for (const sec of config.sections) {
      const { rows: [section] } = await query(
        'INSERT INTO sections (test_id, name, type, order_index) VALUES ($1,$2,$3,$4) RETURNING id',
        [test.id, sec.name, sec.type, sec.order_index || 0]
      );
      if (sec.questions && Array.isArray(sec.questions)) {
        for (const q of sec.questions) {
          await query(
            'INSERT INTO questions (section_id, type, text, options, correct_answer, marks, difficulty, order_index) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
            [section.id, q.type || 'mcq', q.text, JSON.stringify(q.options || []), JSON.stringify(q.correct_answer || {}), q.marks || 2, q.difficulty || 'medium', q.order_index || 0]
          );
        }
      }
    }
  }

  res.status(201).json({ test });
}

module.exports = { listTemplates, createTemplate, deleteTemplate, createTestFromTemplate };
