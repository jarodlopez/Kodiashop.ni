const { imgbb } = require('./config');
const { StudioError } = require('./validation');

// Sube el Buffer a imgbb (multipart, igual que hace el admin) y devuelve la URL de visualización.
async function uploadToImgbb(buffer, name) {
  const form = new FormData();
  form.append('image', new Blob([buffer], { type: 'image/jpeg' }), `${name}.jpg`);
  let res;
  try { res = await fetch(`${imgbb.endpoint}?key=${encodeURIComponent(imgbb.key)}`, { method: 'POST', body: form }); }
  catch { throw new StudioError('imgbb_network', 502, 'No se pudo contactar a imgbb.'); }
  const j = await res.json().catch(() => ({}));
  const url = j && j.success && j.data && (j.data.display_url || j.data.url);
  if (!url) {
    console.error('imgbb error', res.status, JSON.stringify(j).slice(0, 200));
    throw new StudioError('imgbb_error', 502, 'imgbb rechazó la imagen.');
  }
  return url;
}

module.exports = { uploadToImgbb };
