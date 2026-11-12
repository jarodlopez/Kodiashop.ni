const { limits } = require('./config');
const { isPreset } = require('./promptEngine');

class StudioError extends Error {
  constructor(code, status, message, extra = {}) { super(message); this.code = code; this.status = status; this.extra = extra; }
}

// Detecta el tipo real por los primeros bytes (no confía en el nombre ni en el mime enviado).
function sniff(buf) {
  if (buf.length > 12 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return { mime: 'image/jpeg', ext: 'jpg' };
  if (buf.length > 8 && buf.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { mime: 'image/png', ext: 'png' };
  if (buf.length > 12 && buf.slice(0, 4).toString('latin1') === 'RIFF' && buf.slice(8, 12).toString('latin1') === 'WEBP') return { mime: 'image/webp', ext: 'webp' };
  return null;
}

function parseRequest(body) {
  const b = body && typeof body === 'object' ? body : {};
  if (!isPreset(b.preset)) throw new StudioError('invalid_preset', 400, 'Acabado no válido.');
  const requestId = String(b.requestId || '');
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(requestId)) throw new StudioError('invalid_request', 400, 'Solicitud no válida.');
  const raw = String(b.image || '').replace(/^data:[^;]+;base64,/, '');
  if (!raw || raw.length > limits.maxImageBytes * 1.4 || !/^[A-Za-z0-9+/=\s]+$/.test(raw)) {
    throw new StudioError('invalid_image', 400, 'La imagen no es válida o es demasiado grande.');
  }
  const buffer = Buffer.from(raw, 'base64');
  if (buffer.length > limits.maxImageBytes) throw new StudioError('image_too_large', 413, 'La imagen es demasiado grande.');
  const type = sniff(buffer);
  if (!type) throw new StudioError('invalid_image', 400, 'Formato no admitido. Usa JPG, PNG o WEBP.');
  return { preset: b.preset, requestId, buffer, ...type };
}

module.exports = { StudioError, parseRequest, sniff };
