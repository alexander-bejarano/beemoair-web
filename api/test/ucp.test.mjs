// Pruebas de la integración UCP de Beemo Air: recorren los flujos como lo haría una plataforma (Google u otro agente),
// con una plataforma y un Stripe simulados, y validan cada respuesta contra los esquemas oficiales de ucp.dev.
// Preparación (una vez, en una carpeta de trabajo fuera del repositorio):
//   npm i ajv ajv-formats
//   git clone --depth 1 -b release/2026-04-08 https://github.com/Universal-Commerce-Protocol/ucp ucp-2026-04-08
//   git clone --depth 1 -b release/2026-08-25 https://github.com/Universal-Commerce-Protocol/ucp ucp-2026-08-25
// Uso, desde esa carpeta:  node --no-warnings <repo>/api/test/ucp.test.mjs <repo>/api/server.mjs . [A|B|C]
import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { DatabaseSync } from 'node:sqlite';
const require = createRequire(path.join(process.env.AJV_DIR || process.cwd(), 'x.js'));   // ajv se instala fuera del repositorio (el servidor no tiene dependencias)
const Ajv2020 = require('ajv/dist/2020.js').default, addFormats = require('ajv-formats').default;

const SERVER = process.argv[2], SPEC = process.argv[3];
const VERSIONS = ['2026-08-25', '2026-04-08'];
let passed = 0, failed = 0; const fails = [];
async function t(name, fn) { try { await fn(); passed++; console.log('  ✓ ' + name) } catch (e) { failed++; fails.push(name); console.log('  ✗ ' + name + '\n      ' + String(e && e.message || e).split('\n').slice(0, 6).join('\n      ')) } }
const sleep = ms => new Promise(r => setTimeout(r, ms));

/* ---------- validadores con los esquemas oficiales ---------- */
const AJV = {};
for (const v of VERSIONS) {
  const ajv = new Ajv2020({ strict: false, allErrors: true }); addFormats(ajv);
  const root = path.join(SPEC, 'ucp-' + v, 'source', 'schemas');
  const walk = d => fs.readdirSync(d, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(path.join(d, e.name)) : e.name.endsWith('.json') ? [path.join(d, e.name)] : []);
  for (const f of walk(root)) { const j = JSON.parse(fs.readFileSync(f, 'utf8')); if (j.$id) ajv.addSchema(j) }
  AJV[v] = ajv;
}
function valid(v, ref, data, label) {
  const fn = AJV[v].getSchema('https://ucp.dev/schemas/' + ref); assert.ok(fn, 'no existe el esquema ' + ref + ' en ' + v);
  if (!fn(data)) throw new Error(`${label || ref} no cumple el esquema ${v}:\n` + fn.errors.slice(0, 5).map(e => `${e.instancePath || '/'} ${e.message} ${JSON.stringify(e.params)}`).join('\n') + '\n' + JSON.stringify(data).slice(0, 600));
}
const errRef = v => v >= '2026-08-25' ? 'common/types/error_response.json' : 'shopping/types/error_response.json';

/* ---------- plataforma simulada: publica su perfil, firma solicitudes y recibe los eventos de pedido ---------- */
const PKEY = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' }), PJWK = { ...PKEY.publicKey.export({ format: 'jwk' }), kid: 'platform-2026', use: 'sig', alg: 'ES256' };
const EKEY = crypto.generateKeyPairSync('ed25519'), EJWK = { ...EKEY.publicKey.export({ format: 'jwk' }), kid: 'platform-ed', use: 'sig', alg: 'EdDSA' };
const hooks = []; let PPORT = 0, SPORT = 0, hookStatus = 200;
const capUrl = (v, n) => ({ version: v, spec: `https://ucp.dev/${v}/specification/x`, schema: `https://ucp.dev/${v}/schemas/shopping/${n}.json` });
function platformProfile(name) {
  const m = /^(full|retail|nopay|catalog)-(\d{4}-\d{2}-\d{2})$/.exec(name); if (!m) return null; const [, kind, v] = m;
  const caps = { 'dev.ucp.shopping.checkout': [capUrl(v, 'checkout')] };
  if (kind === 'full') Object.assign(caps, { 'dev.ucp.shopping.order': [{ ...capUrl(v, 'order'), config: { webhook_url: `http://127.0.0.1:${PPORT}/hook` } }], 'dev.ucp.shopping.catalog.search': [capUrl(v, 'catalog_search')], 'dev.ucp.shopping.catalog.lookup': [capUrl(v, 'catalog_lookup')],
    'com.beemoair.shopping.passengers': [{ version: '2026-11-24', spec: 'https://beemoair.com/api/ucp/spec/passengers', schema: 'https://beemoair.com/api/ucp/schemas/passengers.json', extends: 'dev.ucp.shopping.checkout' }] });
  if (kind === 'catalog') { delete caps['dev.ucp.shopping.checkout']; Object.assign(caps, { 'dev.ucp.shopping.catalog.search': [capUrl(v, 'catalog_search')] }) }
  const pay = kind === 'nopay' || kind === 'catalog' ? {} : { 'com.google.pay': [{ id: 'gpay', version: '2026-01-23', spec: 'https://pay.google.com/gp/p/ucp/2026-01-23/', schema: 'https://pay.google.com/gp/p/ucp/2026-01-23/schemas/config.json' }],
    ...(kind === 'full' ? { 'com.stripe.payments': [{ id: 'stripe_payments', version: '2026-06-25', spec: 'https://docs.stripe.com/x', schema: 'https://ucp.stripe.com/payments/2026-06-25/schema.json' }] } : {}) };
  return { ucp: { version: v, services: {}, capabilities: caps, payment_handlers: pay }, signing_keys: [PJWK, EJWK], keys: [PJWK, EJWK] };
}
const platform = http.createServer(async (req, res) => {
  const chunks = []; for await (const c of req) chunks.push(c); const body = Buffer.concat(chunks);
  if (req.method === 'POST' && req.url.startsWith('/hook')) { hooks.push({ headers: req.headers, body, url: req.url }); res.writeHead(hookStatus, { 'Content-Type': 'application/json' }); return res.end('{}') }
  const name = (/^\/p\/([\w.-]+)\.json$/.exec(req.url) || [])[1];
  if (name === 'bad') { res.writeHead(200); return res.end('<html>no soy json</html>') }
  if (name === 'old') { res.writeHead(200); return res.end(JSON.stringify({ ucp: { version: '2026-01-11', services: {}, capabilities: [{ name: 'dev.ucp.shopping.checkout', version: '2026-01-11' }], payment_handlers: {} } })) }
  const p = name && platformProfile(name); if (!p) { res.writeHead(404); return res.end() }
  res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(p));
});

/* ---------- Stripe simulado ---------- */
const stripe = { calls: [], pis: new Map(), byKey: new Map(), fail500: 0 };
const stripeSrv = http.createServer(async (req, res) => {
  const chunks = []; for await (const c of req) chunks.push(c); const form = Object.fromEntries(new URLSearchParams(Buffer.concat(chunks).toString()));
  const send = (st, o) => { res.writeHead(st, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)) }, u = new URL(req.url, 'http://x');
  stripe.calls.push({ method: req.method, path: u.pathname, form, headers: req.headers, query: u.search });
  if (req.method === 'POST' && u.pathname === '/v1/checkout/sessions') return send(200, { id: 'cs_test_1', url: 'https://checkout.stripe.test/pay/cs_test_' + crypto.randomBytes(4).toString('hex') });
  if (req.method === 'POST' && u.pathname === '/v1/payment_intents') {
    const ik = req.headers['idempotency-key']; if (ik && stripe.byKey.has(ik) && !stripe.replayOff) { const r = stripe.byKey.get(ik); return send(r[0], r[1]) }
    const tok = form['payment_method_data[card][token]'] || form['payment_method_data[shared_payment_granted_token]'] || '';
    let out;
    if (/decline/.test(tok)) out = [402, { error: { type: 'card_error', code: 'card_declined', decline_code: 'generic_decline', message: 'Your card was declined.' } }];
    else if (/3ds/.test(tok)) out = form.error_on_requires_action === 'true' ? [402, { error: { type: 'card_error', code: 'authentication_required', message: 'Authentication required.' } }] : [200, { id: 'pi_' + crypto.randomBytes(6).toString('hex'), status: 'requires_action' }];
    else { const pi = { id: 'pi_' + crypto.randomBytes(6).toString('hex'), status: 'succeeded', amount: +form.amount, currency: form.currency, metadata: { ref: form['metadata[ref]'], ucp_session: form['metadata[ucp_session]'] } }; stripe.pis.set(pi.id, pi); out = [200, pi] }
    if (ik) stripe.byKey.set(ik, out);
    if (/lost/.test(tok) && stripe.fail500 > 0) { stripe.fail500--; return send(500, { error: { type: 'api_error', message: 'boom' } }) }   // el cobro pasó pero la respuesta se perdió
    return send(out[0], out[1]);
  }
  let m = /^\/v1\/payment_intents\/(pi_\w+)\/cancel$/.exec(u.pathname); if (m && req.method === 'POST') { const pi = stripe.pis.get(m[1]) || { id: m[1] }; pi.status = 'canceled'; return send(200, pi) }
  if (u.pathname === '/v1/payment_intents/search') { const ref = (/B:([A-Z0-9]+)/.exec(decodeURIComponent(u.search)) || [])[1]; return send(200, { data: [...stripe.pis.values()].filter(p => p.metadata?.ref === 'B:' + ref) }) }
  m = /^\/v1\/payment_intents\/(pi_\w+)$/.exec(u.pathname); if (m) return stripe.pis.has(m[1]) ? send(200, stripe.pis.get(m[1])) : send(404, { error: { code: 'resource_missing' } });
  send(404, { error: { message: 'no simulado' } });
});

/* ---------- servidor de Beemo Air bajo prueba ---------- */
let BASE = '', proc = null, PORT = 0, dbn = 0, serverLog = '', DBFILE = '';
const sql = (q, ...a) => { const d = new DatabaseSync(DBFILE); try { d.exec('PRAGMA busy_timeout=5000'); const st = d.prepare(q); return /^\s*select/i.test(q) ? st.all(...a) : st.run(...a) } finally { d.close() } };
async function boot(env = {}) {
  if (proc) { proc.kill(); await new Promise(r => proc.once('exit', r)) }
  PORT = 18000 + Math.floor(Math.random() * 2000); const db = DBFILE = `/tmp/ucpt/t${process.pid}_${++dbn}.db`; fs.mkdirSync('/tmp/ucpt', { recursive: true });
  serverLog = '';
  proc = spawn(process.execPath, ['--no-warnings', SERVER], { env: { PATH: process.env.PATH, DB_PATH: db, PORT: String(PORT), ADMIN_SETUP_CODE: 'setup-123', UCP_ALLOW_INSECURE_PROFILES: '1', STRIPE_API_BASE: `http://127.0.0.1:${SPORT}`, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  proc.stdout.on('data', d => serverLog += d); proc.stderr.on('data', d => serverLog += d);
  BASE = `http://127.0.0.1:${PORT}`;
  for (let i = 0; i < 80; i++) { try { const r = await fetch(BASE + '/api/health'); if (r.ok) return } catch (e) {} await sleep(100) }
  throw new Error('el servidor no arrancó:\n' + serverLog);
}
let ipn = 0; const ip = () => `198.51.${100 + (ipn >> 8) % 100}.${(ipn++ & 255) || 1}`;
const prof = name => `http://127.0.0.1:${PPORT}/p/${name}.json`;
const digest = buf => 'sha-256=:' + crypto.createHash('sha256').update(buf).digest('base64') + ':';
function signReq(method, pathname, search, headers, body, { key = PKEY.privateKey, kid = 'platform-2026', ed = false, authority = 'beemoair.com', skip = [] } = {}) {
  const comps = ['@method', '@authority', '@path', ...(search ? ['@query'] : []), 'ucp-agent', ...(headers['idempotency-key'] ? ['idempotency-key'] : []), ...(body.length ? ['content-digest', 'content-type'] : [])].filter(c => !skip.includes(c));
  const val = c => c === '@method' ? method : c === '@authority' ? authority : c === '@path' ? pathname : c === '@query' ? search : headers[c];
  const params = `(${comps.map(c => `"${c}"`).join(' ')});created=${Math.floor(Date.now() / 1000)};keyid="${kid}"`, base = comps.map(c => `"${c}": ${val(c)}`).join('\n') + `\n"@signature-params": ${params}`;
  const sig = ed ? crypto.sign(null, Buffer.from(base), key) : crypto.sign('sha256', Buffer.from(base), { key, dsaEncoding: 'ieee-p1363' });
  return { 'signature-input': 'sig1=' + params, signature: 'sig1=:' + sig.toString('base64') + ':' };
}
async function call(method, p, body, o = {}) {
  const u = new URL(BASE + '/api/ucp/v1' + p), buf = body === undefined ? Buffer.alloc(0) : Buffer.from(typeof body === 'string' ? body : JSON.stringify(body));
  const h = { ...(o.profile === null ? {} : { 'ucp-agent': `profile="${prof(o.profile || 'full-2026-08-25')}"` }), ...(buf.length ? { 'content-type': 'application/json', 'content-digest': digest(buf) } : {}), ...(o.idem ? { 'idempotency-key': o.idem } : {}), 'x-forwarded-for': ip(), ...(o.headers || {}) };
  if (o.sign) Object.assign(h, signReq(method, u.pathname, u.search, h, o.tamper ? Buffer.from('x') : buf, o.sign === true ? {} : o.sign));
  const r = await fetch(u, { method, headers: h, body: buf.length ? (o.tamper ? Buffer.concat([buf.subarray(0, buf.length - 1), Buffer.from(' }')]) : buf) : undefined }), text = await r.text(); let json = null; try { json = JSON.parse(text) } catch (e) {}
  return { status: r.status, headers: r.headers, json, text };
}
async function admin() {   // crea el administrador y devuelve un token de sesión del portal
  await fetch(BASE + '/api/admin/setup', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-forwarded-for': ip() }, body: JSON.stringify({ code: 'setup-123', email: 'admin@beemoair.test', password: 'clave-larga-123', name: 'Admin' }) });
  const r = await fetch(BASE + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-forwarded-for': ip() }, body: JSON.stringify({ email: 'admin@beemoair.test', password: 'clave-larga-123' }) }); return (await r.json()).token;
}
const adm = async (tok, method, p, body) => { const r = await fetch(BASE + '/api' + p, { method, headers: { Authorization: 'Bearer ' + tok, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }); return { status: r.status, json: await r.json().catch(() => null) } };
const flights = async (route, n = 4) => (await (await fetch(`${BASE}/api/flights?route=${route}&n=${n}`)).json());
const free = async (route, date) => (await (await fetch(`${BASE}/api/seats?route=${route}&date=${date}`)).json()).avail;
const iid = (no, date, fare) => `${no}-${date.replace(/-/g, '')}-${fare}`;
const errs = j => (j.messages || []).filter(m => m.type === 'error');
const uuid = () => crypto.randomUUID();
function verifyBusinessSig(headers, statusOrReq, body, keys) {   // comprueba una firma hecha por Beemo Air (respuesta o webhook)
  const si = headers.get ? headers.get('signature-input') : headers['signature-input'], sg = headers.get ? headers.get('signature') : headers.signature, get = k => headers.get ? headers.get(k) : headers[k];
  const m = /^sig1=(\(([^)]*)\).*keyid="([^"]+)")$/.exec(si); assert.ok(m, 'Signature-Input inesperado: ' + si);
  const comps = [...m[2].matchAll(/"([^"]+)"/g)].map(x => x[1]), jwk = keys.find(k => k.kid === m[3]); assert.ok(jwk, 'la llave ' + m[3] + ' no está en el perfil');
  assert.equal(get('content-digest'), digest(body), 'Content-Digest no coincide con el cuerpo');
  const val = c => c === '@status' ? String(statusOrReq) : c === '@method' ? statusOrReq.method : c === '@authority' ? statusOrReq.authority : c === '@path' ? statusOrReq.path : c === '@query' ? statusOrReq.query : get(c);
  const base = comps.map(c => `"${c}": ${val(c)}`).join('\n') + `\n"@signature-params": ${m[1]}`;
  assert.ok(crypto.verify('sha256', Buffer.from(base), { key: crypto.createPublicKey({ key: jwk, format: 'jwk' }), dsaEncoding: 'ieee-p1363' }, Buffer.from(/sig1=:([^:]+):/.exec(sg)[1], 'base64')), 'la firma no verifica');
  return comps;
}

/* ================= escenarios ================= */
async function suiteBase() {
  console.log('\n■ A · sin pasarela configurada (como está hoy producción): descubrimiento, catálogo, compra que termina en beemoair.com');
  await boot(); const tok = await admin();
  const F = await flights('MIA-AXM'), R = await flights('AXM-MIA'), D1 = F[0].date, D2 = R.find(x => x.date > D1).date; let keys = [];

  await t('perfil en /.well-known/ucp: válido en 2026-08-25, anuncia 2026-04-08 y publica la llave de firma', async () => {
    const r = await fetch(BASE + '/.well-known/ucp'), j = await r.json(); assert.equal(r.status, 200); assert.match(r.headers.get('content-type'), /application\/json/);
    valid('2026-08-25', 'profile.json#/$defs/business_schema', j, 'perfil'); assert.equal(j.ucp.version, '2026-08-25'); assert.deepEqual(Object.keys(j.ucp.supported_versions), ['2026-04-08']);
    assert.equal(j.ucp.services['dev.ucp.shopping'][0].endpoint, 'https://beemoair.com/api/ucp/v1'); assert.deepEqual(j.ucp.payment_handlers, {});
    assert.equal(j.signing_keys[0].alg, 'ES256'); assert.ok(!('d' in j.signing_keys[0]), 'la llave privada no puede salir en el perfil'); assert.deepEqual(j.keys, j.signing_keys); keys = j.signing_keys;
    for (const [n, list] of Object.entries(j.ucp.capabilities)) for (const c of list) { const host = new URL(c.spec).host; assert.equal(host, n.startsWith('dev.ucp.') ? 'ucp.dev' : 'beemoair.com', 'el origen de spec debe coincidir con el espacio de nombres de ' + n) }
  });
  await t('perfil por versión /.well-known/ucp/2026-04-08: hoja válida, sin supported_versions', async () => {
    const j = await (await fetch(BASE + '/.well-known/ucp/2026-04-08')).json(); valid('2026-04-08', 'ucp.json#/$defs/business_schema', j.ucp, 'perfil 04-08'); assert.equal(j.ucp.version, '2026-04-08'); assert.ok(!j.ucp.supported_versions);
    assert.equal(j.ucp.capabilities['dev.ucp.shopping.checkout'][0].spec, 'https://ucp.dev/2026-04-08/specification/checkout');
    assert.equal((await fetch(BASE + '/.well-known/ucp/2026-01-11')).status, 422);
  });
  await t('extensión de pasajeros: esquema y documento publicados', async () => {
    const s = await (await fetch(BASE + '/api/ucp/schemas/passengers.json')).json(); assert.equal(s.name, 'com.beemoair.shopping.passengers'); assert.ok(s.$defs['dev.ucp.shopping.checkout']);
    assert.match(await (await fetch(BASE + '/api/ucp/spec/passengers')).text(), /passengers/);
  });
  await t('negociación: sin UCP-Agent 400, perfil ilegible 422, inalcanzable 424, versión vieja 422, sin capacidad 200+error', async () => {
    let r = await call('POST', '/checkout-sessions', { line_items: [] }, { profile: null }); assert.equal(r.status, 400); assert.equal(r.json.code, 'invalid_profile_url');
    r = await call('POST', '/checkout-sessions', { line_items: [] }, { profile: 'bad' }); assert.equal(r.status, 422); assert.equal(r.json.code, 'profile_malformed');
    r = await call('POST', '/checkout-sessions', { line_items: [] }, { profile: 'noexiste' }); assert.equal(r.status, 424); assert.equal(r.json.code, 'profile_unreachable');
    r = await call('POST', '/checkout-sessions', { line_items: [] }, { profile: 'old' }); assert.equal(r.status, 422); assert.equal(r.json.code, 'version_unsupported'); assert.ok(r.json.continue_url);
    r = await call('POST', '/checkout-sessions', { line_items: [] }, { profile: 'catalog-2026-08-25' }); assert.equal(r.status, 200); assert.equal(r.json.ucp.status, 'error'); assert.equal(r.json.messages[0].code, 'capabilities_incompatible'); valid('2026-08-25', errRef('2026-08-25'), r.json);
    r = await call('POST', '/checkout-sessions', '{mal json', {}); assert.equal(r.status, 400); assert.equal(r.json.code, 'invalid_request');
  });
  for (const v of VERSIONS) {
    const P = 'full-' + v;
    await t(`catálogo ${v}: búsqueda en texto libre, por filtros, paginación, consulta por identificador y detalle`, async () => {
      let r = await call('POST', '/catalog/search', { query: 'vuelos de Miami a Armenia', pagination: { limit: 3 } }, { profile: P }); assert.equal(r.status, 200);
      valid(v, 'shopping/catalog_search.json#/$defs/search_response', r.json); assert.equal(r.json.ucp.version, v); assert.equal(r.json.products.length, 3); assert.ok(r.json.pagination.has_next_page && r.json.pagination.cursor);
      assert.ok(r.json.products.every(p => p.metadata.origin === 'MIA' && p.metadata.destination === 'AXM')); assert.equal(r.json.products[0].metadata.date, D1); assert.equal(r.json.products[0].variants.length, 6);
      const cl = r.json.products[0].variants.find(x => x.id.endsWith('-classic')); assert.equal(cl.price.amount, Math.round(F[0].prices.classic * 100)); assert.equal(cl.id, iid('BM701', D1, 'classic'));
      const r2 = await call('POST', '/catalog/search', { query: 'vuelos de Miami a Armenia', pagination: { limit: 3, cursor: r.json.pagination.cursor } }, { profile: P }); assert.notEqual(r2.json.products[0].id, r.json.products[0].id);
      r = await call('POST', '/catalog/search', { query: 'Armenia to Miami ' + D2, context: { language: 'en' } }, { profile: P }); assert.equal(r.json.products.length, 1); assert.equal(r.json.products[0].metadata.origin, 'AXM'); assert.match(r.json.products[0].description.plain, /nonstop/);
      r = await call('POST', '/catalog/search', { filters: { price: { max: 60000 } } }, { profile: P }); valid(v, 'shopping/catalog_search.json#/$defs/search_response', r.json); assert.ok(r.json.products.length > 0 && r.json.products.every(p => p.variants.every(x => x.price.amount <= 60000)));
      r = await call('POST', '/catalog/search', {}, { profile: P }); assert.equal(r.json.ucp.status, 'error');
      r = await call('POST', '/catalog/lookup', { ids: [iid('BM701', D1, 'flex'), 'BM701-' + D1.replace(/-/g, ''), 'no-existe'] }, { profile: P }); valid(v, 'shopping/catalog_lookup.json#/$defs/lookup_response', r.json);
      assert.equal(r.json.products.length, 1); assert.deepEqual(r.json.products[0].variants.map(x => x.inputs[0].match).sort(), ['exact', 'featured']); assert.equal(r.json.messages[0].content, 'no-existe');
      r = await call('POST', '/catalog/product', { id: iid('BM701', D1, 'plus') }, { profile: P }); valid(v, 'shopping/catalog_lookup.json#/$defs/get_product_response', r.json); assert.equal(r.json.product.variants[0].id, iid('BM701', D1, 'plus')); assert.equal(r.json.product.selected[0].label, 'Plus');
      r = await call('POST', '/catalog/product', { id: 'BM701-' + D1.replace(/-/g, ''), selected: [{ name: 'Tarifa', label: 'Flex BC' }] }, { profile: P }); assert.equal(r.json.product.variants[0].id, iid('BM701', D1, 'bc'));
      r = await call('POST', '/catalog/product', { id: 'BM999-20270101' }, { profile: P }); assert.equal(r.json.ucp.status, 'error'); assert.equal(r.json.messages[0].code, 'not_found');
    });
  }
  let chk = null;
  await t('crear compra ida y vuelta para 2: 201, respuesta firmada, precio igual al de beemoair.com y paso a la web para nombres y pago', async () => {
    const body = { line_items: [{ item: { id: iid('BM701', D1, 'classic') }, quantity: 2 }, { item: { id: iid('BM702', D2, 'light') }, quantity: 2 }], buyer: { first_name: 'Ana', last_name: 'Gómez', email: 'ana@example.com' }, context: { language: 'es' } };
    const r = await call('POST', '/checkout-sessions', body, { idem: uuid(), headers: { 'request-id': 'req-123' } }); assert.equal(r.status, 201, r.text); chk = r.json;
    valid('2026-08-25', 'shopping/checkout.json', chk); assert.equal(r.headers.get('request-id'), 'req-123');
    verifyBusinessSig(r.headers, 201, Buffer.from(r.text), keys);
    const q = await (await fetch(BASE + '/api/quote', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-forwarded-for': ip() }, body: JSON.stringify({ legs: [{ route: 'MIA-AXM', date: D1, fare: 'classic' }, { route: 'AXM-MIA', date: D2, fare: 'light' }], pax: [{ first: 'A', last: 'B' }, { first: 'C', last: 'D' }], contact: { email: 'a@b.co' } }) })).json();
    const tot = chk.totals.find(x => x.type === 'total').amount; assert.equal(tot, Math.round(q.total * 100)); assert.equal(chk.totals[0].lines[1].amount, Math.round(q.taxes * 100));
    assert.equal(chk.totals.filter(x => x.type !== 'total').reduce((s, x) => s + x.amount, 0), tot); assert.equal(chk.totals[0].lines.reduce((s, x) => s + x.amount, 0), chk.totals[0].amount);
    assert.equal(chk.line_items.reduce((s, l) => s + l.totals.find(x => x.type === 'total').amount, 0), tot); assert.equal(chk.line_items[0].item.price * 2, chk.line_items[0].totals[0].amount);
    assert.equal(chk.status, 'requires_escalation'); assert.match(chk.continue_url, /^https:\/\/beemoair\.com\/api\/ucp\/continue\/chk_[a-z0-9]{26}$/);
    assert.ok(errs(chk).length && errs(chk).every(m => m.severity === 'requires_buyer_input'), 'solo debe pedir lo que se resuelve en la web'); assert.ok(chk.messages.some(m => m.code === 'final_sale' && m.path === '$.line_items[1]'));
    assert.ok(['privacy_policy', 'terms_of_service', 'refund_policy'].every(k => chk.links.some(l => l.type === k))); assert.ok(Date.parse(chk.expires_at) > Date.now() + 3600e3);
  });
  await t('crear no aparta sillas: el inventario sigue igual', async () => { const a = await free('MIA-AXM', D1); assert.equal(a.eco, F[0].avail.eco) });
  await t('idempotencia: misma llave y cuerpo repite la respuesta; misma llave con otro cuerpo da 409', async () => {
    const k = uuid(), body = { line_items: [{ item: { id: iid('BM701', D1, 'basic') }, quantity: 1 }] };
    const a = await call('POST', '/checkout-sessions', body, { idem: k }), b = await call('POST', '/checkout-sessions', body, { idem: k });
    assert.equal(a.json.id, b.json.id); assert.equal(b.headers.get('idempotent-replayed'), 'true'); assert.equal(b.status, 201);
    const c = await call('POST', '/checkout-sessions', { ...body, buyer: { email: 'x@y.co' } }, { idem: k }); assert.equal(c.status, 409); assert.equal(c.json.code, 'idempotency_conflict');
  });
  await t('consultar y actualizar: reemplaza líneas y comprador; otra plataforma no ve la sesión', async () => {
    let r = await call('GET', '/checkout-sessions/' + chk.id); assert.equal(r.json.id, chk.id); valid('2026-08-25', 'shopping/checkout.json', r.json);
    r = await call('GET', '/checkout-sessions/' + chk.id, undefined, { profile: 'retail-2026-08-25' }); assert.equal(r.json.ucp.status, 'error'); assert.equal(r.json.messages[0].code, 'not_found'); valid('2026-08-25', errRef('2026-08-25'), r.json);
    r = await call('PUT', '/checkout-sessions/' + chk.id, { line_items: [{ item: { id: iid('BM701', D1, 'classic') }, quantity: 3 }, { item: { id: iid('BM702', D2, 'classic') }, quantity: 3 }], buyer: { first_name: 'Ana', last_name: 'Gómez', email: 'ana@example.com', phone_number: '+13055550100' } }, { idem: uuid() });
    assert.equal(r.status, 200); valid('2026-08-25', 'shopping/checkout.json', r.json); assert.equal(r.json.line_items[1].quantity, 3); assert.ok(!r.json.messages.some(m => m.code === 'final_sale')); chk = r.json;
    r = await call('GET', '/checkout-sessions/chk_noexiste'); assert.equal(r.json.messages[0].code, 'not_found');
  });
  await t('validaciones: artículo desconocido, fechas, cantidades distintas, más de dos vuelos y tope de 9 pasajeros', async () => {
    let r = await call('POST', '/checkout-sessions', { line_items: [{ item: { id: 'ZAPATOS-42' }, quantity: 1 }] }); assert.equal(r.status, 200); assert.equal(r.json.ucp.status, 'error'); assert.equal(r.json.messages[0].code, 'item_unavailable'); valid('2026-08-25', errRef('2026-08-25'), r.json);
    r = await call('POST', '/checkout-sessions', { line_items: [{ item: { id: 'BM701-20200106-classic' }, quantity: 1 }] }); assert.equal(r.json.ucp.status, 'error');
    r = await call('POST', '/checkout-sessions', { line_items: [{ item: { id: iid('BM701', D1, 'classic') }, quantity: 2 }, { item: { id: iid('BM702', D2, 'classic') }, quantity: 1 }] }); assert.equal(r.json.status, 'incomplete'); assert.ok(errs(r.json).some(m => m.path === '$.line_items[1].quantity')); valid('2026-08-25', 'shopping/checkout.json', r.json);
    r = await call('POST', '/checkout-sessions', { line_items: [{ item: { id: iid('BM701', D1, 'classic') }, quantity: 40 }, { item: { id: 'NADA' }, quantity: 1 }] }); assert.equal(r.json.line_items[0].quantity, 9); assert.ok(r.json.messages.some(m => m.code === 'quantity_adjusted')); assert.ok(r.json.messages.some(m => m.code === 'item_unavailable')); valid('2026-08-25', 'shopping/checkout.json', r.json);
    r = await call('POST', '/checkout-sessions', { line_items: [F[0], F[1], F[2]].map(f => ({ item: { id: iid('BM701', f.date, 'basic') }, quantity: 1 })) }); assert.equal(r.json.status, 'incomplete'); assert.ok(errs(r.json).some(m => m.path === '$.line_items[2]')); valid('2026-08-25', 'shopping/checkout.json', r.json);
  });
  let page = '';
  await t('página de continue_url: muestra el viaje, pide los pasajeros y trae cabeceras de seguridad', async () => {
    const r = await fetch(BASE + '/api/ucp/continue/' + chk.id); page = await r.text(); assert.equal(r.status, 200); assert.match(r.headers.get('content-type'), /text\/html/); assert.match(r.headers.get('content-security-policy'), /frame-ancestors 'none'/); assert.equal(r.headers.get('referrer-policy'), 'no-referrer');
    assert.equal((page.match(/name="first_name"/g) || []).length, 3); assert.match(page, /value="Ana"/); assert.match(page, /Miami \(MIA\) → Armenia \(AXM\)/); assert.ok(page.includes('US$' + (chk.totals[1].amount / 100).toLocaleString('en-US', { minimumFractionDigits: 2 })));
    const en = await (await fetch(BASE + '/api/ucp/continue/' + chk.id + '?lang=en')).text(); assert.match(en, /Finish your purchase/);
    assert.equal((await fetch(BASE + '/api/ucp/continue/chk_noexiste')).status, 404);
  });
  let pnr = '';
  await t('terminar en la web: crea la reserva real, aparta 3 sillas por trayecto y la compra queda esperando el pago', async () => {
    let r = await fetch(BASE + '/api/ucp/continue/' + chk.id, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-forwarded-for': ip() }, body: JSON.stringify({ passengers: [{ first_name: 'Ana', last_name: 'Gómez' }], email: 'ana@example.com' }) }); assert.equal(r.status, 400);
    r = await fetch(BASE + '/api/ucp/continue/' + chk.id, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-forwarded-for': ip() }, body: JSON.stringify({ passengers: [{ first_name: 'Ana', last_name: 'Gómez' }, { first_name: 'Luis <img src=x>', last_name: 'Gómez' }, { first_name: 'Sara', last_name: 'Gómez' }], email: 'ana@example.com', phone: '+13055550100' }) });
    const j = await r.json(); assert.equal(r.status, 200, JSON.stringify(j)); pnr = j.pnr; assert.match(pnr, /^[A-Z0-9]{6}$/); assert.equal(j.status, 'pending'); assert.equal(j.pay_url, null);
    assert.equal((await free('MIA-AXM', D1)).eco, F[0].avail.eco - 3); assert.equal((await free('AXM-MIA', D2)).eco, R.find(x => x.date === D2).avail.eco - 3);
    const again = await (await fetch(BASE + '/api/ucp/continue/' + chk.id, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-forwarded-for': ip() }, body: '{}' })).json(); assert.equal(again.pnr, pnr, 'un segundo envío no crea otra reserva');
    const g = await call('GET', '/checkout-sessions/' + chk.id); assert.equal(g.json.status, 'requires_escalation'); assert.ok(g.json.messages.some(m => m.code === 'payment_pending')); valid('2026-08-25', 'shopping/checkout.json', g.json);
    const html = await (await fetch(BASE + '/api/ucp/continue/' + chk.id)).text(); assert.match(html, new RegExp(pnr)); assert.match(html, /apartad/);
    const bk = await adm(tok, 'GET', '/admin/bookings?q=' + pnr); assert.equal(bk.json.bookings[0].channel, 'ucp'); assert.equal(bk.json.bookings[0].total * 100, chk.totals[1].amount);
    const up = await call('PUT', '/checkout-sessions/' + chk.id, { line_items: [{ item: { id: iid('BM701', D1, 'light') }, quantity: 1 }] }, { idem: uuid() }); assert.equal(up.json.line_items[0].quantity, 3, 'con una reserva esperando pago la compra no cambia');
  });
  let order = null;
  await t('al confirmarse el pago nace el pedido: compra completada, evento firmado hacia la plataforma y pedido válido', async () => {
    hooks.length = 0; const r = await adm(tok, 'POST', `/admin/bookings/${pnr}/paid`); assert.equal(r.status, 200);
    const g = await call('GET', '/checkout-sessions/' + chk.id); assert.equal(g.json.status, 'completed'); valid('2026-08-25', 'shopping/checkout.json', g.json); assert.equal(g.json.order.label, pnr); assert.ok(!g.json.continue_url); order = g.json.order;
    assert.deepEqual(g.json.passengers.map(p => p.first_name), ['Ana', 'Luis img src=x', 'Sara']);
    for (let i = 0; i < 40 && !hooks.length; i++) await sleep(100); assert.equal(hooks.length, 1, 'debe llegar un evento de pedido');
    const h = hooks[0], o = JSON.parse(h.body); valid('2026-08-25', 'shopping/order.json', o, 'pedido'); assert.equal(o.id, order.id); assert.equal(o.event_id, h.headers['webhook-id']); assert.ok(Date.parse(o.created_time)); assert.equal(o.checkout_id, chk.id); assert.equal(o.line_items[0].status, 'processing'); assert.equal(o.totals.find(x => x.type === 'total').amount, chk.totals[1].amount);
    assert.equal(h.headers['ucp-agent'], 'profile="https://beemoair.com/.well-known/ucp"'); assert.ok(h.headers['webhook-id'] && h.headers['webhook-timestamp'] && h.headers['idempotency-key']);
    const comps = verifyBusinessSig(h.headers, { method: 'POST', authority: `127.0.0.1:${PPORT}`, path: '/hook' }, h.body, keys); for (const c of ['@method', '@authority', '@path', 'ucp-agent', 'idempotency-key', 'content-digest', 'content-type']) assert.ok(comps.includes(c), 'la firma debe cubrir ' + c);
    const html = await (await fetch(BASE + '/api/ucp/continue/' + chk.id)).text(); assert.match(html, /Reserva confirmada/); assert.match(html, new RegExp(pnr)); assert.match(html, /Luis img src=x/); assert.ok(!html.includes('<img'), 'los nombres se muestran escapados');
  });
  await t('pedido por API: solo para la plataforma que lo originó y autenticada con firma', async () => {
    let r = await call('GET', '/orders/' + order.id); assert.equal(r.json.ucp.status, 'error'); assert.equal(r.json.messages[0].code, 'unauthorized');
    r = await call('GET', '/orders/' + order.id, undefined, { sign: true }); assert.equal(r.status, 200); valid('2026-08-25', 'shopping/order.json', r.json); assert.equal(r.json.label, pnr);
    r = await call('GET', '/orders/' + order.id, undefined, { sign: { ed: true, key: EKEY.privateKey, kid: 'platform-ed' } }); assert.equal(r.json.id, order.id, 'también acepta Ed25519');
    r = await call('GET', '/orders/' + order.id, undefined, { sign: true, profile: 'full-2026-04-08' }); assert.equal(r.json.messages[0].code, 'not_found');
    r = await call('GET', '/orders/ord_noexiste', undefined, { sign: true }); assert.equal(r.json.messages[0].code, 'not_found');
  });
  await t('firmas de la plataforma: cuerpo alterado, llave desconocida y cobertura incompleta se rechazan', async () => {
    const body = { line_items: [{ item: { id: iid('BM701', D1, 'basic') }, quantity: 1 }] };
    let r = await call('POST', '/checkout-sessions', body, { sign: true, idem: uuid() }); assert.equal(r.status, 201, r.text);
    r = await call('POST', '/checkout-sessions', body, { sign: true, idem: uuid(), tamper: true }); assert.ok([400, 401].includes(r.status)); assert.ok(['digest_mismatch', 'signature_invalid'].includes(r.json.code), r.text);
    r = await call('POST', '/checkout-sessions', body, { sign: { kid: 'otra-llave' }, idem: uuid() }); assert.equal(r.status, 401); assert.equal(r.json.code, 'key_not_found');
    r = await call('POST', '/checkout-sessions', body, { sign: { skip: ['content-digest'] }, idem: uuid() }); assert.equal(r.status, 401); assert.equal(r.json.code, 'signature_invalid');
    r = await call('POST', '/checkout-sessions', body, { sign: { authority: 'otro-comercio.example' }, idem: uuid() }); assert.equal(r.status, 401, 'una firma hecha para otro comercio no sirve aquí');
    r = await call('POST', '/checkout-sessions', body, { sign: { key: crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' }).privateKey }, idem: uuid() }); assert.equal(r.status, 401); assert.equal(r.json.code, 'signature_invalid');
  });
  await t('anular una reserva emitida por UCP cancela el pedido y avisa a la plataforma', async () => {
    hooks.length = 0; const r = await adm(tok, 'POST', `/admin/bookings/${pnr}/cancel`); assert.equal(r.status, 200);
    for (let i = 0; i < 40 && !hooks.length; i++) await sleep(100); const o = JSON.parse(hooks[0].body); valid('2026-08-25', 'shopping/order.json', o); assert.equal(o.adjustments[0].type, 'cancellation'); assert.equal(o.line_items[0].status, 'removed'); assert.equal(o.line_items[0].quantity.total, 0);
    assert.equal((await free('MIA-AXM', D1)).eco, F[0].avail.eco, 'las sillas vuelven al inventario');
  });
  await t('cancelar una compra con reserva pendiente libera las sillas; una compra cancelada ya no se puede usar', async () => {
    const c = (await call('POST', '/checkout-sessions', { line_items: [{ item: { id: iid('BM701', D1, 'classic') }, quantity: 2 }] })).json;
    const j = await (await fetch(BASE + '/api/ucp/continue/' + c.id, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-forwarded-for': ip() }, body: JSON.stringify({ passengers: [{ first_name: 'A', last_name: 'B' }, { first_name: 'C', last_name: 'D' }], email: 'a@example.com' }) })).json();
    assert.equal((await free('MIA-AXM', D1)).eco, F[0].avail.eco - 2);
    let r = await call('POST', '/checkout-sessions/' + c.id + '/cancel', {}, { idem: uuid() }); assert.equal(r.json.status, 'canceled'); valid('2026-08-25', 'shopping/checkout.json', r.json); assert.ok(!r.json.continue_url);
    assert.equal((await free('MIA-AXM', D1)).eco, F[0].avail.eco); assert.equal((await adm(tok, 'GET', '/admin/bookings?q=' + j.pnr)).json.bookings[0].status, 'cancelled');
    r = await call('POST', '/checkout-sessions/' + c.id + '/complete', { payment: { instruments: [] } }, { idem: uuid() }); assert.equal(r.json.status, 'canceled'); assert.equal(errs(r.json)[0].code, 'checkout_canceled');
    assert.equal((await fetch(BASE + '/api/ucp/continue/' + c.id, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-forwarded-for': ip() }, body: '{}' })).status, 409);
    r = await call('POST', '/checkout-sessions/' + chk.id + '/cancel', {}, { idem: uuid() }); assert.equal(r.json.status, 'completed'); assert.equal(errs(r.json)[0].code, 'checkout_completed');
  });
  await t('Business se agota: la compra lo informa como out_of_stock y no deja sobrevender', async () => {
    const mk = async n => { const c = (await call('POST', '/checkout-sessions', { line_items: [{ item: { id: iid('BM701', D1, 'bc') }, quantity: n }] })).json; return [c, await fetch(BASE + '/api/ucp/continue/' + c.id, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-forwarded-for': ip() }, body: JSON.stringify({ passengers: Array.from({ length: n }, (_, i) => ({ first_name: 'P' + i, last_name: 'Q' })), email: 'g@example.com' }) })] };
    const waiting = (await call('POST', '/checkout-sessions', { line_items: [{ item: { id: iid('BM701', D1, 'bc') }, quantity: 4 }] })).json;
    let [, r1] = await mk(9); assert.equal(r1.status, 200); assert.equal((await free('MIA-AXM', D1)).biz, 3);
    const g = await call('GET', '/checkout-sessions/' + waiting.id); assert.equal(g.json.status, 'incomplete'); assert.equal(errs(g.json)[0].code, 'out_of_stock'); assert.equal(errs(g.json)[0].path, '$.line_items[0].quantity'); valid('2026-08-25', 'shopping/checkout.json', g.json);
    assert.equal((await fetch(BASE + '/api/ucp/continue/' + waiting.id, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-forwarded-for': ip() }, body: JSON.stringify({ passengers: Array.from({ length: 4 }, () => ({ first_name: 'X', last_name: 'Y' })), email: 'g@example.com' }) })).status, 409);
    let [, r2] = await mk(3); assert.equal(r2.status, 200); assert.equal((await free('MIA-AXM', D1)).biz, 0);
    const r3 = await call('POST', '/checkout-sessions', { line_items: [{ item: { id: iid('BM701', D1, 'bc') }, quantity: 1 }] }); assert.equal(r3.json.ucp.status, 'error'); assert.equal(r3.json.messages[0].code, 'out_of_stock');
    const s = await call('POST', '/catalog/product', { id: iid('BM701', D1, 'bc') }); assert.equal(s.json.product.variants[0].availability.available, false); assert.equal(s.json.product.options[0].values.find(x => x.label === 'Flex BC').available, false);
  });
  await t('eventos de pedido: si la plataforma falla se reintenta en orden; un rechazo definitivo deja el evento en error', async () => {
    const mk = async () => { const c = (await call('POST', '/checkout-sessions', { line_items: [{ item: { id: iid('BM701', F[1].date, 'basic') }, quantity: 1 }] })).json;
      const j = await (await fetch(BASE + '/api/ucp/continue/' + c.id, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-forwarded-for': ip() }, body: JSON.stringify({ passengers: [{ first_name: 'Eva', last_name: 'Ríos' }], email: 'eva@example.com' }) })).json(); return [c, j.pnr] };
    hooks.length = 0; hookStatus = 503; const [c1, p1] = await mk(); await adm(tok, 'POST', `/admin/bookings/${p1}/paid`); for (let i = 0; i < 40 && !hooks.length; i++) await sleep(100);
    let ev = sql("SELECT * FROM ucp_events WHERE status='pending'"); assert.equal(ev.length, 1); assert.equal(ev[0].tries, 1); assert.match(ev[0].error, /503/); assert.ok(ev[0].next_at > Date.now() + 60e3, 'espera antes de reintentar');
    await adm(tok, 'POST', `/admin/bookings/${p1}/cancel`); await sleep(300); assert.equal(hooks.length, 1, 'el segundo evento del mismo pedido espera al primero');
    hookStatus = 200; let r = await adm(tok, 'POST', '/admin/ucp/retry'); assert.equal(r.status, 200); assert.equal(hooks.length, 3); assert.equal(sql("SELECT COUNT(*) n FROM ucp_events WHERE status='pending'")[0].n, 0);
    assert.deepEqual(hooks.slice(1).map(h => JSON.parse(h.body).adjustments.length), [0, 1], 'llegan en el orden en que ocurrieron');
    hooks.length = 0; hookStatus = 410; const [, p2] = await mk(); await adm(tok, 'POST', `/admin/bookings/${p2}/paid`); for (let i = 0; i < 40 && !hooks.length; i++) await sleep(100); await sleep(150);
    assert.equal(sql("SELECT status FROM ucp_events ORDER BY id DESC LIMIT 1")[0].status, 'error'); hookStatus = 200;
  });
  await t('después de volar el trayecto queda entregado y la plataforma recibe el pedido actualizado', async () => {
    const c = (await call('POST', '/checkout-sessions', { line_items: [{ item: { id: iid('BM701', F[1].date, 'basic') }, quantity: 1 }] })).json;
    const j = await (await fetch(BASE + '/api/ucp/continue/' + c.id, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-forwarded-for': ip() }, body: JSON.stringify({ passengers: [{ first_name: 'Eva', last_name: 'Ríos' }], email: 'eva@example.com' }) })).json(); hooks.length = 0; await adm(tok, 'POST', `/admin/bookings/${j.pnr}/paid`);
    for (let i = 0; i < 40 && !hooks.length; i++) await sleep(100); assert.equal(hooks.length, 1); hooks.length = 0;
    const row = sql('SELECT data FROM ucp_sessions WHERE id=?', c.id)[0], d = JSON.parse(row.data); d.items[0].date = '2026-01-05'; sql('UPDATE ucp_sessions SET data=? WHERE id=?', JSON.stringify(d), c.id);   // como si el vuelo ya hubiera salido
    await adm(tok, 'POST', '/admin/ucp/retry'); assert.equal(hooks.length, 1); const o = JSON.parse(hooks[0].body); valid('2026-08-25', 'shopping/order.json', o); assert.equal(o.line_items[0].status, 'fulfilled'); assert.equal(o.line_items[0].quantity.fulfilled, 1); assert.equal(o.fulfillment.events[0].type, 'delivered');
    hooks.length = 0; await adm(tok, 'POST', '/admin/ucp/retry'); assert.equal(hooks.length, 0, 'no se repite el aviso');
  });
  await t('una compra abierta vence sola: queda cancelada, la página lo explica y no se puede terminar', async () => {
    const c = (await call('POST', '/checkout-sessions', { line_items: [{ item: { id: iid('BM701', F[1].date, 'basic') }, quantity: 1 }] })).json; sql('UPDATE ucp_sessions SET expires=? WHERE id=?', Date.now() - 1000, c.id);
    assert.match(await (await fetch(BASE + '/api/ucp/continue/' + c.id)).text(), /ya no está disponible/); assert.equal((await fetch(BASE + '/api/ucp/continue/' + c.id, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-forwarded-for': ip() }, body: JSON.stringify({ passengers: [{ first_name: 'Eva', last_name: 'Ríos' }], email: 'eva@example.com' }) })).status, 409);
    const g = await call('GET', '/checkout-sessions/' + c.id); assert.equal(g.json.status, 'canceled'); assert.equal(errs(g.json)[0].code, 'checkout_expired'); valid('2026-08-25', 'shopping/checkout.json', g.json);
  });
  await t('límite por IP: la página de continuar comparte el tope de reservas de la web (8 por hora)', async () => {
    const c = (await call('POST', '/checkout-sessions', { line_items: [{ item: { id: iid('BM701', F[3].date, 'classic') }, quantity: 1 }] })).json; let last = 0;
    for (let i = 0; i < 10; i++) last = (await fetch(BASE + '/api/ucp/continue/' + c.id, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '192.0.2.77' }, body: '{}' })).status;
    assert.equal(last, 429);
  });
  await t('tablero y panel: las ventas de agentes aparecen como canal propio y /api/admin/ucp resume el estado', async () => {
    const c = (await call('POST', '/checkout-sessions', { line_items: [{ item: { id: iid('BM701', F[1].date, 'classic') }, quantity: 1 }] })).json;
    const j = await (await fetch(BASE + '/api/ucp/continue/' + c.id, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-forwarded-for': ip() }, body: JSON.stringify({ passengers: [{ first_name: 'Eva', last_name: 'Ríos' }], email: 'eva@example.com' }) })).json(); await adm(tok, 'POST', `/admin/bookings/${j.pnr}/paid`);
    const d = await adm(tok, 'GET', '/admin/dashboard'); assert.equal(d.status, 200); assert.ok(d.json.channels.some(x => x.name === 'Agentes de IA (UCP)'), JSON.stringify(d.json.channels));
    const u = await adm(tok, 'GET', '/admin/ucp'); assert.equal(u.status, 200); assert.equal(u.json.enabled, true); assert.equal(u.json.native_payment, false); assert.ok(u.json.orders.length >= 1); assert.equal((await fetch(BASE + '/api/admin/ucp')).status, 401);
    const m = await adm(tok, 'GET', `/admin/manifest?route=MIA-AXM&date=${F[1].date}`); assert.equal(m.json[0].channel, 'Agentes de IA (UCP)');
  });
  await t('la reserva pública de beemoair.com y el portal siguen funcionando igual', async () => {
    const r = await fetch(BASE + '/api/bookings', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-forwarded-for': ip() }, body: JSON.stringify({ legs: [{ route: 'MIA-AXM', date: F[2].date, fare: 'classic' }], pax: [{ first: 'José', last: 'Ñandú' }], contact: { email: 'jose@example.com' } }) }), j = await r.json();
    assert.equal(r.status, 200, JSON.stringify(j)); assert.equal(j.status, 'pending'); assert.equal(j.channel, 'web'); assert.equal((await fetch(`${BASE}/api/bookings/${j.pnr}?last=${encodeURIComponent('Ñandú')}`)).status, 200);
    assert.equal((await fetch(BASE + '/')).status, 200); assert.equal((await fetch(BASE + '/api/routes')).status, 200);
  });
}

async function suitePay() {
  console.log('\n■ B · checkout nativo con pasarela (Stripe simulado): Google Pay y token de Stripe, rechazos, reintentos y respuestas perdidas');
  await boot({ STRIPE_SECRET_KEY: 'sk_test_abc', STRIPE_PUBLISHABLE_KEY: 'pk_test_abc', UCP_GPAY_MERCHANT_ID: 'BCR2DN4TEST', STRIPE_UCP_PROFILE: 'profile_test_1' }); const tok = await admin();
  const F = await flights('MIA-AXM'), R = await flights('AXM-MIA'), D1 = F[0].date, D2 = R.find(x => x.date > D1).date;
  const gp = (token, extra = {}) => ({ payment: { instruments: [{ id: 'pm_1', handler_id: 'gpay', type: 'card', selected: true, display: { brand: 'VISA', last_digits: '4242', description: 'Visa •••• 4242' }, billing_address: { street_address: '1 Main St', address_locality: 'Miami', address_region: 'FL', postal_code: '33101', address_country: 'US', first_name: 'Ana', last_name: 'Gómez' }, credential: { type: 'PAYMENT_GATEWAY', token }, ...extra }] }, signals: { 'dev.ucp.buyer_ip': '203.0.113.9' } });
  const mkReady = async (P, items, pax, buyer = { first_name: 'Ana', last_name: 'Gómez', email: 'ana@example.com' }) => (await call('POST', '/checkout-sessions', { line_items: items, buyer, ...(pax ? { passengers: pax } : {}) }, { profile: P, idem: uuid() })).json;
  for (const v of VERSIONS) {
    const P = 'full-' + v;
    await t(`${v} · perfil y sesión anuncian Google Pay (Stripe como pasarela) y Stripe Payments`, async () => {
      const j = await (await fetch(BASE + (v === VERSIONS[0] ? '/.well-known/ucp' : '/.well-known/ucp/' + v))).json(); if (v === VERSIONS[0]) valid(v, 'profile.json#/$defs/business_schema', j); else valid(v, 'ucp.json#/$defs/business_schema', j.ucp);
      const g = j.ucp.payment_handlers['com.google.pay'][0]; assert.equal(g.version, '2026-01-23'); assert.equal(g.config.allowed_payment_methods[0].tokenization_specification.parameters.gateway, 'stripe'); assert.equal(g.config.allowed_payment_methods[0].tokenization_specification.parameters['stripe:publishableKey'], 'pk_test_abc');
      assert.ok(!JSON.stringify(j).includes('sk_test'), 'la llave secreta nunca sale'); assert.equal(j.ucp.payment_handlers['com.stripe.payments'][0].config.business_profile, 'profile_test_1');
    });
    await t(`${v} · compra nativa completa con Google Pay: pide lo que falta por API, cobra el total exacto, emite y avisa`, async () => {
      stripe.calls.length = 0; hooks.length = 0; const before = await free('MIA-AXM', D1);
      let c = (await call('POST', '/checkout-sessions', { line_items: [{ item: { id: iid('BM701', D1, 'classic') }, quantity: 2 }, { item: { id: iid('BM702', D2, 'classic') }, quantity: 2 }] }, { profile: P })).json;
      valid(v, 'shopping/checkout.json', c); assert.equal(c.ucp.version, v); assert.equal(c.status, 'incomplete'); assert.ok(c.ucp.payment_handlers['com.google.pay'] && c.ucp.capabilities['com.beemoair.shopping.passengers']);
      assert.deepEqual(errs(c).map(m => m.path).sort(), ['$.buyer.email', '$.buyer.first_name', '$.buyer.last_name', '$.passengers']); assert.ok(errs(c).every(m => m.severity === 'recoverable'));
      let r = await call('POST', `/checkout-sessions/${c.id}/complete`, gp('{"id":"tok_ok"}'), { profile: P, idem: uuid() }); assert.equal(r.json.status, 'incomplete', 'no se puede completar una compra incompleta'); assert.equal(stripe.calls.length, 0);
      c = (await call('PUT', '/checkout-sessions/' + c.id, { line_items: c.line_items.map(l => ({ id: l.id, item: { id: l.item.id }, quantity: l.quantity })), buyer: { first_name: 'Ana', last_name: 'Gómez', email: 'ana@example.com', phone_number: '+13055550100' }, passengers: [{ first_name: 'Ana María', last_name: 'Gómez' }, { first_name: 'Luis', last_name: 'Gómez Ruiz' }] }, { profile: P, idem: uuid() })).json;
      valid(v, 'shopping/checkout.json', c); assert.equal(c.status, 'ready_for_complete', JSON.stringify(c.messages)); assert.equal(errs(c).length, 0); const total = c.totals.find(x => x.type === 'total').amount;
      const k = uuid(); r = await call('POST', `/checkout-sessions/${c.id}/complete`, gp('{"id":"tok_ok","object":"token"}'), { profile: P, idem: k }); assert.equal(r.status, 200, r.text); const done = r.json;
      valid(v, 'shopping/checkout.json', done); assert.equal(done.status, 'completed'); assert.match(done.order.id, /^ord_/); assert.match(done.order.label, /^[A-Z0-9]{6}$/); assert.ok(!JSON.stringify(done).includes('tok_ok'), 'la credencial no se devuelve'); assert.equal(done.payment.instruments[0].display.last_digits, '4242');
      const pays = stripe.calls.filter(x => x.path === '/v1/payment_intents'); assert.equal(pays.length, 1); assert.equal(+pays[0].form.amount, total); assert.equal(pays[0].form.currency, 'usd'); assert.equal(pays[0].form['payment_method_data[card][token]'], 'tok_ok'); assert.equal(pays[0].form.confirm, 'true');
      assert.equal(pays[0].form['metadata[ref]'], 'B:' + done.order.label); assert.equal(pays[0].headers.authorization, 'Bearer sk_test_abc'); assert.ok(pays[0].headers['idempotency-key']); assert.equal(pays[0].form['payment_method_data[billing_details][address][postal_code]'], '33101');
      r = await call('POST', `/checkout-sessions/${c.id}/complete`, gp('{"id":"tok_ok","object":"token"}'), { profile: P, idem: k }); assert.equal(r.json.order.id, done.order.id); assert.equal(r.headers.get('idempotent-replayed'), 'true');
      r = await call('POST', `/checkout-sessions/${c.id}/complete`, gp('{"id":"tok_ok"}'), { profile: P, idem: uuid() }); assert.equal(r.json.order.id, done.order.id); assert.equal(stripe.calls.filter(x => x.path === '/v1/payment_intents').length, 1, 'completar de nuevo no cobra dos veces');
      const bk = (await adm(tok, 'GET', '/admin/bookings?q=' + done.order.label)).json.bookings[0]; assert.equal(bk.status, 'confirmed'); assert.equal(Math.round(bk.paid * 100), total); assert.equal(bk.channel, 'ucp'); assert.deepEqual(bk.pax.map(p => p.first + ' ' + p.last), ['Ana María Gómez', 'Luis Gómez Ruiz']);
      assert.equal((await free('MIA-AXM', D1)).eco, before.eco - 2);
      for (let i = 0; i < 40 && !hooks.length; i++) await sleep(100); assert.equal(hooks.length, 1); valid(v, 'shopping/order.json', JSON.parse(hooks[0].body)); assert.equal(JSON.parse(hooks[0].body).ucp.version, v);
    });
  }
  await t('tarjeta rechazada: payment_failed recuperable, sillas liberadas; con otro medio de pago la compra se completa', async () => {
    const before = await free('MIA-AXM', D1); stripe.calls.length = 0;
    const c = await mkReady('full-2026-08-25', [{ item: { id: iid('BM701', D1, 'plus') }, quantity: 1 }], [{ first_name: 'Eva', last_name: 'Ríos' }]); assert.equal(c.status, 'ready_for_complete');
    let r = await call('POST', `/checkout-sessions/${c.id}/complete`, gp('{"id":"tok_decline"}'), { idem: uuid() }); valid('2026-08-25', 'shopping/checkout.json', r.json); assert.equal(r.json.status, 'incomplete'); assert.equal(errs(r.json)[0].code, 'payment_failed'); assert.equal(errs(r.json)[0].severity, 'recoverable'); assert.ok(!r.json.order);
    assert.deepEqual(await free('MIA-AXM', D1), before, 'un pago rechazado no deja sillas apartadas');
    r = await call('GET', '/checkout-sessions/' + c.id); assert.equal(r.json.status, 'incomplete');
    r = await call('POST', `/checkout-sessions/${c.id}/complete`, gp('{"id":"tok_3ds"}'), { idem: uuid() }); assert.equal(r.json.status, 'incomplete'); assert.equal(errs(r.json)[0].code, 'payment_failed'); assert.deepEqual(await free('MIA-AXM', D1), before);
    r = await call('POST', `/checkout-sessions/${c.id}/complete`, gp('{"id":"tok_ok"}'), { idem: uuid() }); assert.equal(r.json.status, 'completed'); assert.equal((await free('MIA-AXM', D1)).eco, before.eco - 1);
    const keys = stripe.calls.filter(x => x.path === '/v1/payment_intents').map(x => x.headers['idempotency-key']); assert.equal(new Set(keys).size, 3, 'cada intento usa su propia llave en Stripe');
  });
  await t('token de Stripe (com.stripe.payments): cobra con shared_payment_granted_token y la versión de API que pide Stripe', async () => {
    stripe.calls.length = 0; const c = await mkReady('full-2026-08-25', [{ item: { id: iid('BM701', D1, 'basic') }, quantity: 1 }], [{ first_name: 'Eva', last_name: 'Ríos' }]);
    const r = await call('POST', `/checkout-sessions/${c.id}/complete`, { payment: { instruments: [{ id: 'instr_1', handler_id: 'stripe_payments', type: 'card', selected: true, credential: { type: 'stripe_payment_token', token: 'spt_123' } }] } }, { idem: uuid() });
    assert.equal(r.json.status, 'completed', r.text); const p = stripe.calls.find(x => x.path === '/v1/payment_intents'); assert.equal(p.form['payment_method_data[shared_payment_granted_token]'], 'spt_123'); assert.equal(p.headers['stripe-version'], '2026-09-30.preview'); assert.equal(+p.form.amount, c.totals[1].amount);
  });
  await t('medio de pago inválido: sin instrumento, manejador ajeno o token que Stripe no entiende no cobran ni apartan sillas', async () => {
    const before = await free('MIA-AXM', D1); stripe.calls.length = 0; const c = await mkReady('full-2026-08-25', [{ item: { id: iid('BM701', D1, 'basic') }, quantity: 1 }], [{ first_name: 'Eva', last_name: 'Ríos' }]);
    let r = await call('POST', `/checkout-sessions/${c.id}/complete`, { payment: { instruments: [] } }, { idem: uuid() }); assert.equal(r.json.status, 'incomplete'); assert.equal(errs(r.json)[0].path, '$.payment.instruments'); valid('2026-08-25', 'shopping/checkout.json', r.json);
    r = await call('POST', `/checkout-sessions/${c.id}/complete`, gp('{"id":"tok_ok"}', { handler_id: 'otro' }), { idem: uuid() }); assert.equal(r.json.status, 'incomplete');
    r = await call('POST', `/checkout-sessions/${c.id}/complete`, gp('{"signature":"x","protocolVersion":"ECv2"}'), { idem: uuid() }); assert.equal(r.json.status, 'incomplete'); assert.equal(errs(r.json)[0].code, 'payment_failed');
    assert.equal(stripe.calls.filter(x => x.path === '/v1/payment_intents').length, 0); assert.deepEqual(await free('MIA-AXM', D1), before);
  });
  await t('dos solicitudes de completar al mismo tiempo: un solo cobro y un solo pedido', async () => {
    stripe.calls.length = 0; const c = await mkReady('full-2026-08-25', [{ item: { id: iid('BM701', D1, 'basic') }, quantity: 1 }], [{ first_name: 'Eva', last_name: 'Ríos' }]);
    const [a, b] = await Promise.all([call('POST', `/checkout-sessions/${c.id}/complete`, gp('{"id":"tok_ok"}'), { idem: uuid() }), call('POST', `/checkout-sessions/${c.id}/complete`, gp('{"id":"tok_ok"}'), { idem: uuid() })]);
    assert.equal(stripe.calls.filter(x => x.path === '/v1/payment_intents').length, 1); assert.ok([a, b].some(x => x.json.status === 'completed')); assert.ok([a, b].every(x => ['completed', 'complete_in_progress'].includes(x.json.status)), a.json.status + ' ' + b.json.status);
    const g = await call('GET', '/checkout-sessions/' + c.id); assert.equal(g.json.status, 'completed');
  });
  await t('respuesta de Stripe perdida después de cobrar: la compra queda en proceso y se confirma sola al consultar en Stripe', async () => {
    stripe.calls.length = 0; stripe.fail500 = 2; stripe.replayOff = true; const c = await mkReady('full-2026-08-25', [{ item: { id: iid('BM701', D1, 'basic') }, quantity: 1 }], [{ first_name: 'Eva', last_name: 'Ríos' }]);
    let r = await call('POST', `/checkout-sessions/${c.id}/complete`, gp('{"id":"tok_lost"}'), { idem: uuid() }); valid('2026-08-25', 'shopping/checkout.json', r.json); assert.equal(r.json.status, 'complete_in_progress', r.text); assert.ok(!r.json.order);
    let u = await call('PUT', '/checkout-sessions/' + c.id, { line_items: [{ item: { id: iid('BM701', D1, 'light') }, quantity: 1 }] }, { idem: uuid() }); assert.equal(u.json.status, 'complete_in_progress'); assert.equal(errs(u.json)[0].code, 'complete_in_progress'); assert.match(u.json.line_items[0].item.id, /basic$/);
    u = await call('POST', `/checkout-sessions/${c.id}/cancel`, {}, { idem: uuid() }); assert.equal(u.json.status, 'complete_in_progress', 'no se cancela mientras el cobro está en el aire');
    r = await call('GET', '/checkout-sessions/' + c.id); assert.equal(r.json.status, 'completed', 'la conciliación encuentra el cobro en Stripe'); assert.ok(stripe.calls.some(x => x.path === '/v1/payment_intents/search')); stripe.replayOff = false;
    assert.equal((await adm(tok, 'GET', '/admin/bookings?q=' + r.json.order.label)).json.bookings[0].status, 'confirmed');
  });
  await t('plataforma tipo retail (sin extensión de pasajeros): no se emite a nombre del comprador; pasa a la web para confirmar quién viaja', async () => {
    const c = await mkReady('retail-2026-04-08', [{ item: { id: iid('BM701', D1, 'classic') }, quantity: 1 }], null); valid('2026-04-08', 'shopping/checkout.json', c); assert.equal(c.status, 'requires_escalation'); assert.equal(errs(c).length, 1); assert.equal(errs(c)[0].code, 'passenger_details_required'); assert.ok(c.continue_url);
    assert.ok(c.ucp.payment_handlers['com.google.pay'] && !c.ucp.payment_handlers['com.stripe.payments'], 'solo los medios de pago que la plataforma maneja'); assert.ok(!c.ucp.capabilities['com.beemoair.shopping.passengers']);
    const r = await call('POST', `/checkout-sessions/${c.id}/complete`, gp('{"id":"tok_ok"}'), { profile: 'retail-2026-04-08', idem: uuid() }); assert.equal(r.json.status, 'requires_escalation');
    const j = await (await fetch(BASE + '/api/ucp/continue/' + c.id, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-forwarded-for': ip() }, body: JSON.stringify({ passengers: [{ first_name: 'Mamá', last_name: 'Gómez' }], email: 'ana@example.com' }) })).json(); assert.match(j.pay_url, /^https:\/\/checkout\.stripe\.test\//, 'con Stripe activo la web lleva al pago seguro');
    const cs = stripe.calls.filter(x => x.path === '/v1/checkout/sessions').pop(); assert.equal(+cs.form['line_items[0][price_data][unit_amount]'], c.totals.find(x => x.type === 'total').amount); assert.ok(cs.form.success_url.includes('/api/ucp/continue/' + c.id));
  });
  await t('correo de confirmación: se encola al completar, en el idioma de la compra, con reserva, vuelos, pasajeros y total', async () => {
    await boot({ STRIPE_SECRET_KEY: 'sk_test_abc', STRIPE_PUBLISHABLE_KEY: 'pk_test_abc', UCP_GPAY_MERCHANT_ID: 'BCR2DN4TEST', SMTP_HOST: '127.0.0.1', SMTP_PORT: '1', SMTP_USER: 'reservas@beemoair.test', SMTP_PASS: 'x' });
    const F3 = await flights('MIA-AXM'), c = (await call('POST', '/checkout-sessions', { line_items: [{ item: { id: iid('BM701', F3[0].date, 'classic') }, quantity: 1 }], buyer: { first_name: 'Ann', last_name: 'Lee', email: 'ann@example.com' }, passengers: [{ first_name: 'Ann', last_name: 'O\'Lee & Co' }], context: { language: 'en' } })).json; assert.equal(c.status, 'ready_for_complete'); assert.match(c.line_items[0].item.title, /Dec/);
    const r = await call('POST', `/checkout-sessions/${c.id}/complete`, gp('{"id":"tok_ok"}'), { idem: uuid() }); assert.equal(r.json.status, 'completed');
    const m = sql("SELECT * FROM outbox WHERE ref LIKE 'ucp:%'"); assert.equal(m.length, 1); assert.deepEqual(JSON.parse(m[0].to_addrs), ['ann@example.com']); assert.match(m[0].subject, new RegExp('booking ' + r.json.order.label + ' is confirmed'));
    assert.match(m[0].text, /BM 701/); assert.match(m[0].text, /Total paid: US\$644\.50/); assert.match(m[0].html, /O'Lee &amp; Co/); assert.equal(m[0].ref, 'ucp:' + r.json.order.id);
  });
  await t('webhook de Stripe payment_intent.succeeded confirma una compra UCP que quedó en proceso', async () => {
    await boot({ STRIPE_SECRET_KEY: 'sk_test_abc', STRIPE_PUBLISHABLE_KEY: 'pk_test_abc', UCP_GPAY_MERCHANT_ID: 'BCR2DN4TEST', STRIPE_WEBHOOK_SECRET: 'whsec_test' });
    const F2 = await flights('MIA-AXM'); stripe.fail500 = 2; stripe.replayOff = true; stripe.pis.clear();
    const c = await mkReady('full-2026-08-25', [{ item: { id: iid('BM701', F2[0].date, 'basic') }, quantity: 1 }], [{ first_name: 'Eva', last_name: 'Ríos' }]);
    const r = await call('POST', `/checkout-sessions/${c.id}/complete`, gp('{"id":"tok_lost"}'), { idem: uuid() }); assert.equal(r.json.status, 'complete_in_progress'); stripe.replayOff = false;
    const pi = [...stripe.pis.values()][0], ev = JSON.stringify({ type: 'payment_intent.succeeded', data: { object: pi } }), ts = Math.floor(Date.now() / 1000);
    const w = await fetch(BASE + '/api/stripe/webhook', { method: 'POST', headers: { 'stripe-signature': `t=${ts},v1=${crypto.createHmac('sha256', 'whsec_test').update(ts + '.' + ev).digest('hex')}` }, body: ev }); assert.equal(w.status, 200);
    const g = await call('GET', '/checkout-sessions/' + c.id); assert.equal(g.json.status, 'completed'); assert.ok(g.json.order.id);
  });
}

async function suiteModes() {
  console.log('\n■ C · modos: comprador = pasajero, autenticación obligatoria, versión fijada, apagado y protección de salidas');
  await boot({ STRIPE_SECRET_KEY: 'sk_test_abc', STRIPE_PUBLISHABLE_KEY: 'pk_test_abc', UCP_GPAY_MERCHANT_ID: 'BCR2DN4TEST', UCP_BUYER_IS_PASSENGER: '1' });
  let F = await flights('MIA-AXM'), D1 = F[0].date; const gp = token => ({ payment: { instruments: [{ id: 'pm_1', handler_id: 'gpay', type: 'card', selected: true, credential: { type: 'PAYMENT_GATEWAY', token } }] } });
  await t('UCP_BUYER_IS_PASSENGER=1: un tiquete se completa de forma nativa a nombre del comprador, con aviso obligatorio antes de pagar', async () => {
    let c = (await call('POST', '/checkout-sessions', { line_items: [{ item: { id: iid('BM701', D1, 'classic') }, quantity: 1 }] }, { profile: 'retail-2026-04-08' })).json; assert.equal(c.status, 'incomplete'); assert.ok(errs(c).every(m => m.path.startsWith('$.buyer')));
    c = (await call('PUT', '/checkout-sessions/' + c.id, { line_items: [{ item: { id: iid('BM701', D1, 'classic') }, quantity: 1 }], buyer: { first_name: 'Ana', last_name: 'Gómez', email: 'ana@example.com' } }, { profile: 'retail-2026-04-08', idem: uuid() })).json;
    valid('2026-04-08', 'shopping/checkout.json', c); assert.equal(c.status, 'ready_for_complete'); const w = c.messages.find(m => m.code === 'passenger_is_buyer'); assert.equal(w.type, 'warning'); assert.equal(w.presentation, 'disclosure'); assert.match(w.content, /Ana Gómez/);
    const r = await call('POST', `/checkout-sessions/${c.id}/complete`, gp('{"id":"tok_ok"}'), { profile: 'retail-2026-04-08', idem: uuid() }); valid('2026-04-08', 'shopping/checkout.json', r.json); assert.equal(r.json.status, 'completed'); assert.deepEqual(r.json.passengers, [{ first_name: 'Ana', last_name: 'Gómez' }]);
    const two = (await call('POST', '/checkout-sessions', { line_items: [{ item: { id: iid('BM701', D1, 'classic') }, quantity: 2 }], buyer: { first_name: 'Ana', last_name: 'Gómez', email: 'ana@example.com' } }, { profile: 'retail-2026-04-08' })).json; assert.equal(two.status, 'requires_escalation', 'con más de un pasajero siempre se piden los nombres');
  });
  await boot({ UCP_REQUIRE_AUTH: '1', UCP_API_KEYS: 'google:clave-secreta-de-prueba-1' }); F = await flights('MIA-AXM'); D1 = F[0].date;
  await t('UCP_REQUIRE_AUTH=1: sin llave ni firma 401; con llave de plataforma o firma válida pasa; llave equivocada 401', async () => {
    const body = { line_items: [{ item: { id: iid('BM701', D1, 'classic') }, quantity: 1 }] };
    let r = await call('POST', '/checkout-sessions', body); assert.equal(r.status, 401); assert.ok(r.headers.get('www-authenticate'));
    r = await call('POST', '/checkout-sessions', body, { headers: { 'x-api-key': 'clave-secreta-de-prueba-1' } }); assert.equal(r.status, 201);
    r = await call('POST', '/checkout-sessions', body, { headers: { authorization: 'Bearer clave-secreta-de-prueba-1' } }); assert.equal(r.status, 201);
    r = await call('POST', '/checkout-sessions', body, { headers: { 'x-api-key': 'otra' } }); assert.equal(r.status, 401); assert.equal(r.json.code, 'unauthorized');
    r = await call('POST', '/checkout-sessions', body, { sign: true, idem: uuid() }); assert.equal(r.status, 201);
    assert.equal((await fetch(BASE + '/.well-known/ucp')).status, 200, 'el perfil siempre es público');
  });
  await boot({ UCP_VERSION: '2026-04-08' });
  await t('UCP_VERSION=2026-04-08 (la que documenta Google): perfil raíz en esa versión y 2026-08-25 se rechaza', async () => {
    const j = await (await fetch(BASE + '/.well-known/ucp')).json(); assert.equal(j.ucp.version, '2026-04-08'); assert.ok(!j.ucp.supported_versions); valid('2026-04-08', 'ucp.json#/$defs/business_schema', j.ucp);
    const r = await call('POST', '/catalog/search', { query: 'miami' }, { profile: 'full-2026-08-25' }); assert.equal(r.status, 422); assert.equal(r.json.code, 'version_unsupported');
    assert.equal((await call('POST', '/catalog/search', { query: 'miami' }, { profile: 'full-2026-04-08' })).status, 200);
  });
  await boot({ UCP_ENABLED: '0' });
  await t('UCP_ENABLED=0: todo UCP responde 404 y el resto del sitio sigue igual', async () => {
    assert.equal((await fetch(BASE + '/.well-known/ucp')).status, 404); assert.equal((await call('POST', '/catalog/search', { query: 'miami' })).status, 404); assert.equal((await fetch(BASE + '/api/ucp/continue/chk_x')).status, 404); assert.equal((await fetch(BASE + '/api/flights?route=MIA-AXM')).status, 200);
  });
  await boot({ UCP_ALLOW_INSECURE_PROFILES: '' });
  await t('salidas protegidas: perfiles por http, hacia la propia máquina, redes privadas o metadatos de nube se rechazan sin conectarse', async () => {
    for (const u of [`http://127.0.0.1:${PPORT}/p/full-2026-08-25.json`, 'https://127.0.0.1/p.json', 'https://localhost/p.json', 'https://169.254.169.254/latest/meta-data/', 'https://10.0.0.5/p.json', 'https://[::1]/p.json', 'https://[::ffff:127.0.0.1]/p.json', 'https://user:pass@example.com/p.json', 'https://192.168.1.10:8443/p.json', 'file:///etc/passwd', 'https://0.0.0.0/p']) {
      const r = await fetch(BASE + '/api/ucp/v1/catalog/search', { method: 'POST', headers: { 'ucp-agent': `profile="${u}"`, 'content-type': 'application/json' }, body: '{"query":"miami"}' }), j = await r.json();
      assert.equal(r.status, 400, u + ' → ' + r.status + ' ' + JSON.stringify(j)); assert.equal(j.code, 'invalid_profile_url', u);
    }
  });
}

platform.listen(0, '127.0.0.1', () => { PPORT = platform.address().port; stripeSrv.listen(0, '127.0.0.1', async () => { SPORT = stripeSrv.address().port;
  const only = process.argv[4];
  try { if (!only || only === 'A') await suiteBase(); if (!only || only === 'B') await suitePay(); if (!only || only === 'C') await suiteModes() }
  catch (e) { failed++; console.log('\nERROR FUERA DE PRUEBA:', e, '\n--- log del servidor ---\n' + serverLog.slice(-3000)) }
  if (proc) proc.kill(); platform.close(); stripeSrv.close();
  console.log(`\n${passed} pruebas pasaron, ${failed} fallaron${fails.length ? ':\n - ' + fails.join('\n - ') : ''}`);
  if (failed) console.log('\n--- log del servidor (final) ---\n' + serverLog.slice(-2500));
  process.exit(failed ? 1 : 0);
}) });
