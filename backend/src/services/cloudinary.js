// NOTE: kept as "cloudinary.js" for backward compatibility with existing
// require('../services/cloudinary') imports, but this no longer talks to
// Cloudinary or any third-party file host. Uploaded images are buffered in
// memory here and then persisted as bytea rows in Postgres by
// controllers/upload.js — see the `images` table in db/migrate.js.
const multer = require('multer');

// Raster types only — NOT a blanket `image/*` check. `image/svg+xml` looks
// like an image but is XML that a browser will parse and execute
// <script> from if the stored file is ever loaded via <object>/<iframe>
// (getImage in controllers/upload.js serves it back with this exact
// content-type, unmodified). Restricting to formats with no script
// capability closes that off.
const ALLOWED_IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_IMAGE_TYPES.has(file.mimetype)) cb(null, true);
    else cb(new Error('Only PNG, JPEG, WebP, or GIF images are allowed'));
  },
});

module.exports = { upload };
