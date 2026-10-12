// Crea una orden de forma segura. El navegador SOLO envía qué quiere comprar
// (ids de producto + variante), sus datos de contacto, la zona y el código de
// descuento. Precios, stock, descuento, envío y total se calculan AQUÍ con los
// datos reales de Firestore, así que el cliente ya no puede fijar su propio
// precio. Escribe con la cuenta de servicio (las reglas bloquean `create`
// desde el navegador).
//
// Requiere la variable de entorno FIREBASE_SERVICE_ACCOUNT (JSON completo).
import crypto from 'crypto';

// Zonas de envío por defecto (si el admin aún no guardó las suyas en settings/store.shippingZones)
const DEFAULT_ZONES = [{ id: 'managua', name: 'Managua', cost: 100 }, { id: 'departamentos', name: 'Departamentos', cost: 165 }];
const MAX_ITEMS = 30;

// --- Cuenta de servicio -> access token (sin firebase-admin) ---
const b64url = (buf) => Buffer.from(buf).toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
let TOKEN_CACHE = { token: null, exp: 0 };

async function getAccess() {
    const sa = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
    const now = Math.floor(Date.now() / 1000);
    if (TOKEN_CACHE.token && TOKEN_CACHE.exp - 60 > now) return { token: TOKEN_CACHE.token, project: sa.project_id };
    const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
    const claim = b64url(JSON.stringify({
        iss: sa.client_email, scope: 'https://www.googleapis.com/auth/datastore',
        aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600,
    }));
    const unsigned = `${header}.${claim}`;
    const jwt = `${unsigned}.${b64url(crypto.sign('RSA-SHA256', Buffer.from(unsigned), sa.private_key))}`;
    const res = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `grant_type=${encodeURIComponent('urn:ietf:params:oauth:grant-type:jwt-bearer')}&assertion=${jwt}`,
    });
    const data = await res.json();
    if (!data.access_token) throw new Error(`oauth: ${data.error || 'sin token'} ${data.error_description || ''}`.trim());
    TOKEN_CACHE = { token: data.access_token, exp: now + (data.expires_in || 3600) };
    return { token: data.access_token, project: sa.project_id };
}

// --- Conversores JS <-> formato tipado de Firestore REST ---
const fromValue = (v) => {
    if (!v) return null;
    if ('stringValue' in v) return v.stringValue;
    if ('integerValue' in v) return Number(v.integerValue);
    if ('doubleValue' in v) return v.doubleValue;
    if ('booleanValue' in v) return v.booleanValue;
    if ('timestampValue' in v) return v.timestampValue;
    if ('arrayValue' in v) return (v.arrayValue.values || []).map(fromValue);
    if ('mapValue' in v) return fromFields(v.mapValue.fields || {});
    return null;
};
const fromFields = (f) => { const o = {}; for (const k in f) o[k] = fromValue(f[k]); return o; };
const toValue = (v) => {
    if (v === null || v === undefined) return { nullValue: null };
    if (typeof v === 'string') return { stringValue: v };
    if (typeof v === 'boolean') return { booleanValue: v };
    if (typeof v === 'number') return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
    if (Array.isArray(v)) return { arrayValue: { values: v.map(toValue) } };
    if (typeof v === 'object') return { mapValue: { fields: toFields(v) } };
    return { stringValue: String(v) };
};
const toFields = (o) => {
    const f = {};
    for (const [k, val] of Object.entries(o)) if (val !== undefined) f[k] = toValue(val);
    return f;
};

const clean = (s, max) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const fail = (res, status, error, extra = {}) => res.status(status).json({ error, ...extra });

export default async function handler(req, res) {
    if (req.method === 'GET') {
        // Diagnóstico: abre /api/order en el navegador. No expone ningún secreto.
        let project = null, valid = false;
        try { project = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT).project_id; valid = !!project; } catch {}
        return res.status(200).json({ ok: true, serviceAccountConfigured: valid, project });
    }
    if (req.method !== 'POST') return fail(res, 405, 'method_not_allowed');
    if (!process.env.FIREBASE_SERVICE_ACCOUNT) return fail(res, 500, 'config_missing');

    try {
        const { items, customer, shippingZone, discountCode } = req.body || {};

        // --- Validación de entrada ---
        const name = clean(customer?.name, 80);
        const phone = clean(customer?.phone, 20);
        const address = clean(customer?.address, 300);
        if (name.length < 2 || phone.replace(/\D/g, '').length < 7 || address.length < 5) {
            return fail(res, 400, 'invalid_customer');
        }
        const zoneId = clean(shippingZone, 80);
        if (!zoneId) return fail(res, 400, 'invalid_zone');
        if (!Array.isArray(items) || items.length === 0 || items.length > MAX_ITEMS) {
            return fail(res, 400, 'invalid_items');
        }
        const wanted = items.map((i) => ({ id: clean(i?.id, 120), size: clean(i?.selectedSize, 60) || 'ÚNICA' }));
        if (wanted.some((w) => !w.id || w.id.includes('/'))) return fail(res, 400, 'invalid_items');

        const { token, project } = await getAccess();
        const base = `https://firestore.googleapis.com/v1/projects/${project}/databases/(default)/documents`;
        const auth = { Authorization: `Bearer ${token}` };

        // --- Zonas de envío generales y tiendas aliadas (los costos salen de Firestore, nunca del cliente) ---
        let zones = DEFAULT_ZONES;
        let vendors = [];
        const okZone = (z) => z && z.id && z.name && Number.isFinite(Number(z.cost)) && Number(z.cost) >= 0;
        const cfg = await fetch(`${base}/settings/store`, { headers: auth });
        if (cfg.ok) {
            const data = fromFields((await cfg.json()).fields || {});
            const valid = Array.isArray(data.shippingZones) ? data.shippingZones.filter(okZone) : [];
            if (valid.length) zones = valid;
            vendors = (Array.isArray(data.vendors) ? data.vendors : []).filter((v) => v && v.id && v.name)
                .map((v) => ({ id: v.id, name: v.name, zones: (Array.isArray(v.shippingZones) ? v.shippingZones : []).filter(okZone) }));
        }

        // --- Productos reales (precio y stock salen de Firestore) ---
        const ids = [...new Set(wanted.map((w) => w.id))];
        const products = {};
        await Promise.all(ids.map(async (id) => {
            const r = await fetch(`${base}/products/${encodeURIComponent(id)}`, { headers: auth });
            if (r.ok) {
                const doc = await r.json();
                products[id] = { id, ...fromFields(doc.fields || {}) };
            } else if (r.status !== 404) {
                throw new Error(`firestore products ${r.status}: ${(await r.text()).slice(0, 160)}`);
            }
        }));

        const demand = {}; // unidades pedidas por producto+variante
        const orderItems = [];
        for (const w of wanted) {
            const p = products[w.id];
            if (!p) return fail(res, 409, 'product_unavailable');
            const hasSizes = Array.isArray(p.sizes) && p.sizes.length > 0;
            if (hasSizes && !p.sizes.includes(w.size)) return fail(res, 400, 'invalid_variant', { title: p.title });
            const key = `${w.id}|${w.size}`;
            demand[key] = (demand[key] || 0) + 1;
            const stock = p.stockBySizes?.[w.size];
            if (stock !== undefined && stock !== '' && stock !== null && Number(stock) < demand[key]) {
                return fail(res, 409, 'sold_out', { title: p.title, size: w.size });
            }
            orderItems.push({ ...p, selectedSize: w.size, cartId: Date.now() + orderItems.length });
        }

        const unit = (p) => (p.discountPrice && p.discountPrice > 0 ? p.discountPrice : p.price);
        const subtotal = orderItems.reduce((a, p) => a + Number(unit(p) || 0), 0);

        // --- Descuento (validado en servidor) ---
        let discountAmount = 0;
        let discountDocName = null;
        let appliedCode = null;
        const code = clean(discountCode, 40).toUpperCase();
        if (code) {
            const q = await fetch(`${base}:runQuery`, {
                method: 'POST',
                headers: { ...auth, 'Content-Type': 'application/json' },
                body: JSON.stringify({ structuredQuery: {
                    from: [{ collectionId: 'discountCodes' }],
                    where: { fieldFilter: { field: { fieldPath: 'code' }, op: 'EQUAL', value: { stringValue: code } } },
                    limit: 1,
                } }),
            });
            const rows = q.ok ? await q.json() : [];
            const doc = rows[0]?.document;
            const d = doc ? fromFields(doc.fields || {}) : null;
            const expired = d?.expiryDate && new Date(d.expiryDate) < new Date();
            const exhausted = d?.usageLimit > 0 && (d.usageCount || 0) >= d.usageLimit;
            if (!d || !d.active || expired || exhausted) return fail(res, 400, 'invalid_discount');
            discountAmount = d.type === 'percent'
                ? Math.round(subtotal * d.value / 100)
                : Math.min(d.value, subtotal);
            discountDocName = doc.name;
            appliedCode = d.code;
        }

        // --- Flete por tienda: cada tienda cobra el de su zona (o el general si no define zonas propias) ---
        const byVendor = new Map();
        for (const p of orderItems) {
            const v = vendors.find((x) => x.id === p.vendorId) || null;
            const k = v ? v.id : '';
            if (!byVendor.has(k)) byVendor.set(k, { vendor: v, name: v ? v.name : 'Kodiashop' });
        }
        const shipments = [];
        let zoneName = '';
        for (const [k, g] of byVendor) {
            const list = g.vendor && g.vendor.zones.length ? g.vendor.zones : zones;
            const z = list.find((x) => x.id === zoneId);
            if (!z) return fail(res, 400, g.vendor ? 'zone_not_served' : 'invalid_zone', { vendor: g.name });
            zoneName = zoneName || z.name;
            shipments.push({ vendorId: k, vendor: g.name, cost: Number(z.cost) });
        }
        const shippingCost = shipments.reduce((a, x) => a + x.cost, 0);
        const total = subtotal - discountAmount + shippingCost;
        const paymentToken = crypto.randomBytes(16).toString('hex');

        // --- Escritura atómica: orden nueva + uso del descuento ---
        let lastErr = '';
        for (let attempt = 0; attempt < 5; attempt++) {
            const orderNumber = `KODIA-${crypto.randomInt(100000, 1000000)}`;
            const order = {
                orderNumber,
                customer: { name, phone, address },
                items: orderItems,
                subtotal,
                discountCode: appliedCode,
                discountAmount,
                shippingZone: zoneName,
                shippingCost,
                shipments,
                total,
                date: new Date().toISOString(),
                status: 'awaiting_payment',
                seenByAdmin: false,
                paymentToken,
                paymentReference: null,
            };
            const writes = [{
                update: { name: `projects/${project}/databases/(default)/documents/orders/${orderNumber}`, fields: toFields(order) },
                currentDocument: { exists: false },
            }];
            if (discountDocName) {
                writes.push({ transform: { document: discountDocName, fieldTransforms: [{ fieldPath: 'usageCount', increment: { integerValue: '1' } }] } });
            }
            const c = await fetch(`${base.replace('/documents', '')}/documents:commit`, {
                method: 'POST',
                headers: { ...auth, 'Content-Type': 'application/json' },
                body: JSON.stringify({ writes }),
            });
            if (c.ok) return res.status(200).json({ order });
            lastErr = `${c.status}: ${(await c.text()).slice(0, 200)}`;
            if (c.status !== 409) break; // solo se reintenta si el número de orden ya existía
        }
        console.error('order commit failed', lastErr);
        return fail(res, 500, 'create_failed', { detail: lastErr });
    } catch (e) {
        console.error('order error', e);
        return fail(res, 500, 'server_error', { detail: String(e && e.message || e).slice(0, 220) });
    }
}
