// Sirve /producto/:id con las etiquetas Open Graph del producto (foto, título, precio, descripción),
// para que WhatsApp, Facebook, Instagram, Telegram e iMessage muestren una vista previa real.
// Devuelve el mismo index.html de la tienda con el <head> personalizado. Si algo falla
// (producto inexistente, Firestore caído), devuelve el index.html normal: la tienda nunca se rompe.
import fs from 'fs';
import path from 'path';

const PROJECT = 'kodiashop-5f927';
const GENERIC_DESC = 'Envíos a toda Nicaragua. Paga por transferencia y confirma por WhatsApp.';

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const fmt = (n) => 'C$ ' + Number(n || 0).toLocaleString('es-NI');
const SMALL = new Set(['de', 'del', 'la', 'el', 'los', 'las', 'con', 'para', 'y', 'o', 'en', 'un', 'una', 'por', 'al', 'sin']);
const nice = (t) => { t = String(t || ''); return /[a-záéíóúñ]/.test(t) ? t : t.toLowerCase().split(' ').map((w, i) => /\d/.test(w) || (w.length <= 3 && !SMALL.has(w)) ? w.toUpperCase() : (i && SMALL.has(w) ? w : w.charAt(0).toUpperCase() + w.slice(1))).join(' '); };

// Firestore REST devuelve {campo: {stringValue|integerValue|...}}; esto lo convierte a valores normales.
function plain(v) {
  if (!v) return null;
  if ('stringValue' in v) return v.stringValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return Number(v.doubleValue);
  if ('booleanValue' in v) return v.booleanValue;
  if ('arrayValue' in v) return (v.arrayValue.values || []).map(plain);
  if ('mapValue' in v) return Object.fromEntries(Object.entries(v.mapValue.fields || {}).map(([k, x]) => [k, plain(x)]));
  return null;
}

async function loadHtml(host) {
  try { return fs.readFileSync(path.join(process.cwd(), 'index.html'), 'utf8'); }
  catch { const r = await fetch(`https://${host}/index.html`); if (!r.ok) throw new Error('index.html no disponible'); return r.text(); }
}

async function loadProduct(id, apiKey) {
  const url = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents/products/${encodeURIComponent(id)}${apiKey ? `?key=${apiKey}` : ''}`;
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 3500);
  try {
    const r = await fetch(url, { signal: ctl.signal });
    if (!r.ok) return null;
    const doc = await r.json();
    return Object.fromEntries(Object.entries(doc.fields || {}).map(([k, v]) => [k, plain(v)]));
  } finally { clearTimeout(t); }
}

// Reemplaza (o agrega) una etiqueta <meta>. Guarda el valor original en data-base para que la tienda
// pueda restaurarlo al volver al inicio sin recargar. Se usan funciones en replace() para que un "$" del texto no se interprete.
function setMeta(html, attr, key, content) {
  const re = new RegExp(`<meta\\s+${attr}="${key}"[^>]*>`, 'i');
  const m = html.match(re);
  const base = m && (m[0].match(/content="([^"]*)"/i) || [])[1];
  const tag = `<meta ${attr}="${key}" content="${esc(content)}"${base != null ? ` data-base="${base}"` : ''}>`;
  return m ? html.replace(re, () => tag) : html.replace('</head>', () => `${tag}\n</head>`);
}

function personalize(html, p, id, origin) {
  const title = nice(p.title || 'Producto');
  const price = p.discountPrice > 0 ? p.discountPrice : p.price;
  const lines = String(Array.isArray(p.description) ? p.description.join(' ') : p.description || '').split(/\n+/).map((x) => x.trim()).filter(Boolean);
  let desc = lines.join(' ').replace(/\s+/g, ' ');
  if (desc.length > 155) desc = desc.slice(0, 155).replace(/\s+\S*$/, '') + '…';
  desc = desc || GENERIC_DESC;
  const ogTitle = price ? `${title} · ${fmt(price)}` : title;
  const url = `${origin}/producto/${encodeURIComponent(id)}`;
  const first = Array.isArray(p.images) && p.images.find((u) => /^https?:\/\//i.test(u || ''));
  // wsrv.nl: JPG 1200×630 con fondo blanco (formato y peso que aceptan WhatsApp y Facebook)
  const img = first ? `https://wsrv.nl/?url=${encodeURIComponent(first.replace(/^https?:\/\//i, ''))}&w=1200&h=630&fit=contain&cbg=white&output=jpg&q=80` : null;

  html = html.replace(/<title>([^<]*)<\/title>/i, (m, t) => `<title data-base="${t}">${esc(title)} | Kodiashop</title>`);
  html = html.replace(/<link rel="canonical" href="([^"]*)">/i, (m, h) => `<link rel="canonical" href="${esc(url)}" data-base="${h}">`);
  html = setMeta(html, 'name', 'description', desc);
  html = setMeta(html, 'property', 'og:title', ogTitle);
  html = setMeta(html, 'property', 'og:description', desc);
  html = setMeta(html, 'property', 'og:url', url);
  html = setMeta(html, 'name', 'twitter:title', ogTitle);
  html = setMeta(html, 'name', 'twitter:description', desc);
  if (img) {
    html = setMeta(html, 'property', 'og:image', img);
    html = setMeta(html, 'property', 'og:image:width', '1200');
    html = setMeta(html, 'property', 'og:image:height', '630');
    html = setMeta(html, 'property', 'og:image:alt', title);
    html = setMeta(html, 'name', 'twitter:image', img);
  }
  return html;
}

export default async function handler(req, res) {
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  const id = String((req.query && req.query.id) || '').trim();
  let html;
  try { html = await loadHtml(host); }
  catch { res.statusCode = 302; res.setHeader('Location', '/'); return res.end(); }

  let out = html, cache = 'public, s-maxage=60, stale-while-revalidate=300';
  try {
    if (/^[A-Za-z0-9_-]{1,120}$/.test(id)) {
      const apiKey = (html.match(/apiKey:\s*'([^']+)'/) || [])[1];
      const p = await loadProduct(id, apiKey);
      if (p && p.title) { out = personalize(html, p, id, `https://${host}`); cache = 'public, s-maxage=300, stale-while-revalidate=3600'; }
    }
  } catch { /* se sirve la página normal */ }

  res.statusCode = 200;
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', cache);
  res.end(out);
}
