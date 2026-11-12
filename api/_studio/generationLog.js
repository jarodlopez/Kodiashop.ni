const crypto = require('crypto');
const { firebase, pricing } = require('./config');

const b64url = (b) => Buffer.from(b).toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
let TOKEN = { t: null, exp: 0 };

async function access() {
  const sa = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
  const now = Math.floor(Date.now() / 1000);
  if (TOKEN.t && TOKEN.exp - 60 > now) return { token: TOKEN.t, project: sa.project_id };
  const head = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claim = b64url(JSON.stringify({ iss: sa.client_email, scope: 'https://www.googleapis.com/auth/datastore', aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600 }));
  const unsigned = `${head}.${claim}`;
  const jwt = `${unsigned}.${b64url(crypto.sign('RSA-SHA256', Buffer.from(unsigned), sa.private_key))}`;
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=${encodeURIComponent('urn:ietf:params:oauth:grant-type:jwt-bearer')}&assertion=${jwt}`,
  });
  const j = await r.json();
  if (!j.access_token) throw new Error('oauth sin token');
  TOKEN = { t: j.access_token, exp: now + (j.expires_in || 3600) };
  return { token: j.access_token, project: sa.project_id };
}

const toValue = (v) => {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === 'string') return { stringValue: v };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number') return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  if (typeof v === 'object') return { mapValue: { fields: Object.fromEntries(Object.entries(v).filter(([, x]) => x !== undefined).map(([k, x]) => [k, toValue(x)])) } };
  return { stringValue: String(v) };
};

// Costo SOLO si el usage real viene en la respuesta Y definiste los precios por env. Si no, null (no se inventa).
function estimateCost(usage) {
  if (!usage || pricing.inputPerM == null || pricing.outputPerM == null) return null;
  const i = Number(usage.input_tokens), o = Number(usage.output_tokens);
  if (!Number.isFinite(i) || !Number.isFinite(o)) return null;
  return Number(((i * pricing.inputPerM + o * pricing.outputPerM) / 1e6).toFixed(5));
}

// Registro simple de cada generación. Nunca rompe el flujo si falla.
async function logGeneration(entry) {
  try {
    if (!process.env.FIREBASE_SERVICE_ACCOUNT) return false;
    const { token, project } = await access();
    const fields = Object.fromEntries(Object.entries({ ...entry, date: new Date().toISOString() }).map(([k, v]) => [k, toValue(v)]));
    const r = await fetch(`https://firestore.googleapis.com/v1/projects/${project}/databases/(default)/documents/${firebase.logCollection}`, {
      method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ fields }),
    });
    if (!r.ok) console.error('studio log failed', r.status);
    return r.ok;
  } catch (e) { console.error('studio log error', String(e && e.message || e)); return false; }
}

module.exports = { logGeneration, estimateCost };
