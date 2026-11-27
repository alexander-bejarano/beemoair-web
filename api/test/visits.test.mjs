// Pruebas del registro de visitas, la ubicación por IP y el origen (IP) de cada reserva.
// Uso: node --no-warnings api/test/visits.test.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url)), SERVER = path.join(HERE, '..', 'server.mjs');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'beemo-vz-')), PORT = 19600 + Math.floor(Math.random() * 300), GPORT = PORT + 400, BASE = `http://127.0.0.1:${PORT}/api`, PW = 'clave-de-prueba-123';
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.7 Mobile/15E148 Safari/604.1';
const sleep = ms => new Promise(r => setTimeout(r, ms));
let passed = 0, failed = 0, srv, errOut = '';
async function t(name, fn) { try { await fn(); passed++; console.log('  ✓ ' + name) } catch (e) { failed++; console.log('  ✗ ' + name + '\n      ' + String(e && e.message || e).split('\n').slice(0, 8).join('\n      ')) } }
async function call(method, p, body, token, h = {}) { const r = await fetch(BASE + p, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}), ...h }, body: body ? JSON.stringify(body) : undefined }); let j = {}; try { j = await r.json() } catch (e) {} return { status: r.status, j } }
const ok = async (...a) => { const r = await call(...a); assert.equal(r.status, 200, `${a[0]} ${a[1]} → ${r.status} ${JSON.stringify(r.j)}`); return r.j };
const from = (ip, ua = UA) => ({ 'X-Forwarded-For': ip, 'User-Agent': ua });
// servicio de ubicación simulado
const GEO = { '164.153.54.182': { success: true, country: 'United States', country_code: 'US', region: 'South Carolina', city: 'Seneca', latitude: 34.6856587, longitude: -82.9532365, connection: { isp: 'West Carolina Communications, LLC' } },
  '181.51.115.132': { success: true, country: 'Colombia', country_code: 'CO', region: 'Quindío', city: 'Armenia', latitude: 4.534, longitude: -75.681, connection: { isp: 'Proveedor de prueba' } } };
const asked = []; const geo = http.createServer((req, res) => { const ip = decodeURIComponent(req.url.slice(1)); asked.push(ip); res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(GEO[ip] || { success: false, message: 'Invalid IP address' })) }); geo.listen(GPORT);
let admin, tk, pnr;
try {
  srv = spawn(process.execPath, ['--no-warnings', SERVER], { env: { ...process.env, PORT: String(PORT), DB_PATH: path.join(dir, 'beemo.db'), ADMIN_SETUP_CODE: 'prueba-local', UCP_ENABLED: '0', GEO_URL: `http://127.0.0.1:${GPORT}/{ip}` }, stdio: ['ignore', 'pipe', 'pipe'] });
  srv.stderr.on('data', d => { errOut += d });
  for (let i = 0; i < 60; i++) { try { if ((await fetch(BASE + '/health')).ok) break } catch (e) {} await sleep(100) }
  await t('la web registra visitas; los robots y los datos raros no entran', async () => {
    await ok('POST', '/admin/setup', { code: 'prueba-local', email: 'admin@prueba.test', password: PW });
    admin = (await ok('POST', '/auth/login', { email: 'admin@prueba.test', password: PW })).token;
    await ok('POST', '/visit', { p: '/', r: 'instagram.com', l: 'es-CO' }, null, from('164.153.54.182'));
    await ok('POST', '/visit', { p: '/ayuda/?x=1#y', r: 'www.beemoair.com', l: 'es' }, null, from('164.153.54.182'));
    await ok('POST', '/visit', { p: '/bee-club/', r: '', l: 'es' }, null, from('181.51.115.132'));
    await ok('POST', '/visit', { p: 'javascript:1', r: '<b>', l: '<<' }, null, from('181.51.115.132'));
    await ok('POST', '/visit', { p: '/' }, null, from('66.249.66.200', 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)'));
    await ok('POST', '/visit', { p: '/' }, null, from('72.14.201.211', 'WhatsApp/2.23.20.0'));
    await ok('POST', '/visit', {}, null, from('1.2.3.4, 164.153.54.182'));   // solo cuenta la última dirección, la que pone el proxy
    const v = await ok('GET', '/admin/visits?days=1', null, admin);
    assert.equal(v.total, 5); assert.equal(v.unique, 2); assert.equal(v.live, 2);
    const r = v.recent.find(x => x.path === '/ayuda/'); assert.ok(r, 'la ruta se guarda sin parámetros'); assert.equal(r.ref, null, 'la propia web no cuenta como origen'); assert.equal(r.device, 'iPhone · Safari');
    assert.ok(v.recent.some(x => x.ref === 'instagram.com')); assert.ok(v.recent.every(x => x.path.startsWith('/') && !/[<>]/.test(JSON.stringify(x))));
  });
  await t('la ubicación se consulta una vez por IP y arma el mapa', async () => {
    for (let i = 0; i < 80 && (await ok('GET', '/admin/visits?days=1', null, admin)).located < 5; i++) await sleep(150);
    const v = await ok('GET', '/admin/visits?days=7', null, admin);
    assert.equal(v.located, 5); assert.equal(v.points.length, 2); assert.deepEqual(v.countries.map(c => c.cc).sort(), ['CO', 'US']);
    const p = v.points.find(x => x.cc === 'US'); assert.equal(p.city, 'Seneca'); assert.equal(p.n, 3); assert.equal(p.u, 1); assert.equal(p.lat, 34.686); assert.equal(p.lon, -82.953);
    assert.equal(v.recent.find(x => x.ip === '181.51.115.132').isp, 'Proveedor de prueba');
    await ok('POST', '/visit', { p: '/' }, null, from('164.153.54.182')); await sleep(4500);
    assert.equal(asked.filter(x => x === '164.153.54.182').length, 1, 'no se vuelve a consultar una IP ya ubicada');
    assert.ok(!asked.includes('127.0.0.1'));
  });
  await t('cada reserva guarda su IP y dispositivo, y se marcan las repetidas', async () => {
    const { id } = await ok('POST', '/admin/agencies', { name: 'Agencia Origen', country: 'Colombia' }, admin), u = await ok('POST', `/admin/agencies/${id}/users`, { email: 'a@prueba.test', name: 'Agente' }, admin);
    tk = (await ok('POST', '/auth/login', { email: 'a@prueba.test', password: u.temp_password })).token; await ok('POST', '/me/password', { password: PW }, tk); tk = (await ok('POST', '/auth/login', { email: 'a@prueba.test', password: PW })).token;
    const date = (await ok('GET', '/agency/flights?route=MIA-AXM&n=1', null, tk))[0].date, body = { legs: [{ route: 'MIA-AXM', date, fare: 'classic' }], pax: [{ first: 'Rosa', last: 'Marín' }], contact: { email: 'rosa@correo.test', phone: '' } };
    pnr = (await ok('POST', '/agency/bookings', { ...body, pay: 'cash' }, tk, from('181.51.115.132', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/157.0.0.0 Safari/537.36'))).pnr;
    const w1 = await ok('POST', '/bookings', { ...body, pax: [{ first: 'Juan', last: 'Prueba' }] }, null, from('164.153.54.182')), w2 = await ok('POST', '/bookings', { ...body, pax: [{ first: 'Otro', last: 'Nombre' }] }, null, from('164.153.54.182'));
    assert.ok(!('ip' in w1) && !JSON.stringify(w1).includes('164.153'), 'la IP no sale en la respuesta pública');
    const L = await ok('GET', '/admin/booking-ips', null, admin), a = L.find(x => x.pnr === pnr), b = L.find(x => x.pnr === w1.pnr), c = L.find(x => x.pnr === w2.pnr);
    assert.equal(a.ip, '181.51.115.132'); assert.equal(a.device, 'Windows · Chrome'); assert.equal(a.same, 1); assert.equal(a.agency, 'Agencia Origen'); assert.equal(a.city, 'Armenia'); assert.equal(a.name, 'Rosa Marín');
    assert.equal(b.ip, '164.153.54.182'); assert.equal(b.same, 2); assert.equal(c.same, 2); assert.equal(b.city, 'Seneca'); assert.equal(b.visits, 4); assert.equal(b.channel, 'web'); assert.equal(b.email, 'rosa@correo.test');
    const mine = await ok('GET', '/agency/bookings', null, tk); assert.ok(!JSON.stringify(mine).includes('181.51.115'), 'la agencia no ve direcciones IP');
  });
  await t('solo un administrador con acceso completo ve las IP', async () => {
    for (const p of ['/admin/visits', '/admin/booking-ips']) { assert.equal((await call('GET', p)).status, 401); assert.equal((await call('GET', p, null, tk)).status, 403) }
    await ok('POST', '/admin/admins', { email: 'lector@prueba.test', name: 'Lector', readonly: true, days: 5, password: PW }, admin);
    const ro = (await ok('POST', '/auth/login', { email: 'lector@prueba.test', password: PW })).token;
    assert.equal((await call('GET', '/admin/visits', null, ro)).status, 403); assert.equal((await call('GET', '/admin/booking-ips', null, ro)).status, 403);
    assert.equal((await call('GET', '/admin/log', null, ro)).status, 200);
  });
} finally { try { srv.kill() } catch (e) {} geo.close(); await sleep(200); if (!process.env.KEEP) fs.rmSync(dir, { recursive: true, force: true }); else console.log('carpeta:', dir) }
if (errOut.trim()) console.log('\nstderr del servidor:\n' + errOut.trim().split('\n').slice(0, 20).join('\n'));
console.log(`\n${passed} pruebas pasaron, ${failed} fallaron.`); process.exit(failed ? 1 : 0);
