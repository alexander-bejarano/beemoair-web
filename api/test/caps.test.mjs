// Pruebas de cupos por tarifa y sobreventa.
// Uso: node --no-warnings api/test/caps.test.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url)), SERVER = path.join(HERE, '..', 'server.mjs');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'beemo-cp-')), PORT = 19900 + Math.floor(Math.random() * 90), BASE = `http://127.0.0.1:${PORT}/api`, PW = 'clave-de-prueba-123';
const srv = spawn(process.execPath, ['--no-warnings', SERVER], { env: { ...process.env, PORT: String(PORT), DB_PATH: path.join(dir, 'beemo.db'), ADMIN_SETUP_CODE: 'prueba-local', UCP_ENABLED: '0' }, stdio: ['ignore', 'pipe', 'pipe'] });
let errOut = ''; srv.stderr.on('data', d => { errOut += d });
const sleep = ms => new Promise(r => setTimeout(r, ms));
let passed = 0, failed = 0;
async function t(name, fn) { try { await fn(); passed++; console.log('  ✓ ' + name) } catch (e) { failed++; console.log('  ✗ ' + name + '\n      ' + String(e && e.message || e).split('\n').slice(0, 8).join('\n      ')) } }
async function call(method, p, body, token) { const r = await fetch(BASE + p, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: body ? JSON.stringify(body) : undefined }); let j = {}; try { j = await r.json() } catch (e) {} return { status: r.status, j } }
const ok = async (...a) => { const r = await call(...a); assert.equal(r.status, 200, `${a[0]} ${a[1]} → ${r.status} ${JSON.stringify(r.j)}`); return r.j };
for (let i = 0; i < 60; i++) { try { if ((await fetch(BASE + '/health')).ok) break } catch (e) {} await sleep(100) }
const R = 'MIA-AXM'; let admin, A, D;
const names = n => Array.from({ length: n }, (_, i) => ({ first: 'Pax' + String.fromCharCode(65 + i), last: 'Prueba' }));
const bk = (date, fare, n = 1, pay = 'cash') => call('POST', '/agency/bookings', { legs: [{ route: R, date, fare }], pax: names(n), contact: { email: 'c@correo.test', phone: '' }, pay }, A);
const left = async date => (await ok('GET', `/agency/flights?route=${R}&n=10`, null, A)).find(f => f.date === date).left;
const setF = (date, caps, overbook) => ok('PUT', '/admin/flight/caps', { route: R, date, caps, overbook }, admin);
try {
  await t('cupos aprobados por defecto, fechas pico y validaciones', async () => {
    await ok('POST', '/admin/setup', { code: 'prueba-local', email: 'admin@prueba.test', password: PW }); admin = (await ok('POST', '/auth/login', { email: 'admin@prueba.test', password: PW })).token;
    const { id } = await ok('POST', '/admin/agencies', { name: 'Agencia A', country: 'Colombia' }, admin), u = await ok('POST', `/admin/agencies/${id}/users`, { email: 'a@prueba.test', name: 'Agente' }, admin);
    A = (await ok('POST', '/auth/login', { email: 'a@prueba.test', password: u.temp_password })).token; await ok('POST', '/me/password', { password: PW }, A); A = (await ok('POST', '/auth/login', { email: 'a@prueba.test', password: PW })).token;
    D = (await ok('GET', `/agency/flights?route=${R}&n=10`, null, A)).map(f => f.date); assert.ok(D.includes('2026-12-18') && D.includes('2026-12-14'));
    const G = await ok('GET', '/admin/caps', null, admin); assert.deepEqual(G.normal, { light: 30, basic: 35, classic: 35, plus: 23, flex: 15 }); assert.deepEqual(G.peak, { light: 15, basic: 25, classic: 40, plus: 33, flex: 25 }); assert.equal(G.overbook, 0); assert.equal(G.eco_seats, 138);
    assert.deepEqual(await left('2026-12-14'), { bc: 12, light: 30, basic: 65, classic: 100, plus: 123, flex: 138 }); assert.equal((await left('2026-12-18')).light, 15, 'fecha pico'); assert.equal((await left('2026-12-18')).basic, 40);
    assert.equal((await call('PUT', '/admin/caps', { ...G, overbook: 99 }, admin)).status, 400); assert.equal((await call('PUT', '/admin/caps', { ...G, normal: { ...G.normal, light: -1 } }, admin)).status, 400); assert.equal((await call('PUT', '/admin/caps', { ...G, peaks: [['2027-01-08', '2027-01-02']] }, admin)).status, 400);
    assert.equal((await call('PUT', '/admin/caps', G, A)).status, 403); assert.equal((await call('PUT', '/admin/flight/caps', { route: R, date: D[0], overbook: 2 }, A)).status, 403);
  });
  await t('una tarifa agotada ofrece la siguiente; las caras usan el cupo que sobra', async () => {
    const d = D[1]; let c = await setF(d, { light: 2, basic: 1, classic: 1, plus: 1, flex: 0 }); assert.equal(c.own, true); assert.deepEqual([c.left.light, c.left.basic, c.left.classic], [2, 3, 4]);
    assert.equal((await bk(d, 'light', 2)).status, 200); let r = await bk(d, 'light'); assert.equal(r.status, 400); assert.equal(r.j.code, 'fare_sold_out'); assert.equal(r.j.next, 'basic'); assert.match(r.j.error, /Light ya se agotó.*Basic/);
    r = await bk(d, 'basic', 2); assert.equal(r.status, 400); assert.match(r.j.error, /solo queda 1 cupo/); assert.equal(r.j.next, 'classic', 'para dos pasajeros cabe desde Classic');
    assert.equal((await bk(d, 'basic')).status, 200); assert.equal((await bk(d, 'basic')).j.next, 'classic'); assert.equal((await bk(d, 'classic', 2)).j.next, 'plus', 'ya solo queda un cupo acumulado hasta Classic');
    const d2 = D[2]; await setF(d2, { light: 2, basic: 1, classic: 0, plus: 0, flex: 0 }); assert.equal((await bk(d2, 'basic', 3)).status, 200, 'Basic usa el cupo libre de Light');
    assert.equal((await left(d2)).light, 0, 'y Light ya no puede venderlo'); assert.equal((await bk(d2, 'light')).j.next, 'flex'); assert.equal((await bk(d2, 'flex')).status, 200, 'la más cara vende cualquier silla libre');
    assert.equal((await left(d)).bc, 12); assert.equal((await bk(d, 'bc', 2)).status, 200);
  });
  await t('editar una reserva pendiente no choca con su propio cupo, y el cambio de fecha lo respeta', async () => {
    const d = D[3]; await setF(d, { light: 1, basic: 0, classic: 0, plus: 0, flex: 0 }); const h = (await bk(d, 'light', 1, 'hold')).j;
    const e = await call('POST', `/agency/bookings/${h.pnr}/edit`, { pax: [{ first: 'Corregido', last: 'Nombre', from: 0 }], contact: { email: 'c@correo.test', phone: '' } }, A); assert.equal(e.status, 200, JSON.stringify(e.j));
    assert.equal((await call('POST', `/agency/bookings/${h.pnr}/edit`, { pax: [{ first: 'Corregido', last: 'Nombre', from: 0 }, { first: 'Otro', last: 'Más', from: null }], contact: { email: 'c@correo.test', phone: '' } }, A)).j.code, 'fare_sold_out');
    const c = (await bk(D[4], 'classic')).j, ch = await call('POST', `/agency/bookings/${c.pnr}/change`, { leg: 0, date: d, preview: true }, A); assert.equal(ch.status, 400); assert.match(ch.j.error, /Classic ya no tiene cupo/);
    await setF(d, null, null); assert.equal((await left(d)).classic, 99, 'sin cupo propio vuelve al general');
    const G = await ok('GET', '/admin/caps', null, admin); await ok('PUT', '/admin/caps', { ...G, on: false }, admin); assert.equal((await left(D[1])).light, 138 - 3, 'cupos apagados: cualquier silla libre'); await ok('PUT', '/admin/caps', { ...G, on: true }, admin);
  });
  await t('sobreventa: en cero no vende de más; activada deja pasajeros en espera y les da silla al liberarse una', async () => {
    const d = D[5]; let first;
    for (let i = 0; i < 15; i++) { const r = await bk(d, 'flex', 9); assert.equal(r.status, 200, JSON.stringify(r.j)); first ||= r.j } assert.equal((await bk(d, 'flex', 3)).status, 200);
    assert.equal((await left(d)).flex, 0); assert.equal((await bk(d, 'flex')).j.code, 'fare_sold_out', 'cabina llena y sobreventa en cero');
    let c = await setF(d, null, 2); assert.equal(c.overbook, 2); assert.equal(c.left.flex, 2); assert.equal(c.left.bc, 12);
    const o = await bk(d, 'flex', 2); assert.equal(o.status, 200, JSON.stringify(o.j)); assert.deepEqual(o.j.legs[0].seats, ['SB1', 'SB2']); assert.equal((await bk(d, 'flex')).j.code, 'fare_sold_out', 'no pasa del límite');
    let m = await ok('GET', `/admin/manifest/control?route=${R}&date=${d}`, null, admin); assert.equal(m.counts.issued, 140); assert.equal(m.caps.standby, 2); assert.equal(m.caps.sold.flex, 140);
    assert.equal((await call('POST', '/agency/bookings', { legs: [{ route: R, date: d, fare: 'flex', seats: ['SB7'] }], pax: names(1), contact: { email: 'c@correo.test', phone: '' }, pay: 'cash' }, A)).status, 400, 'nadie pide un puesto en espera');
    await ok('POST', `/admin/bookings/${first.pnr}/cancel`, {}, admin);   // se liberan 9 sillas
    m = await ok('GET', `/admin/manifest/control?route=${R}&date=${d}`, null, admin); assert.equal(m.caps.standby, 0); assert.equal(m.counts.issued, 131);
    const v = (await ok('GET', '/agency/bookings', null, A)).find(b => b.pnr === o.j.pnr); assert.ok(v.legs[0].seats.every(s => /^\d+[A-F]$/.test(s)), 'ya tienen silla: ' + v.legs[0].seats); assert.ok(v.legs[0].seats.every(s => first.legs[0].seats.includes(s)));
    assert.equal((await left(d)).flex, 9, '7 sillas libres más 2 de sobreventa');
  });
} finally { srv.kill(); await sleep(200); fs.rmSync(dir, { recursive: true, force: true }) }
if (errOut.trim()) console.log('\nstderr del servidor:\n' + errOut.trim().split('\n').slice(0, 20).join('\n'));
console.log(`\n${passed} pruebas pasaron, ${failed} fallaron.`); process.exit(failed ? 1 : 0);
