'use strict';
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const multer = require('multer');
const { UPLOAD_DIR } = require('./db');

let sharp = null;
try { sharp = require('sharp'); } catch { console.warn('[upload] sharp indisponible : les images ne seront pas redimensionnées.'); }

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024, files: 60 },
  fileFilter: (req, file, cb) => cb(null, /^image\//.test(file.mimetype))
});

function rel(...parts) { return '/uploads/' + parts.join('/'); }

/**
 * Enregistre une image redimensionnée. Retourne les chemins publics.
 * @param {Buffer} buffer
 * @param {string} folder sous-dossier de uploads (ex: 'players', 'albums/3')
 * @param {{max?: number, thumb?: number, square?: boolean}} opts
 */
async function saveImage(buffer, folder, { max = 1920, thumb = 0, square = false } = {}) {
  const dir = path.join(UPLOAD_DIR, folder);
  fs.mkdirSync(dir, { recursive: true });
  const id = Date.now().toString(36) + '-' + crypto.randomBytes(4).toString('hex');
  const out = {};
  if (sharp) {
    const base = sharp(buffer, { failOn: 'none' }).rotate();
    const main = square ? base.clone().resize(800, 1000, { fit: 'cover', position: 'attention' }) : base.clone().resize(max, max, { fit: 'inside', withoutEnlargement: true });
    await main.webp({ quality: 82 }).toFile(path.join(dir, id + '.webp'));
    out.file = rel(folder, id + '.webp');
    if (thumb) {
      await base.clone().resize(thumb, thumb, { fit: 'cover', position: 'attention' }).webp({ quality: 74 }).toFile(path.join(dir, id + '-t.webp'));
      out.thumb = rel(folder, id + '-t.webp');
    }
  } else {
    fs.writeFileSync(path.join(dir, id + '.jpg'), buffer);
    out.file = rel(folder, id + '.jpg');
    if (thumb) out.thumb = out.file;
  }
  return out;
}

function removeUpload(publicPath) {
  if (!publicPath || !publicPath.startsWith('/uploads/')) return;
  const p = path.join(UPLOAD_DIR, publicPath.slice('/uploads/'.length));
  if (!p.startsWith(UPLOAD_DIR)) return;
  fs.rm(p, { force: true }, () => {});
}

module.exports = { upload, saveImage, removeUpload };
