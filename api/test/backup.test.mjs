// Pruebas de los respaldos: copia verificada, descarga, restauración real, copia al arrancar y subida externa cifrada.
// Uso: node --no-warnings api/test/backup.test.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import zlib from 'node:zlib';
import { spawn, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { openBackup } from '../tools/restore.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url)), SERVER = path.join(HERE, '..', 'server.mjs'), TOOL = path.join(HERE, '..', 'tools', 'restore.mjs');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'beemo-bk-')), PORT = 19000 + Math.floor(Math.random() * 500), S3PORT = PORT + 600, BASE = `http://127.0.0.1:${PORT}/api`, PW = 'clave-de-prueba-123', PASS = 'frase de prueba';
const sleep = ms => new Promise(r => setTimeout(r, ms));
let passed = 0, failed = 0, srv, errOut = '';
async function t(name, fn) { try { await fn(); passed++; console.log('  ✓ ' + name) } catch (e) { failed++; console.log('  ✗ ' + name + '\n      ' + String(e && e.message || e).split('\n').slice(0, 8).join('\n      ')) } }
async function call(method, p, body, token) { const r = await fetch(BASE + p, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: body ? JSON.stringify(body) : undefined }); let j = {}; try { j = await r.clone().json() } catch (e) {} return { status: r.status, j, r } }
const ok = async (...a) => { const r = await call(...a); assert.equal(r.status, 200, `${a[0]} ${a[1]} → ${r.status} ${JSON.stringify(r.j)}`); return r.j };
async function start(extra = {}) {
  srv = spawn(process.execPath, ['--no-warnings', SERVER], { env: { ...process.env, PORT: String(PORT), DB_PATH: path.join(dir, 'beemo.db'), ADMIN_SETUP_CODE: 'prueba-local', UCP_ENABLED: '0', ...extra }, stdio: ['ignore', 'pipe', 'pipe'] });
  srv.stderr.on('data', d => { errOut += d });
  for (let i = 0; i < 60; i++) { try { if ((await fetch(BASE + '/health')).ok) return } catch (e) {} await sleep(100) } throw new Error('el servidor no arrancó');
}
const stop = async () => { srv.kill(); await sleep(300) };
// almacenamiento externo simulado: guarda lo que le suben
const puts = []; const s3 = http.createServer((req, res) => { const ch = []; req.on('data', c => ch.push(c)); req.on('end', () => { puts.push({ method: req.method, url: req.url, headers: req.headers, body: Buffer.concat(ch) }); res.writeHead(200); res.end() }) }); s3.listen(S3PORT);
let admin, tk, pnr;
try {
  await start();
  await t('copia manual: verificada, comprimida y registrada', async () => {
    await ok('POST', '/admin/setup', { code: 'prueba-local', email: 'admin@prueba.test', password: PW });
    admin = (await ok('POST', '/auth/login', { email: 'admin@prueba.test', password: PW })).token;
    const { id } = await ok('POST', '/admin/agencies', { name: 'Agencia Respaldo', country: 'Colombia' }, admin), u = await ok('POST', `/admin/agencies/${id}/users`, { email: 'a@prueba.test', name: 'Agente' }, admin);
    tk = (await ok('POST', '/auth/login', { email: 'a@prueba.test', password: u.temp_password })).token; await ok('POST', '/me/password', { password: PW }, tk); tk = (await ok('POST', '/auth/login', { email: 'a@prueba.test', password: PW })).token;
    const date = (await ok('GET', '/agency/flights?route=MIA-AXM&n=1', null, tk))[0].date;
    pnr = (await ok('POST', '/agency/bookings', { legs: [{ route: 'MIA-AXM', date, fare: 'classic' }], pax: [{ first: 'Rosa', last: 'Marín' }], contact: { email: 'rosa@correo.test', phone: '' }, pay: 'cash' }, tk)).pnr;
    assert.equal((await ok('GET', '/admin/backups', null, admin)).backups.length, 0, 'base nueva: aún sin copias');
    const { name } = await ok('POST', '/admin/backups', {}, admin); assert.match(name, /^beemo-\d{8}-\d{6}\.db\.gz$/);
    const s = await ok('GET', '/admin/backups', null, admin); assert.equal(s.backups.length, 1); assert.equal(s.last.name, name); assert.equal(s.error, null); assert.equal(s.late, false); assert.equal(s.offsite.configured, false);
    assert.equal((await ok('GET', '/health')).backup.ok, true);
  });
  await t('solo un administrador con acceso completo descarga copias', async () => {
    const name = (await ok('GET', '/admin/backups', null, admin)).last.name;
    assert.equal((await call('GET', `/admin/backups/${name}`, null, tk)).status, 403); assert.equal((await call('GET', `/admin/backups/${name}`)).status, 401);
    assert.equal((await call('GET', '/admin/backups/..%2Fbeemo.db', null, admin)).status, 404); assert.equal((await call('POST', '/admin/backups', {}, tk)).status, 403);
    await ok('POST', '/admin/admins', { email: 'lector@prueba.test', name: 'Lector', readonly: true, days: 5, password: PW }, admin);
    const rt2 = (await ok('POST', '/auth/login', { email: 'lector@prueba.test', password: PW })).token;
    assert.equal((await ok('GET', '/admin/backups', null, rt2)).backups.length, 1); assert.equal((await call('GET', `/admin/backups/${name}`, null, rt2)).status, 403);
  });
  await t('restauración real: la copia descargada abre y trae la reserva', async () => {
    const name = (await ok('GET', '/admin/backups', null, admin)).last.name, r = await fetch(`${BASE}/admin/backups/${name}`, { headers: { Authorization: 'Bearer ' + admin } });
    assert.equal(r.status, 200); const file = path.join(dir, 'bajada.db.gz'); fs.writeFileSync(file, Buffer.from(await r.arrayBuffer()));
    const out = execFileSync(process.execPath, ['--no-warnings', TOOL, file, path.join(dir, 'restaurada.db')], { encoding: 'utf8' }); assert.match(out, /Integridad: ok/); assert.match(out, /Reservas: 1 /);
    const db = new DatabaseSync(path.join(dir, 'restaurada.db'), { readOnly: true }); assert.equal(db.prepare('SELECT pnr FROM bookings').get().pnr, pnr); assert.equal(db.prepare('SELECT COUNT(*) n FROM crm_pax').get().n, 1); db.close();
    // el servidor arranca sobre la base restaurada y la reserva sigue ahí
    await stop(); const bk0 = path.join(dir, 'backups'); for (const f of fs.readdirSync(bk0)) fs.renameSync(path.join(bk0, f), path.join(bk0, 'beemo-20261101-080000.db.gz'));   // la copia manual pasa a ser «vieja»
    for (const f of ['beemo.db', 'beemo.db-wal', 'beemo.db-shm']) fs.rmSync(path.join(dir, f), { force: true }); fs.copyFileSync(path.join(dir, 'restaurada.db'), path.join(dir, 'beemo.db'));
    await start({ BACKUP_S3_ENDPOINT: `http://127.0.0.1:${S3PORT}`, BACKUP_S3_BUCKET: 'copias', BACKUP_S3_KEY: 'AKIDEXAMPLE', BACKUP_S3_SECRET: 'secreto', BACKUP_S3_REGION: 'us-east-1', BACKUP_PASSPHRASE: PASS });
    admin = (await ok('POST', '/auth/login', { email: 'admin@prueba.test', password: PW })).token;
    assert.equal((await ok('GET', `/admin/bookings?q=${pnr}`, null, admin)).bookings.length, 1);
  });
  await t('al arrancar hace una copia y la sube cifrada al almacenamiento externo', async () => {
    for (let i = 0; i < 40 && !puts.length; i++) await sleep(100);
    const s = await ok('GET', '/admin/backups', null, admin); assert.equal(s.backups.length, 2, 'la manual y la del arranque'); assert.equal(s.offsite.configured, true); assert.equal(s.offsite.last?.ok, true, JSON.stringify(s.offsite));
    assert.equal(puts.length, 1); const p = puts[0]; assert.equal(p.method, 'PUT'); assert.equal(p.url, `/copias/beemo/${s.last.name}.enc`);
    assert.match(p.headers.authorization, /^AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE\/\d{8}\/us-east-1\/s3\/aws4_request, SignedHeaders=host;x-amz-content-sha256;x-amz-date, Signature=[0-9a-f]{64}$/);
    assert.equal(p.body.subarray(0, 4).toString(), 'BMO1'); assert.ok(!p.body.includes(Buffer.from('SQLite format')), 'va cifrada');
    assert.throws(() => openBackup(p.body, 'otra clave'), /No se pudo descifrar/);
    const raw = openBackup(p.body, PASS); assert.equal(raw.subarray(0, 15).toString(), 'SQLite format 3'); fs.writeFileSync(path.join(dir, 'externa.db'), raw);
    const db = new DatabaseSync(path.join(dir, 'externa.db'), { readOnly: true }); assert.equal(db.prepare('SELECT pnr FROM bookings').get().pnr, pnr); db.close();
    fs.writeFileSync(path.join(dir, 'firma.json'), JSON.stringify({ url: `http://127.0.0.1:${S3PORT}${p.url}`, headers: p.headers }));
  });
  await t('rotación: no se acumulan sin límite y se conserva una por día', async () => {
    await stop(); const bk = path.join(dir, 'backups'), gz = zlib.gzipSync(Buffer.from('x'));
    for (let d = 1; d <= 45; d++) for (const h of ['00', '06', '12', '18']) { const day = new Date(Date.UTC(2026, 8, d)).toISOString().slice(0, 10).replace(/-/g, ''); fs.writeFileSync(path.join(bk, `beemo-${day}-${h}0000.db.gz`), gz) }
    await sleep(700); await start(); admin = (await ok('POST', '/auth/login', { email: 'admin@prueba.test', password: PW })).token;
    const s = await ok('GET', '/admin/backups', null, admin), days = new Set(s.backups.map(b => b.at.slice(0, 10)));
    assert.ok(s.backups.length <= s.keep.recent + s.keep.days, `quedaron ${s.backups.length}`); assert.equal(days.size, s.keep.days); assert.ok(s.backups[0].at > '2026-11', 'la más nueva es la real');
  });
} finally { try { srv.kill() } catch (e) {} s3.close(); await sleep(200); if (!process.env.KEEP) fs.rmSync(dir, { recursive: true, force: true }); else console.log('carpeta:', dir) }
if (errOut.trim()) console.log('\nstderr del servidor:\n' + errOut.trim().split('\n').slice(0, 20).join('\n'));
console.log(`\n${passed} pruebas pasaron, ${failed} fallaron.`); process.exit(failed ? 1 : 0);
