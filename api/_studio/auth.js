const { firebase } = require('./config');
const { StudioError } = require('./validation');

// Verifica el ID token de Firebase del admin (sin dependencias). Si defines STUDIO_ADMIN_EMAIL, además exige ese correo.
async function verifyAdmin(req) {
  const h = String(req.headers.authorization || '');
  const idToken = h.startsWith('Bearer ') ? h.slice(7) : '';
  if (!idToken) throw new StudioError('unauthorized', 401, 'Inicia sesión.');
  let r;
  try {
    r = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${firebase.webApiKey}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ idToken }),
    });
  } catch { throw new StudioError('auth_unavailable', 502, 'No se pudo verificar la sesión.'); }
  const j = await r.json().catch(() => ({}));
  const u = j && j.users && j.users[0];
  if (!r.ok || !u) throw new StudioError('unauthorized', 401, 'Sesión no válida. Vuelve a entrar.');
  const only = String(process.env.STUDIO_ADMIN_EMAIL || '').trim().toLowerCase();
  if (only && String(u.email || '').toLowerCase() !== only) throw new StudioError('forbidden', 403, 'Sin permiso.');
  return { uid: u.localId, email: u.email || '' };
}

module.exports = { verifyAdmin };
