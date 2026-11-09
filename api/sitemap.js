// Genera /api/sitemap con la página principal + todos los productos de Firestore.
const PROJECT = 'kodiashop-5f927';
const API_KEY = 'AIzaSyDZxtwqBOpiJjMrRlF5tgfVl7uEPpACfoE'; // misma clave pública que ya usa index.html

module.exports = async function handler(req, res) {
  try {
    const host = req.headers['x-forwarded-host'] || req.headers.host || 'kodiashopnicaragua.vercel.app';
    const SITE = `https://${host}`;
    const items = [];
    let pageToken = '';
    do {
      const url =
        `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents/products` +
        `?pageSize=300&key=${API_KEY}` + (pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : '');
      const r = await fetch(url);
      if (!r.ok) throw new Error('Firestore ' + r.status);
      const data = await r.json();
      (data.documents || []).forEach((d) => items.push({ id: d.name.split('/').pop(), date: String(d.updateTime || '').slice(0, 10) }));
      pageToken = data.nextPageToken || '';
    } while (pageToken);

    const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const latest = items.map((i) => i.date).filter(Boolean).sort().pop();
    const rows = [`  <url><loc>${esc(SITE)}/</loc>${latest ? `<lastmod>${latest}</lastmod>` : ''}</url>`].concat(
      items.map((i) => `  <url><loc>${esc(`${SITE}/producto/${encodeURIComponent(i.id)}`)}</loc>${i.date ? `<lastmod>${i.date}</lastmod>` : ''}</url>`)
    );

    res.setHeader('Content-Type', 'application/xml; charset=utf-8');
    res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate');
    res.status(200).send('<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' + rows.join('\n') + '\n</urlset>');
  } catch (e) {
    res.status(500).send('Error generando sitemap');
  }
};
