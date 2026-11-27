// Pruebas del CRM de pasajeros: fichas por persona, aislamiento entre agencias, datos de viaje y manifiesto.
// Uso: node --no-warnings api/test/crm.test.mjs   (levanta el servidor con una base de datos temporal)
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url)), SERVER = path.join(HERE, '..', 'server.mjs');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'beemo-crm-')), PORT = 18000 + Math.floor(Math.random() * 1000), BASE = `http://127.0.0.1:${PORT}/api`;
const srv = spawn(process.execPath, ['--no-warnings', SERVER], { env: { ...process.env, PORT: String(PORT), DB_PATH: path.join(dir, 'beemo.db'), ADMIN_SETUP_CODE: 'prueba-local', UCP_ENABLED: '0' }, stdio: ['ignore', 'pipe', 'pipe'] });
let errOut = ''; srv.stderr.on('data', d => { errOut += d });
const sleep = ms => new Promise(r => setTimeout(r, ms));
let passed = 0, failed = 0;
async function t(name, fn) { try { await fn(); passed++; console.log('  ✓ ' + name) } catch (e) { failed++; console.log('  ✗ ' + name + '\n      ' + String(e && e.message || e).split('\n').slice(0, 8).join('\n      ')) } }
async function call(method, p, body, token) {
  const r = await fetch(BASE + p, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: body ? JSON.stringify(body) : undefined });
  let j = {}; try { j = await r.json() } catch (e) {} return { status: r.status, j };
}
const ok = async (...a) => { const r = await call(...a); assert.equal(r.status, 200, `${a[0]} ${a[1]} → ${r.status} ${JSON.stringify(r.j)}`); return r.j };

for (let i = 0; i < 50; i++) { try { if ((await fetch(BASE + '/health')).ok) break } catch (e) {} await sleep(100) }
const PW = 'clave-de-prueba-123';
async function agencyUser(admin, name, email) {
  const { id } = await ok('POST', '/admin/agencies', { name, country: 'Colombia' }, admin);
  const u = await ok('POST', `/admin/agencies/${id}/users`, { email, name: 'Agente ' + name }, admin);
  let tk = (await ok('POST', '/auth/login', { email, password: u.temp_password })).token;
  await ok('POST', '/me/password', { current: u.temp_password, password: PW, next: PW }, tk);
  tk = (await ok('POST', '/auth/login', { email, password: PW })).token;
  return { id, tk };
}
let admin, A, B, dates, P1, P2, P3, juanA;
const TR = { doc_type: 'P', doc_no: 'ab 123456', doc_country: 'col', doc_exp: '2031-05-01', nationality: 'COL', dob: '1985-03-02', gender: 'M' };
try {
  await t('configuración: administrador y dos agencias', async () => {
    await ok('POST', '/admin/setup', { code: 'prueba-local', email: 'admin@prueba.test', password: PW });
    admin = (await ok('POST', '/auth/login', { email: 'admin@prueba.test', password: PW })).token;
    A = await agencyUser(admin, 'Agencia A', 'a@prueba.test'); B = await agencyUser(admin, 'Agencia B', 'b@prueba.test');
    dates = (await ok('GET', '/agency/flights?route=MIA-AXM&n=4', null, A.tk)).map(f => f.date); assert.ok(dates.length >= 3);
  });
  const book = (tk, date, pax, email, pay = 'cash') => ok('POST', '/agency/bookings', { legs: [{ route: 'MIA-AXM', date, fare: 'classic' }], pax, contact: { email, phone: '+57 300 111 2233' }, pay }, tk);
  await t('cada pasajero queda con su ficha y la misma persona no se duplica', async () => {
    P1 = await book(A.tk, dates[0], [{ first: 'Juan', last: 'Pérez' }, { first: 'Ana', last: 'Pérez' }], 'juan@correo.test');
    P2 = await book(A.tk, dates[1], [{ first: 'JUAN', last: 'Perez' }], 'Juan@correo.test');
    const r = await ok('GET', '/agency/crm', null, A.tk);
    assert.equal(r.customers.length, 2); assert.equal(r.stats.total, 2);
    const juan = r.customers.find(c => c.name === 'Juan Pérez'); assert.ok(juan, 'Juan'); juanA = juan.id;
    assert.equal(juan.bookings, 2); assert.equal(juan.issued, 2); assert.equal(juan.kind, 'frecuente'); assert.equal(juan.legs, 2);
    assert.deepEqual(P1.customers.length, 2); assert.equal(P2.customers[0], juan.id);
  });
  await t('una agencia no ve los clientes, reservas ni notas de otra', async () => {
    P3 = await book(B.tk, dates[0], [{ first: 'Marta', last: 'Gómez' }], 'marta@correo.test');
    const rb = await ok('GET', '/agency/crm', null, B.tk); assert.deepEqual(rb.customers.map(c => c.name), ['Marta Gómez']);
    assert.equal((await call('GET', `/agency/crm/${juanA}`, null, B.tk)).status, 404);
    assert.equal((await call('POST', `/agency/crm/${juanA}/notes`, { body: 'no debería' }, B.tk)).status, 404);
    assert.equal((await call('PUT', `/agency/bookings/${P1.pnr}/travel`, { pax: 0, ...TR }, B.tk)).status, 404);
    await ok('POST', `/agency/crm/${juanA}/notes`, { body: 'Prefiere ventana. Viaja con su esposa.' }, A.tk);
    const d = await ok('GET', `/agency/crm/${juanA}`, null, A.tk);
    assert.equal(d.notes.length, 1); assert.equal(d.bookings.length, 2); assert.equal(d.notes[0].from, 'Agencia A');
    assert.equal((await call('GET', '/admin/crm', null, A.tk)).status, 403);
  });
  await t('datos de viaje: validación, guardado y cliente que vuelve', async () => {
    assert.equal((await call('PUT', `/agency/bookings/${P1.pnr}/travel`, { pax: 0, ...TR, doc_country: 'Colombia' }, A.tk)).status, 400);
    assert.equal((await call('PUT', `/agency/bookings/${P1.pnr}/travel`, { pax: 0, ...TR, doc_exp: '2020-01-01' }, A.tk)).status, 400);
    assert.equal((await call('PUT', `/agency/bookings/${P1.pnr}/travel`, { pax: 7, ...TR }, A.tk)).status, 400);
    const v = await ok('PUT', `/agency/bookings/${P1.pnr}/travel`, { pax: 0, ...TR }, A.tk);
    assert.equal(v.travel[0].doc_no, 'AB123456'); assert.equal(v.travel[0].doc_country, 'COL'); assert.equal(v.travel_ok[0], true); assert.equal(v.travel_ok[1], false);
    const n = await book(A.tk, dates[2], [{ first: 'Juan', last: 'Pérez' }], 'juan@correo.test');
    assert.equal(n.customers[0], juanA); assert.equal(n.travel[0]?.doc_no, 'AB123456', 'se traen los datos de su última reserva con la agencia');
  });
  await t('el mismo documento en otra agencia une la ficha sin mostrar datos ajenos', async () => {
    const x = await book(B.tk, dates[1], [{ first: 'Juan', last: 'Perez' }], 'ventas@agenciab.test');
    assert.notEqual(x.customers[0], juanA); assert.equal(x.travel[0], null, 'la agencia B no hereda el documento que cargó la agencia A');
    const v = await ok('PUT', `/agency/bookings/${x.pnr}/travel`, { pax: 0, ...TR }, B.tk);
    assert.equal(v.customers[0], juanA, 'misma persona, misma ficha');
    const d = await ok('GET', `/agency/crm/${juanA}`, null, B.tk);
    assert.equal(d.bookings.length, 1); assert.equal(d.notes.length, 0); assert.equal(d.customer.bookings, 1);
    const c = await ok('GET', '/admin/crm', null, admin);
    const juan = c.customers.find(k => k.id === juanA); assert.equal(juan.bookings, 4); assert.deepEqual(juan.channels.sort(), ['Agencia A', 'Agencia B']);
    assert.equal(c.customers.filter(k => /juan/i.test(k.name)).length, 1);
  });
  await t('otro documento para la misma persona no crea otra ficha (doble nacionalidad)', async () => {
    const v = await ok('PUT', `/agency/bookings/${P2.pnr}/travel`, { pax: 0, ...TR, doc_no: 'US5554443', doc_country: 'USA', nationality: 'USA' }, A.tk);
    assert.equal(v.customers[0], juanA); assert.equal(v.travel[0].doc_country, 'USA');
    assert.equal((await ok('GET', '/agency/crm?q=juan%20p', null, A.tk)).customers.length, 1);
    assert.equal((await ok('GET', '/agency/crm?q=juan%20p', null, B.tk)).customers.length, 1);
  });
  await t('vista central: todo, por agencia y venta directa', async () => {
    const web = await call('POST', '/bookings', { legs: [{ route: 'MIA-AXM', date: dates[0], fare: 'classic' }], pax: [{ first: 'Luis', last: 'Rojas' }], contact: { email: 'luis@correo.test', phone: '' } });
    assert.equal(web.status, 200, JSON.stringify(web.j)); assert.equal(web.j.travel, undefined, 'la vista pública no lleva datos de viaje');
    const all = await ok('GET', '/admin/crm', null, admin); assert.equal(all.stats.total, 4); assert.ok(all.agencies.length >= 2);
    assert.equal(all.agencies.find(a => a.name === 'Agencia A').total, 2); assert.equal(all.agencies.find(a => a.name === 'Agencia B').total, 2); assert.equal(all.direct.total, 1);
    assert.deepEqual((await ok('GET', `/admin/crm?agency=${B.id}`, null, admin)).customers.map(c => c.name).sort(), ['Juan Pérez', 'Marta Gómez']);
    assert.deepEqual((await ok('GET', '/admin/crm?agency=web', null, admin)).customers.map(c => c.name), ['Luis Rojas']);
    assert.equal((await ok('GET', '/admin/crm?q=marta', null, admin)).customers.length, 1);
    assert.equal((await ok('GET', `/admin/crm?q=${P1.pnr}`, null, admin)).customers.length, 2);
    const d = await ok('GET', `/admin/crm/${juanA}`, null, admin); assert.equal(d.bookings.length, 4); assert.equal(d.notes.length, 1);
    await ok('POST', `/admin/crm/${juanA}/notes`, { body: 'Nota interna de Beemo.' }, admin);
    assert.equal((await ok('GET', `/agency/crm/${juanA}`, null, A.tk)).notes.length, 1, 'la agencia no ve las notas de Beemo');
    assert.equal((await ok('GET', `/admin/crm/${juanA}`, null, admin)).notes.length, 2);
  });
  await t('editar una reserva pendiente conserva fichas y datos de viaje', async () => {
    const h = await book(A.tk, dates[2], [{ first: 'Sofía', last: 'Lara' }, { first: 'Pedro', last: 'Lara' }], 'sofia@correo.test', 'hold');
    await ok('PUT', `/agency/bookings/${h.pnr}/travel`, { pax: 1, ...TR, doc_no: 'ZZ998877', dob: '1990-01-01' }, A.tk);
    const e = await ok('POST', `/agency/bookings/${h.pnr}/edit`, { pax: [{ first: 'Pedro', last: 'Lara', from: 1 }, { first: 'Sofia', last: 'Lara Ruiz', from: 0 }, { first: 'Nuevo', last: 'Pasajero', from: null }], contact: { email: 'sofia@correo.test', phone: '' } }, A.tk);
    assert.equal(e.pax.length, 3); assert.equal(e.travel[0]?.doc_no, 'ZZ998877'); assert.equal(e.travel[1], null);
    assert.equal(e.customers[0], h.customers[1]); assert.equal(e.customers[1], h.customers[0], 'corregir el nombre no crea otra ficha');
    const L = (await ok('GET', '/agency/crm?q=lara', null, A.tk)).customers; assert.deepEqual(L.map(c => c.name).sort(), ['Pedro Lara', 'Sofia Lara Ruiz']);
    assert.equal(L[0].kind, 'prospecto');
  });
  await t('manifiesto: datos de viaje por pasajero', async () => {
    const m = await ok('GET', `/admin/manifest?route=MIA-AXM&date=${dates[0]}`, null, admin); assert.equal(m.length, 4);
    const j = m.find(r => r.name === 'Juan Pérez'); assert.equal(j.travel_ok, true); assert.equal(j.travel.nationality, 'COL'); assert.equal(j.email, 'juan@correo.test'); assert.equal(j.last, 'Pérez');
    assert.equal(m.filter(r => r.travel_ok).length, 1);
    const ma = await ok('GET', `/agency/manifest?route=MIA-AXM&date=${dates[0]}`, null, A.tk); assert.equal(ma.rows.length, 2); assert.equal(ma.rows.filter(r => r.travel_ok).length, 1);
    const mb = await ok('GET', `/agency/manifest?route=MIA-AXM&date=${dates[0]}`, null, B.tk); assert.deepEqual(mb.rows.map(r => r.name), ['Marta Gómez']);
  });
} finally { srv.kill(); await sleep(200); fs.rmSync(dir, { recursive: true, force: true }) }
if (errOut.trim()) console.log('\nstderr del servidor:\n' + errOut.trim().split('\n').slice(0, 20).join('\n'));
console.log(`\n${passed} pruebas pasaron, ${failed} fallaron.`); process.exit(failed ? 1 : 0);
