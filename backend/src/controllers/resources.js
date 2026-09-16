const multer = require('multer');
const { query } = require('../db');
const { ALLOWED_DEPARTMENTS } = require('../config/departments');

const CATEGORIES = ['aptitude', 'coding', 'gd', 'pi'];

// Document types only — no images (upload.js/cloudinary.js already cover
// those) and, notably, no SVG/HTML-capable type: this file gets served
// back with its own declared content-type, so accepting anything a
// browser could execute would reopen the same stored-XSS risk the image
// upload allow-list was tightened to avoid.
const ALLOWED_MIME_TYPES = new Set([
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
]);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_MIME_TYPES.has(file.mimetype)) cb(null, true);
    else cb(new Error('Only PDF, Word, PowerPoint, or Excel files are allowed'));
  },
});

function isAdmin(user) {
  return user.role === 'admin' || user.role === 'super_admin';
}

// Same shape as tests.js's own targeting arrays (departments/years/classes,
// each either empty/["all"] for "everyone" or a specific list) — a
// resource is visible to a student if every one of these matches, same
// rule a test uses to decide who can see it.
function studentCanAccessResource(resource, userDepartment, userClass, userYear) {
  const depts = Array.isArray(resource.departments) ? resource.departments.filter(Boolean) : [];
  if (depts.length && !depts.includes('all')) {
    if (!userDepartment || !depts.includes(userDepartment)) return false;
  }

  const classList = Array.isArray(resource.classes) ? resource.classes.filter(Boolean) : [];
  if (classList.length && !classList.includes('all')) {
    if (!userClass || !classList.includes(userClass)) return false;
  }

  const years = Array.isArray(resource.years) ? resource.years.filter(y => y !== null && y !== '') : [];
  if (years.length && !years.includes('all')) {
    const yStr = String(userYear);
    if (!userYear || !years.map(String).includes(yStr)) return false;
  }

  return true;
}

function normalizeTargeting({ departments, years, classes }) {
  const deptList = Array.isArray(departments) ? departments.filter(Boolean) : [];
  if (deptList.length && !deptList.includes('all')) {
    for (const d of deptList) {
      if (!ALLOWED_DEPARTMENTS.includes(d)) {
        const err = new Error(`Invalid department: ${d}`);
        err.status = 400;
        throw err;
      }
    }
  }
  return {
    departments: deptList,
    years: Array.isArray(years) ? years.filter(y => y !== null && y !== '').map(String) : [],
    classes: Array.isArray(classes) ? classes.filter(Boolean) : [],
  };
}

// GET /api/resources?category=aptitude
async function listResources(req, res) {
  const { category } = req.query;
  if (category && !CATEGORIES.includes(category)) {
    return res.status(400).json({ error: `Invalid category. Must be one of: ${CATEGORIES.join(', ')}` });
  }

  const params = [];
  const filters = [];
  if (category) {
    params.push(category);
    filters.push(`category = $${params.length}`);
  }
  const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';

  const { rows } = await query(
    `SELECT r.id, r.title, r.description, r.category, r.mimetype, r.filename, r.size_bytes,
       r.departments, r.years, r.classes, r.created_at, u.name as uploaded_by_name
     FROM resources r LEFT JOIN users u ON r.created_by = u.id
     ${where}
     ORDER BY r.created_at DESC`,
    params
  );

  const admin = isAdmin(req.user);
  const visible = admin
    ? rows
    : rows.filter(r => studentCanAccessResource(r, req.user.department, req.user.class_name, req.user.year_of_study));

  res.json({ resources: visible });
}

// GET /api/resources/:id/file — streams the raw bytes for in-app viewing
// (e.g. a PDF <iframe>) or as the source of a client-side "download as"
// blob. Requires auth (unlike images.js's deliberately-public route) since
// this is institutional study material, not something meant to be
// link-shareable.
async function getResourceFile(req, res) {
  const { id } = req.params;
  const { rows } = await query(
    'SELECT file_data, mimetype, filename, departments, years, classes FROM resources WHERE id=$1',
    [id]
  );
  if (!rows.length) return res.status(404).json({ error: 'Resource not found' });
  const resource = rows[0];

  if (!isAdmin(req.user) && !studentCanAccessResource(resource, req.user.department, req.user.class_name, req.user.year_of_study)) {
    return res.status(403).json({ error: 'Not available for your department/class/year' });
  }

  res.set('Content-Type', resource.mimetype || 'application/octet-stream');
  res.set('Content-Disposition', `inline; filename="${(resource.filename || 'resource').replace(/"/g, '')}"`);
  res.send(resource.file_data);
}

// POST /api/resources (admin, multipart: file + title/category/description/targeting)
async function createResource(req, res) {
  if (!req.file) return res.status(400).json({ error: 'A file is required' });
  const { title, description, category } = req.body;
  if (!title) return res.status(400).json({ error: 'Title is required' });
  if (!CATEGORIES.includes(category)) {
    return res.status(400).json({ error: `Category must be one of: ${CATEGORIES.join(', ')}` });
  }

  let targeting;
  try {
    targeting = normalizeTargeting({
      departments: JSON.parse(req.body.departments || '[]'),
      years: JSON.parse(req.body.years || '[]'),
      classes: JSON.parse(req.body.classes || '[]'),
    });
  } catch (err) {
    return res.status(err.status || 400).json({ error: err.message || 'Invalid targeting data' });
  }

  const { buffer, mimetype, originalname, size } = req.file;
  const { rows } = await query(
    `INSERT INTO resources (title, description, category, file_data, mimetype, filename, size_bytes, departments, years, classes, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
     RETURNING id, title, description, category, mimetype, filename, size_bytes, departments, years, classes, created_at`,
    [title, description || null, category, buffer, mimetype, originalname || null, size || buffer.length,
     JSON.stringify(targeting.departments), JSON.stringify(targeting.years), JSON.stringify(targeting.classes), req.user.id]
  );

  res.status(201).json({ resource: rows[0] });
}

// PATCH /api/resources/:id (admin) — metadata/targeting only, not the file itself
async function updateResource(req, res) {
  const { id } = req.params;
  const { title, description, category } = req.body;
  if (category && !CATEGORIES.includes(category)) {
    return res.status(400).json({ error: `Category must be one of: ${CATEGORIES.join(', ')}` });
  }

  let targeting = null;
  if (req.body.departments !== undefined || req.body.years !== undefined || req.body.classes !== undefined) {
    try {
      targeting = normalizeTargeting({
        departments: req.body.departments,
        years: req.body.years,
        classes: req.body.classes,
      });
    } catch (err) {
      return res.status(err.status || 400).json({ error: err.message || 'Invalid targeting data' });
    }
  }

  const fields = [];
  const params = [];
  if (title !== undefined) { params.push(title); fields.push(`title=$${params.length}`); }
  if (description !== undefined) { params.push(description); fields.push(`description=$${params.length}`); }
  if (category !== undefined) { params.push(category); fields.push(`category=$${params.length}`); }
  if (targeting) {
    params.push(JSON.stringify(targeting.departments)); fields.push(`departments=$${params.length}`);
    params.push(JSON.stringify(targeting.years)); fields.push(`years=$${params.length}`);
    params.push(JSON.stringify(targeting.classes)); fields.push(`classes=$${params.length}`);
  }
  if (!fields.length) return res.status(400).json({ error: 'Nothing to update' });

  params.push(id);
  const { rows } = await query(
    `UPDATE resources SET ${fields.join(', ')}, updated_at=NOW() WHERE id=$${params.length}
     RETURNING id, title, description, category, mimetype, filename, size_bytes, departments, years, classes, created_at`,
    params
  );
  if (!rows.length) return res.status(404).json({ error: 'Resource not found' });
  res.json({ resource: rows[0] });
}

// DELETE /api/resources/:id (admin)
async function deleteResource(req, res) {
  const { rows } = await query('DELETE FROM resources WHERE id=$1 RETURNING id', [req.params.id]);
  if (!rows.length) return res.status(404).json({ error: 'Resource not found' });
  res.json({ message: 'Resource deleted' });
}

module.exports = { upload, listResources, getResourceFile, createResource, updateResource, deleteResource };
