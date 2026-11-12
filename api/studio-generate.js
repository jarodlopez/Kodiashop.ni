// POST /api/studio-generate  — Kodia Studio MVP.
// Flujo: verificar admin -> validar -> 1 edición en OpenAI -> Buffer -> imgbb -> registro -> respuesta.
// GET devuelve un diagnóstico sin secretos.
const { openai } = require('./_studio/config');
const { buildPrompt } = require('./_studio/promptEngine');
const { StudioError, parseRequest } = require('./_studio/validation');
const { verifyAdmin } = require('./_studio/auth');
const { editImage } = require('./_studio/openaiImageService');
const { uploadToImgbb } = require('./_studio/imgbbService');
const { logGeneration, estimateCost } = require('./_studio/generationLog');

// Anti doble clic / duplicados (por instancia): en curso + resultados recientes.
const inflight = new Set();
const recent = new Map(); // requestId -> { at, body }
const RECENT_MS = 5 * 60 * 1000;
function remember(id, body) {
  const now = Date.now();
  for (const [k, v] of recent) if (now - v.at > RECENT_MS) recent.delete(k);
  while (recent.size >= 4) recent.delete(recent.keys().next().value);
  recent.set(id, { at: now, body });
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'GET') {
    return res.status(200).json({ ok: true, openaiConfigured: !!process.env.OPENAI_API_KEY, logConfigured: !!process.env.FIREBASE_SERVICE_ACCOUNT, model: openai.model, quality: openai.quality, size: openai.size });
  }
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });

  let reqId = null, owns = false;
  try {
    const user = await verifyAdmin(req);
    const input = parseRequest(req.body);
    reqId = input.requestId;

    if (recent.has(reqId)) return res.status(200).json({ ...recent.get(reqId).body, duplicate: true });
    if (inflight.has(reqId)) throw new StudioError('duplicate', 409, 'Esta generación ya está en proceso.');
    if (inflight.size >= 2) throw new StudioError('busy', 429, 'Hay generaciones en curso. Espera un momento.');
    inflight.add(reqId); owns = true;

    const base = { model: openai.model, preset: input.preset, quality: openai.quality, size: openai.size, requestId: reqId, userEmail: user.email, originalUrl: null };
    let out;
    try { out = await editImage({ ...input, prompt: buildPrompt(input.preset) }); }
    catch (e) { await logGeneration({ ...base, status: 'error', error: e.code || 'unknown', generatedUrl: null }); throw e; }

    const cost = estimateCost(out.usage);
    let url = null, warning = null;
    try { url = await uploadToImgbb(out.buffer, `kodia-studio-${input.preset}-${Date.now()}`); }
    catch (e) { warning = e.code || 'imgbb_error'; }

    await logGeneration({ ...base, status: url ? 'ok' : 'imgbb_failed', usage: out.usage || null, costEstimate: cost, generatedUrl: url });

    const body = {
      ok: true, url, warning, usage: out.usage, costEstimate: cost, model: out.model, preset: input.preset,
      imageBase64: out.buffer.toString('base64'), mime: 'image/jpeg',
    };
    remember(reqId, body);
    return res.status(200).json(body);
  } catch (e) {
    if (e instanceof StudioError) return res.status(e.status).json({ ok: false, error: e.code, message: e.message, ...e.extra });
    console.error('studio error', e);
    return res.status(500).json({ ok: false, error: 'server_error', message: 'Error inesperado.' });
  } finally {
    if (owns) inflight.delete(reqId);
  }
};
