// Pruebas de operación irregular: cancelar, reabrir, cambiar de hora, agregar un vuelo y reacomodar pasajeros.
// Uso: node --no-warnings api/test/irop.test.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url)), SERVER = path.join(HERE, '..', 'server.mjs');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'beemo-io-')), PORT = 19300 + Math.floor(Math.random() * 300), BASE = `http://127.0.0.1:${PORT}/api`, PW = 'clave-de-prueba-123';
const srv = spawn(process.execPath, ['--no-warnings', SERVER], { env: { ...process.env, PORT: String(PORT), DB_PATH: path.join(dir, 'beemo.db'), ADMIN_SETUP_CODE: 'prueba-local', UCP_ENABLED: '0' }, stdio: ['ignore', 'pipe', 'pipe'] });
let errOut = ''; srv.stderr.on('data', d => { errOut += d });
const sleep = ms => new Promise(r => setTimeout(r, ms));
let passed = 0, failed = 0;
async function t(name, fn) { try { await fn(); passed++; console.log('  ✓ ' + name) } catch (e) { failed++; console.log('  ✗ ' + name + '\n      ' + String(e && e.message || e).split('\n').slice(0, 8).join('\n      ')) } }
async function call(method, p, body, token) { const r = await fetch(BASE + p, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: body ? JSON.stringify(body) : undefined }); let j = {}; try { j = await r.json() } catch (e) {} return { status: r.status, j } }
const ok = async (...a) => { const r = await call(...a); assert.equal(r.status, 200, `${a[0]} ${a[1]} → ${r.status} ${JSON.stringify(r.j)}`); return r.j };
for (let i = 0; i < 60; i++) { try { if ((await fetch(BASE + '/health')).ok) break } catch (e) {} await sleep(100) }
let admin, A, D, RD, one, two, rt, hold;
const R = 'MIA-AXM', flights = async (route = R) => (await ok('GET', `/agency/flights?route=${route}&n=8`, null, A)).map(f => f.date);
const seatsOf = async (date, route = R) => (await ok('GET', `/seats?route=${route}&date=${date}`)).taken.sort();
const mine = async pnr => (await ok('GET', '/agency/bookings', null, A)).find(b => b.pnr === pnr);
const book = (legs, pax, pay = 'cash') => ok('POST', '/agency/bookings', { legs, pax, contact: { email: 'cliente@correo.test', phone: '+57 300 111 2233' }, pay }, A);
const act = (action, body, tk = admin) => call('POST', `/admin/flight/${action}`, { route: R, ...body }, tk);
try {
  await t('preparación: reservas en el vuelo que se va a cancelar', async () => {
    await ok('POST', '/admin/setup', { code: 'prueba-local', email: 'admin@prueba.test', password: PW }); admin = (await ok('POST', '/auth/login', { email: 'admin@prueba.test', password: PW })).token;
    const { id } = await ok('POST', '/admin/agencies', { name: 'Agencia A', country: 'Colombia' }, admin), u = await ok('POST', `/admin/agencies/${id}/users`, { email: 'a@prueba.test', name: 'Agente' }, admin);
    A = (await ok('POST', '/auth/login', { email: 'a@prueba.test', password: u.temp_password })).token; await ok('POST', '/me/password', { password: PW }, A); A = (await ok('POST', '/auth/login', { email: 'a@prueba.test', password: PW })).token;
    D = await flights(); RD = await flights('AXM-MIA');
    one = await book([{ route: R, date: D[1], fare: 'classic', seats: ['10A'] }], [{ first: 'Uno', last: 'Solo' }]);
    two = await book([{ route: R, date: D[1], fare: 'bc' }], [{ first: 'Dos', last: 'Biz' }, { first: 'Tres', last: 'Biz' }]);
    rt = await book([{ route: R, date: D[1], fare: 'plus' }, { route: 'AXM-MIA', date: RD.find(x => x > D[1] && x < D[3]), fare: 'plus' }], [{ first: 'Ida', last: 'Vuelta' }]);
    hold = await book([{ route: R, date: D[1], fare: 'light' }], [{ first: 'Sin', last: 'Pagar' }], 'hold');
    await book([{ route: R, date: D[2], fare: 'classic', seats: ['10A'] }], [{ first: 'Ya', last: 'Estaba' }]);   // ocupa la 10A en el vuelo de destino
    assert.equal((await seatsOf(D[1])).length, 5);
  });
  await t('cancelar un vuelo lo saca de la venta y avisa', async () => {
    assert.equal((await act('cancel', { date: D[1], note: 'Mantenimiento' }, A)).status, 403); assert.equal((await act('cancel', { date: D[1] })).status, 400, 'pide el motivo'); assert.equal((await act('cancel', { date: '2026-12-16', note: 'no existe' })).status, 400);
    const s = (await act('cancel', { date: D[1], note: 'Mantenimiento no programado' })).j; assert.equal(s.status, 'cancelled'); assert.equal(s.on_sale, false); assert.equal(s.bookings.length, 4); assert.equal(s.pax, 5); assert.ok(!s.alternatives.some(x => x.date === D[1]));
    assert.ok(!(await flights()).includes(D[1])); assert.equal((await call('POST', '/agency/bookings', { legs: [{ route: R, date: D[1], fare: 'classic' }], pax: [{ first: 'No', last: 'Puede' }], contact: { email: 'x@correo.test', phone: '' }, pay: 'cash' }, A)).status, 400);
    assert.equal((await act('cancel', { date: D[1], note: 'otra vez' })).status, 400);
    const ov = (await ok('GET', '/admin/overview', null, admin)).flights.find(f => f.route === R && f.date === D[1]); assert.equal(ov.state, 'cancelled'); assert.equal(ov.sold, 4);
    assert.ok((await ok('GET', '/agency/notices', null, A)).some(n => n.flight === `${R}|${D[1]}` && /cancelado/.test(n.message) && n.mine));
    assert.equal((await mine(one.pnr)).legs[0].cancelled, true); assert.equal((await ok('GET', `/admin/manifest/control?route=${R}&date=${D[1]}`, null, admin)).counts.issued, 4, 'el manifiesto sigue disponible');
  });
  await t('reacomodar: conserva la silla si está libre, y si no asigna una de su cabina', async () => {
    assert.equal((await act('move', { date: D[1], pnr: one.pnr, to: D[1] })).status, 409); assert.equal((await act('move', { date: D[1], pnr: 'NOEXISTE', to: D[2] })).status, 400);
    assert.equal((await act('move', { date: D[1], pnr: one.pnr, to: '2026-12-16' })).status, 409, 'ese día no hay vuelo');
    const m = (await act('move', { date: D[1], pnr: one.pnr, to: D[2] })).j; assert.equal(m.moved.length, 1); assert.equal(m.moved[0].kept, false, 'la 10A ya estaba ocupada allá'); assert.notEqual(m.moved[0].seats[0], '10A');
    const b = await mine(one.pnr); assert.equal(b.legs[0].date, D[2]); assert.equal(b.legs[0].moved.from, D[1]); assert.equal(b.legs[0].cancelled, undefined); assert.equal(b.total, one.total, 'sin costo');
    assert.ok(!(await seatsOf(D[1])).includes('10A')); assert.ok((await seatsOf(D[2])).includes(m.moved[0].seats[0]));
    const m2 = (await act('move', { date: D[1], pnr: two.pnr, to: D[2] })).j; assert.equal(m2.moved[0].kept, true); assert.deepEqual(m2.moved[0].seats, two.legs[0].seats); assert.ok(m2.moved[0].seats.every(s => parseInt(s) <= 3), 'siguen en Business');
  });
  await t('reacomodo en bloque: mueve las que puede y explica las que no', async () => {
    const r = (await act('move', { date: D[1], to: D[3] })).j;
    assert.deepEqual(r.moved.map(x => x.pnr), [hold.pnr]); assert.equal(r.failed.length, 1); assert.equal(r.failed[0].pnr, rt.pnr); assert.match(r.failed[0].error, /regreso quedaría antes de la ida/);
    assert.deepEqual(r.bookings.map(x => x.pnr), [rt.pnr]); assert.equal((await mine(rt.pnr)).legs[0].date, D[1], 'no se tocó');
    const no = await act('move', { date: D[1], pnr: rt.pnr, to: D[2] }); assert.equal(no.status, 409, 'el regreso es ese mismo día'); assert.match(no.j.error, /regreso quedaría antes/); assert.equal((await seatsOf(D[1])).length, 1);
  });
  await t('reembolso por operación desde el vuelo, y reabrir', async () => {
    const x = await book([{ route: R, date: D[4], fare: 'classic' }], [{ first: 'Pide', last: 'Plata' }]), h = await book([{ route: R, date: D[4], fare: 'classic' }], [{ first: 'Apartada', last: 'Dos' }], 'hold');
    await act('cancel', { date: D[4], note: 'Cierre del aeropuerto' });
    let s = (await act('refund', { date: D[4], pnr: x.pnr })).j; assert.equal(s.bookings.find(b => b.pnr === x.pnr).refund, 'requested');
    const rf = (await ok('GET', '/admin/refunds', null, admin)).refunds[0]; assert.equal(rf.pnr, x.pnr); assert.equal(rf.cause, 'operacion'); assert.equal(rf.suggested, x.total);
    s = (await act('refund', { date: D[4], pnr: h.pnr })).j; assert.equal(s.released, h.pnr); assert.equal((await mine(h.pnr)).status, 'cancelled', 'la apartada sin pago solo se libera');
    assert.equal((await act('move', { date: D[4], to: D[5] })).j.failed[0].error, 'Tiene un reembolso en curso.');
    assert.equal((await act('reopen', { date: D[2] })).status, 400); s = (await act('reopen', { date: D[4] })).j; assert.equal(s.status, 'scheduled'); assert.equal(s.on_sale, true); assert.ok((await flights()).includes(D[4]));
  });
  await t('cambio de hora: actualiza el vuelo, las reservas y el cierre de ventas', async () => {
    assert.equal((await act('retime', { date: D[2], dep: '25:00', arr: '13:00' })).status, 400);
    const c0 = await ok('GET', `/admin/manifest/control?route=${R}&date=${D[2]}`, null, admin), s = (await act('retime', { date: D[2], dep: '12:10', arr: '15:45', note: 'Por franja del aeropuerto' })).j;
    assert.equal(s.dep, '12:10'); assert.equal(s.retimed, true); assert.equal(s.base.dep, '09:40');
    const f = (await ok('GET', `/agency/flights?route=${R}&n=8`, null, A)).find(x => x.date === D[2]); assert.equal(f.dep, '12:10'); assert.equal(f.arr, '15:45');
    const b = await mine(one.pnr); assert.equal(b.legs[0].dep, '12:10'); assert.equal(b.legs[0].retimed.from, '09:40');
    const c1 = await ok('GET', `/admin/manifest/control?route=${R}&date=${D[2]}`, null, admin); assert.equal(Date.parse(c1.dep_at) - Date.parse(c0.dep_at), 2.5 * 3600e3); assert.equal(Date.parse(c1.closes_at) - Date.parse(c0.closes_at), 2.5 * 3600e3);
    assert.ok((await ok('GET', '/agency/notices', null, A)).some(n => n.kind === 'horario' && /12:10/.test(n.message)));
    const n = await book([{ route: R, date: D[2], fare: 'classic' }], [{ first: 'Hora', last: 'Nueva' }]); assert.equal(n.legs[0].dep, '12:10');
    const back = (await act('retime', { date: D[2], dep: '09:40', arr: '13:15' })).j; assert.equal(back.retimed, false); assert.equal((await mine(one.pnr)).legs[0].dep, '09:40');
  });
  await t('vuelo adicional fuera de la programación', async () => {
    const extra = (() => { const d = new Date(D[2] + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + 1); return d.toISOString().slice(0, 10) })(); assert.ok(!D.includes(extra));
    assert.equal((await act('add', { date: D[2] })).status, 400, 'ya existe'); assert.equal((await act('add', { date: extra, dep: '9:40' })).status, 400);
    const s = (await act('add', { date: extra, dep: '16:00', arr: '19:35', note: 'Vuelo de refuerzo' })).j; assert.equal(s.status, 'extra'); assert.equal(s.on_sale, true); assert.equal(s.dep, '16:00');
    assert.ok((await flights()).includes(extra)); const b = await book([{ route: R, date: extra, fare: 'classic' }], [{ first: 'En', last: 'Adicional' }]); assert.equal(b.legs[0].dep, '16:00');
    const mv = (await act('move', { date: D[2], pnr: one.pnr, to: extra })).j; assert.equal(mv.moved.length, 1); assert.equal((await mine(one.pnr)).legs[0].dep, '16:00');
    const c = (await act('cancel', { date: extra, note: 'Ya no hace falta' })).j; assert.equal(c.status, 'cancelled'); assert.ok(!(await flights()).includes(extra)); assert.equal(c.bookings.length, 2);
  });
  await t('cambio de fecha desde el administrador: cualquier canal, con o sin las reglas de la tarifa', async () => {
    const F = await flights(), put = (pnr, body, tk = admin) => call('PUT', `/admin/bookings/${pnr}/change`, body, tk);
    const web = await ok('POST', '/bookings', { legs: [{ route: R, date: F[5], fare: 'bc' }], pax: [{ first: 'Clase', last: 'Ejecutiva' }], contact: { email: 'bc@correo.test', phone: '' } });
    assert.equal((await put(web.pnr, { leg: 0, date: F[6], preview: true })).status, 400, 'pendiente de pago: aún no es un cambio'); await ok('POST', `/admin/bookings/${web.pnr}/paid`, {}, admin);
    assert.equal((await put(web.pnr, { leg: 0, date: F[6], preview: true }, A)).status, 403); assert.equal((await put('NOEXISTE', { leg: 0, date: F[6] })).status, 404);
    const pv = (await put(web.pnr, { leg: 0, date: F[6], preview: true })).j; assert.equal(pv.fee, 0); assert.equal(pv.amount, 0); assert.ok(parseInt(pv.seats[0].to) <= 3, 'sigue en Business');
    const done = (await put(web.pnr, { leg: 0, date: F[6] })).j; assert.equal(done.legs[0].date, F[6]); assert.equal(done.changes.length, 1); assert.equal(done.changes[0].amount, 0); assert.ok(!(await seatsOf(F[5])).includes(web.legs[0].seats[0]));
    const li = await book([{ route: R, date: F[5], fare: 'light' }], [{ first: 'Tarifa', last: 'Light' }]);
    assert.match((await put(li.pnr, { leg: 0, date: F[6] })).j.error, /Light no permite cambios/); assert.match((await put(li.pnr, { leg: 0, date: F[6], force: true })).j.error, /Escribe el motivo/);
    const fl = (await put(li.pnr, { leg: 0, date: F[6], force: true, free: true, note: 'Cortesía por demora anterior' })).j; assert.equal(fl.legs[0].date, F[6]); assert.equal(fl.changes[0].amount, 0);
    const cl = await book([{ route: R, date: F[5], fare: 'classic' }], [{ first: 'Tarifa', last: 'Classic' }]), q = (await put(cl.pnr, { leg: 0, date: F[6], preview: true })).j; assert.equal(q.fee, 175); assert.equal(q.amount, 175);
    assert.equal((await put(cl.pnr, { leg: 0, date: F[6], free: true, preview: true })).j.amount, 0);
    const paid = (await put(cl.pnr, { leg: 0, date: F[6], pay: 'cash' })).j; assert.equal(paid.changes[0].amount, 175); assert.equal(paid.changes[0].pay, 'cash');
    assert.equal((await call('POST', `/agency/bookings/${cl.pnr}/change`, { leg: 0, date: F[7], preview: true }, A)).j.fee, 175, 'la agencia conserva sus reglas');
  });
} finally { srv.kill(); await sleep(200); fs.rmSync(dir, { recursive: true, force: true }) }
if (errOut.trim()) console.log('\nstderr del servidor:\n' + errOut.trim().split('\n').slice(0, 20).join('\n'));
console.log(`\n${passed} pruebas pasaron, ${failed} fallaron.`); process.exit(failed ? 1 : 0);
