const { openai } = require('./config');
const { StudioError } = require('./validation');

// UNA solicitud de edición, UN resultado. La instrucción va en el parámetro `prompt` (la API no tiene campo system).
async function editImage({ buffer, mime, ext, prompt }) {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new StudioError('config_missing', 500, 'Falta OPENAI_API_KEY en Vercel.');

  const form = new FormData();
  form.append('model', openai.model);
  form.append('prompt', prompt);
  form.append('image', new Blob([buffer], { type: mime }), `product.${ext}`);
  form.append('size', openai.size);
  form.append('quality', openai.quality);
  form.append('output_format', openai.outputFormat);
  form.append('n', '1');

  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), openai.timeoutMs);
  let res;
  try {
    res = await fetch(openai.endpoint, { method: 'POST', headers: { Authorization: `Bearer ${key}` }, body: form, signal: ctl.signal });
  } catch (e) {
    if (e && e.name === 'AbortError') throw new StudioError('openai_timeout', 504, 'OpenAI tardó demasiado. Intenta de nuevo.');
    throw new StudioError('openai_network', 502, 'No se pudo contactar a OpenAI.');
  } finally { clearTimeout(timer); }

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = data.error || {};
    const code = err.code || err.type || String(res.status);
    console.error('openai error', res.status, code, String(err.message || '').slice(0, 200));
    if (code === 'moderation_blocked' || /safety|moderation/i.test(err.message || '')) throw new StudioError('moderation', 422, 'OpenAI bloqueó esta imagen por sus filtros de seguridad. Prueba con otra foto.');
    if (res.status === 401) throw new StudioError('openai_auth', 502, 'La clave de OpenAI no es válida.');
    if (res.status === 429 || /quota|billing/i.test(code + (err.message || ''))) throw new StudioError('openai_quota', 429, 'OpenAI rechazó la solicitud por límite o saldo. Revisa tu cuenta.');
    if (res.status === 404 || res.status === 403) throw new StudioError('openai_model', 502, `Tu cuenta no tiene acceso al modelo ${openai.model}. Revisa STUDIO_MODEL.`, { detail: String(err.message || '').slice(0, 160) });
    throw new StudioError('openai_error', 502, 'OpenAI no pudo procesar la imagen.', { detail: String(err.message || '').slice(0, 160) });
  }
  const b64 = data.data && data.data[0] && data.data[0].b64_json;
  if (!b64) throw new StudioError('openai_empty', 502, 'OpenAI no devolvió imagen.');
  return { buffer: Buffer.from(b64, 'base64'), usage: data.usage || null, model: openai.model };
}

module.exports = { editImage };
