// Genera sitemap.xml automáticamente con la página principal + todos los productos de Firestore.
const SITE = 'https://kodiashopnicaragua.vercel.app';
const PROJECT = 'kodiashop-5f927';
const API_KEY = 'AIzaSyDZxtwqBOpiJjMrRlF5tgfVl7uEPpACfoE'; // misma clave pública que ya usa tu index.html

module.exports = async function handler(req, res) {
  try {
    const ids = [];
    let pageToken = '';
    do {
      const url =
        `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents/products` +
        `?pageSize=300&key=${API_KEY}` + (pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : '');
      const r = await fetch(url);
      if (!r.ok) throw new Error('Firestore ' + r.status);
      const data = await r.json();
      (data.documents || []).forEach(d => ids.push(d.name.split('/').pop()));
      pageToken = data.nextPageToken || '';
    } while (pageToken);

    const today = new Date().toISOString().slice(0, 10);
    const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const urls = [`${SITE}/`, ...ids.map(id => `${SITE}/producto/${encodeURIComponent(id)}`)];

    const xml =
      '<?xml version="1.0" encoding="UTF-8"?>\n' +
      '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
      urls.map(u => `  <url><loc>${esc(u)}</loc><lastmod>${today}</lastmod></url>`).join('\n') +
      '\n</urlset>';

    res.setHeader('Content-Type', 'application/xml; charset=utf-8');
    res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate');
    res.status(200).send(xml);
  } catch (e) {
    res.status(500).send('Error generando sitemap');
  }
};
