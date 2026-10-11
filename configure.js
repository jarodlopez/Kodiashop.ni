// Apunta la tienda a TU proyecto (Firebase, WhatsApp y dominio de Vercel).
// Reemplaza los valores del proyecto anterior en el código y en dist/. Sin
// dependencias: solo Node.
//
// En Vercel corre solo en cada deploy (buildCommand de vercel.json) y lee estas
// variables de entorno, así no hay que editar código:
//   WHATSAPP_NUMBER (obligatoria). FIREBASE_PROJECT_ID y FIREBASE_WEB_API_KEY son opcionales:
//   si faltan se usa el proyecto kodiashop-5f927.
//   SITE_URL (opcional: si falta usa el dominio de producción de Vercel)
// Si falta alguna, el deploy FALLA a propósito para no publicar la tienda
// apuntando al proyecto anterior.
//
// También se puede correr a mano: node configure.js --project X --apikey AIza... --wa 505... --site https://...
const fs = require('fs');
const path = require('path');

const OLD = {
  project: 'kuranic-b1034',
  apikey: 'AIzaSyB6YA-gSckDvi-fdFlRsvwRttr3VnGQ82U',
  wa: '50584016969',
  site: 'https://kodiashop.vercel.app',
};

const args = {};
for (let i = 2; i < process.argv.length; i += 2) args[process.argv[i].replace(/^--/, '')] = process.argv[i + 1];

const env = process.env;
// Valores por defecto = proyecto Firebase de Kodiashop. Las variables de entorno de Vercel
// (FIREBASE_PROJECT_ID / FIREBASE_WEB_API_KEY) tienen prioridad si las defines.
args.project = args.project || env.FIREBASE_PROJECT_ID || 'kodiashop-5f927';
args.apikey = args.apikey || env.FIREBASE_WEB_API_KEY || 'AIzaSyDZxtwqBOpiJjMrRlF5tgfVl7uEPpACfoE';
args.wa = args.wa || env.WHATSAPP_NUMBER;
args.site = args.site || env.SITE_URL || (env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${env.VERCEL_PROJECT_PRODUCTION_URL}` : '');

const missing = ['project', 'apikey', 'wa', 'site'].filter((k) => !args[k]);
if (missing.length) {
  const vars = { project: 'FIREBASE_PROJECT_ID', apikey: 'FIREBASE_WEB_API_KEY', wa: 'WHATSAPP_NUMBER', site: 'SITE_URL' };
  console.error(`Faltan variables de entorno: ${missing.map((m) => vars[m]).join(', ')}\nAgrégalas en Vercel > Settings > Environment Variables y vuelve a desplegar.`);
  process.exit(1);
}
if (!/^[a-z0-9-]+$/.test(args.project)) { console.error('--project solo admite minúsculas, números y guiones'); process.exit(1); }
if (!/^AIza[\w-]{30,}$/.test(args.apikey)) { console.error('--apikey no parece una API key web de Firebase (empieza con AIza)'); process.exit(1); }
if (!/^\d{8,15}$/.test(args.wa)) { console.error('--wa debe ser solo dígitos con código de país, ej. 50588887777'); process.exit(1); }
args.site = args.site.replace(/\/+$/, '');
if (!/^https:\/\/[\w.-]+$/.test(args.site)) { console.error('--site debe ser https://tu-dominio (sin ruta)'); process.exit(1); }

const SKIP = new Set(['node_modules', '.git']);
const EXT = new Set(['.js', '.html', '.json', '.xml', '.txt', '.md']);
const pairs = [
  [OLD.project, args.project],
  [OLD.apikey, args.apikey],
  [OLD.wa, args.wa],
  [OLD.site, args.site],
  [OLD.site.replace('https://', ''), args.site.replace('https://', '')],
];

let touched = 0;
(function walk(dir) {
  for (const name of fs.readdirSync(dir)) {
    if (SKIP.has(name) || name === 'package-lock.json' || name === 'configure.js') continue;
    const p = path.join(dir, name);
    if (fs.statSync(p).isDirectory()) { walk(p); continue; }
    if (!EXT.has(path.extname(name))) continue;
    const before = fs.readFileSync(p, 'utf8');
    let after = before;
    for (const [from, to] of pairs) after = after.split(from).join(to);
    if (after !== before) { fs.writeFileSync(p, after); touched++; console.log('✓', p); }
  }
})('.');
console.log(`\n${touched} archivos actualizados. Ya no queda ninguna referencia al proyecto anterior.`);
