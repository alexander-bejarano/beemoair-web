// Pruebas de la integración de PayPal (Expanded Checkout) de Beemo Air, con un PayPal simulado: no usan internet ni llaves reales.
// Recorren la página de pago, la orden, la captura, los rechazos, el pago en revisión y el webhook.
// Uso:  node --no-warnings api/test/paypal.test.mjs api/server.mjs
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';

const SERVER = process.argv[2] || path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'server.mjs');
const PORT = 18000 + Math.floor(Math.random() * 1000), PPORT = PORT + 1, BASE = `http://127.0.0.1:${PORT}`;
const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'beemo-paypal-')), DB = path.join(DIR, 'beemo.db');
let passed = 0, failed = 0, n = 0; const ip = () => `10.9.${Math.floor(n / 250)}.${++n % 250}`;
async function t(name, fn) { try { await fn(); passed++; console.log('  ✓ ' + name) } catch (e) { failed++; console.log('  ✗ ' + name + '\n      ' + String(e && e.message || e).split('\n').slice(0, 6).join('\n      ')) } }
const sleep = ms => new Promise(r => setTimeout(r, ms));

/* ---------- PayPal simulado ---------- */
const PP = { orders: new Map(), captures: new Map(), calls: [], mode: 'ok', verify: 'SUCCESS', seq: 0 };
const paypal = http.createServer(async (req, res) => {
  let raw = ''; for await (const c of req) raw += c;
  const send = (st, o) => { res.writeHead(st, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)) };
  PP.calls.push({ method: req.method, url: req.url, headers: req.headers, raw });
  if (req.url === '/v1/oauth2/token') { if (req.headers.authorization !== 'Basic ' + Buffer.from('client-id:client-secret').toString('base64')) return send(401, { error: 'invalid_client' }); return send(200, { access_token: 'tok-' + ++PP.seq, expires_in: 3600 }) }
  if (!/^Bearer tok-/.test(req.headers.authorization || '')) return send(401, { name: 'AUTHENTICATION_FAILURE' });
  if (req.method === 'POST' && req.url === '/v2/checkout/orders') { const b = JSON.parse(raw), id = 'ORDER' + String(++PP.seq).padStart(6, '0'); PP.orders.set(id, { id, status: 'CREATED', body: b }); return send(201, { id, status: 'CREATED' }) }
  let m = /^\/v2\/checkout\/orders\/([\w-]+)\/capture$/.exec(req.url);
  if (m && req.method === 'POST') { const o = PP.orders.get(m[1]); if (!o) return send(404, { name: 'RESOURCE_NOT_FOUND' });
    if (o.status === 'COMPLETED') return send(422, { name: 'UNPROCESSABLE_ENTITY', details: [{ issue: 'ORDER_ALREADY_CAPTURED' }] });
    if (PP.mode === 'declined') return send(422, { name: 'UNPROCESSABLE_ENTITY', details: [{ issue: 'INSTRUMENT_DECLINED' }], debug_id: 'dbg1' });
    const pu = o.body.purchase_units[0], cap = { id: 'CAP' + String(++PP.seq).padStart(8, '0'), status: PP.mode === 'review' ? 'PENDING' : 'COMPLETED', ...(PP.mode === 'review' ? { status_details: { reason: 'PENDING_REVIEW' } } : {}),
      amount: PP.mode === 'short' ? { currency_code: 'USD', value: '1.00' } : pu.amount, custom_id: pu.custom_id, invoice_id: pu.invoice_id, supplementary_data: { related_ids: { order_id: o.id } } };
    PP.captures.set(cap.id, cap); o.status = 'COMPLETED'; o.cap = cap;
    return send(201, { id: o.id, status: 'COMPLETED', payer: { email_address: 'buyer@example.com' }, purchase_units: [{ custom_id: pu.custom_id, payments: { captures: [cap] } }] }) }
  m = /^\/v2\/checkout\/orders\/([\w-]+)$/.exec(req.url);
  if (m && req.method === 'GET') { const o = PP.orders.get(m[1]); return o ? send(200, { id: o.id, status: o.status, purchase_units: [{ custom_id: o.body.purchase_units[0].custom_id, payments: { captures: o.cap ? [o.cap] : [] } }] }) : send(404, {}) }
  m = /^\/v2\/payments\/captures\/([\w-]+)$/.exec(req.url);
  if (m && req.method === 'GET') { const c = PP.captures.get(m[1]); return c ? send(200, c) : send(404, { name: 'RESOURCE_NOT_FOUND' }) }
  if (req.url === '/v1/notifications/verify-webhook-signature') return send(200, { verification_status: PP.verify });
  send(404, { name: 'NOT_FOUND' });
});

/* ---------- servidor de Beemo Air ---------- */
let proc;
async function boot(env = {}) {
  if (proc) { proc.kill(); await new Promise(r => proc.once('exit', r)) }
  proc = spawn(process.execPath, ['--no-warnings', SERVER], { env: { PATH: process.env.PATH, DB_PATH: DB, PORT: String(PORT), ADMIN_SETUP_CODE: 'setup-123', UCP_ENABLED: '0', PAYPAL_CLIENT_ID: 'client-id', PAYPAL_CLIENT_SECRET: 'client-secret', PAYPAL_API_BASE: `http://127.0.0.1:${PPORT}`, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  proc.stderr.on('data', d => { if (process.env.VERBOSE) process.stderr.write(d) });
  for (let i = 0; i < 80; i++) { try { if ((await fetch(BASE + '/api/health')).ok) return } catch (e) {} await sleep(100) }
  throw new Error('el servidor no arrancó');
}
const post = async (p, body, headers = {}) => { const r = await fetch(BASE + p, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-forwarded-for': ip(), ...headers }, body: typeof body === 'string' ? body : JSON.stringify(body || {}) }); return { status: r.status, j: await r.json().catch(() => ({})) } };
const get = async p => { const r = await fetch(BASE + p, { headers: { 'x-forwarded-for': ip() } }); return { status: r.status, text: await r.text(), headers: r.headers } };
let flights;
async function book(i = 0, pax = [{ first: 'Ana', last: 'Gómez' }]) {
  flights ||= (await (await fetch(BASE + '/api/flights?route=MIA-AXM&n=20')).json());
  const list = Array.isArray(flights) ? flights : flights.flights, r = await post('/api/bookings', { legs: [{ route: 'MIA-AXM', date: list[i].date, fare: 'classic' }], pax, contact: { email: 'ana@example.com' } });
  assert.equal(r.status, 200, JSON.stringify(r.j)); return r.j;
}
const tokOf = b => new URL(b.pay_url).pathname;   // /api/pay/<token>
const view = async b => (await (await fetch(`${BASE}/api/bookings/${b.pnr}?last=${encodeURIComponent('Gómez')}`, { headers: { 'x-forwarded-for': ip() } })).json());
const sql = (q, ...a) => { const d = new DatabaseSync(DB, { readOnly: true }); try { return d.prepare(q).all(...a) } finally { d.close() } };

await new Promise(r => paypal.listen(PPORT, '127.0.0.1', r));
try {
  console.log('PayPal activo (sandbox)');
  await boot();
  await t('health y config anuncian PayPal y la reserva queda 45 min apartada', async () => {
    const h = await (await fetch(BASE + '/api/health')).json(); assert.equal(h.paypal, true); assert.equal(h.payments, true); assert.equal(h.stripe, false);
    const c = await (await fetch(BASE + '/api/config')).json(); assert.equal(c.hold_hours, 0.75);
  });
  let b1;
  await t('la reserva web trae un enlace a la página de pago de Beemo Air', async () => {
    b1 = await book(0); assert.equal(b1.status, 'pending'); assert.match(b1.pay_url, /^https:\/\/beemoair\.com\/api\/pay\/[\w-]{20,}$/);
    const again = await view(b1); assert.equal(again.pay_url, b1.pay_url);
  });
  await t('la página de pago muestra el resumen, carga el SDK con buttons y card-fields y trae su política de seguridad', async () => {
    const p = await get(tokOf(b1)); assert.equal(p.status, 200); assert.match(p.headers.get('content-type'), /text\/html/);
    assert.ok(p.text.includes(b1.pnr)); assert.ok(p.text.includes('Ana Gómez')); assert.ok(p.text.includes('US$' + b1.total.toFixed(2)));
    assert.ok(p.text.includes('https://www.paypal.com/sdk/js?client-id=client-id&amp;components=buttons,card-fields&amp;currency=USD')); assert.ok(p.text.includes('buyer-country=US')); assert.ok(p.text.includes('sandbox'));
    assert.ok(!p.text.includes('client-secret')); assert.match(p.headers.get('content-security-policy'), /paypal\.com/);
    assert.equal((await get('/api/pay/' + 'x'.repeat(24))).status, 404);
    const en = await get(tokOf(b1) + '?lang=en'); assert.ok(en.text.includes('Complete your payment'));
  });
  let o1;
  await t('la orden se crea por el valor de la reserva, sin que el navegador pueda cambiarlo', async () => {
    const r = await post(tokOf(b1) + '/order', { source: 'paypal', amount: 1 }); assert.equal(r.status, 200, JSON.stringify(r.j)); o1 = r.j.id;
    const sent = PP.orders.get(o1).body, pu = sent.purchase_units[0];
    assert.equal(sent.intent, 'CAPTURE'); assert.equal(pu.amount.value, b1.total.toFixed(2)); assert.equal(pu.amount.currency_code, 'USD'); assert.equal(pu.custom_id, 'B:' + b1.pnr);
    assert.equal(sent.application_context.shipping_preference, 'NO_SHIPPING'); assert.equal(sent.payment_source, undefined);
  });
  await t('con tarjeta la orden pide 3D Secure cuando el banco lo exige', async () => {
    const r = await post(tokOf(b1) + '/order', { source: 'card' }); assert.equal(r.status, 200);
    assert.equal(PP.orders.get(r.j.id).body.payment_source.card.attributes.verification.method, 'SCA_WHEN_REQUIRED');
  });
  await t('una tarjeta rechazada no confirma nada y deja pagar de nuevo', async () => {
    PP.mode = 'declined'; const r = await post(tokOf(b1) + '/capture', { order_id: o1 }); PP.mode = 'ok';
    assert.equal(r.status, 402); assert.equal(r.j.code, 'declined'); assert.equal((await view(b1)).status, 'pending');
  });
  await t('no se puede capturar una orden de otra reserva', async () => {
    const b2 = await book(1), r2 = await post(tokOf(b2) + '/order', { source: 'paypal' });
    assert.equal((await post(tokOf(b1) + '/capture', { order_id: r2.j.id })).status, 404);
    assert.equal((await post(tokOf(b1) + '/capture', { order_id: 'NOEXISTE1' })).status, 404);
  });
  await t('la captura confirma la reserva y la página pasa a «pago recibido»', async () => {
    const r = await post(tokOf(b1) + '/capture', { order_id: o1 }); assert.equal(r.status, 200, JSON.stringify(r.j)); assert.equal(r.j.status, 'paid');
    const v = await view(b1); assert.equal(v.status, 'confirmed'); assert.equal(v.paid, b1.total); assert.equal(v.pay_url, null);
    const call = PP.calls.filter(c => c.url.endsWith(`/${o1}/capture`)).pop(); assert.equal(call.headers['paypal-request-id'], 'cap-' + o1);
    const row = sql('SELECT * FROM paypal_orders WHERE order_id=?', o1)[0]; assert.equal(row.status, 'paid'); assert.ok(row.capture_id); assert.equal(row.payer, 'buyer@example.com');
    const p = await get(tokOf(b1)); assert.ok(/Pago recibido/.test(p.text)); assert.ok(!p.text.includes('paypal.com/sdk/js'));
  });
  await t('repetir la captura o pedir otra orden no cobra dos veces', async () => {
    const before = PP.calls.length, r = await post(tokOf(b1) + '/capture', { order_id: o1 }); assert.equal(r.j.status, 'paid'); assert.equal(PP.calls.length, before);
    const again = await post(tokOf(b1) + '/order', { source: 'paypal' }); assert.equal(again.status, 409); assert.equal(again.j.code, 'paid');
  });
  await t('si PayPal captura menos de lo debido, la reserva no se confirma y queda el aviso', async () => {
    const b = await book(2), o = (await post(tokOf(b) + '/order', {})).j.id; PP.mode = 'short'; const r = await post(tokOf(b) + '/capture', { order_id: o }); PP.mode = 'ok';
    assert.equal(r.status, 409); assert.equal(r.j.code, 'mismatch'); assert.equal((await view(b)).status, 'pending');
    assert.ok(sql("SELECT what FROM log WHERE what LIKE 'PAYPAL VALOR DISTINTO%'").length === 1);
  });
  await t('un pago en revisión conserva las sillas un día y el webhook lo confirma después', async () => {
    const b = await book(3), o = (await post(tokOf(b) + '/order', {})).j.id; PP.mode = 'review'; const r = await post(tokOf(b) + '/capture', { order_id: o }); PP.mode = 'ok';
    assert.equal(r.j.status, 'review'); const v = await view(b); assert.equal(v.status, 'pending'); assert.ok(Date.parse(v.expires) - Date.now() > 20 * 3600e3);
    assert.equal((await post(tokOf(b) + '/order', {})).j.code, 'review'); assert.ok((await get(tokOf(b))).text.includes('en revisión'));
    const cap = PP.orders.get(o).cap; cap.status = 'COMPLETED';
    const w = await post('/api/paypal/webhook', { event_type: 'PAYMENT.CAPTURE.COMPLETED', resource: { id: cap.id, custom_id: 'B:OTRA00', amount: { value: '0.01' } } }); assert.equal(w.status, 200);
    assert.equal((await view(b)).status, 'confirmed');
  });
  await t('el webhook solo cree lo que PayPal confirma: una captura inventada no confirma nada', async () => {
    const b = await book(4); const w = await post('/api/paypal/webhook', { event_type: 'PAYMENT.CAPTURE.COMPLETED', resource: { id: 'CAPFALSA001', custom_id: 'B:' + b.pnr, status: 'COMPLETED', amount: { currency_code: 'USD', value: b.total.toFixed(2) } } });
    assert.equal(w.status, 400); assert.equal((await view(b)).status, 'pending');
  });
  await t('el webhook confirma un pago cuyo navegador se cerró antes de avisar', async () => {
    const b = await book(5), o = (await post(tokOf(b) + '/order', {})).j.id, ord = PP.orders.get(o), pu = ord.body.purchase_units[0];
    const cap = { id: 'CAPWEBHOOK01', status: 'COMPLETED', amount: pu.amount, custom_id: pu.custom_id, supplementary_data: { related_ids: { order_id: o } } }; PP.captures.set(cap.id, cap); ord.status = 'COMPLETED'; ord.cap = cap;
    assert.equal((await post('/api/paypal/webhook', { event_type: 'PAYMENT.CAPTURE.COMPLETED', resource: { id: cap.id } })).status, 200);
    assert.equal((await view(b)).status, 'confirmed'); assert.equal((await post(tokOf(b) + '/capture', { order_id: o })).j.status, 'paid');
  });
  await t('reembolsos y disputas quedan en la bitácora para revisión', async () => {
    assert.equal((await post('/api/paypal/webhook', { event_type: 'PAYMENT.CAPTURE.REFUNDED', resource: { id: 'REF123456789' } })).status, 200);
    assert.ok(sql("SELECT what FROM log WHERE what LIKE 'PAYMENT.CAPTURE.REFUNDED REF123456789%'").length === 1);
  });
  await t('una reserva anulada no se cobra', async () => {
    const b = await book(6), o = (await post(tokOf(b) + '/order', {})).j.id;
    const d = new DatabaseSync(DB); d.prepare("UPDATE bookings SET status='cancelled' WHERE pnr=?").run(b.pnr); d.close();
    const before = PP.calls.length, r = await post(tokOf(b) + '/capture', { order_id: o }); assert.equal(r.status, 409); assert.equal(r.j.code, 'closed'); assert.equal(PP.calls.length, before);
    assert.ok((await get(tokOf(b))).text.includes('ya no está disponible'));
  });
  await t('el pase de temporada se paga por la misma página y queda activo', async () => {
    const prods = sql("SELECT id FROM pass_products WHERE status='active' LIMIT 1"); if (!prods.length) return;
    const r = await post('/api/passes', { product_id: prods[0].id, name: 'Ana Gómez', email: 'ana@example.com' }); assert.equal(r.status, 200, JSON.stringify(r.j)); assert.match(r.j.pay_url, /\/api\/pay\//);
    const tok = new URL(r.j.pay_url).pathname, o = (await post(tok + '/order', { source: 'card' })).j.id; assert.equal(PP.orders.get(o).body.purchase_units[0].custom_id, 'P:' + r.j.code);
    assert.equal((await post(tok + '/capture', { order_id: o })).j.status, 'paid'); assert.equal(sql('SELECT status FROM passes WHERE code=?', r.j.code)[0].status, 'paid');
  });

  console.log('Webhook con firma (PAYPAL_WEBHOOK_ID)');
  await boot({ PAYPAL_WEBHOOK_ID: 'WH-123' });
  await t('una firma inválida se rechaza y una válida se envía a verificar con el cuerpo original', async () => {
    PP.verify = 'FAILURE'; assert.equal((await post('/api/paypal/webhook', { event_type: 'PAYMENT.CAPTURE.REFUNDED', resource: { id: 'REF000000001' } })).status, 400);
    PP.verify = 'SUCCESS'; const raw = '{"event_type":"PAYMENT.CAPTURE.REFUNDED","resource":{"id":"REF000000002","amount":{"value":"10.00"}}}';
    assert.equal((await post('/api/paypal/webhook', raw, { 'paypal-transmission-id': 'tx-1', 'paypal-transmission-sig': 'sig', 'paypal-transmission-time': '2026-11-25T00:00:00Z', 'paypal-auth-algo': 'SHA256withRSA', 'paypal-cert-url': 'https://api.paypal.com/cert' })).status, 200);
    const v = PP.calls.filter(c => c.url === '/v1/notifications/verify-webhook-signature').pop(); assert.ok(v.raw.endsWith(`"webhook_event":${raw}}`)); const j = JSON.parse(v.raw); assert.equal(j.webhook_id, 'WH-123'); assert.equal(j.transmission_id, 'tx-1');
  });

  console.log('Sin PayPal');
  await boot({ PAYPAL_CLIENT_ID: '', PAYPAL_CLIENT_SECRET: '' });
  await t('sin llaves todo sigue como antes: reserva pendiente 24 h, sin enlace de pago', async () => {
    const h = await (await fetch(BASE + '/api/health')).json(); assert.equal(h.paypal, false); assert.equal(h.payments, false);
    const b = await book(7); assert.equal(b.pay_url, null); assert.ok(Date.parse(b.expires) - Date.now() > 20 * 3600e3);
    assert.equal((await post('/api/paypal/webhook', {})).status, 404);
  });
  console.log('PayPal en producción');
  await boot({ PAYPAL_ENV: 'live' });
  await t('en live la página no lleva el aviso de pruebas ni buyer-country', async () => {
    const b = await book(8), p = await get(tokOf(b)); assert.ok(!p.text.includes('buyer-country')); assert.ok(!p.text.includes('sandbox'));
  });
} finally { if (proc) proc.kill(); paypal.close(); fs.rmSync(DIR, { recursive: true, force: true }) }
console.log(`\n${passed} pasaron, ${failed} fallaron`);
process.exit(failed ? 1 : 0);
