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
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 2000);
  try {
    const r = await fetch(url, { signal: ctl.signal });
    if (r.status === 404) return 'NOT_FOUND';   // el producto realmente no existe
    if (!r.ok) return null;                      // error temporal: se sirve la página normal
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


// ¿Está agotado? Misma lógica que isSold() de index.html (sin stock definido = disponible).
function soldOut(p) {
  const sizes = Array.isArray(p.sizes) && p.sizes.length ? p.sizes : ['ÚNICA'];
  const st = p.stockBySizes || {};
  return sizes.every((s) => { const v = st[s]; const n = v === undefined || v === null || v === '' ? Infinity : Number(v); return n <= 0; });
}

// Datos estructurados (schema.org/Product) para que Google muestre precio y disponibilidad.
function productJsonLd(p, title, price, desc, url) {
  const imgs = (Array.isArray(p.images) ? p.images : []).filter((u) => /^https?:\/\//i.test(u || '')).slice(0, 6);
  const ld = { '@context': 'https://schema.org', '@type': 'Product', name: title, description: desc, url };
  if (imgs.length) ld.image = imgs;
  if (p.sku) ld.sku = String(p.sku);
  if (p.category) ld.category = String(p.category);
  if (price > 0) ld.offers = {
    '@type': 'Offer', url, priceCurrency: 'NIO', price: String(Number(price)),
    availability: soldOut(p) ? 'https://schema.org/OutOfStock' : 'https://schema.org/InStock',
    itemCondition: 'https://schema.org/NewCondition',
  };
  return `<script type="application/ld+json">${JSON.stringify(ld).replace(/</g, '\\u003c')}</script>`;
}

// Texto del producto dentro del HTML inicial, para que Google lo lea sin esperar al JavaScript.
// index.html lo elimina al pintar la tienda (ver showView), así que no se duplica ni se ve.
function productBody(p, title, price) {
  const d = String(Array.isArray(p.description) ? p.description.join('\n') : p.description || '').split(/\n+/).map((x) => x.trim()).filter(Boolean);
  return `<section id="seo-product" class="sr"><h1>${esc(title)}</h1>${price ? `<p>${esc(fmt(price))}</p>` : ''}${p.category ? `<p>${esc(p.category)}</p>` : ''}${d.map((x) => `<p>${esc(x)}</p>`).join('')}</section>`;
}

function notFoundPage(html) {
  const tag = '<meta name="robots" content="noindex">';
  return html.includes('</head>') ? html.replace('</head>', () => `${tag}\n</head>`) : tag + html;
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
  html = html.replace('</head>', () => `${productJsonLd(p, title, price, desc, url)}\n</head>`);
  html = html.replace(/<body>/i, () => `<body>\n${productBody(p, title, price)}`);
  return html;
}

export default async function handler(req, res) {
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  const id = String((req.query && req.query.id) || '').trim();
  let html;
  try { html = await loadHtml(host); }
  catch { res.statusCode = 302; res.setHeader('Location', '/'); return res.end(); }

  let out = html, cache = 'public, s-maxage=60, stale-while-revalidate=300', status = 200;
  try {
    if (!/^[A-Za-z0-9_-]{1,120}$/.test(id)) {
      out = notFoundPage(html); status = 404;   // id inválido
    } else {
      const apiKey = (html.match(/apiKey:\s*'([^']+)'/) || [])[1];
      const p = await loadProduct(id, apiKey);
      if (p === 'NOT_FOUND') { out = notFoundPage(html); status = 404; }
      else if (p && p.title) { out = personalize(html, p, id, `https://${host}`); cache = 'public, s-maxage=300, stale-while-revalidate=3600'; }
    }
  } catch { /* se sirve la página normal */ }

  res.statusCode = status;
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', cache);
  res.end(out);
}
