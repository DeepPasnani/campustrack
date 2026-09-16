const { query } = require('../db');

// Images are stored as bytea rows in Postgres (see `images` table) instead of
// on local disk, so they survive backend restarts/redeploys and work
// correctly even if the backend runs as multiple instances behind a load
// balancer. No third-party file host (e.g. Cloudinary/S3) is used.

async function uploadImage(req, res) {
  if (!req.file) return res.status(400).json({ error: 'No image file provided' });

  const { buffer, mimetype, originalname, size } = req.file;

  const { rows } = await query(
    `INSERT INTO images (data, mimetype, filename, size_bytes, created_by)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id`,
    [buffer, mimetype, originalname || null, size || buffer.length, req.user?.id || null]
  );

  const id = rows[0].id;

  res.json({
    url: `/api/images/${id}`,
    id,
  });
}

async function deleteImage(req, res) {
  const { publicId } = req.params;

  try {
    await query('DELETE FROM images WHERE id = $1', [publicId]);
  } catch {
    // invalid id / already gone — treat as success either way
  }

  res.json({ message: 'Image deleted' });
}

// Serves the raw image bytes so it can be used directly as an <img src="...">
// on the admin's test-builder page, the student's test page, and results
// pages alike — no auth header required, same as the old static file route.
async function getImage(req, res) {
  const { id } = req.params;

  try {
    const { rows } = await query('SELECT data, mimetype FROM images WHERE id = $1', [id]);
    if (!rows.length) return res.status(404).json({ error: 'Image not found' });

    const { data, mimetype } = rows[0];
    res.set('Content-Type', mimetype || 'application/octet-stream');
    res.set('Cache-Control', 'public, max-age=31536000, immutable');
    res.send(data);
  } catch {
    res.status(404).json({ error: 'Image not found' });
  }
}

module.exports = { uploadImage, deleteImage, getImage };
