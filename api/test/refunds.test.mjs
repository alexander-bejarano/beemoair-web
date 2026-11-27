// Pruebas de reembolsos: política por tarifa, monto sugerido, monto fijado por el administrador, anulación y saldo de la agencia.
// Uso: node --no-warnings api/test/refunds.test.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url)), SERVER = path.join(HERE, '..', 'server.mjs');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'beemo-rf-')), PORT = 19600 + Math.floor(Math.random() * 300), BASE = `http://127.0.0.1:${PORT}/api`, PW = 'clave-de-prueba-123';
const srv = spawn(process.execPath, ['--no-warnings', SERVER], { env: { ...process.env, PORT: String(PORT), DB_PATH: path.join(dir, 'beemo.db'), ADMIN_SETUP_CODE: 'prueba-local', UCP_ENABLED: '0' }, stdio: ['ignore', 'pipe', 'pipe'] });
let errOut = ''; srv.stderr.on('data', d => { errOut += d });
const sleep = ms => new Promise(r => setTimeout(r, ms)), r2 = n => Math.round(n * 100) / 100;
let passed = 0, failed = 0;
async function t(name, fn) { try { await fn(); passed++; console.log('  ✓ ' + name) } catch (e) { failed++; console.log('  ✗ ' + name + '\n      ' + String(e && e.message || e).split('\n').slice(0, 8).join('\n      ')) } }
async function call(method, p, body, token) { const r = await fetch(BASE + p, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: body ? JSON.stringify(body) : undefined }); let j = {}; try { j = await r.json() } catch (e) {} return { status: r.status, j } }
const ok = async (...a) => { const r = await call(...a); assert.equal(r.status, 200, `${a[0]} ${a[1]} → ${r.status} ${JSON.stringify(r.j)}`); return r.j };
for (let i = 0; i < 60; i++) { try { if ((await fetch(BASE + '/health')).ok) break } catch (e) {} await sleep(100) }
async function agencyUser(admin, name, email) { const { id } = await ok('POST', '/admin/agencies', { name, country: 'Colombia' }, admin), u = await ok('POST', `/admin/agencies/${id}/users`, { email, name: 'Agente' }, admin);
  let tk = (await ok('POST', '/auth/login', { email, password: u.temp_password })).token; await ok('POST', '/me/password', { password: PW }, tk); return { id, tk: (await ok('POST', '/auth/login', { email, password: PW })).token } }
let admin, A, B, F, tax;
const book = (tk, fare, pax = [{ first: 'Rosa', last: 'Marín' }], pay = 'cash') => ok('POST', '/agency/bookings', { legs: [{ route: 'MIA-AXM', date: F.date, fare }], pax, contact: { email: 'rosa@correo.test', phone: '' }, pay }, tk);
try {
  await t('política: valores aprobados y validaciones', async () => {
    await ok('POST', '/admin/setup', { code: 'prueba-local', email: 'admin@prueba.test', password: PW }); admin = (await ok('POST', '/auth/login', { email: 'admin@prueba.test', password: PW })).token;
    A = await agencyUser(admin, 'Agencia A', 'a@prueba.test'); B = await agencyUser(admin, 'Agencia B', 'b@prueba.test');
    F = (await ok('GET', '/agency/flights?route=MIA-AXM&n=3', null, A.tk))[2]; tax = F.tax;
    const P = await ok('GET', '/admin/refund-policy', null, admin); assert.deepEqual(P.pct, { light: [0, 0, 0], basic: [0, 0, 0], classic: [25, 0, 0], plus: [50, 25, 0], flex: [75, 50, 0], bc: [90, 75, 0] }); assert.equal(P.days, 7); assert.equal(P.hours, 24);
    const put = pct => call('PUT', '/admin/refund-policy', { days: 7, hours: 24, pct: { ...P.pct, ...pct } }, admin);
    assert.match((await put({ flex: [95, 50, 0] })).j.error, /no puede devolver más que Flex BC/); assert.match((await put({ plus: [50, 60, 0] })).j.error, /no puede subir/); assert.equal((await put({ classic: [25, 0, -1] })).status, 400);
    assert.equal((await call('PUT', '/admin/refund-policy', { ...P }, A.tk)).status, 403); assert.equal((await put({ classic: [30, 10, 0] })).status, 200); assert.deepEqual((await ok('GET', '/agency/refund-policy', null, A.tk)).pct.classic, [30, 10, 0]);
    assert.equal((await put({ classic: [25, 0, 0] })).status, 200);
  });
  await t('monto sugerido según causa y tarifa', async () => {
    const c = await book(A.tk, 'classic'), l = await book(A.tk, 'light'), x = await book(A.tk, 'bc', [{ first: 'Dos', last: 'Pax' }, { first: 'Tres', last: 'Pax' }]);
    let Q = await ok('GET', `/agency/bookings/${c.pnr}/refund-quote?cause=voluntaria`, null, A.tk); assert.equal(Q.basis, c.total); assert.equal(Q.suggested, r2(r2((F.prices.classic - tax) * 0.25) + tax));
    Q = await ok('GET', `/agency/bookings/${l.pnr}/refund-quote?cause=voluntaria`, null, A.tk); assert.equal(Q.suggested, r2(tax), 'Light: solo las tasas');
    Q = await ok('GET', `/agency/bookings/${x.pnr}/refund-quote?cause=voluntaria`, null, A.tk); assert.equal(Q.suggested, r2(r2((F.prices.bc - tax) * 2 * 0.9) + r2(tax * 2)));
    Q = await ok('GET', `/agency/bookings/${c.pnr}/refund-quote?cause=operacion`, null, A.tk); assert.equal(Q.suggested, c.total);
    assert.equal((await call('GET', `/agency/bookings/${c.pnr}/refund-quote`, null, B.tk)).status, 404); assert.equal((await call('GET', `/agency/bookings/${c.pnr}/refund-quote?cause=otra`, null, A.tk)).status, 400);
  });
  await t('solicitud de la agencia, monto fijado por el administrador y anulación', async () => {
    const b = await book(A.tk, 'plus'), h = await book(A.tk, 'plus', [{ first: 'Sin', last: 'Pagar' }], 'hold');
    assert.equal((await call('POST', `/agency/bookings/${h.pnr}/refund`, { cause: 'voluntaria', note: 'no viaja' }, A.tk)).status, 400, 'una apartada no se reembolsa');
    assert.equal((await call('POST', `/agency/bookings/${b.pnr}/refund`, { cause: 'excepcion', note: 'por favor' }, A.tk)).status, 400); assert.equal((await call('POST', `/agency/bookings/${b.pnr}/refund`, { cause: 'voluntaria', note: '' }, A.tk)).status, 400);
    assert.equal((await call('POST', `/agency/bookings/${b.pnr}/refund`, { cause: 'voluntaria', note: 'no puede viajar' }, B.tk)).status, 404);
    const r = await ok('POST', `/agency/bookings/${b.pnr}/refund`, { cause: 'voluntaria', note: 'El cliente no puede viajar' }, A.tk); assert.equal(r.status, 'requested'); const sug = r2(r2((F.prices.plus - tax) * 0.5) + tax); assert.equal(r.suggested, sug);
    assert.equal((await call('POST', `/agency/bookings/${b.pnr}/refund`, { cause: 'voluntaria', note: 'otra vez lo mismo' }, A.tk)).status, 400, 'una sola solicitud en revisión');
    assert.equal((await call('POST', `/admin/refunds/${r.id}/approve`, {}, A.tk)).status, 403);
    assert.match((await call('POST', `/admin/refunds/${r.id}/approve`, { amount: sug + 20 }, admin)).j.error, /escribe el motivo/); assert.match((await call('POST', `/admin/refunds/${r.id}/approve`, { amount: b.total + 1, reason: 'demasiado' }, admin)).j.error, /más de lo pagado/);
    const seats0 = (await ok('GET', `/seats?route=MIA-AXM&date=${F.date}`)).taken.length, due0 = (await ok('GET', '/agency/statement', null, A.tk)).cash_due;
    const ap = await ok('POST', `/admin/refunds/${r.id}/approve`, { amount: sug + 20, reason: 'Acordado con el cliente por teléfono' }, admin);
    assert.equal(ap.status, 'approved'); assert.equal(ap.amount, r2(sug + 20)); assert.equal(ap.retained, r2(b.total - sug - 20)); assert.equal(ap.payer, 'agencia', 'la agencia tiene el dinero: cobro en agencia sin consignar'); assert.equal(ap.booking_status, 'cancelled');
    assert.equal((await ok('GET', `/seats?route=MIA-AXM&date=${F.date}`)).taken.length, seats0 - 1, 'la silla quedó libre');
    const st = await ok('GET', '/agency/statement', null, A.tk); assert.equal(st.refund_retained_due, ap.retained); assert.equal(st.cash_due, r2(due0 - b.total + ap.retained), 'la agencia ya no debe el tiquete, solo lo retenido');
    assert.equal((await call('POST', `/admin/refunds/${r.id}/paid`, {}, admin)).status, 400); const pd = await ok('POST', `/admin/refunds/${r.id}/paid`, { method: 'agencia', ref: 'Recibo 44' }, admin); assert.equal(pd.status, 'paid');
    assert.equal((await ok('GET', '/agency/statement', null, A.tk)).refund_retained_due, 0); assert.equal((await call('POST', `/admin/refunds/${r.id}/approve`, {}, admin)).status, 400);
    const mine = await ok('GET', '/agency/refunds', null, A.tk); assert.equal(mine.length, 1); assert.equal(mine[0].reason, 'Acordado con el cliente por teléfono'); assert.equal((await ok('GET', '/agency/refunds', null, B.tk)).length, 0);
  });
  await t('causa de operación: 100 %, y se puede fijar otro monto', async () => {
    const b = await book(A.tk, 'basic'); await ok('POST', `/admin/bookings/${b.pnr}/settle`, {}, admin);
    const r = await ok('POST', '/admin/refunds', { pnr: b.pnr, cause: 'operacion', note: 'Vuelo cancelado' }, admin); assert.equal(r.suggested, b.total);
    const ap = await ok('POST', `/admin/refunds/${r.id}/approve`, {}, admin); assert.equal(ap.amount, b.total); assert.equal(ap.retained, 0); assert.equal(ap.payer, 'beemo', 'ya consignada: devuelve Beemo Air');
    const b2 = await book(A.tk, 'basic'), r2_ = await ok('POST', `/agency/bookings/${b2.pnr}/refund`, { cause: 'voluntaria', note: 'Dice que el vuelo cambió' }, A.tk);
    const ap2 = await ok('POST', `/admin/refunds/${r2_.id}/approve`, { cause: 'operacion', amount: 300, reason: 'Aceptó US$300 y un crédito para otro vuelo' }, admin); assert.equal(ap2.cause, 'operacion'); assert.equal(ap2.amount, 300); assert.equal(ap2.suggested, b2.total);
  });
  await t('excepción sin anular y rechazo con motivo', async () => {
    const b = await book(A.tk, 'classic'), r = await ok('POST', '/admin/refunds', { pnr: b.pnr, cause: 'excepcion', cancel: false, note: 'Compensación por maleta' }, admin); assert.equal(r.suggested, 0);
    assert.equal((await call('POST', `/admin/refunds/${r.id}/approve`, { amount: 55 }, admin)).status, 400); const ap = await ok('POST', `/admin/refunds/${r.id}/approve`, { amount: 55, reason: 'Maleta cobrada dos veces', cancel: false }, admin);
    assert.equal(ap.booking_status, 'confirmed'); assert.equal(ap.retained, 0); assert.equal((await ok('GET', `/admin/bookings/${b.pnr}/refund-quote?cause=operacion`, null, admin)).suggested, r2(b.total - 55), 'lo ya devuelto se descuenta');
    const r3 = await ok('POST', `/agency/bookings/${b.pnr}/refund`, { cause: 'voluntaria', note: 'Cambió de planes' }, A.tk);
    assert.equal((await call('POST', `/admin/refunds/${r3.id}/reject`, {}, admin)).status, 400); const rj = await ok('POST', `/admin/refunds/${r3.id}/reject`, { reason: 'El vuelo sale en menos de 24 horas' }, admin); assert.equal(rj.status, 'rejected'); assert.equal(rj.booking_status, 'confirmed');
    const L = await ok('GET', '/admin/refunds', null, admin); assert.ok(L.refunds.length >= 5); assert.equal(L.totals.requested, 0); assert.ok(L.totals.paid > 0 && L.totals.to_pay > 0);
    const v = (await ok('GET', '/agency/bookings', null, A.tk)).find(x => x.pnr === b.pnr); assert.deepEqual(v.refunds.map(x => x.status), ['approved', 'rejected']);
  });
} finally { srv.kill(); await sleep(200); fs.rmSync(dir, { recursive: true, force: true }) }
if (errOut.trim()) console.log('\nstderr del servidor:\n' + errOut.trim().split('\n').slice(0, 20).join('\n'));
console.log(`\n${passed} pruebas pasaron, ${failed} fallaron.`); process.exit(failed ? 1 : 0);
