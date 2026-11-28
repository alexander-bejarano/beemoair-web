// Beemo Air · booking API and agency portal
// One inventory for beemoair.com and agencias.beemoair.com: every seat on every flight can be sold once.
// Node 22.13+/24 (node:sqlite), no npm dependencies.
import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import zlib from 'node:zlib';
import tls from 'node:tls';
import net from 'node:net';
import https from 'node:https';
import dns from 'node:dns';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PORT = +(process.env.PORT || 8080);
const DB_PATH = process.env.DB_PATH || '/data/beemo.db';
const PUBLIC_URL = (process.env.PUBLIC_URL || 'https://beemoair.com').replace(/\/$/, '');
const AGENCY_URL = (process.env.AGENCY_URL || 'https://agencias.beemoair.com').replace(/\/$/, '');
const STRIPE_KEY = process.env.STRIPE_SECRET_KEY || '';
const STRIPE_WH = process.env.STRIPE_WEBHOOK_SECRET || '';
const STRIPE_API = (process.env.STRIPE_API_BASE || 'https://api.stripe.com').replace(/\/$/, ''); // solo cambia en pruebas locales
const SETUP_CODE = process.env.ADMIN_SETUP_CODE || '';
const DEV_STATIC = process.env.DEV_STATIC || ''; // local testing: serve the public site for non-API paths
const PORTAL_DIR = path.join(HERE, 'public');

/* ============ commercial rules (mirror beemoair.com) ============ */
const SALES_FROM = '2026-12-14', SALES_TO = '2027-06-15';
const SCHED = {
  'MIA-AXM': { no: 'BM 701', days: [1, 5], dep: '09:40', arr: '13:15' },
  'AXM-MIA': { no: 'BM 702', days: [1, 5], dep: '14:45', arr: '18:20' },
  'MIA-BAQ': { no: 'BM 731', dates: ['2027-02-06'], dep: '08:30', arr: '11:05' },
  'BAQ-MIA': { no: 'BM 732', dates: ['2027-02-10'], dep: '12:30', arr: '15:05' },
};
// Seis familias de tarifa (23 nov 2026). Precio ida y vuelta sin tasas; cada trayecto vale la mitad más las tasas.
const FAMILIES = { light: { name: 'Light', rt: 699 }, basic: { name: 'Basic', rt: 799 }, classic: { name: 'Classic', rt: 850 }, plus: { name: 'Plus', rt: 980 }, flex: { name: 'Flex', rt: 1050 }, bc: { name: 'Flex BC', rt: 1550 } };
const famP = () => Object.fromEntries(Object.entries(FAMILIES).map(([k, v]) => [k, Math.round((v.rt / 2 + (198 + 241) / 2) * 100) / 100]));
const SEASONS = [
  { from: '2026-12-01', to: '2027-01-31', name: 'Temporada alta', p: famP() },
  { from: '2027-02-01', to: '2027-06-15', name: 'Temporada regular', p: famP() },
];
// Seis familias de tarifa (23 nov 2026). Precio ida y vuelta sin tasas; cada trayecto vale la mitad más las tasas.
const FARE_NAME = Object.fromEntries(Object.entries(FAMILIES).map(([k, v]) => [k, v.name]));
const SEAT_INC = new Set(['plus', 'flex', 'bc']);     // selección de asiento incluida
const NO_BAG = new Set(['light', 'basic']);           // sin maleta de bodega incluida
const TAX_LEG = (198 + 241) / 2;
const ROWS = 26, BIZ = 3, COLS = ['A', 'B', 'C', 'D', 'E', 'F'], EXIT = [13, 14];
const isSeat = (r, c) => r >= 1 && r <= ROWS && COLS.includes(c) && !(r <= BIZ && (c === 'B' || c === 'E'));
const zoneOf = r => r <= BIZ ? 0 : r <= 6 ? 1 : EXIT.includes(r) ? 2 : r <= 12 ? 3 : r <= 22 ? 4 : 5;
const ZONE_P = { 1: 25, 2: 30, 3: 15, 4: 12, 5: 0 };
const EXTRA_P = { hand: 18, bag: 55, bag2: 55, prio: 8 };
const INF_P = 40;
const PASS_KIND = { 4: { n: 4, price: 1399 }, 6: { n: 6, price: 1999 } };
const PASS_ROUTES = ['MIA-AXM', 'AXM-MIA'];
// post-booking ladder: [hasta 7 días antes, hasta 24 h antes, aeropuerto]
// extras después de reservar: [hasta 7 días antes, hasta 24 h antes, aeropuerto]. Pasar a Flex o a Business cuesta la diferencia de tarifa.
const LADDER = { hand: [25, 30, 35], bag: [55, 65, 75], bag2: [65, 75, 90], front: [25, 30, 40], prio: [10, 12, 15], flex: [0, 0, null], biz: [0, 0, 0] };
const HOLD_WEB_H = 24, HOLD_CARD_MIN = 45;

const seasonOf = d => SEASONS.find(s => d >= s.from && d <= s.to) || SEASONS[SEASONS.length - 1];
const priceOf = (d, f) => seasonOf(d).p[f];
const r2 = n => Math.round(n * 100) / 100;
const iso = d => d.toISOString().slice(0, 10);
const todayISO = () => new Date(Date.now() - 5 * 3600e3).toISOString().slice(0, 10); // Miami time, close enough
// La programación sale de SCHED; la tabla flight_ops la ajusta vuelo por vuelo: cancelado, vuelo adicional o cambio de hora.
let FO = null;
const flightOps = () => FO || (FO = new Map(db.prepare('SELECT * FROM flight_ops').all().map(r => [r.flight, r])));
const flightOp = (route, date) => flightOps().get(route + '|' + date) || null;
const okDay = date => /^\d{4}-\d{2}-\d{2}$/.test(date);
function inPattern(route, date) { const s = SCHED[route]; if (s.dates) return s.dates.includes(date); return date >= SALES_FROM && date <= SALES_TO && s.days.includes(new Date(date + 'T12:00:00Z').getUTCDay()) }
// a la venta: en la programación (o adicional), sin cancelar y sin haber pasado
function operates(route, date) {
  if (!SCHED[route] || !okDay(date) || date < todayISO()) return false;
  const o = flightOp(route, date); if (o && o.status === 'cancelled') return false;
  return inPattern(route, date) || !!(o && o.status === 'extra');
}
// calendario completo, incluidos los vuelos ya volados y los cancelados (para reportes y para atender a sus pasajeros)
function scheduled(route, date) { return !!SCHED[route] && okDay(date) && (inPattern(route, date) || !!flightOp(route, date)) }
// vuelos que se operan (sin los cancelados), en orden
function allDates(route) { const s = SCHED[route]; if (!s) return []; const set = new Set(s.dates || []);
  if (!s.dates) { const d = new Date(SALES_FROM + 'T12:00:00Z'); for (let i = 0; i < 800; i++) { const x = iso(d); if (x > SALES_TO) break; if (inPattern(route, x)) set.add(x); d.setUTCDate(d.getUTCDate() + 1) } }
  for (const [f, o] of flightOps()) { const [r, x] = f.split('|'); if (r !== route) continue; if (o.status === 'extra') set.add(x); if (o.status === 'cancelled') set.delete(x) }
  return [...set].sort() }
function opDates(route, from, n) { return allDates(route).filter(d => d >= from && operates(route, d)).slice(0, n) }
const flightTimes = (route, date) => { const o = flightOp(route, date), s = SCHED[route]; return { dep: (o && o.dep) || s.dep, arr: (o && o.arr) || s.arr } };
const depTime = (route, date) => new Date(`${date}T${flightTimes(route, date).dep}:00-05:00`).getTime();
// Tabla oficial: Plus y Flex incluyen la selección de asiento estándar; los asientos con más espacio
// (zona preferente y salidas de emergencia) tienen cargo extra en toda la cabina económica.
function seatPrice(fare, id) {
  const z = zoneOf(parseInt(id)); if (!z || (SEAT_INC.has(fare) && z > 2)) return 0;
  return ZONE_P[z];
}
const cabinOk = (fare, r) => fare === 'bc' ? r <= BIZ : r > BIZ;
const ALL_SEATS = []; for (let r = 1; r <= ROWS; r++) for (const c of COLS) if (isSeat(r, c)) ALL_SEATS.push(r + c);

/* ============ database ============ */
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
const db = new DatabaseSync(DB_PATH);

/* ============ respaldos: copia verificada de la base de datos, en el servidor y fuera de él ============ */
// Cada copia es una foto consistente (VACUUM INTO) que se abre y se revisa antes de guardarla comprimida en /data/backups.
// Se hace una al arrancar (antes de aplicar cambios de esquema del código nuevo) y luego cada BACKUP_EVERY_HOURS.
// Con BACKUP_S3_* también sube cada copia a un almacenamiento externo, cifrada si existe BACKUP_PASSPHRASE.
const BK_DIR = path.join(path.dirname(DB_PATH), 'backups'); try { fs.mkdirSync(BK_DIR, { recursive: true }) } catch (e) {}
const BK_EVERY_H = Math.min(24, Math.max(1, +(process.env.BACKUP_EVERY_HOURS || 6) || 6)), BK_RECENT = 28, BK_DAYS = 30;
const BK_S3 = { endpoint: (process.env.BACKUP_S3_ENDPOINT || '').replace(/\/$/, ''), bucket: process.env.BACKUP_S3_BUCKET || '', region: process.env.BACKUP_S3_REGION || 'auto', key: process.env.BACKUP_S3_KEY || '', secret: process.env.BACKUP_S3_SECRET || '', prefix: (process.env.BACKUP_S3_PREFIX || 'beemo').replace(/^\/|\/$/g, '') };
const BK_S3_ON = !!(BK_S3.endpoint && BK_S3.bucket && BK_S3.key && BK_S3.secret), BK_PASS = process.env.BACKUP_PASSPHRASE || '';
const BK = { error: null, offsite: null, busy: false };
const BK_RE = /^beemo-(\d{8})-(\d{6})\.db\.gz$/;
function backupList() {
  let names = []; try { names = fs.readdirSync(BK_DIR) } catch (e) {}
  return names.filter(n => BK_RE.test(n)).sort().reverse().map(n => { const m = BK_RE.exec(n), st = fs.statSync(path.join(BK_DIR, n));
    return { name: n, size: st.size, at: `${m[1].slice(0, 4)}-${m[1].slice(4, 6)}-${m[1].slice(6)}T${m[2].slice(0, 2)}:${m[2].slice(2, 4)}:${m[2].slice(4)}Z` } });
}
const backupAgeH = () => { const l = backupList()[0]; return l ? (Date.now() - Date.parse(l.at)) / 36e5 : Infinity };
// cifrado para la copia externa: BMO1 + sal(16) + iv(12) + datos + sello(16); clave por scrypt
function backupSeal(buf) { const salt = crypto.randomBytes(16), iv = crypto.randomBytes(12), c = crypto.createCipheriv('aes-256-gcm', crypto.scryptSync(BK_PASS, salt, 32), iv);
  return Buffer.concat([Buffer.from('BMO1'), salt, iv, c.update(buf), c.final(), c.getAuthTag()]) }
function s3Put(key, body) {   // subida firmada (AWS SigV4, estilo ruta): sirve para S3, Cloudflare R2, Backblaze B2 y compatibles
  const u = new URL(`${BK_S3.endpoint}/${BK_S3.bucket}/${key.split('/').map(encodeURIComponent).join('/')}`), t = new Date().toISOString().replace(/[-:]|\.\d{3}/g, ''), day = t.slice(0, 8);
  const hash = d => crypto.createHash('sha256').update(d).digest('hex'), hm = (k, d) => crypto.createHmac('sha256', k).update(d).digest();
  const ph = hash(body), headers = { host: u.host, 'x-amz-content-sha256': ph, 'x-amz-date': t }, signed = Object.keys(headers).sort().join(';');
  const canon = ['PUT', u.pathname, '', ...Object.keys(headers).sort().map(k => `${k}:${headers[k]}`), '', signed, ph].join('\n'), scope = `${day}/${BK_S3.region}/s3/aws4_request`;
  const sig = hm(hm(hm(hm(hm('AWS4' + BK_S3.secret, day), BK_S3.region), 's3'), 'aws4_request'), ['AWS4-HMAC-SHA256', t, scope, hash(canon)].join('\n')).toString('hex');
  return { url: u.href, headers: { ...headers, Authorization: `AWS4-HMAC-SHA256 Credential=${BK_S3.key}/${scope}, SignedHeaders=${signed}, Signature=${sig}` } };
}
async function backupOffsite(name) {
  if (!BK_S3_ON) return;
  try { let body = fs.readFileSync(path.join(BK_DIR, name)), key = `${BK_S3.prefix}/${name}`; if (BK_PASS) { body = backupSeal(body); key += '.enc' }
    const r = s3Put(key, body), { host, ...h } = r.headers, res = await fetch(r.url, { method: 'PUT', headers: h, body, signal: AbortSignal.timeout(120e3) });
    if (!res.ok) throw new Error(`el almacenamiento respondió ${res.status}`);
    BK.offsite = { at: new Date().toISOString(), ok: true, file: key, encrypted: !!BK_PASS };
  } catch (e) { BK.offsite = { at: new Date().toISOString(), ok: false, error: String(e && e.message || e).slice(0, 200) }; console.error('backup offsite', e && e.message || e) }
}
function backupRotate() {   // se conservan las BK_RECENT más nuevas y, de ahí hacia atrás, la última de cada día durante BK_DAYS días
  const L = backupList(), keep = new Set(L.slice(0, BK_RECENT).map(x => x.name)), days = new Set();
  for (const x of L) { const d = x.at.slice(0, 10); if (!days.has(d) && days.size < BK_DAYS) { days.add(d); keep.add(x.name) } }
  for (const x of L) if (!keep.has(x.name)) { try { fs.unlinkSync(path.join(BK_DIR, x.name)) } catch (e) {} }
}
function backupNow(why) {
  if (BK.busy) return null; BK.busy = true;
  const ts = new Date().toISOString().replace(/[-:]|\.\d{3}Z/g, '').replace('T', '-'), name = `beemo-${ts}.db.gz`, tmp = path.join(BK_DIR, `tmp-${ts}.db`);
  try {
    try { fs.unlinkSync(tmp) } catch (e) {}
    db.exec(`VACUUM INTO '${tmp.replace(/'/g, "''")}'`);
    // la copia se abre y se revisa antes de darla por buena
    const c = new DatabaseSync(tmp, { readOnly: true }); let okInt, n, live;
    try { okInt = c.prepare('PRAGMA integrity_check').get().integrity_check === 'ok'; n = c.prepare('SELECT COUNT(*) n FROM bookings').get().n; live = db.prepare('SELECT COUNT(*) n FROM bookings').get().n } finally { c.close() }
    if (!okInt) throw new Error('la copia no pasó la revisión de integridad'); if (n < live) throw new Error(`la copia tiene ${n} reservas y la base ${live}`);
    fs.writeFileSync(path.join(BK_DIR, name), zlib.gzipSync(fs.readFileSync(tmp))); fs.unlinkSync(tmp);
    BK.error = null; backupRotate(); console.log(`backup ${name} (${why}) · ${n} reservas`);
    backupOffsite(name);
    return name;
  } catch (e) { BK.error = { at: new Date().toISOString(), message: String(e && e.message || e).slice(0, 200) }; console.error('backup', e); try { fs.unlinkSync(tmp) } catch (x) {} return null }
  finally { BK.busy = false }
}
// al arrancar: una copia de la base tal como estaba, antes de que el código nuevo toque el esquema
try { if (db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='bookings'").get() && backupAgeH() > 1 / 6) backupNow('arranque') } catch (e) { console.error('backup arranque', e) }
try { backupRotate() } catch (e) {}
db.exec(`CREATE TABLE IF NOT EXISTS flight_ops(flight TEXT PRIMARY KEY, status TEXT, dep TEXT, arr TEXT, note TEXT, updated TEXT NOT NULL, by TEXT)`);
setInterval(() => { if (backupAgeH() >= BK_EVERY_H) backupNow('automática') }, 10 * 60e3).unref();
db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
CREATE TABLE IF NOT EXISTS agencies(id INTEGER PRIMARY KEY, name TEXT NOT NULL, commission REAL NOT NULL DEFAULT 3, incentive REAL NOT NULL DEFAULT 0, active INTEGER NOT NULL DEFAULT 1, created TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY, agency_id INTEGER REFERENCES agencies(id), email TEXT NOT NULL UNIQUE, name TEXT, role TEXT NOT NULL, pass TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1, must_change INTEGER NOT NULL DEFAULT 0, created TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id), expires INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS bookings(id INTEGER PRIMARY KEY, pnr TEXT NOT NULL UNIQUE, channel TEXT NOT NULL, agency_id INTEGER, user_id INTEGER, status TEXT NOT NULL, pay_method TEXT, total REAL NOT NULL, paid REAL NOT NULL DEFAULT 0,
  fare_net REAL NOT NULL DEFAULT 0, commission REAL NOT NULL DEFAULT 0, settled INTEGER NOT NULL DEFAULT 0, pass_code TEXT, pass_n INTEGER NOT NULL DEFAULT 0, data TEXT NOT NULL, expires INTEGER, stripe_url TEXT, created TEXT NOT NULL, updated TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS seat_inv(flight TEXT NOT NULL, seat TEXT NOT NULL, booking_id INTEGER NOT NULL REFERENCES bookings(id), pax INTEGER NOT NULL, PRIMARY KEY(flight, seat));
CREATE TABLE IF NOT EXISTS addons(id INTEGER PRIMARY KEY, booking_id INTEGER NOT NULL REFERENCES bookings(id), leg INTEGER NOT NULL, key TEXT NOT NULL, qty INTEGER NOT NULL, unit REAL NOT NULL, status TEXT NOT NULL, created TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS passes(code TEXT PRIMARY KEY, kind INTEGER NOT NULL, total INTEGER NOT NULL, left_n INTEGER NOT NULL, price REAL NOT NULL, name TEXT, email TEXT, status TEXT NOT NULL, exp TEXT NOT NULL, stripe_url TEXT, created TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS log(id INTEGER PRIMARY KEY, at TEXT NOT NULL, who TEXT, what TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS ix_b_status ON bookings(status);
CREATE INDEX IF NOT EXISTS ix_b_agency ON bookings(agency_id);
CREATE INDEX IF NOT EXISTS ix_inv_b ON seat_inv(booking_id);`);
// cambios de fecha de reservas emitidas: cargo por cambio + diferencia de tarifa
db.exec(`CREATE TABLE IF NOT EXISTS changes(id INTEGER PRIMARY KEY, booking_id INTEGER NOT NULL REFERENCES bookings(id), leg INTEGER NOT NULL, from_date TEXT NOT NULL, to_date TEXT NOT NULL, pax INTEGER NOT NULL, fee REAL NOT NULL, diff REAL NOT NULL, amount REAL NOT NULL, pay TEXT NOT NULL, status TEXT NOT NULL, settled INTEGER NOT NULL DEFAULT 0, stripe_url TEXT, by TEXT, created TEXT NOT NULL)`);
try { db.exec('ALTER TABLE changes ADD COLUMN seat_diff REAL NOT NULL DEFAULT 0') } catch (e) {}
for (const c of ['kind TEXT', 'fare_from TEXT', 'fare_to TEXT']) { try { db.exec('ALTER TABLE changes ADD COLUMN ' + c) } catch (e) {} }
for (const [col, type] of [['country', "TEXT NOT NULL DEFAULT ''"], ['city', 'TEXT'], ['tax_id', 'TEXT'], ['address', 'TEXT'], ['contact', 'TEXT'], ['email', 'TEXT'], ['phone', 'TEXT'], ['goal', 'REAL NOT NULL DEFAULT 0']]) {
  try { db.exec(`ALTER TABLE agencies ADD COLUMN ${col} ${type}`) } catch (e) { /* already there */ }
}
db.exec(`CREATE TABLE IF NOT EXISTS pass_products(id INTEGER PRIMARY KEY, name TEXT NOT NULL, name_en TEXT, description TEXT, description_en TEXT, badge TEXT, badge_en TEXT,
  segments INTEGER, price REAL, routes TEXT NOT NULL DEFAULT '[]', valid_months INTEGER NOT NULL DEFAULT 12, status TEXT NOT NULL DEFAULT 'inactive', sort INTEGER NOT NULL DEFAULT 100, created TEXT NOT NULL, updated TEXT NOT NULL)`);
for (const [col, type] of [['product_id', 'INTEGER'], ['routes', 'TEXT'], ['product_name', 'TEXT']]) { try { db.exec(`ALTER TABLE passes ADD COLUMN ${col} ${type}`) } catch (e) {} }
db.exec(`CREATE TABLE IF NOT EXISTS ambassadors(id INTEGER PRIMARY KEY, name TEXT NOT NULL, code TEXT NOT NULL UNIQUE, email TEXT, phone TEXT, socials TEXT NOT NULL DEFAULT '{}', sponsor_id INTEGER, notes TEXT, active INTEGER NOT NULL DEFAULT 1, created TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS docs(id INTEGER PRIMARY KEY, name TEXT NOT NULL, kind TEXT NOT NULL, file TEXT NOT NULL, size INTEGER NOT NULL, uploaded TEXT NOT NULL, by TEXT, is_model INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS pax_docs(booking_id INTEGER NOT NULL, pax INTEGER NOT NULL, passport INTEGER NOT NULL DEFAULT 0, visa INTEGER NOT NULL DEFAULT 0, checkmig INTEGER NOT NULL DEFAULT 0, updated TEXT, by TEXT, PRIMARY KEY(booking_id, pax));
CREATE TABLE IF NOT EXISTS notices(id INTEGER PRIMARY KEY, flight TEXT, kind TEXT NOT NULL, message TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1, created TEXT NOT NULL, by TEXT);
CREATE TABLE IF NOT EXISTS tickets(id INTEGER PRIMARY KEY, agency_id INTEGER NOT NULL, topic TEXT NOT NULL, subject TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'open', unread_admin INTEGER NOT NULL DEFAULT 0, unread_agency INTEGER NOT NULL DEFAULT 0, created TEXT NOT NULL, updated TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS ticket_msgs(id INTEGER PRIMARY KEY, ticket_id INTEGER NOT NULL, side TEXT NOT NULL, author_email TEXT, author_name TEXT, body TEXT NOT NULL, created TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS outbox(id INTEGER PRIMARY KEY, to_addrs TEXT NOT NULL, subject TEXT NOT NULL, text TEXT NOT NULL, html TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', tries INTEGER NOT NULL DEFAULT 0, error TEXT, ref TEXT, created TEXT NOT NULL, sent TEXT);
CREATE TABLE IF NOT EXISTS impact_log(flight TEXT PRIMARY KEY, social INTEGER NOT NULL DEFAULT 0, aid_kg INTEGER NOT NULL DEFAULT 0, notes TEXT, updated TEXT NOT NULL);`);
try { db.exec('ALTER TABLE sessions ADD COLUMN as_agency INTEGER') } catch (e) {}
// administradores temporales y de solo lectura
try { db.exec('ALTER TABLE users ADD COLUMN readonly INTEGER NOT NULL DEFAULT 0') } catch (e) {}
try { db.exec('ALTER TABLE users ADD COLUMN expires TEXT') } catch (e) {}
try { db.exec('ALTER TABLE users ADD COLUMN last_login TEXT') } catch (e) {}
// portal del embajador
try { db.exec('ALTER TABLE users ADD COLUMN amb_id INTEGER') } catch (e) {}
// usuario corto (p. ej. «martha») además del correo
try { db.exec('ALTER TABLE users ADD COLUMN username TEXT') } catch (e) {}
try { db.exec('CREATE UNIQUE INDEX IF NOT EXISTS users_username ON users(username) WHERE username IS NOT NULL') } catch (e) {}
try { db.exec('ALTER TABLE sessions ADD COLUMN as_amb INTEGER') } catch (e) {}
try { db.exec("ALTER TABLE docs ADD COLUMN audience TEXT NOT NULL DEFAULT 'admin'") } catch (e) {}
for (const [col, type] of [['amb_id', 'INTEGER'], ['amb_src', 'TEXT']]) { try { db.exec(`ALTER TABLE bookings ADD COLUMN ${col} ${type}`) } catch (e) {} }
const q = (sql, ...a) => db.prepare(sql).all(...a);
const q1 = (sql, ...a) => db.prepare(sql).get(...a);
const run = (sql, ...a) => db.prepare(sql).run(...a);
const now = () => new Date().toISOString();
const chName = (names, b) => names[b.agency_id] || (b.channel === 'ucp' ? 'Agentes de IA (UCP)' : 'beemoair.com');
const log = (who, what) => run('INSERT INTO log(at,who,what) VALUES(?,?,?)', now(), who || null, what);
function tx(fn) { db.exec('BEGIN IMMEDIATE'); try { const r = fn(); db.exec('COMMIT'); return r } catch (e) { db.exec('ROLLBACK'); throw e } }

/* ============ seed: signed distributors (21 nov 2026), created once ============ */
const SEED = [
  { name: 'Travel y Travel Ltda.', country: 'Colombia', city: 'Armenia, Quindío', tax_id: 'NIT 801.000.684-3', address: 'Cra. 14 # 18 Norte 14-76, local 7, Armenia, Quindío', contact: 'Patricia Muñoz Buitrago (CEO)', email: 'ventas@travelytravel.com', phone: '' },
  { name: 'Carnaval Barranquilla Tours (provisional)', country: 'Colombia', city: 'Barranquilla, Atlántico', tax_id: 'NIT por confirmar', address: 'Dirección por confirmar', contact: 'Organizador del Carnaval (por confirmar)', email: '', phone: '' },
  { name: 'Cartagena Travel & Tours, Inc.', country: 'Estados Unidos', city: 'Miami, Florida', tax_id: '', address: '13370 SW 128th St, Miami, FL 33186', contact: 'Claudia Elena De La Espriella (CEO)', email: 'claudia@cartagenatraveltours.com', phone: '+1 305 383 0093' },
];
for (const a of SEED) {
  const ex = db.prepare('SELECT id, email FROM agencies WHERE name=?').get(a.name);
  if (ex) { // agency already there: make sure its main contact has a login
    if (a.email && !ex.email) db.prepare('UPDATE agencies SET email=? WHERE id=?').run(a.email, ex.id);
    if (a.email && !db.prepare('SELECT 1 FROM users WHERE email=?').get(a.email))
      db.prepare("INSERT INTO users(agency_id,email,name,role,pass,must_change,created) VALUES(?,?,?,'agent','-',1,?)").run(ex.id, a.email, a.contact.replace(/ \(.*\)$/, ''), new Date().toISOString());
    continue;
  }
  const r = db.prepare('INSERT INTO agencies(name,commission,incentive,active,created,country,city,tax_id,address,contact,email,phone) VALUES(?,3,0,1,?,?,?,?,?,?,?,?)')
    .run(a.name, new Date().toISOString(), a.country, a.city, a.tax_id, a.address, a.contact, a.email, a.phone);
  // the CEO's login exists but has no usable password until the admin issues a temporary one
  if (a.email && !db.prepare('SELECT 1 FROM users WHERE email=?').get(a.email))
    db.prepare("INSERT INTO users(agency_id,email,name,role,pass,must_change,created) VALUES(?,?,?,'agent','-',1,?)").run(Number(r.lastInsertRowid), a.email, a.contact.replace(/ \(.*\)$/, ''), new Date().toISOString());
}

if (!db.prepare('SELECT 1 FROM pass_products').get()) {
  const ts = new Date().toISOString(), MA = JSON.stringify(['MIA-AXM', 'AXM-MIA']);
  const ins = db.prepare('INSERT INTO pass_products(name,name_en,description,description_en,badge,badge_en,segments,price,routes,valid_months,status,sort,created,updated) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)');
  ins.run('4 trayectos', '4 segments', 'Dos viajes de ida y vuelta a casa.', 'Two round trips home.', '', '', 4, 1399, MA, 12, 'active', 10, ts, ts);
  ins.run('6 trayectos', '6 segments', 'Tres viajes de ida y vuelta a casa.', 'Three round trips home.', 'Más ahorro', 'Best value', 6, 1999, MA, 12, 'active', 20, ts, ts);
  ins.run('Pase Caribe', 'Caribbean pass', 'Barranquilla, Valledupar y Santa Marta.', 'Barranquilla, Valledupar and Santa Marta.', '', '', null, null, '[]', 12, 'soon', 50, ts, ts);
  ins.run('Pase Montaña', 'Mountain pass', 'Medellín y el Eje Cafetero.', 'Medellín and the Coffee Region.', '', '', null, null, '[]', 12, 'soon', 60, ts, ts);
  ins.run('Pase Pacífico', 'Pacific pass', 'Cali y Popayán.', 'Cali and Popayán.', '', '', null, null, '[]', 12, 'soon', 70, ts, ts);
}

/* ============ helpers ============ */
class HttpErr extends Error { constructor(status, msg, extra) { super(msg); this.status = status; this.extra = extra } }
const bad = (m, x) => { throw new HttpErr(400, m, x) };
const CH = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const rnd = n => Array.from(crypto.randomBytes(n), b => CH[b % 32]).join('');
const hashPw = pw => { const salt = crypto.randomBytes(16); const h = crypto.scryptSync(pw, salt, 32); return salt.toString('hex') + ':' + h.toString('hex') };
const checkPw = (pw, stored) => { const [s, h] = String(stored).split(':'); if (!s || !h) return false; const x = crypto.scryptSync(pw, Buffer.from(s, 'hex'), 32); return crypto.timingSafeEqual(x, Buffer.from(h, 'hex')) };
const sha = t => crypto.createHash('sha256').update(t).digest('hex');
const norm = t => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase();
const okEmail = v => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(v || '')) && !/\.invalid$/i.test(String(v));
const NOMAIL = '@sin-correo.invalid'; // marcador para usuarios que solo tienen nombre de usuario
const normUser = v => String(v || '').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
const clean = (v, n = 80) => String(v ?? '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, n);

// tiny rate limiter per ip+bucket
const RL = new Map();
function limit(ip, bucket, max, windowMs) {
  const k = ip + '|' + bucket, t = Date.now(); const a = (RL.get(k) || []).filter(x => t - x < windowMs);
  if (a.length >= max) throw new HttpErr(429, 'Demasiadas solicitudes. Intenta de nuevo en unos minutos.');
  a.push(t); RL.set(k, a);
}
setInterval(() => { const t = Date.now(); for (const [k, a] of RL) if (!a.some(x => t - x < 3600e3)) RL.delete(k) }, 600e3).unref();

/* ============ pricing / booking core ============ */
function takenSeats(flight) { return q('SELECT seat FROM seat_inv WHERE flight=?', flight).map(r => r.seat) }
function availability(route, date) {
  const f = route + '|' + date, taken = new Set(takenSeats(f));
  let eco = 0, biz = 0; for (const s of ALL_SEATS) if (!taken.has(s)) { if (parseInt(s) <= BIZ) biz++; else eco++ }
  return { eco, biz };
}
function pickSeat(fare, takenSet) {
  const order = fare === 'bc' ? [0] : SEAT_INC.has(fare) ? [4, 3, 5, 1, 2] : [5, 4, 3, 1, 2];
  for (const z of order) for (const s of ALL_SEATS) { const r = parseInt(s); if (zoneOf(r) === z && cabinOk(fare, r) && !takenSet.has(s)) return s }
  return null;
}
function passUsable(code) {
  const p = q1('SELECT * FROM passes WHERE code=?', String(code || '').trim().toUpperCase());
  if (!p) return { err: 'No encontramos ese código de pase. Revísalo e intenta de nuevo.' };
  if (p.status !== 'paid') return { err: 'Este pase todavía no está pagado.' };
  if (p.exp < todayISO()) return { err: 'Este pase ya venció.' };
  if (p.left_n <= 0) return { err: 'Este pase ya no tiene trayectos disponibles.' };
  return { pass: p };
}
// Validate the request and compute the authoritative price. Does not write.
function quote(body, channel, opts = {}) {
  const legsIn = Array.isArray(body.legs) ? body.legs.slice(0, 2) : [];
  const paxIn = Array.isArray(body.pax) ? body.pax.slice(0, 9) : [];
  if (!legsIn.length) bad('Elige al menos un vuelo.');
  if (!paxIn.length) bad('Agrega al menos un pasajero.');
  const pax = paxIn.map((p, i) => {
    const first = clean(p.first, 40), last = clean(p.last, 40);
    if (!first || !last) bad(`Falta el nombre o el apellido del pasajero ${i + 1}.`);
    const club = clubNumber(p.club); if (club === 'X') bad(`El número BEE CLUB del pasajero ${i + 1} no es válido: son las letras BEE y 6 dígitos.`);
    if (club && !q1('SELECT 1 FROM club_members WHERE number=? AND active=1', club)) bad(`El número BEE CLUB del pasajero ${i + 1} no existe. Revísalo o déjalo en blanco.`);
    return { first, last, inf: !!p.inf, ...(club && !p.inf ? { club } : {}) };
  });
  const contact = { email: clean(body.contact?.email, 120), phone: clean(body.contact?.phone, 40) };
  if (!okEmail(contact.email)) bad('Revisa el correo electrónico de contacto.');
  const legs = legsIn.map((l, li) => {
    const route = String(l.route || ''), date = String(l.date || ''), fare = String(l.fare || '');
    if (!SCHED[route]) bad('Ruta no válida.');
    if (!operates(route, date)) bad(`No hay vuelo ${route} el ${date}.`);
    { const h = getOps().close_hours, left = (depTime(route, date) - Date.now()) / 36e5; if (left <= h) bad(left <= 0 ? `El vuelo ${route} del ${date} ya salió.` : `Las ventas del vuelo ${route} del ${date} ya cerraron: se cierran ${h} ${h === 1 ? 'hora' : 'horas'} antes de la salida.`, { code: 'sales_closed' }) }
    if (!FARE_NAME[fare]) bad('Tarifa no válida.');
    if (li === 1 && date <= legsIn[0].date) bad('El regreso debe ser después de la ida.');
    const seats = pax.map((_, i) => { const s = l.seats?.[i]; if (s == null || s === '') return null; const id = String(s).toUpperCase(); if (opts.skip && isSB(id)) return id; const r = parseInt(id), c = id.slice(-1);
      if (!isSeat(r, c) || String(r) + c !== id) bad(`Asiento ${id} no válido.`); if (!cabinOk(fare, r)) bad(`El asiento ${id} no corresponde a la tarifa ${FARE_NAME[fare]}.`); return id });
    if (new Set(seats.filter(Boolean)).size !== seats.filter(Boolean).length) bad('Dos pasajeros no pueden tener el mismo asiento.');
    { const left = fareLeft(route, date, opts.skip), n = pax.length; if (left[fare] < n) { const next = fare === 'bc' ? null : ECO_FARES.slice(ECO_FARES.indexOf(fare) + 1).find(k => left[k] >= n);
      bad(`${left[fare] ? `En la tarifa ${FARE_NAME[fare]} solo ${left[fare] === 1 ? 'queda 1 cupo' : `quedan ${left[fare]} cupos`}` : `La tarifa ${FARE_NAME[fare]} ya se agotó`} en el vuelo ${route} del ${date}.${next ? ` La más económica disponible para ${n === 1 ? 'un pasajero' : n + ' pasajeros'} es ${FARE_NAME[next]}.` : ' No quedan sillas para este grupo en ese vuelo.'}`, { code: 'fare_sold_out', leg: li, fare, next: next || null, left: left[fare] }) } }
    const extras = pax.map((_, i) => { const e = l.extras?.[i] || {}; const x = {};
      for (const k of ['hand', 'bag', 'bag2', 'prio']) if (e[k]) x[k] = true;
      if (fare === 'bc') return {};
      if (fare !== 'light') delete x.hand;            // desde Basic el equipaje de mano va incluido
      if (!NO_BAG.has(fare)) delete x.bag;            // desde Classic la maleta de bodega va incluida
      if (NO_BAG.has(fare) && x.bag2 && !x.bag) delete x.bag2;
      return x });
    return { route, date, fare, seats, extras, no: SCHED[route].no, ...flightTimes(route, date) };
  });
  // pass
  let pass = null, passN = 0, passCredit = 0;
  if (body.pass) {
    const r = passUsable(body.pass); if (r.err) bad(r.err); pass = r.pass; let left = pass.left_n;
    const okRoutes = pass.routes ? JSON.parse(pass.routes) : PASS_ROUTES;
    for (const l of legs) { if (!okRoutes.includes(l.route)) continue; for (let i = 0; i < pax.length && left > 0; i++) { left--; passN++; passCredit += priceOf(l.date, 'classic') } }
    if (!passN) bad('Tu pase de temporada no sirve para esta ruta.');
  }
  // money
  let fares = 0, seatsP = 0, extrasP = 0, net = 0;
  for (const l of legs) {
    const p = priceOf(l.date, l.fare); fares += p * pax.length; net += (p - TAX_LEG) * pax.length;
    l.seats.forEach(s => { if (s) seatsP += seatPrice(l.fare, s) });
    l.extras.forEach(x => { for (const k in x) extrasP += EXTRA_P[k] });
  }
  const infP = pax.filter(p => p.inf).length * legs.length * INF_P;
  const total = r2(fares + seatsP + extrasP + infP - passCredit);
  return { pax, contact, legs, pass, passN, passCredit: r2(passCredit), breakdown: { fares: r2(fares), seats: r2(seatsP), extras: r2(extrasP), infants: r2(infP), taxes: r2(TAX_LEG * pax.length * legs.length), pass: r2(passCredit), total }, total, net: r2(net), channel };
}
function newPnr() { for (let i = 0; i < 20; i++) { const p = rnd(6); if (!q1('SELECT 1 FROM bookings WHERE pnr=?', p)) return p } throw new Error('pnr') }

function createBooking(body, ctx) {
  const Q = quote(body, ctx.channel);
  return tx(() => {
    // seats: claim the requested ones, then auto-assign the rest
    const claims = [];
    for (const [li, l] of Q.legs.entries()) {
      const flight = l.route + '|' + l.date, taken = new Set(takenSeats(flight));
      const conflict = l.seats.filter(s => s && taken.has(s));
      if (conflict.length) throw new HttpErr(409, `El asiento ${conflict.join(', ')} acaba de venderse. Elige otro.`, { code: 'seat_taken', leg: li, seats: conflict });
      l.seats.forEach(s => s && taken.add(s));
      l.seats = l.seats.map(s => { if (s) return s; const p = seatFor(l, taken); if (!p) throw new HttpErr(409, `No quedan sillas ${l.fare === 'bc' ? 'en Business' : 'en económica'} en el vuelo ${l.no} del ${l.date}.`, { code: 'sold_out', leg: li }); taken.add(p); return p });
      l.seats.forEach((s, i) => claims.push([flight, s, i]));
    }
    // recompute seat price after auto-assign (auto seats are free zones)
    const pnr = newPnr(), ts = now();
    let status, expires = null, payMethod = ctx.pay === 'hold' ? 'cash' : ctx.pay || 'card';
    if (Q.total <= 0) status = 'confirmed';
    else if (ctx.channel === 'agency' && ctx.pay === 'hold') { status = 'pending'; expires = Date.now() + HOLD_WEB_H * 3600e3 } // apartada: la agencia cobra después
    else if (ctx.channel === 'agency' && payMethod === 'cash') status = 'confirmed';
    else { status = 'pending'; expires = Date.now() + (ctx.holdMin ? ctx.holdMin * 60e3 : STRIPE_KEY ? HOLD_CARD_MIN * 60e3 : HOLD_WEB_H * 3600e3) }
    // a pending hold never outlives the flight's check-in close
    if (expires) { const first = Math.min(...Q.legs.map(l => depTime(l.route, l.date))); expires = Math.min(expires, first - 3 * 3600e3); if (expires <= Date.now()) throw new HttpErr(409, 'Este vuelo ya no admite reservas pendientes de pago.') }
    const ag = ctx.agency; const rate = ag ? (ag.commission + effIncentive(ag, Q.pax.length * Q.legs.length)) / 100 : 0;
    const commission = r2(Q.net * rate);
    const data = { pax: Q.pax, contact: Q.contact, legs: Q.legs.map(l => ({ route: l.route, date: l.date, fare: l.fare, no: l.no, dep: l.dep, arr: l.arr, seats: l.seats, extras: l.extras })), breakdown: Q.breakdown, rate: rate * 100 };
    const res = run(`INSERT INTO bookings(pnr,channel,agency_id,user_id,status,pay_method,total,paid,fare_net,commission,pass_code,pass_n,data,expires,created,updated) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      pnr, ctx.channel, ag?.id ?? null, ctx.user?.id ?? null, status, payMethod, Q.total, status === 'confirmed' && payMethod !== 'cash' ? Q.total : 0, Q.net, commission, Q.pass?.code ?? null, Q.passN, JSON.stringify(data), expires, ts, ts);
    const bid = Number(res.lastInsertRowid);
    if (ctx.amb) run('UPDATE bookings SET amb_id=?, amb_src=? WHERE id=?', ctx.amb.id, ctx.amb.src, bid);
    const ins = db.prepare('INSERT INTO seat_inv(flight,seat,booking_id,pax) VALUES(?,?,?,?)');
    for (const [f, s, i] of claims) { try { ins.run(f, s, bid, i) } catch (e) { throw new HttpErr(409, `El asiento ${s} acaba de venderse. Elige otro.`, { code: 'seat_taken', seats: [s] }) } }
    if (Q.pass) run('UPDATE passes SET left_n=left_n-? WHERE code=?', Q.passN, Q.pass.code);
    crmLinkBooking(bid);
    log(ctx.user?.email || ctx.channel, `booking ${pnr} ${status} ${Q.total}`);
    return bid;
  });
}
function releaseBooking(b, newStatus, who) {
  tx(() => {
    run('DELETE FROM seat_inv WHERE booking_id=?', b.id);
    if (b.pass_code && b.pass_n) run('UPDATE passes SET left_n=left_n+? WHERE code=?', b.pass_n, b.pass_code);
    run('UPDATE bookings SET status=?, updated=?, expires=NULL WHERE id=?', newStatus, now(), b.id);
    run("UPDATE addons SET status='cancelled' WHERE booking_id=? AND status='pending'", b.id);
  });
  log(who, `booking ${b.pnr} -> ${newStatus}`);
  try { promoteStandby() } catch (e) { console.error('standby', e.message) }
  try { ucpBookingReleased(b, newStatus) } catch (e) { console.error('ucp released', e.message) }
}
// una reserva emitida «en agencia» que en realidad no se ha cobrado vuelve a quedar apartada 24 h (o hasta 3 h antes del vuelo)
function toHold(b, who) {
  if (b.status !== 'confirmed' || b.pay_method !== 'cash' || b.settled) bad('Solo aplica a reservas emitidas con cobro en agencia que aún no se han consignado.');
  const d = JSON.parse(b.data), first = Math.min(...d.legs.map(l => depTime(l.route, l.date))), exp = Math.min(Date.now() + HOLD_WEB_H * 3600e3, first - 3 * 3600e3);
  if (exp <= Date.now()) bad('Este vuelo ya no admite reservas apartadas.');
  run("UPDATE bookings SET status='pending', paid=0, expires=?, updated=? WHERE id=?", exp, now(), b.id);
  log(who, `booking ${b.pnr} -> pending (apartada sin pago)`);
}
function confirmPaid(b, who) {
  tx(() => {
    run("UPDATE bookings SET status='confirmed', paid=total, expires=NULL, updated=? WHERE id=?", now(), b.id);
    run("UPDATE addons SET status='paid' WHERE booking_id=? AND status='pending'", b.id);
  });
  log(who, `booking ${b.pnr} paid`);
  try { ucpBookingPaid(b) } catch (e) { console.error('ucp paid', e.message) }
}
// expire unpaid holds
function sweep() {
  for (const b of q("SELECT * FROM bookings WHERE status='pending' AND expires IS NOT NULL AND expires<?", Date.now())) releaseBooking(b, 'expired', 'system');
  for (const p of q("SELECT * FROM passes WHERE status='pending' AND created<?", new Date(Date.now() - 7 * 86400e3).toISOString())) run("UPDATE passes SET status='expired' WHERE code=?", p.code);
  try { promoteStandby() } catch (e) { console.error('standby', e.message) }
}
setInterval(sweep, 60e3).unref();
// ajuste único pedido por Beemo Air (23 nov 2026): la reserva de Cartagena Travel no se ha cobrado, queda apartada sin pago
try { if (!q1("SELECT 1 FROM settings WHERE key='fix_cartagena_hold'")) {
  const ag = q1("SELECT id FROM agencies WHERE name LIKE 'Cartagena Travel%'"), rows = ag ? q("SELECT * FROM bookings WHERE agency_id=? AND status IN ('confirmed','pending')", ag.id) : [];
  if (rows.length === 1 && rows[0].status === 'confirmed' && rows[0].pay_method === 'cash' && !rows[0].settled) toHold(rows[0], 'ajuste Beemo Air');
  console.log('fix_cartagena_hold', rows.length, rows[0]?.pnr, rows[0]?.status, rows[0]?.pay_method);
  run("INSERT INTO settings(key,value) VALUES('fix_cartagena_hold',?)", JSON.stringify({ at: now(), pnr: rows.length === 1 ? rows[0].pnr : null, n: rows.length, status: rows[0]?.status || null }));
} } catch (e) { console.error('fix_cartagena_hold', e.message) }
setInterval(() => flushOutbox().catch(e => console.error('outbox', e.message)), 30e3).unref();

function bookingView(b, opts = {}) {
  const d = JSON.parse(b.data);
  const adds = q('SELECT id,leg,key,qty,unit,status FROM addons WHERE booking_id=? ORDER BY id', b.id);
  const addDue = adds.filter(a => a.status === 'pending').reduce((s, a) => s + a.qty * a.unit, 0);
  const v = { pnr: b.pnr, status: b.status, channel: b.channel, pay_method: b.pay_method, total: b.total, paid: b.paid, due: r2((b.status === 'pending' ? b.total : 0) + addDue),
    expires: b.expires ? new Date(b.expires).toISOString() : null, pay_url: b.status === 'pending' ? b.stripe_url : null, created: b.created,
    pax: d.pax, legs: d.legs.map(l => flightOp(l.route, l.date)?.status === 'cancelled' ? { ...l, cancelled: true } : l), breakdown: d.breakdown, pass_code: b.pass_code, pass_n: b.pass_n, addons: adds,
    changes: q('SELECT id,kind,fare_from,fare_to,leg,from_date,to_date,pax,fee,diff,seat_diff,amount,pay,status,settled,created FROM changes WHERE booking_id=? ORDER BY id', b.id).map(c => ({ ...c, pay_url: c.status === 'pending' ? q1('SELECT stripe_url FROM changes WHERE id=?', c.id).stripe_url : null })) };
  if (opts.private) Object.assign(v, { contact: d.contact, commission: b.commission, rate: d.rate, fare_net: b.fare_net, settled: !!b.settled, agency_id: b.agency_id });
  if (opts.private) { const cp = Object.fromEntries(q('SELECT * FROM crm_pax WHERE booking_id=?', b.id).map(r => [r.pax, r])); v.travel = d.pax.map((_, i) => travelOf(cp[i])); v.travel_ok = d.pax.map((p, i) => travelDone(cp[i], p.inf)); v.op_ref = b.op_ref || null; v.refunds = q('SELECT id, cause, status, amount, suggested, reason, created FROM refunds WHERE booking_id=? ORDER BY id', b.id); v.customers = d.pax.map((_, i) => cp[i]?.customer_id ?? null) }
  return v;
}
function ladderWindow(route, date) { const h = (depTime(route, date) - Date.now()) / 36e5; return h <= 0 ? -1 : h > 168 ? 0 : h > 24 ? 1 : 2 }

/* ============ Stripe (optional) ============ */
async function stripeCheckout({ ref, amount, name, email, successUrl, cancelUrl, minutes }) {
  if (!STRIPE_KEY) return null;
  const f = new URLSearchParams();
  f.set('mode', 'payment'); f.set('success_url', successUrl); f.set('cancel_url', cancelUrl);
  f.set('line_items[0][quantity]', '1'); f.set('line_items[0][price_data][currency]', 'usd');
  f.set('line_items[0][price_data][unit_amount]', String(Math.round(amount * 100)));
  f.set('line_items[0][price_data][product_data][name]', name);
  if (email) f.set('customer_email', email);
  f.set('metadata[ref]', ref); f.set('client_reference_id', ref);
  f.set('expires_at', String(Math.floor(Date.now() / 1000) + Math.max(31, minutes || HOLD_CARD_MIN) * 60));
  const r = await fetch(STRIPE_API + '/v1/checkout/sessions', { method: 'POST', headers: { Authorization: 'Bearer ' + STRIPE_KEY, 'Content-Type': 'application/x-www-form-urlencoded' }, body: f });
  const j = await r.json(); if (!r.ok) { console.error('stripe', j.error?.message); return null }
  return j.url;
}
function stripeVerify(raw, header) {
  if (!STRIPE_WH) return false;
  const parts = Object.fromEntries(String(header || '').split(',').map(x => x.split('=')));
  if (!parts.t || !parts.v1) return false;
  if (Math.abs(Date.now() / 1000 - +parts.t) > 600) return false;
  const exp = crypto.createHmac('sha256', STRIPE_WH).update(parts.t + '.' + raw).digest('hex');
  try { return crypto.timingSafeEqual(Buffer.from(exp), Buffer.from(parts.v1)) } catch { return false }
}
async function attachPayLink(bid, successBase) {
  const b = q1('SELECT * FROM bookings WHERE id=?', bid); if (b.status !== 'pending' || !STRIPE_KEY || b.pay_method === 'cash') return;
  const d = JSON.parse(b.data);
  const url = await stripeCheckout({ ref: 'B:' + b.pnr, amount: b.total, name: `Beemo Air · Reserva ${b.pnr}`, email: d.contact.email,
    successUrl: `${successBase}?pago=ok&pnr=${b.pnr}`, cancelUrl: `${successBase}?pago=cancelado&pnr=${b.pnr}`, minutes: Math.round((b.expires - Date.now()) / 60e3) });
  if (url) run('UPDATE bookings SET stripe_url=? WHERE id=?', url, bid);
}

/* ============ auth ============ */
function authUser(req) {
  const h = req.headers.authorization || ''; const t = h.startsWith('Bearer ') ? h.slice(7) : '';
  if (!t) return null;
  const s = q1('SELECT * FROM sessions WHERE token=?', sha(t)); if (!s || s.expires < Date.now()) return null;
  const u = q1('SELECT * FROM users WHERE id=? AND active=1', s.user_id); if (!u || expired(u)) return null;
  // un administrador viendo el portal como una agencia
  if (s.as_agency && u.role === 'admin') { const va = q1('SELECT * FROM agencies WHERE id=?', s.as_agency); if (!va) return null;
    return { user: { ...u, role: 'agent', must_change: 0, agency_id: va.id }, agency: va, viewer: u } }
  // un administrador viendo el portal como un embajador
  if (s.as_amb && u.role === 'admin') { const am = q1('SELECT * FROM ambassadors WHERE id=?', s.as_amb); if (!am) return null;
    return { user: { ...u, role: 'ambassador', must_change: 0, amb_id: am.id }, amb: am, viewer: u } }
  if (u.role === 'ambassador') { const am = q1('SELECT * FROM ambassadors WHERE id=?', u.amb_id); if (!am || !am.active) return null; return { user: u, amb: am } }
  const ag = u.agency_id ? q1('SELECT * FROM agencies WHERE id=?', u.agency_id) : null;
  if (u.role === 'agent' && (!ag || !ag.active)) return null;
  return { user: u, agency: ag };
}
const expired = u => !!u.expires && Date.parse(u.expires) < Date.now();
// rutas que un acceso de solo lectura sí puede usar aunque no sean GET
const RO_OK = /^\/api\/(auth\/logout|me\/password|admin\/agencies\/\d+\/view|admin\/ambassadors\/\d+\/view)$/;
function need(req, role) {
  const a = authUser(req); if (!a) throw new HttpErr(401, 'Inicia sesión.');
  const base = a.viewer || a.user;
  if (base.readonly && req.method !== 'GET' && !RO_OK.test(String(req.url).split('?')[0])) throw new HttpErr(403, 'Tu acceso es de solo lectura: puedes ver todo, pero no hacer cambios.');
  if (role === 'admin' && a.user.role !== 'admin') throw new HttpErr(403, 'Solo para administradores.');
  if (role === 'agent' && a.user.role !== 'agent') throw new HttpErr(403, 'Solo para agencias.');
  if (role === 'ambassador' && a.user.role !== 'ambassador') throw new HttpErr(403, 'Solo para embajadores.');
  return a;
}
const userView = (u, ag, viewer, am) => ({ ambassador: am ? { id: am.id, name: am.name, code: am.code } : null, id: u.id, email: u.email, name: u.name, role: u.role, must_change: !!u.must_change, readonly: !!(viewer || u).readonly, expires: (viewer || u).expires || null, viewer: viewer ? { email: viewer.email, name: viewer.name } : null, agency: ag ? { id: ag.id, name: ag.name, country: ag.country, commission: ag.commission, incentive: ag.incentive, active: !!ag.active } : null });
const tempPassword = () => rnd(4) + '-' + rnd(4) + '-' + rnd(4);

/* ============ routes ============ */
const routes = [];
const on = (m, p, fn) => routes.push({ m, re: new RegExp('^' + p.replace(/:(\w+)/g, '(?<$1>[^/]+)') + '$'), fn });

on('GET', '/api/health', () => { const l = backupList()[0]; return { ok: true, time: now(), stripe: !!STRIPE_KEY, backup: { last: l ? l.at : null, ok: !BK.error && backupAgeH() <= BK_EVERY_H * 2 } } });
on('GET', '/api/routes', () => Object.entries(SCHED).map(([k, v]) => ({ route: k, no: v.no, seasonal: !!v.dates })));
on('GET', '/api/config', () => ({ stripe: !!STRIPE_KEY, hold_hours: STRIPE_KEY ? HOLD_CARD_MIN / 60 : HOLD_WEB_H }));

on('GET', '/api/flights', ({ url }) => {
  const route = url.searchParams.get('route'), from = url.searchParams.get('from') || todayISO(), n = Math.min(+url.searchParams.get('n') || 8, 40);
  if (!SCHED[route]) bad('Ruta no válida.');
  return opDates(route, from, n).map(date => ({ date, route, ...SCHED[route], ...flightTimes(route, date), days: undefined, dates: undefined, season: seasonOf(date).name, prices: seasonOf(date).p, tax: TAX_LEG, avail: availability(route, date), left: fareLeft(route, date) }));
});
on('GET', '/api/seats', ({ url }) => {
  const route = url.searchParams.get('route'), date = url.searchParams.get('date');
  if (!SCHED[route]) bad('Ruta no válida.');
  return { taken: takenSeats(route + '|' + date), avail: availability(route, date) };
});
on('POST', '/api/quote', ({ body }) => { const Q = quote(body, 'web'); return Q.breakdown });

// public booking from beemoair.com
on('POST', '/api/bookings', async ({ body, ip, req }) => {
  limit(ip, 'book', 8, 3600e3);
  const c = consentRead(body);
  const bid = createBooking(body, { channel: 'web', amb: refOf(body.ref) }); stampOrigin(bid, ip, req);
  { const b0 = q1('SELECT pnr, data FROM bookings WHERE id=?', bid), d0 = JSON.parse(b0.data); consentLog(c, { form: 'reserva_web', subject: d0.contact?.email, name: paxNames(d0), ref: b0.pnr, ip, req }) }
  await attachPayLink(bid, PUBLIC_URL + '/');
  return bookingView(q1('SELECT * FROM bookings WHERE id=?', bid));
});
function findPublic(pnr, last) {
  const b = q1('SELECT * FROM bookings WHERE pnr=?', String(pnr || '').toUpperCase());
  if (!b || !last) throw new HttpErr(404, 'No encontramos una reserva con ese código y apellido. Revisa los datos e intenta de nuevo.');
  const d = JSON.parse(b.data), l = norm(last);
  if (!d.pax.some(p => norm(p.last) === l || norm(p.first + ' ' + p.last).endsWith(l))) throw new HttpErr(404, 'No encontramos una reserva con ese código y apellido. Revisa los datos e intenta de nuevo.');
  return b;
}
on('GET', '/api/bookings/:pnr', ({ params, url, ip }) => { limit(ip, 'lookup', 30, 600e3); return bookingView(findPublic(params.pnr, url.searchParams.get('last'))) });
on('POST', '/api/bookings/:pnr/addons', async ({ params, body, ip }) => {
  limit(ip, 'addon', 30, 3600e3);
  const b = findPublic(params.pnr, body.last);
  if (!['confirmed', 'pending'].includes(b.status)) bad('Esta reserva ya no admite cambios.');
  const d = JSON.parse(b.data), li = +body.leg, key = String(body.key || ''), l = d.legs[li];
  if (!l || !LADDER[key]) bad('Opción no válida.');
  const w = ladderWindow(l.route, l.date); if (w < 0) bad('Este vuelo ya salió.'); if (w === 2) bad('En las últimas 24 horas este extra se compra en el aeropuerto.');
  const R = FARE_RANK[l.fare] ?? 2;
  if ((key === 'hand' && l.fare !== 'light') || (key === 'bag' && !NO_BAG.has(l.fare)) || (key === 'flex' && R >= FARE_RANK.flex) || (key === 'biz' && R >= FARE_RANK.bc) || (l.fare === 'bc' && key !== 'biz')) bad('Tu tarifa ya incluye esta opción.');
  const unit = key === 'flex' || key === 'biz' ? r2(Math.max(0, priceOf(l.date, key === 'flex' ? 'flex' : 'bc') - priceOf(l.date, l.fare))) : LADDER[key][w]; if (unit == null) bad('Este extra ya no está disponible.');
  if (q1("SELECT 1 FROM addons WHERE booking_id=? AND leg=? AND key=? AND status!='cancelled'", b.id, li, key)) bad('Ya agregaste este extra.');
  if (key === 'biz') { const av = availability(l.route, l.date); if (av.biz < d.pax.length) bad('No quedan sillas libres en Business para este vuelo.') }
  run('INSERT INTO addons(booking_id,leg,key,qty,unit,status,created) VALUES(?,?,?,?,?,?,?)', b.id, li, key, d.pax.length, unit, 'pending', now());
  log('web', `addon ${b.pnr} ${key}`);
  return bookingView(q1('SELECT * FROM bookings WHERE id=?', b.id));
});

// season pass
on('POST', '/api/passes', async ({ body, ip, req }) => {
  limit(ip, 'pass', 5, 3600e3);
  let pr = body.product_id ? q1("SELECT * FROM pass_products WHERE id=? AND status='active'", +body.product_id) : q1("SELECT * FROM pass_products WHERE segments=? AND status='active' ORDER BY sort LIMIT 1", +body.kind || 0);
  if (!pr) bad('Este pase ya no está a la venta.');
  const name = clean(body.name, 80), email = clean(body.email, 120);
  if (!name) bad('Escribe tu nombre.'); if (!okEmail(email)) bad('Revisa tu correo electrónico.');
  const c = consentRead(body);
  let code; for (let i = 0; i < 20; i++) { code = 'PT-' + rnd(4) + '-' + rnd(4); if (!q1('SELECT 1 FROM passes WHERE code=?', code)) break }
  const exp = new Date(); exp.setMonth(exp.getMonth() + pr.valid_months);
  run('INSERT INTO passes(code,kind,total,left_n,price,name,email,status,exp,created,product_id,routes,product_name) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)', code, pr.segments, pr.segments, pr.segments, pr.price, name, email, 'pending', iso(exp), now(), pr.id, pr.routes, pr.name);
  const url = await stripeCheckout({ ref: 'P:' + code, amount: pr.price, name: `Beemo Air · Pase de temporada ${pr.name}`, email, successUrl: `${PUBLIC_URL}/pase-de-temporada/?pago=ok&pase=${code}`, cancelUrl: `${PUBLIC_URL}/pase-de-temporada/?pago=cancelado&pase=${code}`, minutes: 60 });
  if (url) run('UPDATE passes SET stripe_url=? WHERE code=?', url, code);
  consentLog(c, { form: 'pase', subject: email, name, ref: code, ip, req });
  log('web', `pass ${code} pending (${pr.name})`);
  return passView(q1('SELECT * FROM passes WHERE code=?', code), true);
});
const passView = (p, withUrl) => ({ code: p.code, kind: p.kind, name: p.product_name || `${p.total} trayectos`, routes: p.routes ? JSON.parse(p.routes) : PASS_ROUTES, total: p.total, left: p.left_n, price: p.price, status: p.status, exp: p.exp, pay_url: withUrl && p.status === 'pending' ? p.stripe_url : null });
// pass products (catalog)
const CLASSIC_REF = 395;
const productView = pr => { const routes = JSON.parse(pr.routes || '[]'); return { id: pr.id, name: pr.name, name_en: pr.name_en, description: pr.description, description_en: pr.description_en, badge: pr.badge, badge_en: pr.badge_en,
  segments: pr.segments, price: pr.price, routes, valid_months: pr.valid_months, status: pr.status, sort: pr.sort,
  per_segment: pr.segments && pr.price ? r2(pr.price / pr.segments) : null, savings: pr.segments && pr.price ? Math.max(0, Math.round(CLASSIC_REF * pr.segments - pr.price)) : null } };
on('GET', '/api/pass-products', () => q("SELECT * FROM pass_products WHERE status IN ('active','soon') ORDER BY sort, id").map(productView));
function productInput(body, cur = {}) {
  const v = k => body[k] !== undefined ? body[k] : cur[k];
  const status = String(v('status') || 'inactive'); if (!['active', 'soon', 'inactive'].includes(status)) bad('Estado no válido.');
  const name = clean(v('name'), 60); if (!name) bad('Escribe el nombre del pase.');
  let routes = body.routes !== undefined ? body.routes : JSON.parse(cur.routes || '[]'); if (!Array.isArray(routes)) routes = [];
  routes = [...new Set(routes.map(String))].filter(r => SCHED[r]);
  const segments = v('segments') === '' || v('segments') == null ? null : Math.round(Number(v('segments')));
  const price = v('price') === '' || v('price') == null ? null : r2(Number(v('price')));
  const months = Math.round(Number(v('valid_months') || 12));
  if (status === 'active') {
    if (!(segments >= 1 && segments <= 40)) bad('Los trayectos deben estar entre 1 y 40.');
    if (!(price > 0 && price < 100000)) bad('Escribe un precio válido.');
    if (!routes.length) bad('Elige al menos una ruta.');
  }
  if (!(months >= 1 && months <= 36)) bad('La vigencia debe estar entre 1 y 36 meses.');
  return { name, name_en: clean(v('name_en'), 60), description: clean(v('description'), 200), description_en: clean(v('description_en'), 200), badge: clean(v('badge'), 30), badge_en: clean(v('badge_en'), 30),
    segments, price, routes: JSON.stringify(routes), valid_months: months, status, sort: Math.round(Number(v('sort') ?? 100)) || 100 };
}
on('GET', '/api/admin/pass-products', ({ req }) => { need(req, 'admin'); return q('SELECT * FROM pass_products ORDER BY sort, id').map(pr => ({ ...productView(pr), sold: q1('SELECT COUNT(*) n FROM passes WHERE product_id=? AND status=?', pr.id, 'paid').n })) });
on('POST', '/api/admin/pass-products', ({ req, body }) => {
  const a = need(req, 'admin'); const d = productInput(body); const ts = now();
  const r = run('INSERT INTO pass_products(name,name_en,description,description_en,badge,badge_en,segments,price,routes,valid_months,status,sort,created,updated) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
    d.name, d.name_en, d.description, d.description_en, d.badge, d.badge_en, d.segments, d.price, d.routes, d.valid_months, d.status, d.sort, ts, ts);
  log(a.user.email, `pass product ${d.name} created (${d.status})`); return { id: Number(r.lastInsertRowid) };
});
on('PATCH', '/api/admin/pass-products/:id', ({ req, body, params }) => {
  const a = need(req, 'admin'); const cur = q1('SELECT * FROM pass_products WHERE id=?', +params.id); if (!cur) throw new HttpErr(404, 'Pase no encontrado.');
  const d = productInput(body, cur);
  run('UPDATE pass_products SET name=?,name_en=?,description=?,description_en=?,badge=?,badge_en=?,segments=?,price=?,routes=?,valid_months=?,status=?,sort=?,updated=? WHERE id=?',
    d.name, d.name_en, d.description, d.description_en, d.badge, d.badge_en, d.segments, d.price, d.routes, d.valid_months, d.status, d.sort, now(), cur.id);
  log(a.user.email, `pass product ${cur.id} -> ${d.status}`); return { ok: true };
});
on('POST', '/api/admin/pass-products/:id/clone', ({ req, params }) => {
  const a = need(req, 'admin'); const c = q1('SELECT * FROM pass_products WHERE id=?', +params.id); if (!c) throw new HttpErr(404, 'Pase no encontrado.'); const ts = now();
  const r = run('INSERT INTO pass_products(name,name_en,description,description_en,badge,badge_en,segments,price,routes,valid_months,status,sort,created,updated) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
    c.name + ' (copia)', c.name_en ? c.name_en + ' (copy)' : '', c.description, c.description_en, c.badge, c.badge_en, c.segments, c.price, c.routes, c.valid_months, 'inactive', c.sort + 1, ts, ts);
  log(a.user.email, `pass product ${c.id} cloned`); return { id: Number(r.lastInsertRowid) };
});
on('GET', '/api/passes/:code', ({ params, ip }) => { limit(ip, 'passget', 60, 600e3); const p = q1('SELECT * FROM passes WHERE code=?', String(params.code).toUpperCase()); if (!p) throw new HttpErr(404, 'No encontramos ese código de pase. Revísalo e intenta de nuevo.'); return passView(p, true) });

// Stripe webhook
on('POST', '/api/stripe/webhook', ({ raw, req }) => {
  if (!stripeVerify(raw, req.headers['stripe-signature'])) throw new HttpErr(400, 'bad signature');
  const ev = JSON.parse(raw);
  if (ev.type === 'checkout.session.completed' && ev.data?.object?.payment_status === 'paid') {
    const ref = ev.data.object.metadata?.ref || '';
    if (ref.startsWith('B:')) { const b = q1('SELECT * FROM bookings WHERE pnr=?', ref.slice(2)); if (b && b.status === 'pending') confirmPaid(b, 'stripe'); else if (b && ['expired', 'cancelled'].includes(b.status)) log('stripe', `PAID AFTER EXPIRY ${b.pnr}: revisar y reembolsar o reubicar`) }
    if (ref.startsWith('P:')) { run("UPDATE passes SET status='paid' WHERE code=? AND status='pending'", ref.slice(2)); log('stripe', `pass ${ref.slice(2)} paid`) }
    if (ref.startsWith('C:')) { run("UPDATE changes SET status='paid' WHERE id=? AND status='pending'", +ref.slice(2)); log('stripe', `change ${ref.slice(2)} paid`) }
  }
  // cobro directo de una compra hecha por un agente (UCP): confirma la reserva si la respuesta del cobro se perdió
  if (ev.type === 'payment_intent.succeeded' && String(ev.data?.object?.metadata?.ref || '').startsWith('B:') && ev.data.object.metadata.ucp_session) {
    const b = q1('SELECT * FROM bookings WHERE pnr=?', ev.data.object.metadata.ref.slice(2));
    if (b && b.status === 'pending') confirmPaid(b, 'stripe'); else if (b && b.status !== 'confirmed') log('stripe', `PAID AFTER EXPIRY ${b.pnr}: revisar y reembolsar o reubicar`) }
  return { received: true };
});

// auth
on('POST', '/api/auth/login', ({ body, ip }) => {
  limit(ip, 'login', 10, 900e3);
  const id = norm(body.email), u = q1('SELECT * FROM users WHERE (email=? OR username=?) AND active=1', id, normUser(body.email));
  if (!u || !checkPw(String(body.password || ''), u.pass)) throw new HttpErr(401, 'El correo o la contraseña no coinciden.');
  if (expired(u)) throw new HttpErr(403, 'Tu acceso temporal venció. Escríbenos a management@beemoair.com si necesitas más tiempo.');
  const ag = u.agency_id ? q1('SELECT * FROM agencies WHERE id=?', u.agency_id) : null;
  if (u.role === 'agent' && (!ag || !ag.active)) throw new HttpErr(403, 'Tu agencia no está activa. Escríbenos a management@beemoair.com.');
  const am = u.role === 'ambassador' ? q1('SELECT * FROM ambassadors WHERE id=?', u.amb_id) : null;
  if (u.role === 'ambassador' && (!am || !am.active)) throw new HttpErr(403, 'Tu código de embajador no está activo. Escríbenos a management@beemoair.com.');
  const t = crypto.randomBytes(32).toString('hex');
  run('INSERT INTO sessions(token,user_id,expires) VALUES(?,?,?)', sha(t), u.id, Date.now() + 12 * 3600e3);
  run('DELETE FROM sessions WHERE expires<?', Date.now());
  run('UPDATE users SET last_login=? WHERE id=?', now(), u.id); log(u.email, 'login');
  return { token: t, user: userView(u, ag, null, am) };
});
on('POST', '/api/auth/logout', ({ req }) => { const h = req.headers.authorization || ''; if (h.startsWith('Bearer ')) run('DELETE FROM sessions WHERE token=?', sha(h.slice(7))); return { ok: true } });
on('GET', '/api/me', ({ req }) => { const a = need(req); return userView(a.user, a.agency, a.viewer, a.amb) });
on('POST', '/api/admin/agencies/:id/view', ({ req, params }) => {
  const a = need(req, 'admin'); const ag = q1('SELECT * FROM agencies WHERE id=?', +params.id); if (!ag) throw new HttpErr(404, 'Agencia no encontrada.');
  const t = crypto.randomBytes(32).toString('hex'); run('INSERT INTO sessions(token,user_id,expires,as_agency) VALUES(?,?,?,?)', sha(t), a.user.id, Date.now() + 4 * 3600e3, ag.id);
  log(a.user.email, `view as agency ${ag.name}`); return { token: t };
});
on('POST', '/api/me/password', ({ req, body }) => {
  const a = need(req); if (a.viewer) bad('Estás viendo el portal como agencia; cambia tu contraseña desde tu propia sesión.'); const pw = String(body.password || '');
  if (pw.length < 10) bad('La contraseña debe tener al menos 10 caracteres.');
  if (!a.user.must_change && !checkPw(String(body.current || ''), a.user.pass)) bad('La contraseña actual no coincide.');
  run('UPDATE users SET pass=?, must_change=0 WHERE id=?', hashPw(pw), a.user.id); log(a.user.email, 'password changed'); return { ok: true };
});
// equipo de Beemo Air: administradores, incluidos los temporales y de solo lectura
const adminView = u => ({ id: u.id, name: u.name, email: u.email, readonly: !!u.readonly, expires: u.expires, expired: expired(u), active: !!u.active, must_change: !!u.must_change, created: u.created, last_login: u.last_login });
on('GET', '/api/admin/admins', ({ req }) => { const a = need(req, 'admin'); return { me: a.user.id, list: q("SELECT * FROM users WHERE role='admin' ORDER BY expires IS NOT NULL, created").map(adminView) } });
on('POST', '/api/admin/admins', ({ req, body }) => {
  const a = need(req, 'admin'); const email = norm(body.email); if (!okEmail(email)) bad('Revisa el correo.');
  if (q1('SELECT 1 FROM users WHERE email=?', email)) bad('Ya existe un usuario con ese correo.');
  const days = Math.round(+body.days || 0); if (body.days !== 'none' && (days < 1 || days > 90)) bad('Elige una duración entre 1 y 90 días.');
  const exp = body.days === 'none' ? null : new Date(Date.now() + days * 864e5).toISOString();
  const own = String(body.password || ''); if (own && own.length < 10) bad('La contraseña debe tener al menos 10 caracteres.');
  const pw = own || tempPassword(), ro = body.readonly === false || body.readonly === 'false' ? 0 : 1;
  run('INSERT INTO users(email,name,role,pass,must_change,readonly,expires,created) VALUES(?,?,?,?,?,?,?,?)', email, clean(body.name, 80) || email, 'admin', hashPw(pw), own ? 0 : 1, ro, exp, now());
  log(a.user.email, `admin ${email} creado${ro ? ' (solo lectura)' : ''}${exp ? ' hasta ' + exp.slice(0, 10) : ''}`);
  return { password: own ? null : pw, user: adminView(q1('SELECT * FROM users WHERE email=?', email)) };
});
on('POST', '/api/admin/admins/:id/:action', ({ req, params }) => {
  const a = need(req, 'admin'); const u = q1("SELECT * FROM users WHERE id=? AND role='admin'", +params.id); if (!u) throw new HttpErr(404, 'Usuario no encontrado.');
  if (u.id === a.user.id) bad('No puedes cambiar tu propio acceso.');
  if (params.action === 'revoke') { run('UPDATE users SET active=0 WHERE id=?', u.id); run('DELETE FROM sessions WHERE user_id=?', u.id); log(a.user.email, `admin ${u.email} revocado`); return { ok: true } }
  if (params.action === 'reset') { const pw = tempPassword(); run('UPDATE users SET pass=?, must_change=1, active=1 WHERE id=?', hashPw(pw), u.id); run('DELETE FROM sessions WHERE user_id=?', u.id); log(a.user.email, `admin ${u.email} nueva contraseña`); return { password: pw } }
  if (params.action === 'extend') { const base = Math.max(Date.now(), Date.parse(u.expires || 0) || 0); const exp = new Date(base + 7 * 864e5).toISOString(); run('UPDATE users SET expires=?, active=1 WHERE id=?', exp, u.id); log(a.user.email, `admin ${u.email} extendido hasta ${exp.slice(0, 10)}`); return { ok: true } }
  bad('Acción no válida.');
});
on('GET', '/api/admin/setup', () => ({ needed: !q1("SELECT 1 FROM users WHERE role='admin'") && !!SETUP_CODE }));
on('POST', '/api/admin/setup', ({ body, ip }) => {
  limit(ip, 'setup', 5, 3600e3);
  if (q1("SELECT 1 FROM users WHERE role='admin'")) bad('El administrador ya fue creado.');
  if (!SETUP_CODE || String(body.code || '').trim() !== SETUP_CODE) throw new HttpErr(403, 'El código de configuración no es válido.');
  if (!okEmail(body.email)) bad('Revisa el correo.'); if (String(body.password || '').length < 10) bad('La contraseña debe tener al menos 10 caracteres.');
  run('INSERT INTO users(email,name,role,pass,created) VALUES(?,?,?,?,?)', norm(body.email), clean(body.name || 'Administrador'), 'admin', hashPw(String(body.password)), now());
  log(norm(body.email), 'admin created'); return { ok: true };
});

// agency
on('GET', '/api/agency/flights', ({ req, url }) => { need(req, 'agent'); return routeFlights(url) });
function routeFlights(url) { const route = url.searchParams.get('route'), from = url.searchParams.get('from') || todayISO(); if (!SCHED[route]) bad('Ruta no válida.'); return opDates(route, from, Math.min(+url.searchParams.get('n') || 10, 40)).map(date => ({ date, route, no: SCHED[route].no, ...flightTimes(route, date), season: seasonOf(date).name, prices: seasonOf(date).p, tax: TAX_LEG, avail: availability(route, date), left: fareLeft(route, date) })) }
// cabina del vuelo para la agencia: estado de cada silla (sin nombres) y cuáles son de sus pasajeros
on('GET', '/api/agency/flight', ({ req, url }) => {
  const a = need(req, 'agent'); const route = String(url.searchParams.get('route') || ''), date = String(url.searchParams.get('date') || ''); if (!scheduled(route, date)) bad('Vuelo no encontrado.');
  const f = route + '|' + date, sc = SCHED[route];
  const seats = q('SELECT i.seat, b.status, b.agency_id FROM seat_inv i JOIN bookings b ON b.id=i.booking_id WHERE i.flight=?', f).map(r => ({ seat: r.seat, status: r.status, mine: r.agency_id === a.agency.id }));
  const av = availability(route, date), mine = seats.filter(x => x.mine);
  return { route, date, no: sc.no, ...flightTimes(route, date), dep_at: new Date(depTime(route, date)).toISOString(), seats, free: av.eco + av.biz, biz_free: av.biz,
    sold: seats.filter(x => x.status === 'confirmed').length, held: seats.filter(x => x.status !== 'confirmed').length, mine: mine.length, mine_held: mine.filter(x => x.status !== 'confirmed').length };
});
// manifiesto de la agencia: solo sus propios pasajeros
on('GET', '/api/agency/manifest', ({ req, url }) => {
  const a = need(req, 'agent'); const f = String(url.searchParams.get('route') || '') + '|' + String(url.searchParams.get('date') || '');
  const [route, date] = f.split('|'); if (!scheduled(route, date)) bad('Vuelo no encontrado.');
  const dep = depTime(route, date), opens = dep - 72 * 3600e3, closes = dep - 3 * 3600e3, nowMs = Date.now();
  const checkin = { opens: new Date(opens).toISOString(), closes: new Date(closes).toISOString(), state: nowMs < opens ? 'soon' : nowMs < closes ? 'open' : 'closed' };
  const rows = q('SELECT i.seat, i.pax, b.id bid, b.pnr, b.status, b.data FROM seat_inv i JOIN bookings b ON b.id=i.booking_id WHERE i.flight=? AND b.agency_id=? ORDER BY CAST(i.seat AS INTEGER), i.seat', f, a.agency.id)
    .map(r => { const d = JSON.parse(r.data), p = d.pax[r.pax], l = d.legs.find(x => x.route + '|' + x.date === f) || {}, dc = q1('SELECT * FROM pax_docs WHERE booking_id=? AND pax=?', r.bid, r.pax) || {}; const cp = q1('SELECT * FROM crm_pax WHERE booking_id=? AND pax=?', r.bid, r.pax);
      return { seat: r.seat, pnr: r.pnr, pax: r.pax, status: r.status, name: `${p.first} ${p.last}`, inf: !!p.inf, fare: FARE_NAME[l.fare] || l.fare, extras: Object.keys((l.extras || [])[r.pax] || {}), email: d.contact?.email || '', travel: travelOf(cp), travel_ok: travelDone(cp, p.inf), customer: cp?.customer_id ?? null,
        docs: { passport: !!dc.passport, visa: !!dc.visa, checkmig: !!dc.checkmig } } });
  return { checkin, to_colombia: route.endsWith('AXM') || route.endsWith('BAQ'), rows };
});
on('POST', '/api/agency/quote', ({ req, body }) => { const a = need(req, 'agent'); const Q = quote(body, 'agency'); const inc = effIncentive(a.agency, Q.pax.length * Q.legs.length); return { ...Q.breakdown, commission: r2(Q.net * (a.agency.commission + inc) / 100), rate: a.agency.commission + inc } });
on('POST', '/api/agency/bookings', async ({ req, body, ip }) => {
  const a = need(req, 'agent'); const pay = body.pay === 'cash' ? 'cash' : body.pay === 'hold' ? 'hold' : 'card';
  const c = consentRead(body, true);
  const bid = createBooking(body, { channel: 'agency', agency: a.agency, user: a.user, pay }); stampOrigin(bid, ip, req);
  { const b0 = q1('SELECT pnr, data FROM bookings WHERE id=?', bid), d0 = JSON.parse(b0.data); consentLog(c, { form: 'reserva_agencia', subject: d0.contact?.email, name: paxNames(d0), ref: b0.pnr, channel: 'agencia', by: `${a.agency.name} · ${a.user.email}`, ip, req }) }
  await attachPayLink(bid, AGENCY_URL + '/');
  return bookingView(q1('SELECT * FROM bookings WHERE id=?', bid), { private: true });
});
on('GET', '/api/agency/bookings', ({ req }) => { const a = need(req, 'agent'); return q('SELECT * FROM bookings WHERE agency_id=? ORDER BY id DESC LIMIT 500', a.agency.id).map(b => bookingView(b, { private: true })) });
on('POST', '/api/agency/bookings/:pnr/cancel', ({ req, params }) => {
  const a = need(req, 'agent'); const b = q1('SELECT * FROM bookings WHERE pnr=? AND agency_id=?', params.pnr, a.agency.id);
  if (!b) throw new HttpErr(404, 'Reserva no encontrada.');
  if (b.status !== 'pending') bad('Solo puedes anular reservas pendientes de pago. Para una reserva emitida escribe a management@beemoair.com.');
  releaseBooking(b, 'cancelled', a.user.email); return bookingView(q1('SELECT * FROM bookings WHERE id=?', b.id), { private: true });
});
// la agencia registra que el cliente le pagó: la reserva apartada (o con enlace sin pagar) se emite y pasa a su saldo por consignar
on('POST', '/api/agency/bookings/:pnr/collect', ({ req, params }) => {
  const a = need(req, 'agent'), b = q1('SELECT * FROM bookings WHERE pnr=? AND agency_id=?', String(params.pnr || '').toUpperCase(), a.agency.id); if (!b) throw new HttpErr(404, 'Reserva no encontrada.');
  if (b.status !== 'pending') bad(b.status === 'confirmed' ? 'Esta reserva ya está emitida.' : 'Esta reserva ya no está activa: las sillas se liberaron. Crea una nueva.');
  tx(() => { run("UPDATE bookings SET status='confirmed', pay_method='cash', paid=0, settled=0, expires=NULL, stripe_url=NULL, updated=? WHERE id=?", now(), b.id); run("UPDATE addons SET status='paid' WHERE booking_id=? AND status='pending'", b.id) });
  log(a.user.email, `booking ${b.pnr} collected at agency ${b.total}`);
  return bookingView(q1('SELECT * FROM bookings WHERE id=?', b.id), { private: true });
});
/* ---------- editar una reserva pendiente: pasajeros, maletas y prioritario ---------- */
const myBooking = (a, pnr) => { const b = q1('SELECT * FROM bookings WHERE pnr=? AND agency_id=?', String(pnr || '').toUpperCase(), a.agency.id); if (!b) throw new HttpErr(404, 'Reserva no encontrada.'); return b };
function editBody(b, body) {
  const d = JSON.parse(b.data), pax = Array.isArray(body.pax) ? body.pax.slice(0, 9) : [];
  if (!pax.length) bad('La reserva necesita al menos un pasajero.');
  const from = pax.map(p => Number.isInteger(p.from) && p.from >= 0 && p.from < d.pax.length ? p.from : null);
  if (new Set(from.filter(x => x != null)).size !== from.filter(x => x != null).length) bad('Un pasajero aparece dos veces.');
  return { from, body: { pax: pax.map(p => ({ first: p.first, last: p.last, inf: !!p.inf, club: p.club })), contact: { email: body.contact?.email ?? d.contact.email, phone: body.contact?.phone ?? d.contact.phone },
    legs: d.legs.map((l, li) => ({ route: l.route, date: l.date, fare: l.fare, seats: from.map(f => f == null ? null : l.seats[f]), extras: pax.map((_, i) => body.extras?.[li]?.[i] || {}) })) } };
}
on('POST', '/api/agency/bookings/:pnr/edit', async ({ req, params, body, ip }) => {
  const a = need(req, 'agent'), b = myBooking(a, params.pnr);
  if (b.status !== 'pending') bad('Solo se editan reservas pendientes de pago. Para una reserva emitida usa «Cambiar fecha».');
  if (b.pass_code) bad('Esta reserva usa un pase de temporada. Para cambiarla escríbenos por Soporte.');
  const { body: nb, from } = editBody(b, body), Q = quote(nb, 'agency', { skip: b.id });
  const inc = effIncentive(a.agency, Q.pax.length * Q.legs.length), rate = (a.agency.commission + inc) / 100;
  if (body.preview) return { ...Q.breakdown, commission: r2(Q.net * rate), old_total: b.total };
  const added = from.map((f, i) => f == null ? i : -1).filter(i => i >= 0), cAdd = added.length ? consentRead(body, true) : null;   // los pasajeros nuevos también aceptan, por la agencia
  tx(() => {
    run('DELETE FROM seat_inv WHERE booking_id=?', b.id);
    const claims = [];
    for (const [li, l] of Q.legs.entries()) {
      const flight = l.route + '|' + l.date, taken = new Set(takenSeats(flight));
      const conflict = l.seats.filter(x => x && taken.has(x)); if (conflict.length) throw new HttpErr(409, `El asiento ${conflict.join(', ')} ya no está libre.`);
      l.seats.forEach(x => x && taken.add(x));
      l.seats = l.seats.map(x => { if (x) return x; const p = seatFor(l, taken); if (!p) throw new HttpErr(409, `No quedan sillas ${l.fare === 'bc' ? 'en Business' : 'en económica'} en el vuelo ${l.no} del ${l.date} para otro pasajero.`); taken.add(p); return p });
      l.seats.forEach((x, i) => claims.push([flight, x, i]));
    }
    const data = { pax: Q.pax, contact: Q.contact, legs: Q.legs.map(l => ({ route: l.route, date: l.date, fare: l.fare, no: l.no, dep: l.dep, arr: l.arr, seats: l.seats, extras: l.extras })), breakdown: Q.breakdown, rate: rate * 100 };
    run('UPDATE bookings SET total=?, fare_net=?, commission=?, data=?, stripe_url=NULL, updated=? WHERE id=?', Q.total, Q.net, r2(Q.net * rate), JSON.stringify(data), now(), b.id);
    const ins = db.prepare('INSERT INTO seat_inv(flight,seat,booking_id,pax) VALUES(?,?,?,?)'); for (const [f, x, i] of claims) ins.run(f, x, b.id, i);
    crmRemap(b.id, from);
  });
  if (cAdd) consentLog(cAdd, { form: 'reserva_agencia', subject: Q.contact?.email, name: added.map(i => `${Q.pax[i].first} ${Q.pax[i].last}`).join(', '), ref: b.pnr, channel: 'agencia', by: `${a.agency.name} · ${a.user.email}`, ip, req });
  await attachPayLink(b.id, AGENCY_URL + '/');
  log(a.user.email, `booking ${b.pnr} edited ${b.total} -> ${Q.total}`);
  return bookingView(q1('SELECT * FROM bookings WHERE id=?', b.id), { private: true });
});
/* ---------- cambio de fecha de una reserva emitida ---------- */
// Classic: US$120 hasta 7 días antes y US$150 hasta 24 h antes; Flex y Flex BC sin cargo. Siempre más la diferencia de tarifa si sube.
function changeQuote(b, li, date, seats0, opts = {}) {   // opts.force: sin el límite de 24 horas ni las restricciones de la tarifa; opts.free: sin cobro
  const d = JSON.parse(b.data), l = d.legs[li]; if (!l) bad('Elige el tramo que quieres cambiar.');
  const h = (depTime(l.route, l.date) - Date.now()) / 36e5;
  if (h < 24 && !opts.force) bad('Los cambios se hacen hasta 24 horas antes de la salida. Después, el cambio se gestiona en el aeropuerto.');
  if (date === l.date) bad('Elige una fecha distinta a la actual.');
  if (!operates(l.route, date)) bad('No hay vuelo en esa fecha.');
  if (depTime(l.route, date) - Date.now() < 24 * 36e5 && !opts.force) bad('La nueva fecha debe salir dentro de más de 24 horas.');
  if (depTime(l.route, date) <= Date.now()) bad('Ese vuelo ya salió.');
  if (d.legs.length === 2) { if (li === 0 && date >= d.legs[1].date) bad('La ida debe ser antes del regreso. Cambia primero el regreso.'); if (li === 1 && date <= d.legs[0].date) bad('El regreso debe ser después de la ida.') }
  const n = d.pax.length, av = availability(l.route, date); if ((l.fare === 'bc' ? av.biz : av.eco) < n) bad(`No hay ${n} sillas libres ${l.fare === 'bc' ? 'en Business' : 'en económica'} en ese vuelo.`);
  if (!opts.force && fareLeft(l.route, date)[l.fare] < n) bad(`La tarifa ${FARE_NAME[l.fare]} ya no tiene ${n === 1 ? 'cupo' : n + ' cupos'} en ese vuelo. Elige otra fecha o mejora la tarifa primero.`);
  if (l.fare === 'light' && !opts.force) bad('La tarifa Light no permite cambios de fecha. Puedes mejorar la tarifa y luego cambiar la fecha.');
  const usedFree = q1("SELECT COUNT(*) n FROM changes WHERE booking_id=? AND leg=? AND COALESCE(kind,'date')='date'", b.id, li).n;
  // Tabla oficial: Basic y Classic, penalidad de US$175; Plus, hasta un cambio sin penalidad; Flex y Flex BC, sin penalidad. Siempre más la diferencia de tarifa.
  if (l.fare === 'plus' && usedFree && !opts.force) bad('La tarifa Plus permite un solo cambio de fecha. Para cambiarla otra vez, mejora la tarifa a Flex.');
  const fee = opts.free ? 0 : ['basic', 'classic'].includes(l.fare) ? 175 : 0, diff = opts.free ? 0 : r2(Math.max(0, priceOf(date, l.fare) - priceOf(l.date, l.fare)));
  // sillas: propuesta automática (sin costo) o las que elija la agencia (se cobra solo si sube de zona)
  const newF = l.route + '|' + date, taken = new Set(takenSeats(newF));
  let seats, seatDiff = 0, custom = Array.isArray(seats0) && seats0.length;
  if (custom) {
    seats = seats0.map(x => String(x || '').toUpperCase()); if (seats.length !== n) bad('Elige una silla para cada pasajero.');
    if (new Set(seats).size !== n) bad('Dos pasajeros no pueden tener la misma silla.');
    for (const x of seats) { const r = parseInt(x), c = x.slice(-1); if (!isSeat(r, c) || String(r) + c !== x) bad(`La silla ${x} no es válida.`); if (!cabinOk(l.fare, r)) bad(`La silla ${x} no corresponde a la tarifa ${FARE_NAME[l.fare]}.`); if (taken.has(x)) bad(`La silla ${x} ya está ocupada en ese vuelo.`) }
    seatDiff = opts.free ? 0 : r2(seats.reduce((t, x, i) => t + Math.max(0, seatPrice(l.fare, x) - (l.seats[i] ? seatPrice(l.fare, l.seats[i]) : 0)), 0));
  } else seats = proposeSeats(l, taken);
  return { leg: li, route: l.route, from: l.date, to: date, fare: l.fare, fare_name: FARE_NAME[l.fare], pax: n, fee, diff, per_pax: r2(fee + diff), seats: seats.map((x, i) => ({ from: l.seats[i] || null, to: x })), custom: !!custom, seat_diff: seatDiff, amount: r2((fee + diff) * n + seatDiff) };
}
// sillas para el nuevo vuelo: las mismas si están libres; si no, un bloque contiguo para el grupo, primero en la zona original
function proposeSeats(l, taken) {
  const n = l.seats.length, ok = x => x && !taken.has(x) && cabinOk(l.fare, parseInt(x));
  if (l.seats.every(ok)) return l.seats.slice();
  const base = l.fare === 'bc' ? [0] : SEAT_INC.has(l.fare) ? [4, 3, 5, 1, 2] : [5, 4, 3, 1, 2];
  const pref = [...new Set([zoneOf(parseInt(l.seats[0] || '0')), ...base].filter(z => base.includes(z)))];
  const free = ALL_SEATS.filter(x => !taken.has(x) && cabinOk(l.fare, parseInt(x)));
  for (const z of pref) {
    const rows = {}; free.filter(x => zoneOf(parseInt(x)) === z).forEach(x => { const r = parseInt(x); (rows[r] = rows[r] || []).push(x) });
    const rs = Object.keys(rows).map(Number).sort((a, b) => a - b);
    for (const r of rs) for (const side of ['ABC', 'DEF']) { const ss = rows[r].filter(x => side.includes(x.slice(-1))); if (ss.length >= n) return ss.slice(0, n) }
    for (const r of rs) if (rows[r].length >= n) return rows[r].slice(0, n);
    for (let i = 0; i < rs.length; i++) { let acc = []; for (let j = i; j < rs.length && (j === i || rs[j] - rs[j - 1] === 1); j++) { acc = acc.concat(rows[rs[j]]); if (acc.length >= n) return acc.slice(0, n) } }
  }
  const t2 = new Set(taken); return l.seats.map(x => { if (ok(x) && !t2.has(x)) { t2.add(x); return x } const p = pickSeat(l.fare, t2); if (!p) throw new HttpErr(409, 'Ya no quedan sillas en ese vuelo.'); t2.add(p); return p });
}
async function applyChange(b, body, who, opts = {}) {
  if (b.status !== 'confirmed') bad('El cambio de fecha aplica a reservas emitidas. Si está pendiente, edítala o anúlala y crea una nueva.');
  if (b.pass_code) bad(opts.admin ? 'Esta reserva usa un pase de temporada: el cambio de fecha no aplica desde aquí.' : 'Esta reserva usa un pase de temporada. Para cambiarla escríbenos por Soporte.');
  const cq = changeQuote(b, +body.leg, String(body.date || ''), body.seats, opts);
  if (body.preview) return cq;
  const pay = cq.amount <= 0 ? 'none' : body.pay === 'cash' ? 'cash' : 'card';
  let cid;
  tx(() => {
    const d = JSON.parse(b.data), l = d.legs[cq.leg], oldF = l.route + '|' + l.date, newF = l.route + '|' + cq.to;
    run('DELETE FROM seat_inv WHERE booking_id=? AND flight=?', b.id, oldF);
    const taken = new Set(takenSeats(newF)); if (cq.seats.some(x => taken.has(x.to))) throw new HttpErr(409, 'Una de las sillas acaba de ocuparse. Vuelve a elegir.');
    l.seats = cq.seats.map(x => x.to);
    const ins = db.prepare('INSERT INTO seat_inv(flight,seat,booking_id,pax) VALUES(?,?,?,?)'); l.seats.forEach((x, i) => ins.run(newF, x, b.id, i));
    l.date = cq.to; Object.assign(l, flightTimes(l.route, cq.to));
    run('UPDATE bookings SET data=?, updated=? WHERE id=?', JSON.stringify(d), now(), b.id);
    cid = Number(run('INSERT INTO changes(booking_id,leg,from_date,to_date,pax,fee,diff,seat_diff,amount,pay,status,by,created) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)', b.id, cq.leg, cq.from, cq.to, cq.pax, cq.fee, cq.diff, cq.seat_diff, cq.amount, pay, pay === 'card' ? 'pending' : 'paid', who, now()).lastInsertRowid);
  });
  if (pay === 'card' && STRIPE_KEY) { const d = JSON.parse(b.data); const url = await stripeCheckout({ ref: 'C:' + cid, amount: cq.amount, name: `Beemo Air · Cambio de fecha ${b.pnr}`, email: d.contact.email, successUrl: `${AGENCY_URL}/?pago=ok&pnr=${b.pnr}`, cancelUrl: `${AGENCY_URL}/?pago=cancelado&pnr=${b.pnr}`, minutes: 60 * 24 }); if (url) run('UPDATE changes SET stripe_url=? WHERE id=?', url, cid) }
  log(who, `booking ${b.pnr} leg ${cq.leg} ${cq.from} -> ${cq.to} (${cq.amount} ${pay})${opts.force ? ' · sin restricciones' : ''}${opts.free ? ' · sin cobro' : ''}`);
  return bookingView(q1('SELECT * FROM bookings WHERE id=?', b.id), { private: true });
}
on('POST', '/api/agency/bookings/:pnr/change', ({ req, params, body }) => { const a = need(req, 'agent'); return applyChange(myBooking(a, params.pnr), body, a.user.email) });
// cambio de fecha desde el administrador: cualquier reserva emitida, de cualquier canal; puede saltarse el límite de 24 horas
// y las restricciones de la tarifa («force»), y hacerlo sin cobro («free»). Si se salta algo, pide el motivo.
on('PUT', '/api/admin/bookings/:pnr/change', ({ req, params, body }) => { const a = need(req, 'admin'), b = q1('SELECT * FROM bookings WHERE pnr=?', String(params.pnr || '').toUpperCase()); if (!b) throw new HttpErr(404, 'Reserva no encontrada.');
  const opts = { admin: true, force: !!body.force, free: !!body.free }, note = clean(body.note, 200);
  if (!body.preview && (opts.force || opts.free) && note.length < 5) bad('Escribe el motivo: estás saltando las reglas de la tarifa o haciendo el cambio sin cobro.');
  const out = applyChange(b, body, a.user.email, opts); if (!body.preview && note) log(a.user.email, `cambio de fecha ${b.pnr}: ${note}`); return out });
/* ---------- mejora de tarifa (Classic → Flex o Flex BC, Flex → Flex BC), mismos precios que «Mi reserva» en beemoair.com ---------- */
const FARE_RANK = { light: 0, basic: 1, classic: 2, plus: 3, flex: 4, bc: 5 };
function upgradeQuote(b, li, fare, seats0) {
  const d = JSON.parse(b.data), l = d.legs[li]; if (!l) bad('Elige el tramo.');
  if (!(FARE_RANK[fare] > FARE_RANK[l.fare])) bad('Elige una tarifa superior a la actual.');
  const w = ladderWindow(l.route, l.date); if (w < 0) bad('Este vuelo ya salió.'); if (w === 2) bad('En las últimas 24 horas la mejora se compra en el aeropuerto.');
  const unit = r2(Math.max(0, priceOf(l.date, fare) - priceOf(l.date, l.fare))); // la diferencia entre familias
  const n = d.pax.length, f = l.route + '|' + l.date, mine = new Set(q('SELECT seat FROM seat_inv WHERE booking_id=? AND flight=?', b.id, f).map(r => r.seat));
  const taken = new Set(takenSeats(f).filter(x => !mine.has(x)));
  const bizFree = ALL_SEATS.filter(x => parseInt(x) <= BIZ && !taken.has(x)).length;
  let seats = l.seats.slice(), custom = false;
  if (fare === 'bc') {
    if (bizFree < n) bad(bizFree ? `Solo quedan ${bizFree} ${bizFree === 1 ? 'silla libre' : 'sillas libres'} en Business y la reserva tiene ${n} pasajeros.` : 'No quedan sillas libres en Business en este vuelo.');
    if (Array.isArray(seats0) && seats0.length) {
      custom = true; seats = seats0.map(x => String(x || '').toUpperCase()); if (seats.length !== n || new Set(seats).size !== n) bad('Elige una silla distinta para cada pasajero.');
      for (const x of seats) { const r = parseInt(x), c = x.slice(-1); if (!isSeat(r, c) || String(r) + c !== x || r > BIZ) bad(`La silla ${x} no es de la cabina Business.`); if (taken.has(x)) bad(`La silla ${x} ya está ocupada.`) }
    } else seats = proposeSeats({ ...l, fare: 'bc', seats: l.seats.map(() => null) }, taken);
  }
  return { leg: li, route: l.route, date: l.date, from_fare: l.fare, to_fare: fare, fare_name: FARE_NAME[fare], pax: n, unit, amount: r2(unit * n), biz_free: bizFree, seats: seats.map((x, i) => ({ from: l.seats[i], to: x })), custom };
}
on('POST', '/api/agency/bookings/:pnr/upgrade', async ({ req, params, body }) => {
  const a = need(req, 'agent'), b = myBooking(a, params.pnr);
  if (!['pending', 'confirmed'].includes(b.status)) bad('Esta reserva ya no está activa.');
  if (b.pass_code) bad('Esta reserva usa un pase de temporada. Para mejorarla escríbenos por Soporte.');
  const uq = upgradeQuote(b, +body.leg, String(body.fare || ''), body.seats);
  if (body.preview) return uq;
  const pay = b.status === 'pending' ? 'booking' : body.pay === 'cash' ? 'cash' : 'card';
  tx(() => {
    const d = JSON.parse(b.data), l = d.legs[uq.leg], f = l.route + '|' + l.date;
    const taken = new Set(takenSeats(f)); const own = new Set(q('SELECT seat FROM seat_inv WHERE booking_id=? AND flight=?', b.id, f).map(r => r.seat));
    if (uq.seats.some(x => taken.has(x.to) && !own.has(x.to))) throw new HttpErr(409, 'Una de las sillas acaba de ocuparse. Vuelve a elegir.');
    run('DELETE FROM seat_inv WHERE booking_id=? AND flight=?', b.id, f);
    const ins = db.prepare('INSERT INTO seat_inv(flight,seat,booking_id,pax) VALUES(?,?,?,?)'); uq.seats.forEach((x, i) => ins.run(f, x.to, b.id, i));
    l.fare = uq.to_fare; l.seats = uq.seats.map(x => x.to); l.extras = (l.extras || []).map(x => { if (uq.to_fare === 'bc') return {}; const y = { ...x }; if (uq.to_fare !== 'light') delete y.hand; if (!NO_BAG.has(uq.to_fare)) delete y.bag; return y });
    if (b.status === 'pending') {
      const net = r2(b.fare_net + uq.amount), rate = (d.rate || 0) / 100;
      d.breakdown = { ...d.breakdown, upgrades: r2((d.breakdown?.upgrades || 0) + uq.amount), total: r2(b.total + uq.amount) };
      run('UPDATE bookings SET total=?, fare_net=?, commission=?, data=?, stripe_url=NULL, updated=? WHERE id=?', r2(b.total + uq.amount), net, r2(net * rate), JSON.stringify(d), now(), b.id);
    } else {
      run('UPDATE bookings SET data=?, updated=? WHERE id=?', JSON.stringify(d), now(), b.id);
      run('INSERT INTO changes(booking_id,kind,fare_from,fare_to,leg,from_date,to_date,pax,fee,diff,seat_diff,amount,pay,status,by,created) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)', b.id, 'upgrade', uq.from_fare, uq.to_fare, uq.leg, uq.date, uq.date, uq.pax, 0, uq.unit, 0, uq.amount, pay, pay === 'card' ? 'pending' : 'paid', a.user.email, now());
    }
  });
  if (b.status === 'pending') await attachPayLink(b.id, AGENCY_URL + '/');
  else if (pay === 'card' && STRIPE_KEY) { const c = q1('SELECT id FROM changes WHERE booking_id=? ORDER BY id DESC LIMIT 1', b.id), d = JSON.parse(b.data); const url = await stripeCheckout({ ref: 'C:' + c.id, amount: uq.amount, name: `Beemo Air · Mejora a ${uq.fare_name} ${b.pnr}`, email: d.contact.email, successUrl: `${AGENCY_URL}/?pago=ok&pnr=${b.pnr}`, cancelUrl: `${AGENCY_URL}/?pago=cancelado&pnr=${b.pnr}`, minutes: 60 * 24 }); if (url) run('UPDATE changes SET stripe_url=? WHERE id=?', url, c.id) }
  log(a.user.email, `booking ${b.pnr} leg ${uq.leg} ${uq.from_fare} -> ${uq.to_fare} (${uq.amount})`);
  return bookingView(q1('SELECT * FROM bookings WHERE id=?', b.id), { private: true });
});
// administración: cobros de cambios
on('GET', '/api/admin/changes', ({ req }) => { need(req, 'admin'); return q("SELECT c.*, b.pnr, a.name agency FROM changes c JOIN bookings b ON b.id=c.booking_id LEFT JOIN agencies a ON a.id=b.agency_id WHERE c.status='pending' OR (c.pay='cash' AND c.settled=0) ORDER BY c.id DESC") });
on('POST', '/api/admin/changes/:id/:action', ({ req, params }) => {
  const a = need(req, 'admin'), c = q1('SELECT * FROM changes WHERE id=?', +params.id); if (!c) throw new HttpErr(404, 'Cambio no encontrado.');
  if (params.action === 'paid') run("UPDATE changes SET status='paid' WHERE id=?", c.id);
  else if (params.action === 'settle') run('UPDATE changes SET settled=1 WHERE id=?', c.id);
  else bad('Acción no válida.');
  log(a.user.email, `change ${c.id} ${params.action}`); return { ok: true };
});
on('GET', '/api/agency/statement', ({ req }) => { const a = need(req, 'agent'); return statement(a.agency.id) });
function statement(agencyId) {
  const rows = q("SELECT * FROM bookings WHERE agency_id=? AND status='confirmed'", agencyId);
  const sum = f => r2(rows.reduce((s, b) => s + f(b), 0));
  return { bookings: rows.length, sales: sum(b => b.total), net: sum(b => b.fare_net), commission: sum(b => b.commission),
    cash_due: r2(sum(b => b.pay_method === 'cash' && !b.settled ? b.total : 0) + chgCash(agencyId).reduce((t, c) => t + c.total, 0) + refundAgencyDue(agencyId)), refund_retained_due: refundAgencyDue(agencyId), cash_settled: sum(b => b.pay_method === 'cash' && b.settled ? b.total : 0),
    pending: q("SELECT COUNT(*) n FROM bookings WHERE agency_id=? AND status='pending'", agencyId)[0].n, months: agencyMonths(rows), cash_weeks: cashWeeks(rows.concat(chgCash(agencyId))), changes_paid: r2(q("SELECT COALESCE(SUM(c.amount),0) n FROM changes c JOIN bookings b ON b.id=c.booking_id WHERE b.agency_id=? AND c.status='paid'", agencyId)[0].n) };
}
const nyDay = iso => new Date(iso).toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
function agencyMonths(rows) { const m = {};
  for (const b of rows) { const k = nyDay(b.created).slice(0, 7), d = JSON.parse(b.data); m[k] = m[k] || { month: k, bookings: 0, segs: 0, sales: 0, commission: 0 };
    m[k].bookings++; m[k].segs += d.pax.length * d.legs.length; m[k].sales = r2(m[k].sales + b.total); m[k].commission = r2(m[k].commission + b.commission) }
  return Object.values(m).sort((a, b) => a.month.localeCompare(b.month)) }
// efectivo cobrado por la agencia: se consigna por semana (lunes a domingo) a más tardar el martes siguiente (segundo día hábil)
// cargos de cambio cobrados en efectivo y aún sin consignar, con la misma forma que una reserva para el calendario de consignaciones
const chgCash = agencyId => q("SELECT c.amount total, c.created, 'cash' pay_method, 0 settled FROM changes c JOIN bookings b ON b.id=c.booking_id WHERE b.agency_id=? AND c.pay='cash' AND c.status='paid' AND c.settled=0", agencyId);
function cashWeeks(rows) { const w = {};
  for (const b of rows) { if (b.pay_method !== 'cash' || b.settled) continue; const d = new Date(nyDay(b.created) + 'T12:00:00Z'), dow = (d.getUTCDay() + 6) % 7;
    const start = new Date(d); start.setUTCDate(d.getUTCDate() - dow); const due = new Date(start); due.setUTCDate(start.getUTCDate() + 8);
    const k = iso(start); w[k] = w[k] || { week_start: k, week_end: iso(new Date(start.getTime() + 6 * 864e5)), due: iso(due), amount: 0, bookings: 0 }; w[k].amount = r2(w[k].amount + b.total); w[k].bookings++ }
  const today = todayISO(); return Object.values(w).map(x => ({ ...x, overdue: x.due < today })).sort((a, b) => a.due.localeCompare(b.due)) }
/* plan de incentivos de agencias: % extra según trayectos emitidos en el mes (lo define el administrador; vacío = sin plan) */
const getAgPlan = () => { const r = q1("SELECT value FROM settings WHERE key='agency_plan'"); try { return r ? JSON.parse(r.value) : { tiers: [] } } catch (e) { return { tiers: [] } } };
function agencyMonthSegs(agencyId) { const m = nyDay(new Date().toISOString()).slice(0, 7); let n = 0;
  for (const b of q("SELECT data, created FROM bookings WHERE agency_id=? AND status='confirmed'", agencyId)) if (nyDay(b.created).slice(0, 7) === m) { const d = JSON.parse(b.data); n += d.pax.length * d.legs.length } return n }
function tierFor(segs) { const t = getAgPlan().tiers.slice().sort((a, b) => a.min - b.min); let cur = null, next = null; for (const x of t) { if (segs >= x.min) cur = x; else { next = x; break } } return { cur, next } }
function effIncentive(ag, extraSegs = 0) { const { cur } = tierFor(agencyMonthSegs(ag.id) + extraSegs); return Math.max(ag.incentive || 0, cur ? cur.incentive : 0) }

// admin
on('GET', '/api/admin/overview', ({ req }) => {
  need(req, 'admin');
  const flights = []; for (const route of Object.keys(SCHED)) for (const date of [...new Set([...opDates(route, todayISO(), 60), ...[...flightOps()].filter(([f, o]) => o.status === 'cancelled' && f.startsWith(route + '|') && f.split('|')[1] >= todayISO()).map(([f]) => f.split('|')[1])])]) {
    const av = availability(route, date); const sold = q("SELECT COUNT(*) n FROM seat_inv i JOIN bookings b ON b.id=i.booking_id WHERE i.flight=? AND b.status='confirmed'", route + '|' + date)[0].n;
    const held = q("SELECT COUNT(*) n FROM seat_inv i JOIN bookings b ON b.id=i.booking_id WHERE i.flight=? AND b.status='pending'", route + '|' + date)[0].n;
    const fo = flightOp(route, date), ft = flightTimes(route, date);
    flights.push({ route, date, no: SCHED[route].no, sold, held, free: av.eco + av.biz, biz_free: av.biz, dep_at: new Date(depTime(route, date)).toISOString(), state: fo?.status === 'cancelled' ? 'cancelled' : fo?.status === 'extra' ? 'extra' : 'scheduled', retimed: ft.dep !== SCHED[route].dep || ft.arr !== SCHED[route].arr, dep: ft.dep }) }
  flights.sort((x, y) => x.date.localeCompare(y.date) || x.route.localeCompare(y.route));
  const tot = q("SELECT status, COUNT(*) n, SUM(total) t FROM bookings GROUP BY status");
  return { flights, totals: tot, stripe: !!STRIPE_KEY };
});
/* ============ dashboard: live business vs the year-1 financial plan (escenario medio) ============ */
const PLAN = { revenue: 8161808, ebitda: 3261672, margin: 0.40, ops: 56, pax: 15100, load: 0.80, load_min: 0.70, breakeven_load: 0.35, breakeven_tickets_only: 0.68,
  rev_per_op: 146496, charter_per_op: 80400, nontariff_share: 0.29, cash_need: 645784, avg_fare: 395,
  monthly: { '2026-12': 439488, '2027-01': 585984, '2027-02': 727234, '2027-03': 727234, '2027-04': 727234, '2027-05': 585984, '2027-06': 727234, '2027-07': 873730, '2027-08': 727234, '2027-09': 585984, '2027-10': 727234, '2027-11': 727234 } };
/* ============ finanzas: el modelo financiero vive en el servidor (se sube desde el portal), no en el código ============ */
// lector mínimo de .xlsx (zip + xml) con los valores calculados que guarda Excel
function unzip(buf) {
  let e = buf.length - 22; while (e >= 0 && buf.readUInt32LE(e) !== 0x06054b50) e--; if (e < 0) bad('El archivo no es un Excel válido.');
  const n = buf.readUInt16LE(e + 10); let p = buf.readUInt32LE(e + 16); const out = {};
  for (let i = 0; i < n; i++) { if (buf.readUInt32LE(p) !== 0x02014b50) break;
    const meth = buf.readUInt16LE(p + 10), csize = buf.readUInt32LE(p + 20), fl = buf.readUInt16LE(p + 28), xl = buf.readUInt16LE(p + 30), cl = buf.readUInt16LE(p + 32), off = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + fl); p += 46 + fl + xl + cl;
    const lo = off + 30 + buf.readUInt16LE(off + 26) + buf.readUInt16LE(off + 28), data = buf.subarray(lo, lo + csize);
    out[name] = meth === 8 ? zlib.inflateRawSync(data) : data }
  return out;
}
const xmlText = s => s.replace(/<[^>]+>/g, '').replace(/&#x([0-9a-f]+);/gi, (m, h) => String.fromCodePoint(parseInt(h, 16))).replace(/&#(\d+);/g, (m, d) => String.fromCodePoint(+d)).replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
function readXlsx(buf) {
  const z = unzip(buf), str = k => z[k] ? z[k].toString('utf8') : '';
  const shared = [...str('xl/sharedStrings.xml').matchAll(/<si>([\s\S]*?)<\/si>/g)].map(m => xmlText([...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map(t => t[1]).join('')));
  const rels = Object.fromEntries([...str('xl/_rels/workbook.xml.rels').matchAll(/<Relationship [^>]*?Id="([^"]+)"[^>]*?Target="([^"]+)"/g)].map(m => [m[1], m[2]]));
  const relsB = Object.fromEntries([...str('xl/_rels/workbook.xml.rels').matchAll(/<Relationship [^>]*?Target="([^"]+)"[^>]*?Id="([^"]+)"/g)].map(m => [m[2], m[1]]));
  const sheets = {};
  for (const m of str('xl/workbook.xml').matchAll(/<sheet [^>]*?name="([^"]+)"[^>]*?r:id="([^"]+)"/g)) {
    const t = (rels[m[2]] || relsB[m[2]] || '').replace(/^\/?xl\//, ''), xml = str('xl/' + t), rows = [];
    for (const r of xml.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)) { const row = [];
      for (const c of r[1].matchAll(/<c ([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) { const at = c[1], ty = (at.match(/t="([^"]+)"/) || [])[1], v = ((c[2] || '').match(/<v>([\s\S]*?)<\/v>/) || [])[1];
        let val = null; if (ty === 's') val = shared[+v]; else if (ty === 'inlineStr') val = xmlText(c[2] || ''); else if (ty === 'str') val = v != null ? xmlText(v) : null; else if (ty === 'b') val = v === '1'; else if (v != null) val = Number(v);
        if (val !== null && val !== '') row.push(val) }
      if (row.length) rows.push(row) }
    sheets[xmlText(m[1])] = rows }
  return sheets;
}
const R2 = x => typeof x === 'number' ? Math.round(x * 100) / 100 : x;
// base del simulador de canales (pestaña Agencias): sillas vendibles, ocupación de Business, mezcla de familias y, si el modelo trae la hoja «Canales»,
// las cifras del modelo original aunque el Excel se haya guardado con un escenario de convenio activo. Todo es opcional: sin estas hojas se usan los valores por defecto.
function channelsBaseFromXlsx(W) {
  const SC = ['basico', 'medio', 'full'], out = {}, num = v => typeof v === 'number' && Number.isFinite(v);
  const row = (sheet, label) => { const r = (W[sheet] || []).find(r => typeof r[0] === 'string' && r[0].startsWith(label)); return r ? r.slice(1) : null };
  const tri = v => v && v.slice(0, 3).every(num) ? Object.fromEntries(SC.map((k, i) => [k, v[i]])) : null;
  try {
    const eco = row('Familias de tarifa', 'Economía ('), biz = row('Familias de tarifa', 'Business ('), ob = tri(row('Familias de tarifa', 'Ocupación de Business'));
    if (eco && num(eco[0])) out.eco_rt = eco[0]; if (biz && num(biz[0])) out.biz_rt = biz[0]; if (ob) out.occ_biz = ob;
    const mix = {}; for (const [k, n] of [['light', 'Light'], ['basic', 'Basic'], ['classic', 'Classic'], ['plus', 'Plus'], ['flex', 'Flex']]) {
      const r = (W['Familias de tarifa'] || []).find(r => r[0] === n); if (r && num(r[3])) mix[k] = r[3] }
    if (Object.keys(mix).length === 5) out.mix = mix;
    const ops = row('Supuestos', 'Operaciones ruta regular'); if (ops && num(ops[0])) out.ops_regular = ops[0];
    const gw = row('Supuestos', 'Pasarela de pagos'); if (gw && num(gw[0]) && gw[0] > 0 && gw[0] < 0.2) out.gateway = gw[0];
    if (W.Canales) {
      const inc = row('Canales', 'Incentivo a agencias que ya trae el modelo'), tax = row('Canales', 'Tasas e impuestos por pasajero'), act = row('Canales', 'Escenario activo que entra al modelo'), gwc = row('Canales', 'Pasarela de pagos');
      if (inc && num(inc[0])) out.incentive = inc[0]; if (tax && num(tax[0])) out.taxes_rt = tax[0]; if (act && num(act[0])) out.active = act[0]; if (gwc && num(gwc[0]) && gwc[0] > 0 && gwc[0] < 0.2) out.gateway = gwc[0];
      const orig = {}; for (const [k, l] of [['tickets', 'Ingreso por tiquetes, ruta regular'], ['nontariff', 'Ingreso no tarifario, ruta regular'], ['pax_rt', 'Pasajeros ida y vuelta, ruta regular'], ['revenue', 'Ingreso total del modelo original'], ['ebitda', 'EBITDA del modelo original']]) { const t = tri(row('Canales', l)); if (t) orig[k] = Object.fromEntries(SC.map(c => [c, R2(t[c])])) }
      if (Object.keys(orig).length === 5) out.orig = orig;
    }
  } catch (e) { /* hojas opcionales */ }
  return out;
}
function financeFromXlsx(buf, meta) {
  const W = readXlsx(buf), sh = n => { if (!W[n]) bad(`Al modelo le falta la hoja «${n}».`); return W[n] };
  const find = (n, label) => { const r = sh(n).find(r => r[0] === label); if (!r) bad(`No encontré «${label}» en la hoja «${n}».`); return r.slice(1) };
  const SC = ['basico', 'medio', 'full'], tri = v => Object.fromEntries(SC.map((k, i) => [k, R2(v[i])]));
  const y1 = {};
  for (const [k, l] of [['load', 'Ocupación de economía, ruta regular'], ['rev_regular', 'Ingresos ruta regular Miami–Armenia'], ['rev_season', 'Ingresos vuelos de temporada'], ['revenue', 'Ingreso total'], ['charter_regular', 'Costo del chárter, ruta regular'], ['charter_season', 'Costo del chárter, temporada'], ['own', 'Gastos propios y equipo base'], ['gateway_season', 'Pasarela de pagos, temporada'], ['marketing', 'Marketing compartido'], ['cost', 'Costo total'], ['ebitda', 'EBITDA'], ['margin', 'Margen EBITDA'], ['pax', 'Pasajeros transportados (aprox.)'], ['ops', 'Operaciones totales'], ['rev_per_op', 'Ingreso por operación'], ['charter_per_op', 'Costo del chárter promedio por operación']]) y1[k] = tri(find('Año 1', l));
  for (const [k, l] of [['tickets_regular', 'Ingreso por tiquetes, ruta regular'], ['nontariff_regular', 'Ingreso no tarifario, ruta regular'], ['ads_regular', 'Publicidad no intrusiva, ruta regular'], ['tickets_season', 'Ingreso por tiquetes, temporada'], ['compl_season', 'Ingreso complementario, temporada']]) y1[k] = tri(find('Supuestos', l));
  const opex = sh('Costos').filter(r => typeof r[1] === 'number' && r[0] !== 'Costo total' && !String(r[0]).startsWith('Verificación')).map(r => ({ name: r[0], usd: R2(r[1]), share: R2(r[2]), note: typeof r[3] === 'string' ? r[3] : '' }));
  const MES = { Ene: '01', Feb: '02', Mar: '03', Abr: '04', May: '05', Jun: '06', Jul: '07', Ago: '08', Sep: '09', Oct: '10', Nov: '11', Dic: '12' };
  const months = sh('Flujo de caja').filter(r => typeof r[0] === 'string' && /^(Ene|Feb|Mar|Abr|May|Jun|Jul|Ago|Sep|Oct|Nov|Dic)-\d\d$/.test(r[0]) && r.length >= 11)
    .map(r => Object.fromEntries(['month', 'ops_regular', 'ops_season', 'revenue', 'collections', 'retention', 'release', 'charter', 'other', 'net', 'cum', 'blocks'].map((k, i) => [k, R2(r[i])])));
  const sens = sh('Sensibilidad').filter(r => typeof r[0] === 'string' && r.length > 12 && typeof r[1] === 'number').map(r => ({ name: r[0], load: r[1], revenue: R2(r[r.length - 4]), cost: R2(r[r.length - 3]), ebitda: R2(r[r.length - 2]), margin: R2(r[r.length - 1]) }));
  const E = l => find('Expansión', l);
  const yrs = E('Año calendario'), expansion = yrs.map((y, i) => ({ year: y, aircraft: E('Aviones en la flota')[i], ops: E('Operaciones')[i], revenue: R2(E('Ingreso total')[i]), charter: R2(E('Costo del chárter')[i]), variable: R2(E('Gastos variables')[i]), marketing: R2(E('Marketing')[i]), structure: R2(E('Estructura corporativa')[i]), ebitda: R2(E('EBITDA')[i]), margin: R2(E('Margen EBITDA')[i]), pax: R2(E('Pasajeros (aprox.)')[i]) }));
  const imp = {}; for (const [k, l] of [['visitors', 'Visitantes a la región'], ['spend', 'Gasto en la región (US$)'], ['jobs', 'Empleos apoyados'], ['social', 'Beneficiarios de cupos sociales'], ['aid_t', 'Ayuda humanitaria (toneladas)'], ['inkind', 'Aporte en especie de Beemo Air (US$)']]) { const v = find('Impacto', l); imp[k] = { basico: R2(v[0]), medio: R2(v[1]), full: R2(v[2]), y5: R2(v[3]) } }
  const need = find('Flujo de caja', 'Necesidad máxima de caja')[0];
  const cf = sh('Flujo de caja'), adv = cf.find(r => r.includes('Anticipo inicial (8 ops)')), gua = cf.find(r => r.includes('Garantía del contrato'));
  return { source: meta.name, updated: meta.updated, period: 'Año 1: diciembre 2026 – noviembre 2027', scenarios: { basico: 'Básico', medio: 'Medio', full: 'Full' },
    year1: y1, opex, opex_total: R2(find('Costos', 'Costo total')[0]),
    capex: { total: 0, note: 'Operación chárter: aeronave, tripulación, combustible, mantenimiento, catering y seguros van dentro del precio por operación. El modelo no incluye inversiones de capital.' },
    cash: { need: R2(need), presale_share: 0.4, advance: adv ? adv[adv.indexOf('Anticipo inicial (8 ops)') + 1] : 0, guarantee: gua ? gua[gua.indexOf('Garantía del contrato') + 1] : 0, retention: 0.1, months },
    sensitivity: sens, expansion, impact: imp, base: channelsBaseFromXlsx(W),
    targets: { ops: y1.ops.medio, load: y1.load.medio, load_min: y1.load.basico, pax: y1.pax.medio, revenue: y1.revenue.medio, ebitda: y1.ebitda.medio,
      nontariff: R2((y1.nontariff_regular.medio + y1.ads_regular.medio + y1.compl_season.medio) / y1.revenue.medio), social: imp.social.medio, aid_t: imp.aid_t.medio } };
}
// prioridad: el Excel subido desde el portal; si no hay, el modelo incluido en el código (api/finance.json)
let FIN_FILE = null; try { FIN_FILE = JSON.parse(fs.readFileSync(new URL('./finance.json', import.meta.url), 'utf8')) } catch (e) {}
const getFin = () => { const r = q1("SELECT value FROM settings WHERE key='finance'"); try { return r ? JSON.parse(r.value) : FIN_FILE } catch (e) { return FIN_FILE } };
function applyFin(f) { if (!f) return; const m = {};
  for (const x of f.cash.months) { const [mm, yy] = x.month.split('-'); const k = { Ene: '01', Feb: '02', Mar: '03', Abr: '04', May: '05', Jun: '06', Jul: '07', Ago: '08', Sep: '09', Oct: '10', Nov: '11', Dic: '12' }[mm]; if (x.revenue) m[`20${yy}-${k}`] = x.revenue }
  Object.assign(PLAN, { revenue: f.year1.revenue.medio, ebitda: f.year1.ebitda.medio, margin: f.year1.margin.medio, ops: f.year1.ops.medio, pax: f.year1.pax.medio, load: f.year1.load.medio, load_min: f.year1.load.basico,
    rev_per_op: Math.round(f.year1.rev_per_op.medio), nontariff_share: f.targets.nontariff, cash_need: f.cash.need, ...(Object.keys(m).length ? { monthly: m } : {}) });
}
// lo que pasó de verdad, para comparar con las metas del Fondo
function fundActuals() {
  const nowMs = Date.now(), flown = [];
  for (const route of Object.keys(SCHED)) for (const date of allDates(route)) if (depTime(route, date) < nowMs) flown.push(route + '|' + date);
  const fset = new Set(flown);
  let ecoSold = 0, ecoOffered = 0, pax = 0, revFlown = 0, nonFare = 0, fare = 0;
  for (const f of flown) { const [route, date] = f.split('|'); if (SCHED[route].dates) continue; ecoOffered += ECO;
    ecoSold += q("SELECT COUNT(*) n FROM seat_inv i JOIN bookings b ON b.id=i.booking_id WHERE i.flight=? AND b.status='confirmed' AND CAST(i.seat AS INTEGER)>3", f)[0].n }
  for (const b of q("SELECT * FROM bookings WHERE status='confirmed'")) { const d = JSON.parse(b.data), legs = d.legs.filter(l => fset.has(l.route + '|' + l.date)); if (!legs.length) continue;
    const share = legs.length / d.legs.length; pax += d.pax.length * legs.length; revFlown += b.total * share;
    const bd = d.breakdown || {}; const f0 = (bd.fares || 0) + (bd.taxes || 0); fare += f0 * share; nonFare += Math.max(0, b.total - f0) * share }
  const opsDone = new Set(flown.filter(f => !SCHED[f.split('|')[0]].dates).map(f => f.split('|')[1])).size + flown.filter(f => SCHED[f.split('|')[0]].dates && f.startsWith('MIA')).length;
  const im = q("SELECT COALESCE(SUM(social),0) s, COALESCE(SUM(aid_kg),0) k, COUNT(*) n FROM impact_log")[0];
  const charter = opsDone * PLAN.charter_per_op, varCost = revFlown * 0.032;
  return { ops: opsDone, load: ecoOffered ? ecoSold / ecoOffered : null, pax, revenue: r2(revFlown), ebitda_est: r2(revFlown - charter - varCost), nontariff: revFlown ? nonFare / revFlown : null,
    social: im.s, aid_t: r2(im.k / 1000), impact_flights: im.n, providers: Number(q1("SELECT value FROM settings WHERE key='providers'")?.value || 0) };
}
on('GET', '/api/admin/finance', ({ req }) => {
  need(req, 'admin'); const F = getFin(); if (!F) return { missing: true };
  let emitted = 0; for (const b of q("SELECT total FROM bookings WHERE status='confirmed'")) emitted += b.total;
  return { ...F, actual: { emitted: r2(emitted) }, fund: fundActuals(), impact: F.impact, impact_log: q('SELECT * FROM impact_log ORDER BY flight DESC LIMIT 100') };
});
on('POST', '/api/admin/impact', ({ req, body }) => {
  const a = need(req, 'admin'); const f = String(body.flight || ''); const [route, date] = f.split('|');
  if (!scheduled(route, date)) bad('Ese vuelo no está en la programación.');
  const social = Math.max(0, Math.min(150, Math.round(Number(body.social) || 0))), kg = Math.max(0, Math.min(20000, Math.round(Number(body.aid_kg) || 0)));
  run('INSERT INTO impact_log(flight,social,aid_kg,notes,updated) VALUES(?,?,?,?,?) ON CONFLICT(flight) DO UPDATE SET social=excluded.social, aid_kg=excluded.aid_kg, notes=excluded.notes, updated=excluded.updated', f, social, kg, clean(body.notes, 200), now());
  log(a.user.email, `impact ${f} ${social} cupos ${kg} kg`); return { ok: true };
});
on('PUT', '/api/admin/providers', ({ req, body }) => {
  const a = need(req, 'admin'); const n = Math.max(0, Math.min(100000, Math.round(Number(body.n) || 0)));
  run("INSERT INTO settings(key,value) VALUES('providers',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", String(n)); log(a.user.email, `providers ${n}`); return { ok: true };
});
/* documentos del Fondo: se guardan en el volumen del servidor y solo los descarga un administrador */
const DOCS_DIR = path.join(path.dirname(DB_PATH), 'docs'); try { fs.mkdirSync(DOCS_DIR, { recursive: true }) } catch (e) {}
const DOC_TYPES = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', mp4: 'video/mp4', pdf: 'application/pdf', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' };
on('GET', '/api/admin/docs', ({ req, url }) => { need(req, 'admin'); return q('SELECT id,name,kind,size,uploaded,by,is_model,audience FROM docs WHERE audience=? ORDER BY id DESC', url.searchParams.get('audience') === 'agencias' ? 'agencias' : 'admin') });
/* ============ agencias: plan de incentivos, documentos, avisos y material ============ */
// la agencia consigna por semana: una sola acción marca como consignados todos los cobros en efectivo de esa semana de venta
on('POST', '/api/admin/agencies/:id/settle-week', ({ req, params, body }) => {
  const a = need(req, 'admin'), ag = q1('SELECT * FROM agencies WHERE id=?', +params.id); if (!ag) throw new HttpErr(404, 'Agencia no encontrada.');
  const wk = String(body.week || ''); if (!/^\d{4}-\d\d-\d\d$/.test(wk)) bad('Semana no válida.');
  const inWeek = created => { const d = new Date(nyDay(created) + 'T12:00:00Z'), st = new Date(d); st.setUTCDate(d.getUTCDate() - (d.getUTCDay() + 6) % 7); return iso(st) === wk };
  const bks = q("SELECT id,pnr,total,created FROM bookings WHERE agency_id=? AND status='confirmed' AND pay_method='cash' AND settled=0", ag.id).filter(b => inWeek(b.created));
  const chs = q("SELECT c.id,c.amount,c.created FROM changes c JOIN bookings b ON b.id=c.booking_id WHERE b.agency_id=? AND c.pay='cash' AND c.status='paid' AND c.settled=0", ag.id).filter(c => inWeek(c.created));
  if (!bks.length && !chs.length) bad('Esa semana ya no tiene valores por consignar.');
  const amount = r2(bks.reduce((t, b) => t + b.total, 0) + chs.reduce((t, c) => t + c.amount, 0)), ts = now();
  tx(() => { for (const b of bks) run('UPDATE bookings SET settled=1, paid=total, updated=? WHERE id=?', ts, b.id); for (const c of chs) run('UPDATE changes SET settled=1 WHERE id=?', c.id) });
  log(a.user.email, `settled week ${wk} agency ${ag.id}: ${bks.length + chs.length} items ${amount}`);
  return { ok: true, bookings: bks.length, changes: chs.length, amount };
});
on('GET', '/api/admin/agency-plan', ({ req }) => { need(req, 'admin'); return getAgPlan() });
on('PUT', '/api/admin/agency-plan', ({ req, body }) => {
  const a = need(req, 'admin'); const t = Array.isArray(body.tiers) ? body.tiers.slice(0, 8) : [];
  const tiers = t.map((x, i) => { const min = Math.round(Number(x.min)), inc = Number(x.incentive), name = clean(x.name, 30) || `Nivel ${i + 1}`;
    if (!(min >= 1 && min <= 100000)) bad(`Los trayectos del nivel ${name} deben ser 1 o más.`); if (!(inc >= 0 && inc <= 20)) bad(`El incentivo del nivel ${name} debe estar entre 0 y 20 %.`); return { name, min, incentive: inc } }).sort((x, y) => x.min - y.min);
  for (let i = 1; i < tiers.length; i++) if (tiers[i].min === tiers[i - 1].min) bad('Dos niveles no pueden pedir los mismos trayectos.');
  run("INSERT INTO settings(key,value) VALUES('agency_plan',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", JSON.stringify({ tiers })); log(a.user.email, 'agency plan updated'); return { tiers };
});
on('GET', '/api/agency/plan', ({ req }) => {
  const a = need(req, 'agent'); const segs = agencyMonthSegs(a.agency.id), { cur, next } = tierFor(segs);
  return { tiers: getAgPlan().tiers, segs, commission: a.agency.commission, base_incentive: a.agency.incentive || 0, incentive: effIncentive(a.agency), current: cur, next: next ? { ...next, missing: next.min - segs } : null };
});
// Inicio de la agencia: filas compactas de todas sus reservas para calcular cualquier periodo en el navegador, más lo que hay por cobrar y la meta del mes
on('GET', '/api/agency/dashboard', ({ req }) => {
  const a = need(req, 'agent');
  const names = new Map(q('SELECT id, name, email FROM users WHERE agency_id=?', a.agency.id).map(u => [u.id, String(u.name || u.email || '').trim()]));
  const rows = q('SELECT pnr, status, pay_method, total, commission, user_id, data, expires, created FROM bookings WHERE agency_id=? ORDER BY id', a.agency.id).map(b => {
    const d = JSON.parse(b.data);
    return { pnr: b.pnr, st: b.status, day: nyDay(b.created), pay: b.pay_method, total: b.total, com: b.commission, pax: d.pax.length,
      legs: d.legs.map(l => ({ r: l.route, d: l.date, f: l.fare, no: l.no, dep: l.dep })), by: b.user_id ? names.get(b.user_id) || 'Beemo Air' : '',
      exp: b.status === 'pending' && b.expires ? new Date(b.expires).toISOString() : null };
  });
  const chg = q("SELECT c.amount FROM changes c JOIN bookings b ON b.id=c.booking_id WHERE b.agency_id=? AND c.status='pending'", a.agency.id);
  return { rows, changes_pending: { n: chg.length, amount: r2(chg.reduce((t, c) => t + c.amount, 0)) }, goal: q1('SELECT goal FROM agencies WHERE id=?', a.agency.id)?.goal || 0, sellers: names.size };
});
// meta de ventas mensual que la propia agencia se pone (la comparten todos sus usuarios)
on('PUT', '/api/agency/goal', ({ req, body }) => {
  const a = need(req, 'agent'); const g = Math.round(Number(body.goal));
  if (!(g >= 0 && g <= 10000000)) bad('Escribe una meta entre US$0 y US$10.000.000.');
  run('UPDATE agencies SET goal=? WHERE id=?', g, a.agency.id); log(a.user.email, `agency ${a.agency.id} goal ${g}`); return { goal: g };
});
// documentos de viaje revisados por la agencia, por pasajero
on('POST', '/api/agency/docs', ({ req, body }) => {
  const a = need(req, 'agent'); const b = q1('SELECT id, data FROM bookings WHERE pnr=? AND agency_id=?', String(body.pnr || ''), a.agency.id); if (!b) throw new HttpErr(404, 'Reserva no encontrada.');
  const pax = Math.round(Number(body.pax)); if (!(pax >= 0 && pax < JSON.parse(b.data).pax.length)) bad('Pasajero no válido.');
  const field = String(body.field || ''); if (!['passport', 'visa', 'checkmig'].includes(field)) bad('Documento no válido.');
  run(`INSERT INTO pax_docs(booking_id,pax,${field},updated,by) VALUES(?,?,?,?,?) ON CONFLICT(booking_id,pax) DO UPDATE SET ${field}=excluded.${field}, updated=excluded.updated, by=excluded.by`, b.id, pax, body.value ? 1 : 0, now(), a.user.email);
  return { ok: true };
});
// avisos de la aerolínea
on('GET', '/api/admin/notices', ({ req }) => { need(req, 'admin'); return q('SELECT * FROM notices ORDER BY id DESC LIMIT 100') });
on('POST', '/api/admin/notices', ({ req, body }) => {
  const a = need(req, 'admin'); const msg = clean(body.message, 400); if (!msg) bad('Escribe el aviso.');
  const kind = ['horario', 'puerta', 'operacion', 'general'].includes(body.kind) ? body.kind : 'general';
  let flight = null; if (body.flight) { const [route, date] = String(body.flight).split('|'); if (!scheduled(route, date)) bad('Ese vuelo no está en la programación.'); flight = route + '|' + date }
  const r = run('INSERT INTO notices(flight,kind,message,active,created,by) VALUES(?,?,?,1,?,?)', flight, kind, msg, now(), a.user.email); log(a.user.email, `notice ${kind} ${flight || 'general'}`); return { id: Number(r.lastInsertRowid) };
});
on('PATCH', '/api/admin/notices/:id', ({ req, params, body }) => { const a = need(req, 'admin'); run('UPDATE notices SET active=? WHERE id=?', body.active ? 1 : 0, +params.id); return { ok: true } });
on('GET', '/api/agency/notices', ({ req }) => {
  const a = need(req, 'agent'); const mine = new Set(q("SELECT DISTINCT i.flight FROM seat_inv i JOIN bookings b ON b.id=i.booking_id WHERE b.agency_id=? AND b.status IN ('confirmed','pending')", a.agency.id).map(r => r.flight));
  const today = todayISO();
  return q('SELECT id,flight,kind,message,created FROM notices WHERE active=1 ORDER BY id DESC LIMIT 50').filter(n => !n.flight || n.flight.split('|')[1] >= today).map(n => ({ ...n, mine: !!(n.flight && mine.has(n.flight)) }));
});
// material de venta subido por el administrador
on('GET', '/api/agency/materials', ({ req }) => { need(req, 'agent'); return q("SELECT id,name,kind,size,uploaded FROM docs WHERE audience='agencias' ORDER BY id DESC") });

on('DELETE', '/api/admin/docs/:id', ({ req, params }) => {
  const a = need(req, 'admin'), d = q1('SELECT * FROM docs WHERE id=?', +params.id); if (!d) throw new HttpErr(404, 'Documento no encontrado.');
  try { fs.unlinkSync(path.join(DOCS_DIR, d.file)) } catch (e) {} run('DELETE FROM docs WHERE id=?', d.id); log(a.user.email, `doc deleted ${d.name}`); return { ok: true };
});
async function uploadDoc(req, res, url, send) {
  const a = need(req, 'admin'); const name = clean(decodeURIComponent(req.headers['x-file-name'] || ''), 160).replace(/[\\/]/g, '-'); const ext = (name.split('.').pop() || '').toLowerCase();
  if (!name || !DOC_TYPES[ext]) bad('Sube un archivo PDF, Excel, Word, PowerPoint, imagen (PNG, JPG, WebP) o video MP4.');
  const audience = url.searchParams.get('audience') === 'agencias' ? 'agencias' : 'admin';
  const parts = []; let size = 0; for await (const c of req) { size += c.length; if (size > 60e6) throw new HttpErr(413, 'El archivo pesa más de 60 MB.'); parts.push(c) }
  const buf = Buffer.concat(parts); if (!buf.length) bad('El archivo está vacío.');
  let isModel = 0, fin = null;
  if (ext === 'xlsx' && url.searchParams.get('model') === '1') { fin = financeFromXlsx(buf, { name, updated: todayISO() }); isModel = 1 }
  const file = crypto.randomBytes(12).toString('hex') + '.' + ext; fs.writeFileSync(path.join(DOCS_DIR, file), buf);
  const r = run('INSERT INTO docs(name,kind,file,size,uploaded,by,is_model,audience) VALUES(?,?,?,?,?,?,?,?)', name, ext, file, buf.length, now(), a.user.email, isModel, audience);
  if (fin) { run('UPDATE docs SET is_model=0 WHERE id<>?', Number(r.lastInsertRowid)); run("INSERT INTO settings(key,value) VALUES('finance',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", JSON.stringify(fin)); applyFin(fin) }
  log(a.user.email, `doc ${name}${fin ? ' (modelo financiero)' : ''}`); send(200, { id: Number(r.lastInsertRowid), model: !!fin });
}
const url_inline = d => ['png', 'jpg', 'jpeg', 'webp'].includes(d.kind);
function downloadDoc(req, res, id) {
  const who = need(req); if (who.user.role !== 'admin' && !(who.user.role === 'agent')) throw new HttpErr(403, 'Sin acceso.');
  const d = q1('SELECT * FROM docs WHERE id=?', +id); if (d && who.user.role === 'agent' && d.audience !== 'agencias') throw new HttpErr(404, 'Documento no encontrado.'); if (!d) throw new HttpErr(404, 'Documento no encontrado.');
  const buf = fs.readFileSync(path.join(DOCS_DIR, d.file));
  res.writeHead(200, { 'Content-Type': DOC_TYPES[d.kind] || 'application/octet-stream', 'Content-Length': buf.length, 'Cache-Control': 'no-store', 'Content-Disposition': `${url_inline(d) ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(d.name)}`, ...SEC }); res.end(buf);
}
const ECO = 138;
applyFin(getFin());
on('GET', '/api/admin/dashboard', ({ req, url }) => {
  need(req, 'admin');
  const nowMs = Date.now(), today = todayISO(), chF = url.searchParams.get('channel') || '', scope = url.searchParams.get('scope') || '';
  const inScope = route => !scope || (scope === 'seasonal' ? !!SCHED[route]?.dates : !SCHED[route]?.dates);
  const chOk = b => !chF || (chF === 'web' ? !b.agency_id : b.agency_id === +chF);
  const books = q("SELECT * FROM bookings WHERE status IN ('confirmed','pending')").filter(chOk).filter(b => JSON.parse(b.data).legs.some(l => inScope(l.route)));
  const names = Object.fromEntries(q('SELECT id,name FROM agencies').map(a => [a.id, a.name]));
  const byMonth = {}, legStats = {}, mix = { fares: 0, seats: 0, extras: 0, infants: 0, addons: 0 }, channels = {};
  let emitted = 0, pending = 0, paxLegs = 0, commission = 0, cashDue = 0;
  for (const b of books) {
    const d = JSON.parse(b.data), bd = d.breakdown || {}, conf = b.status === 'confirmed';
    const fares = d.legs.reduce((t, l) => t + priceOf(l.date, l.fare) * d.pax.length, 0) || 1;
    if (conf) { emitted += b.total; paxLegs += d.pax.length * d.legs.length; commission += b.commission; if (b.pay_method === 'cash' && !b.settled) cashDue += b.total;
      mix.fares += (bd.fares || 0) - (bd.pass || 0); mix.seats += bd.seats || 0; mix.extras += bd.extras || 0; mix.infants += bd.infants || 0;
      const ch = chName(names, b); channels[ch] = (channels[ch] || 0) + b.total }
    else pending += b.total;
    for (const l of d.legs) {
      const share = b.total * (priceOf(l.date, l.fare) * d.pax.length / fares), m = l.date.slice(0, 7);
      byMonth[m] = byMonth[m] || { emitted: 0, pending: 0 }; byMonth[m][conf ? 'emitted' : 'pending'] += share;
      const k = l.route + '|' + l.date; legStats[k] = legStats[k] || { sold: 0, held: 0, eco: 0, rev: 0, revp: 0 };
      legStats[k][conf ? 'sold' : 'held'] += d.pax.length; if (l.fare !== 'bc') legStats[k].eco += d.pax.length; legStats[k][conf ? 'rev' : 'revp'] += share;
    }
  }
  const paidAdds = q("SELECT a.qty*a.unit v, b.agency_id FROM addons a JOIN bookings b ON b.id=a.booking_id WHERE a.status='paid'").filter(chOk).reduce((t, r) => t + r.v, 0);
  mix.addons = paidAdds; emitted += paidAdds;
  const passes = q("SELECT * FROM passes WHERE status='paid'"), passRev = passes.reduce((t, p) => t + p.price, 0), passLeft = passes.reduce((t, p) => t + p.left_n, 0);
  // operations: an outbound day + its return (same day for the regular route; Carnaval pairs 6 and 10 Feb)
  const ops = [];
  for (const date of allDates('MIA-AXM')) ops.push({ date, legs: ['MIA-AXM|' + date, 'AXM-MIA|' + date], label: 'MIA ⇄ AXM', cost: PLAN.charter_per_op, dep: depTime('MIA-AXM', date) });
  ops.push({ date: '2027-02-06', legs: ['MIA-BAQ|2027-02-06', 'BAQ-MIA|2027-02-10'], label: 'Carnaval MIA ⇄ BAQ', cost: 80000, dep: depTime('MIA-BAQ', '2027-02-06') });
  ops.sort((a, b) => a.date.localeCompare(b.date));
  const opsF = ops.filter(o => inScope(o.legs[0].split('|')[0]));
  // the pre-launch dates before SALES_FROM have no flights; opDates already starts at SALES_FROM
  const opView = o => { const st = o.legs.map(k => legStats[k] || { sold: 0, held: 0, eco: 0, rev: 0, revp: 0 });
    const sold = st.reduce((t, x) => t + x.sold, 0), held = st.reduce((t, x) => t + x.held, 0), rev = st.reduce((t, x) => t + x.rev, 0), revp = st.reduce((t, x) => t + x.revp, 0);
    const load = st.reduce((t, x) => t + x.sold, 0) / (150 * o.legs.length);
    return { date: o.date, label: o.label, sold, held, load: r2(load), load_held: r2((sold + held) / (150 * o.legs.length)), revenue: r2(rev), revenue_pending: r2(revp), cost: o.cost, coverage: r2(rev / o.cost), result: r2(rev - o.cost),
      seats_to_breakeven: Math.max(0, Math.ceil((o.cost - rev) / PLAN.avg_fare)), flown: o.dep < nowMs } };
  const all = opsF.map(opView), flown = all.filter(o => o.flown), upcoming = all.filter(o => !o.flown);
  const next30 = upcoming.filter(o => o.date <= iso(new Date(nowMs + 30 * 86400e3)));
  const avg = (a, k) => a.length ? r2(a.reduce((t, x) => t + x[k], 0) / a.length) : 0;
  // daily sales, last 30 days (by booking creation)
  const daily = []; for (let i = 59; i >= 0; i--) { const dd = iso(new Date(nowMs - i * 86400e3)); daily.push({ date: dd, revenue: 0, bookings: 0 }) }
  for (const b of books) { const x = daily.find(d => d.date === b.created.slice(0, 10)); if (x) { x.revenue += b.total; x.bookings++ } }
  const prev7 = daily.slice(-14, -7).reduce((t, d) => t + d.revenue, 0);
  const seasons = [];
  for (const [route, sc] of Object.entries(SCHED)) if (sc.dates) for (const date of sc.dates) { const st = legStats[route + '|' + date] || { sold: 0 }; seasons.push({ route, date, sold: st.sold, deadline: iso(new Date(depTime(route, date) - 45 * 86400e3)) }) }
  const allOps = ops.map(opView), firstOp = allOps[0], fourth = allOps[3];
  const nontariff = emitted ? r2((mix.seats + mix.extras + mix.infants + mix.addons) / emitted) : 0;
  const milestones = [
    { date: '2026-11-30', title: 'Cierre de la edición 1 de la revista', kind: 'manual', detail: 'Pauta vendida y archivo a imprenta antes del vuelo inaugural.' },
    { date: firstOp.date, title: 'Vuelo inaugural Miami–Armenia', kind: 'metric', value: firstOp.load, target: PLAN.load_min, detail: `${firstOp.sold} pasajeros emitidos · ${Math.round(firstOp.coverage * 100)} % del costo del chárter cubierto` },
    ...seasons.filter((x, i, a) => a.findIndex(y => y.deadline === x.deadline) === i).map(x => ({ date: x.deadline, title: `Plazo de 90 sillas · ${x.route.replace('-', '→')} Carnaval`, kind: 'metric', value: x.sold / 90, target: 1, detail: `${x.sold} de 90 sillas emitidas` })),
    { date: fourth.date, title: 'Revisar el modelo con las 4 primeras operaciones', kind: 'progress', value: Math.min(1, flown.length / 4), target: 1, detail: `${Math.min(4, flown.length)} de 4 operaciones realizadas` },
    { date: '2027-03-02', title: 'Fin de la fase 1 del contrato chárter', kind: 'manual', detail: 'Decidir la renovación trimestral con el operador al mismo precio por operación.' },
    { date: null, title: 'Pasarela de pagos Stripe activa', kind: 'flag', value: STRIPE_KEY ? 1 : 0, target: 1, detail: STRIPE_KEY ? 'Cobro con tarjeta automático.' : 'Las reservas con tarjeta se confirman a mano.' },
    { date: null, title: 'Punto de equilibrio acumulado', kind: 'flag', value: flown.length && flown.reduce((t, o) => t + o.result, 0) >= 0 ? 1 : 0, target: 1, detail: flown.length ? `Resultado de los vuelos realizados: US$${Math.round(flown.reduce((t, o) => t + o.result, 0)).toLocaleString('en-US')}` : 'Se mide desde el primer vuelo.' },
  ].sort((a, b) => (a.date || '9999').localeCompare(b.date || '9999'));
  const months = Object.keys(PLAN.monthly).map(m => ({ month: m, plan: PLAN.monthly[m], emitted: r2(byMonth[m]?.emitted || 0), pending: r2(byMonth[m]?.pending || 0) }));
  return {
    at: now(), stripe: !!STRIPE_KEY, plan: PLAN,
    kpis: { emitted: r2(emitted), pending: r2(pending), pax_legs: paxLegs, commission: r2(commission), cash_due: r2(cashDue), nontariff, pass_revenue: r2(passRev), pass_segments_left: passLeft, passes_sold: passes.length,
      load_next30: avg(next30, 'load'), load_next30_held: avg(next30, 'load_held'), ops_next30: next30.length, flown_ops: flown.length, flown_result: r2(flown.reduce((t, o) => t + o.result, 0)),
      committed_year1: r2(months.reduce((t, m) => t + m.emitted, 0)), bookings_7d: daily.slice(-7).reduce((t, d) => t + d.bookings, 0), revenue_7d: r2(daily.slice(-7).reduce((t, d) => t + d.revenue, 0)), revenue_prev7d: r2(prev7) },
    recent: q('SELECT * FROM bookings ORDER BY id DESC LIMIT 60').filter(chOk).filter(b => JSON.parse(b.data).legs.some(l => inScope(l.route))).slice(0, 8).map(b => { const d = JSON.parse(b.data);
      return { pnr: b.pnr, channel: chName(names, b), total: b.total, status: b.status, created: b.created, pax: d.pax.length, route: d.legs.map(l => l.route).join(' · '), date: d.legs[0].date, pay: b.pay_method } }),
    filtered: !!(chF || scope), months, upcoming: upcoming.slice(0, 16), daily: daily.slice(-30).map(d => ({ ...d, revenue: r2(d.revenue) })),
    channel_options: [{ id: 'web', name: 'beemoair.com' }, ...q('SELECT id,name FROM agencies WHERE active=1 ORDER BY name')], mix: Object.fromEntries(Object.entries(mix).map(([k, v]) => [k, r2(v)])),
    channels: Object.entries(channels).map(([name, v]) => ({ name, revenue: r2(v) })).sort((a, b) => b.revenue - a.revenue), milestones };
});

// seasonal flights: occupancy, sales by channel and the 90-seats-at-45-days go/no-go rule
const SEASON_MIN = 90, SEASON_DAYS = 45;
function flightStat(route, date, names) {
  const sc = SCHED[route], f = route + '|' + date, rows = q('SELECT i.pax, b.status, b.agency_id, b.channel, b.data FROM seat_inv i JOIN bookings b ON b.id=i.booking_id WHERE i.flight=?', f);
  let sold = 0, held = 0, revenue = 0, biz = 0; const ch = {};
  for (const r of rows) { const d = JSON.parse(r.data), l = d.legs.find(x => x.route + '|' + x.date === f); const k = chName(names, r);
    ch[k] = ch[k] || { sold: 0, held: 0 }; if (r.status === 'confirmed') { sold++; ch[k].sold++; revenue += priceOf(date, l.fare) } else { held++; ch[k].held++ }
    if (l.fare === 'bc') biz++ }
  const av = availability(route, date), dep = depTime(route, date);
  return { route, date, no: sc.no, ...flightTimes(route, date), sold, held, biz, free: av.eco + av.biz, biz_free: av.biz, revenue: r2(revenue),
    channels: Object.entries(ch).map(([name, v]) => ({ name, ...v })).sort((a, b) => b.sold - a.sold), dep_at: new Date(dep).toISOString(),
    days_to_flight: Math.ceil((dep - Date.now()) / 86400e3), hours_to_flight: Math.max(0, Math.round((dep - Date.now()) / 3600e3)) };
}
const agencyNames = () => Object.fromEntries(q('SELECT id,name FROM agencies').map(a => [a.id, a.name]));
on('GET', '/api/admin/seasons', ({ req }) => {
  need(req, 'admin'); const names = agencyNames(); const out = [];
  for (const [route, sc] of Object.entries(SCHED)) { if (!sc.dates) continue;
    for (const date of sc.dates) { const st = flightStat(route, date, names), deadline = new Date(depTime(route, date) - SEASON_DAYS * 86400e3);
      out.push({ ...st, min_seats: SEASON_MIN, deadline: iso(deadline), days_to_deadline: Math.ceil((deadline - Date.now()) / 86400e3) }) } }
  return out.sort((a, b) => a.date.localeCompare(b.date));
});
on('GET', '/api/admin/flight', ({ req, url }) => {
  need(req, 'admin'); const route = String(url.searchParams.get('route') || ''), date = String(url.searchParams.get('date') || '');
  if (!SCHED[route] || !(operates(route, date) || flightOp(route, date)?.status === 'cancelled')) bad('Vuelo no encontrado.');
  return flightStat(route, date, agencyNames());
});
// manifiesto completo de un vuelo: una fila por silla, con los datos de viaje y el localizador del operador
function manifestRows(f) {
  const names = agencyNames();
  return q('SELECT i.seat, i.pax, b.id bid, b.pnr, b.status, b.channel, b.agency_id, b.op_ref, b.data FROM seat_inv i JOIN bookings b ON b.id=i.booking_id WHERE i.flight=? ORDER BY CAST(i.seat AS INTEGER), i.seat', f)
    .map(r => { const d = JSON.parse(r.data), p = d.pax[r.pax], li = d.legs.findIndex(l => l.route + '|' + l.date === f), cp = q1('SELECT * FROM crm_pax WHERE booking_id=? AND pax=?', r.bid, r.pax), t = travelOf(cp);
      return { seat: r.seat, pnr: r.pnr, pax: r.pax, status: r.status, channel: chName(names, r), name: `${p.first} ${p.last}`, first: p.first, last: p.last, inf: !!p.inf, fare: FARE_NAME[d.legs[li]?.fare], fare_key: d.legs[li]?.fare, extras: d.legs[li]?.extras?.[r.pax] || {},
        email: t?.email || d.contact?.email || '', phone: t?.phone || d.contact?.phone || '', club: p.club || '', travel: t, travel_ok: travelDone(cp, p.inf), customer: cp?.customer_id ?? null, op_ref: r.op_ref || '' } });
}
on('GET', '/api/admin/manifest', ({ req, url }) => { need(req, 'admin'); return manifestRows(url.searchParams.get('route') + '|' + url.searchParams.get('date')) });
/* ---------- control del manifiesto: cierre de ventas, envíos al operador, novedades y conciliación ---------- */
const getOps = () => { const r = q1("SELECT value FROM settings WHERE key='ops'"); let o = {}; try { o = r ? JSON.parse(r.value) : {} } catch (e) {} return { close_hours: Number.isFinite(+o.close_hours) ? +o.close_hours : 3 } };
on('GET', '/api/admin/ops', ({ req }) => { need(req, 'admin'); return getOps() });
on('PUT', '/api/admin/ops', ({ req, body }) => { const a = need(req, 'admin'); const h = Number(body.close_hours); if (!Number.isFinite(h) || h < 0 || h > 720) bad('El cierre de ventas va entre 0 y 720 horas (30 días) antes de la salida.');
  run("INSERT INTO settings(key,value) VALUES('ops',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", JSON.stringify({ close_hours: h })); log(a.user.email, `cierre de ventas: ${h} h antes de la salida`); return getOps() });
// lo que identifica a un pasajero frente al operador: si algo de esto cambia después de un envío, es una novedad
const sendKey = r => r.pnr + '|' + r.pax;
const sendSig = r => { const t = r.travel || {}, i = t.infant || {}; return [normUser(r.last), normUser(r.first), r.seat, r.fare_key, Object.keys(r.extras).sort().join('+'), t.doc_type, t.doc_no, t.doc_country, t.doc_exp, t.nationality, t.dob, t.gender, (t.ssr || []).join('+'), r.inf ? [normUser(i.last), normUser(i.first), i.dob, i.doc_no].join('/') : ''].map(x => x || '').join('~') };
const liveRows = rows => rows.filter(r => r.status === 'confirmed');   // al operador solo van los tiquetes emitidos
function manifestControl(route, date) {
  const f = route + '|' + date, rows = manifestRows(f), live = liveRows(rows), dep = depTime(route, date), ops = getOps(), closes = dep - ops.close_hours * 3600e3;
  const sends = q('SELECT id, at, by, pax FROM manifest_sends WHERE flight=? ORDER BY id DESC LIMIT 20', f), last = q1('SELECT * FROM manifest_sends WHERE flight=? ORDER BY id DESC LIMIT 1', f);
  let delta = null;
  if (last) { const old = JSON.parse(last.rows), cur = Object.fromEntries(live.map(r => [sendKey(r), r])), added = [], changed = [], removed = [];
    for (const r of live) { const o = old[sendKey(r)]; if (!o) added.push(sendKey(r)); else if (o.sig !== sendSig(r)) changed.push(sendKey(r)) }
    for (const k in old) if (!cur[k]) removed.push({ key: k, ...old[k] });
    delta = { since: last.at, added, changed, removed } }
  const pnrs = [...new Set(live.map(r => r.pnr))], noRef = [...new Set(live.filter(r => !r.op_ref).map(r => r.pnr))];
  return { route, date, no: SCHED[route].no, dep_at: new Date(dep).toISOString(), close_hours: ops.close_hours, closes_at: new Date(closes).toISOString(), closed: Date.now() >= closes, flown: Date.now() >= dep, cancelled: flightOp(route, date)?.status === 'cancelled',
    counts: { issued: live.length, infants: live.filter(r => r.inf).length, held: rows.filter(r => r.status === 'pending').length, travel_ok: live.filter(r => r.travel_ok).length, bookings: pnrs.length, with_ref: pnrs.length - noRef.length },
    missing_ref: noRef, sends, delta, rows, caps: capsView(route, date) };
}
const flightParam = url => { const route = String(url.searchParams.get('route') || ''), date = String(url.searchParams.get('date') || ''); if (!scheduled(route, date)) bad('Vuelo no encontrado.'); return [route, date] };
on('GET', '/api/admin/manifest/control', ({ req, url }) => { need(req, 'admin'); return manifestControl(...flightParam(url)) });
// registrar que el manifiesto se entregó al operador: guarda la foto para poder sacar después solo las novedades
on('POST', '/api/admin/manifest/send', ({ req, url }) => { const a = need(req, 'admin'), [route, date] = flightParam(url), f = route + '|' + date, live = liveRows(manifestRows(f));
  if (!live.length) bad('Este vuelo aún no tiene tiquetes emitidos.');
  const snap = Object.fromEntries(live.map(r => [sendKey(r), { sig: sendSig(r), pnr: r.pnr, pax: r.pax, seat: r.seat, first: r.first, last: r.last, inf: r.inf, op_ref: r.op_ref, doc_no: r.travel?.doc_no || '' }]));
  run('INSERT INTO manifest_sends(flight,at,by,pax,rows) VALUES(?,?,?,?,?)', f, now(), a.user.email, live.length, JSON.stringify(snap)); log(a.user.email, `manifiesto ${route} ${date} entregado al operador: ${live.length} pasajeros`);
  return manifestControl(route, date) });
// localizadores del operador: uno por reserva, a mano o pegando la lista que devuelve su sistema
const opRef = v => String(v || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12);
on('PUT', '/api/admin/bookings/:pnr/op-ref', ({ req, params, body }) => { const a = need(req, 'admin'), b = q1('SELECT * FROM bookings WHERE pnr=?', String(params.pnr || '').toUpperCase()); if (!b) throw new HttpErr(404, 'Reserva no encontrada.');
  const ref = opRef(body.ref); if (ref && ref.length < 4) bad('El localizador tiene al menos 4 letras o números.');
  run('UPDATE bookings SET op_ref=? WHERE id=?', ref || null, b.id); log(a.user.email, `localizador del operador ${b.pnr}: ${ref || 'borrado'}`); return { pnr: b.pnr, op_ref: ref || null } });
on('POST', '/api/admin/manifest/refs', ({ req, body }) => { const a = need(req, 'admin'), done = [], unknown = [], invalid = [];
  for (const line of String(body.text || '').split(/\r?\n/).slice(0, 2000)) { const m = line.replace(/"/g, '').trim().split(/[\s,;\t]+/).filter(Boolean); if (m.length < 2) { if (m.length) invalid.push(line.trim().slice(0, 40)); continue }
    const pnr = m[0].toUpperCase(), ref = opRef(m[1]); if (/^(reserva|pnr|codigo|código)$/i.test(m[0])) continue;
    const b = q1('SELECT id FROM bookings WHERE pnr=?', pnr); if (!b) { unknown.push(pnr.slice(0, 12)); continue } if (ref.length < 4) { invalid.push(line.trim().slice(0, 40)); continue }
    run('UPDATE bookings SET op_ref=? WHERE id=?', ref, b.id); done.push(pnr) }
  if (!done.length && !unknown.length && !invalid.length) bad('Pega una reserva y su localizador por línea, por ejemplo: SK8328 XJ4K9P');
  log(a.user.email, `localizadores del operador cargados: ${done.length}`); return { saved: done.length, unknown, invalid } });
on('GET', '/api/admin/bookings', ({ req, url }) => {
  need(req, 'admin'); const sp = url.searchParams, st = sp.get('status'), flight = sp.get('flight'), ag = sp.get('agency'), term = norm(sp.get('q') || '');
  let rows = st ? q('SELECT * FROM bookings WHERE status=? ORDER BY id DESC LIMIT 5000', st) : q('SELECT * FROM bookings ORDER BY id DESC LIMIT 5000');
  if (ag === 'web') rows = rows.filter(b => !b.agency_id); else if (ag) rows = rows.filter(b => b.agency_id === +ag);
  if (flight || term) rows = rows.filter(b => { const d = JSON.parse(b.data);
    if (flight && !d.legs.some(l => l.route + '|' + l.date === flight)) return false;
    if (term && !(norm(b.pnr).includes(term) || norm(d.contact.email).includes(term) || d.pax.some(p => norm(p.first + ' ' + p.last).includes(term)))) return false;
    return true });
  const names = Object.fromEntries(q('SELECT id,name FROM agencies').map(a => [a.id, a.name]));
  const ambs = Object.fromEntries(q('SELECT id,name,code FROM ambassadors').map(a => [a.id, a]));
  const out = rows.slice(0, 500).map(b => ({ ...bookingView(b, { private: true }), agency: names[b.agency_id] || null, amb: b.amb_id && ambs[b.amb_id] ? { name: ambs[b.amb_id].name, code: ambs[b.amb_id].code, src: b.amb_src } : null }));
  const sum = k => r2(rows.reduce((t, b) => t + (k(b) || 0), 0));
  return { bookings: out, count: rows.length, totals: { pax: rows.reduce((t, b) => t + JSON.parse(b.data).pax.length, 0), confirmed: sum(b => b.status === 'confirmed' ? b.total : 0), pending: sum(b => b.status === 'pending' ? b.total : 0), cash_due: sum(b => b.status === 'confirmed' && b.pay_method === 'cash' && !b.settled ? b.total : 0) } };
});

/* ============ embajadores (influencers): atribución por código y red social, rangos y bono de referidos ============ */
const NETS = { instagram: 'Instagram', tiktok: 'TikTok', youtube: 'YouTube', facebook: 'Facebook', x: 'X', whatsapp: 'WhatsApp', otro: 'Otra', codigo: 'Código escrito' };
const PLAN_DEFAULT = { tiers: [{ name: 'Embajador', min: 0, rate: 3, bonus: 0 }, { name: 'Plata', min: 10, rate: 4, bonus: 0 }, { name: 'Oro', min: 25, rate: 5, bonus: 100 }, { name: 'Diamante', min: 50, rate: 6, bonus: 300 }],
  override: 1, override_min: 5, window_days: 30 };
const getPlan = () => { const r = q1("SELECT value FROM settings WHERE key='amb_plan'"); try { return r ? JSON.parse(r.value) : PLAN_DEFAULT } catch (e) { return PLAN_DEFAULT } };
const codeOk = c => /^[A-Z0-9]{3,16}$/.test(c);
function refOf(ref) {
  if (!ref || typeof ref !== 'object') return null; const code = String(ref.code || '').toUpperCase().trim(); if (!codeOk(code)) return null;
  const a = q1('SELECT id FROM ambassadors WHERE code=? AND active=1', code); if (!a) return null;
  let src = String(ref.src || '').toLowerCase().trim(); if (!NETS[src]) src = ref.src ? 'otro' : 'codigo';
  return { id: a.id, src };
}
const nyMonth = iso => new Date(iso).toLocaleDateString('en-CA', { timeZone: 'America/New_York' }).slice(0, 7);
const segsOf = b => { const d = JSON.parse(b.data); return d.pax.length * d.legs.length };
function rankFor(plan, segs) { let r = plan.tiers[0], i = 0; plan.tiers.forEach((t, k) => { if (segs >= t.min) { r = t; i = k } }); return { ...r, i, next: plan.tiers[i + 1] || null } }
function ambReport(month) {
  const plan = getPlan(), list = q('SELECT * FROM ambassadors ORDER BY name'), rows = q("SELECT * FROM bookings WHERE amb_id IS NOT NULL AND status='confirmed'");
  const st = {}; for (const a of list) st[a.id] = { month: { bookings: 0, segs: 0, sales: 0, net: 0, by: {} }, all: { bookings: 0, segs: 0, sales: 0, net: 0 }, pending: 0 };
  const nets = {}; const days = {};
  for (const b of rows) { const s = st[b.amb_id]; if (!s) continue; const n = segsOf(b);
    s.all.bookings++; s.all.segs += n; s.all.sales += b.total; s.all.net += b.fare_net;
    if (nyMonth(b.created) !== month) continue;
    s.month.bookings++; s.month.segs += n; s.month.sales += b.total; s.month.net += b.fare_net;
    const k = b.amb_src || 'codigo'; s.month.by[k] = s.month.by[k] || { bookings: 0, segs: 0, sales: 0 }; s.month.by[k].bookings++; s.month.by[k].segs += n; s.month.by[k].sales += b.total;
    nets[k] = nets[k] || { bookings: 0, segs: 0, sales: 0 }; nets[k].bookings++; nets[k].segs += n; nets[k].sales += b.total;
    const dk = new Date(b.created).toLocaleDateString('en-CA', { timeZone: 'America/New_York' }); days[dk] = (days[dk] || 0) + b.total }
  for (const b of q("SELECT amb_id FROM bookings WHERE amb_id IS NOT NULL AND status='pending'")) if (st[b.amb_id]) st[b.amb_id].pending++;
  const out = list.map(a => { const s = st[a.id], rank = rankFor(plan, s.month.segs);
    const commission = r2(s.month.net * rank.rate / 100), bonus = rank.bonus || 0;
    const refs = list.filter(x => x.sponsor_id === a.id);
    const refNet = refs.reduce((t, x) => t + st[x.id].month.net, 0), qualifies = s.month.segs >= plan.override_min;
    const override = qualifies ? r2(refNet * plan.override / 100) : 0;
    return { id: a.id, name: a.name, code: a.code, email: a.email, phone: a.phone, socials: JSON.parse(a.socials || '{}'), notes: a.notes, active: !!a.active, created: a.created,
      sponsor: a.sponsor_id ? (list.find(x => x.id === a.sponsor_id) || {}).name || null : null, sponsor_id: a.sponsor_id,
      referrals: refs.map(x => ({ id: x.id, name: x.name, code: x.code, segs: st[x.id].month.segs, net: r2(st[x.id].month.net) })),
      month: { ...s.month, sales: r2(s.month.sales), net: r2(s.month.net) }, all: { ...s.all, sales: r2(s.all.sales), net: r2(s.all.net) }, pending: s.pending,
      rank: { name: rank.name, rate: rank.rate, bonus, i: rank.i, next: rank.next ? { name: rank.next.name, min: rank.next.min, rate: rank.next.rate, missing: rank.next.min - s.month.segs } : null },
      pay: { commission, bonus, override, override_qualifies: qualifies, override_base: r2(refNet), total: r2(commission + bonus + override) } } });
  const tot = out.reduce((t, a) => ({ sales: t.sales + a.month.sales, segs: t.segs + a.month.segs, bookings: t.bookings + a.month.bookings, pay: t.pay + a.pay.total }), { sales: 0, segs: 0, bookings: 0, pay: 0 });
  const months = [...new Set(rows.map(b => nyMonth(b.created)).concat([nyMonth(new Date().toISOString())]))].sort().reverse();
  return { month, months, plan, nets: Object.entries(nets).map(([k, v]) => ({ key: k, label: NETS[k] || k, ...v, sales: r2(v.sales) })).sort((a, b) => b.sales - a.sales), net_labels: NETS,
    totals: { ...tot, sales: r2(tot.sales), pay: r2(tot.pay), active: list.filter(a => a.active).length }, days, list: out };
}
on('GET', '/api/ref/:code', ({ params, ip }) => {
  limit(ip, 'ref', 60, 3600e3); const code = String(params.code || '').toUpperCase(); if (!codeOk(code)) return { ok: false };
  const a = q1('SELECT name FROM ambassadors WHERE code=? AND active=1', code); return a ? { ok: true, code, name: a.name.split(' ')[0], window_days: getPlan().window_days } : { ok: false };
});
on('GET', '/api/admin/ambassadors', ({ req, url }) => {
  need(req, 'admin'); const m = String(url.searchParams.get('month') || ''); const r = ambReport(/^\d{4}-\d{2}$/.test(m) ? m : nyMonth(new Date().toISOString()));
  const acc = Object.fromEntries(q("SELECT amb_id, email, last_login, must_change FROM users WHERE role='ambassador' AND active=1").map(u => [u.amb_id, u]));
  r.list.forEach(x => { const u = acc[x.id]; x.access = u ? { email: u.email, last_login: u.last_login, pending: !!u.must_change } : null }); return r;
});
function ambFields(body, cur = {}) {
  const name = clean(body.name ?? cur.name, 80); if (!name) bad('Escribe el nombre del embajador.');
  const code = String(body.code ?? cur.code ?? '').toUpperCase().replace(/[^A-Z0-9]/g, ''); if (!codeOk(code)) bad('El código debe tener de 3 a 16 letras o números, sin espacios.');
  const dup = q1('SELECT id FROM ambassadors WHERE code=?', code); if (dup && dup.id !== cur.id) bad('Ese código ya lo tiene otro embajador.');
  const email = clean(body.email ?? cur.email, 120); if (email && !okEmail(email)) bad('Revisa el correo del embajador.');
  const soc = {}; const sIn = body.socials ?? JSON.parse(cur.socials || '{}'); for (const k of ['instagram', 'tiktok', 'youtube', 'facebook', 'x']) { const v = clean(sIn?.[k], 80); if (v) soc[k] = v }
  let sponsor = body.sponsor_id === undefined ? cur.sponsor_id ?? null : (body.sponsor_id ? +body.sponsor_id : null);
  if (sponsor && (sponsor === cur.id || !q1('SELECT id FROM ambassadors WHERE id=?', sponsor))) bad('El embajador que lo refirió no es válido.');
  if (sponsor && cur.id) { let p = sponsor, n = 0; while (p && n++ < 50) { if (p === cur.id) bad('Esa referencia crearía un círculo.'); p = q1('SELECT sponsor_id FROM ambassadors WHERE id=?', p)?.sponsor_id } }
  return { name, code, email, phone: clean(body.phone ?? cur.phone, 40), socials: JSON.stringify(soc), sponsor, notes: clean(body.notes ?? cur.notes, 300) };
}
on('POST', '/api/admin/ambassadors', ({ req, body }) => {
  const a = need(req, 'admin'), f = ambFields(body);
  const r = run('INSERT INTO ambassadors(name,code,email,phone,socials,sponsor_id,notes,active,created) VALUES(?,?,?,?,?,?,?,1,?)', f.name, f.code, f.email, f.phone, f.socials, f.sponsor, f.notes, now());
  log(a.user.email, `ambassador ${f.code} created`); return { id: Number(r.lastInsertRowid) };
});
on('PATCH', '/api/admin/ambassadors/:id', ({ req, body, params }) => {
  const a = need(req, 'admin'), cur = q1('SELECT * FROM ambassadors WHERE id=?', +params.id); if (!cur) throw new HttpErr(404, 'Embajador no encontrado.');
  const f = ambFields(body, cur), active = body.active == null ? cur.active : (body.active ? 1 : 0);
  run('UPDATE ambassadors SET name=?,code=?,email=?,phone=?,socials=?,sponsor_id=?,notes=?,active=? WHERE id=?', f.name, f.code, f.email, f.phone, f.socials, f.sponsor, f.notes, active, cur.id);
  log(a.user.email, `ambassador ${f.code} updated`); return { ok: true };
});
// acceso del embajador a su portal
on('POST', '/api/admin/ambassadors/:id/access', ({ req, params }) => {
  const a = need(req, 'admin'), am = q1('SELECT * FROM ambassadors WHERE id=?', +params.id); if (!am) throw new HttpErr(404, 'Embajador no encontrado.');
  const pw = tempPassword(), cur = q1("SELECT * FROM users WHERE role='ambassador' AND amb_id=?", am.id);
  if (cur) { run('UPDATE users SET pass=?, must_change=1, active=1 WHERE id=?', hashPw(pw), cur.id); run('DELETE FROM sessions WHERE user_id=?', cur.id) }
  else { const email = norm(am.email || ''); if (!okEmail(email)) bad('Primero agrega el correo del embajador (botón Editar).');
    const other = q1('SELECT role FROM users WHERE email=?', email); if (other) bad('Ese correo ya tiene acceso al portal como ' + (other.role === 'agent' ? 'agencia' : other.role === 'admin' ? 'administrador' : 'embajador') + '.');
    run('INSERT INTO users(email,name,role,pass,must_change,amb_id,created) VALUES(?,?,?,?,1,?,?)', email, am.name, 'ambassador', hashPw(pw), am.id, now()) }
  log(a.user.email, `ambassador ${am.code} portal access`); return { email: cur ? cur.email : norm(am.email), password: pw };
});
on('POST', '/api/admin/ambassadors/:id/view', ({ req, params }) => {
  const a = need(req, 'admin'), am = q1('SELECT * FROM ambassadors WHERE id=?', +params.id); if (!am) throw new HttpErr(404, 'Embajador no encontrado.');
  const t = crypto.randomBytes(32).toString('hex'); run('INSERT INTO sessions(token,user_id,expires,as_amb) VALUES(?,?,?,?)', sha(t), a.user.id, Date.now() + 4 * 3600e3, am.id);
  log(a.user.email, `view as ambassador ${am.code}`); return { token: t };
});
// portal del embajador: solo sus números y sus ventas, sin datos de los pasajeros
on('GET', '/api/amb/me', ({ req, url }) => {
  const a = need(req, 'ambassador'), m0 = String(url.searchParams.get('month') || ''), month = /^\d{4}-\d{2}$/.test(m0) ? m0 : nyMonth(new Date().toISOString());
  const rep = ambReport(month), me = rep.list.find(x => x.id === a.amb.id); if (!me) throw new HttpErr(404, 'Embajador no encontrado.');
  const mine = q("SELECT * FROM bookings WHERE amb_id=? AND status IN ('confirmed','pending') ORDER BY created DESC", a.amb.id);
  const months = [...new Set(mine.map(b => nyMonth(b.created)).concat([nyMonth(new Date().toISOString())]))].sort().reverse();
  const sales = mine.filter(b => nyMonth(b.created) === month).map(b => { const d = JSON.parse(b.data);
    return { at: b.created, status: b.status, src: rep.net_labels[b.amb_src || 'codigo'] || b.amb_src, legs: d.legs.map(l => ({ route: l.route, date: l.date })), pax: d.pax.length, segs: d.pax.length * d.legs.length, net: b.status === 'confirmed' ? b.fare_net : 0, earn: b.status === 'confirmed' ? r2(b.fare_net * me.rank.rate / 100) : 0 } });
  const days = {}; for (const b of mine) if (b.status === 'confirmed' && nyMonth(b.created) === month) { const dk = new Date(b.created).toLocaleDateString('en-CA', { timeZone: 'America/New_York' }); days[dk] = (days[dk] || 0) + segsOf(b) }
  const hist = months.slice(0, 6).reverse().map(mm => { const r2m = mm === month ? me : ambReport(mm).list.find(x => x.id === a.amb.id); return { month: mm, segs: r2m.month.segs, pay: r2m.pay.total } });
  const { notes, email, phone, ...pub } = me;
  return { month, months, me: pub, plan: { tiers: rep.plan.tiers, override: rep.plan.override, override_min: rep.plan.override_min, window_days: rep.plan.window_days }, net_labels: rep.net_labels, sales, days, hist, site: PUBLIC_URL };
});
on('PUT', '/api/admin/amb-plan', ({ req, body }) => {
  const a = need(req, 'admin'); const t = Array.isArray(body.tiers) ? body.tiers.slice(0, 8) : [];
  if (t.length < 1) bad('El plan necesita al menos un rango.');
  const tiers = t.map((x, i) => { const name = clean(x.name, 30); if (!name) bad(`Ponle nombre al rango ${i + 1}.`); const min = Math.round(Number(x.min)), rate = Number(x.rate), bonus = Number(x.bonus || 0);
    if (!(min >= 0 && min <= 100000)) bad(`Revisa los trayectos mínimos del rango ${name}.`); if (!(rate >= 0 && rate <= 30)) bad(`La comisión del rango ${name} debe estar entre 0 y 30 %.`); if (!(bonus >= 0 && bonus <= 100000)) bad(`Revisa el bono del rango ${name}.`);
    return { name, min, rate, bonus } }).sort((x, y) => x.min - y.min);
  tiers[0].min = 0; for (let i = 1; i < tiers.length; i++) if (tiers[i].min === tiers[i - 1].min) bad('Dos rangos no pueden pedir los mismos trayectos.');
  const ov = Number(body.override), ovm = Math.round(Number(body.override_min)), wd = Math.round(Number(body.window_days));
  if (!(ov >= 0 && ov <= 10)) bad('El bono de referidos debe estar entre 0 y 10 %.'); if (!(ovm >= 0 && ovm <= 1000)) bad('Revisa el mínimo de trayectos para cobrar el bono de referidos.'); if (!(wd >= 1 && wd <= 90)) bad('La vigencia del enlace debe estar entre 1 y 90 días.');
  const plan = { tiers, override: ov, override_min: ovm, window_days: wd };
  run("INSERT INTO settings(key,value) VALUES('amb_plan',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", JSON.stringify(plan));
  log(a.user.email, 'ambassador plan updated'); return plan;
});

/* ============ correo saliente (SMTP sin dependencias) ============ */
const SMTP = { host: process.env.SMTP_HOST || '', port: +(process.env.SMTP_PORT || 465), user: process.env.SMTP_USER || '', pass: process.env.SMTP_PASS || '',
  from: process.env.MAIL_FROM || process.env.SMTP_USER || '', name: process.env.MAIL_FROM_NAME || 'Beemo Air' };
const SUPPORT_EMAIL = process.env.SUPPORT_EMAIL || 'management@beemoair.com';
const mailReady = () => !!(SMTP.host && SMTP.user && SMTP.pass && SMTP.from);
const b64 = s => Buffer.from(s, 'utf8').toString('base64');
const encH = s => /^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${b64(s)}?=`;
const wrap76 = s => s.replace(/.{1,76}/g, m => m + '\r\n');
function smtpSend({ to, subject, text, html, replyTo }) {
  return new Promise((resolve, reject) => {
    let sock, buf = '', waiter = null, done = false;
    const fail = e => { if (done) return; done = true; try { sock && sock.destroy() } catch (x) {} reject(e instanceof Error ? e : new Error(String(e))) };
    const timer = setTimeout(() => fail(new Error('Tiempo de espera agotado con el servidor de correo.')), 30e3);
    const onData = d => { buf += d.toString('utf8'); const lines = buf.split('\r\n'); const last = lines[lines.length - 2];
      if (last && /^\d{3} /.test(last)) { const resp = buf; buf = ''; const w = waiter; waiter = null; w && w(resp) } };
    const read = () => new Promise(r => { waiter = r; if (buf && /\r\n$/.test(buf)) { const lines = buf.split('\r\n'), last = lines[lines.length - 2]; if (last && /^\d{3} /.test(last)) { const resp = buf; buf = ''; waiter = null; r(resp) } } });
    const cmd = async (line, ok) => { if (line != null) sock.write(line + '\r\n'); const r = await read(); const code = +r.slice(0, 3); if (!ok.includes(code)) throw new Error(`SMTP ${line ? line.split(' ')[0] : 'saludo'}: ${r.trim().slice(0, 200)}`); return r };
    const attach = s => { sock = s; sock.on('data', onData); sock.on('error', fail) };
    const run = async () => {
      await cmd(null, [220]); await cmd('EHLO beemoair.com', [250]);
      if (SMTP.port !== 465) { await cmd('STARTTLS', [220]); sock.removeListener('data', onData); const up = tls.connect({ socket: sock, servername: SMTP.host }); await new Promise((r, j) => { up.once('secureConnect', r); up.once('error', j) }); attach(up); await cmd('EHLO beemoair.com', [250]) }
      await cmd('AUTH LOGIN', [334]); await cmd(b64(SMTP.user), [334]); await cmd(b64(SMTP.pass), [235]);
      await cmd(`MAIL FROM:<${SMTP.from}>`, [250]); for (const t of to) await cmd(`RCPT TO:<${t}>`, [250, 251]);
      await cmd('DATA', [354]);
      const bd = 'b' + crypto.randomBytes(12).toString('hex');
      const msg = [`From: ${encH(SMTP.name)} <${SMTP.from}>`, `To: ${to.join(', ')}`, `Subject: ${encH(subject)}`, `Date: ${new Date().toUTCString()}`,
        `Message-ID: <${crypto.randomBytes(10).toString('hex')}@beemoair.com>`, ...(replyTo ? [`Reply-To: ${replyTo}`] : []), 'MIME-Version: 1.0', `Content-Type: multipart/alternative; boundary="${bd}"`, '',
        `--${bd}`, 'Content-Type: text/plain; charset=utf-8', 'Content-Transfer-Encoding: base64', '', wrap76(b64(text)),
        `--${bd}`, 'Content-Type: text/html; charset=utf-8', 'Content-Transfer-Encoding: base64', '', wrap76(b64(html)), `--${bd}--`, ''].join('\r\n');
      sock.write(msg + '\r\n.\r\n'); const r = await read(); if (+r.slice(0, 3) !== 250) throw new Error('SMTP DATA: ' + r.trim().slice(0, 200));
      try { sock.write('QUIT\r\n') } catch (e) {} done = true; clearTimeout(timer); sock.end(); resolve(true);
    };
    const s0 = SMTP.port === 465 ? tls.connect({ host: SMTP.host, port: SMTP.port, servername: SMTP.host }) : net.connect({ host: SMTP.host, port: SMTP.port });
    attach(s0); (SMTP.port === 465 ? new Promise(r => s0.once('secureConnect', r)) : new Promise(r => s0.once('connect', r))).then(run).catch(e => { clearTimeout(timer); fail(e) });
  });
}
function queueMail(to, subject, text, html, ref) {
  const list = [...new Set(to.map(x => String(x || '').trim().toLowerCase()).filter(okEmail))]; if (!list.length) return;
  run('INSERT INTO outbox(to_addrs,subject,text,html,ref,created) VALUES(?,?,?,?,?,?)', JSON.stringify(list), subject, text, html, ref || null, now());
  setTimeout(() => flushOutbox().catch(() => {}), 50);
}
try { run("DELETE FROM outbox WHERE status='pending' AND ref LIKE 'ticket:%' AND subject NOT LIKE '%Caso cerrado:%'") } catch (e) {}
let flushing = false;
async function flushOutbox() {
  if (flushing || !mailReady()) return; flushing = true;
  try { for (const m of q("SELECT * FROM outbox WHERE status='pending' AND tries<5 ORDER BY id LIMIT 20")) {
    try { await smtpSend({ to: JSON.parse(m.to_addrs), subject: m.subject, text: m.text, html: m.html, replyTo: SUPPORT_EMAIL }); run("UPDATE outbox SET status='sent', sent=?, error=NULL WHERE id=?", now(), m.id) }
    catch (e) { run("UPDATE outbox SET tries=tries+1, error=?, status=CASE WHEN tries+1>=5 THEN 'error' ELSE 'pending' END WHERE id=?", e.message.slice(0, 300), m.id) } } }
  finally { flushing = false }
}
/* ============ soporte: chat entre agencias y Beemo Air, con copia por correo ============ */
const TOPICS = { pregunta: 'Pregunta', tecnico: 'Soporte técnico', reservas: 'Reservas', pagos: 'Pagos y consignaciones' };
const escH = t => String(t).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
function ticketMail(t, closedBy) {
  // Copia completa de la conversación, enviada una sola vez cuando se cierra el caso.
  const ag = q1('SELECT * FROM agencies WHERE id=?', t.agency_id) || {};
  const to = [SUPPORT_EMAIL, ag.email, ...q('SELECT email FROM users WHERE agency_id=? AND active=1', t.agency_id).map(u => u.email)];
  const msgs = q('SELECT * FROM ticket_msgs WHERE ticket_id=? ORDER BY id', t.id);
  const when = d => new Date(d).toLocaleString('es-CO', { timeZone: 'America/New_York', dateStyle: 'medium', timeStyle: 'short' });
  const who = m => m.side === 'beemo' ? `Beemo Air · ${m.author_name}` : `${ag.name || 'Agencia'} · ${m.author_name}`;
  const topic = TOPICS[t.topic] || t.topic, subject = `[Beemo Air · Soporte #${t.id}] Caso cerrado: ${t.subject}`;
  const text = `Caso de soporte #${t.id} cerrado por ${closedBy}.\nAgencia: ${ag.name}\nTema: ${topic}\nAsunto: ${t.subject}\nAbierto: ${when(t.created)} · Cerrado: ${when(now())} · ${msgs.length} mensajes\n\nConversación completa:\n\n` +
    msgs.map(m => `[${when(m.created)}] ${who(m)}\n${m.body}`).join('\n\n') + `\n\n— Si necesitas retomarlo, escribe en la misma conversación desde el portal: ${AGENCY_URL}/#soporte`;
  const html = `<div style="font-family:Arial,sans-serif;max-width:640px;color:#101B36"><p style="margin:0 0 4px;color:#56617E;font-size:13px">Soporte #${t.id} · ${escH(topic)} · ${escH(ag.name || '')}</p><h2 style="margin:0 0 6px;font-size:18px">${escH(t.subject)}</h2>
    <p style="margin:0 0 16px;font-size:13px;color:#56617E">Caso cerrado por ${escH(closedBy)}. Abierto ${escH(when(t.created))} · cerrado ${escH(when(now()))} · ${msgs.length} mensajes.</p>
    ${msgs.map(m => `<div style="margin:0 0 10px;padding:10px 14px;border-radius:10px;${m.side === 'beemo' ? 'background:#F1FBDD;border-left:4px solid #B9F44D' : 'background:#F2F5F9;border-left:4px solid #C9D2E3'}"><p style="margin:0;font-size:12px;color:#56617E"><b style="color:#101B36">${escH(who(m))}</b> · ${escH(when(m.created))}</p><p style="white-space:pre-wrap;margin:6px 0 0;font-size:14px">${escH(m.body)}</p></div>`).join('')}
    <p style="font-size:12px;color:#56617E;margin-top:16px">Si necesitas retomarlo, escribe en la misma conversación desde el <a href="${AGENCY_URL}/#soporte">portal de agencias</a>.</p>
    <p style="font-size:11px;color:#8A93A8">Copia para Beemo Air y ${escH(ag.name || 'la agencia')}.</p></div>`;
  queueMail(to, subject, text, html, 'ticket:' + t.id);
}
function closeTicket(id, byName) {
  const t = q1('SELECT * FROM tickets WHERE id=?', +id); if (!t) throw new HttpErr(404, 'Conversación no encontrada.');
  if (t.status === 'closed') return; run("UPDATE tickets SET status='closed', updated=? WHERE id=?", now(), t.id); ticketMail(t, byName);
}
function ticketView(t, side) { const ag = q1('SELECT name FROM agencies WHERE id=?', t.agency_id);
  const last = q1('SELECT body, side, created FROM ticket_msgs WHERE ticket_id=? ORDER BY id DESC LIMIT 1', t.id);
  return { id: t.id, topic: t.topic, topic_label: TOPICS[t.topic] || t.topic, subject: t.subject, status: t.status, created: t.created, updated: t.updated, agency: ag?.name || '', agency_id: t.agency_id,
    unread: side === 'beemo' ? t.unread_admin : t.unread_agency, last: last ? { body: last.body.slice(0, 140), side: last.side, created: last.created } : null } }
function ticketFull(t, side) { const mails = q("SELECT status, COUNT(*) n FROM outbox WHERE ref=? GROUP BY status", 'ticket:' + t.id);
  return { ...ticketView(t, side), messages: q('SELECT id, side, author_name, author_email, body, created FROM ticket_msgs WHERE ticket_id=? ORDER BY id', t.id), mail: Object.fromEntries(mails.map(m => [m.status, m.n])) } }
function addMsg(t, side, a, body) {
  body = String(body || '').replace(/\r/g, '').trim().slice(0, 4000); if (!body) bad('Escribe tu mensaje.');
  const ts = now(); run('INSERT INTO ticket_msgs(ticket_id,side,author_email,author_name,body,created) VALUES(?,?,?,?,?,?)', t.id, side, a.user.email, a.user.name || a.user.email, body, ts);
  run(`UPDATE tickets SET updated=?, status='open', ${side === 'beemo' ? 'unread_agency=unread_agency+1' : 'unread_admin=unread_admin+1'} WHERE id=?`, ts, t.id);
}
on('GET', '/api/agency/tickets', ({ req }) => { const a = need(req, 'agent'); return q('SELECT * FROM tickets WHERE agency_id=? ORDER BY updated DESC', a.agency.id).map(t => ticketView(t, 'agency')) });
on('POST', '/api/agency/tickets', ({ req, body }) => {
  const a = need(req, 'agent'); const subject = clean(body.subject, 120); if (!subject) bad('Escribe el asunto.'); const topic = TOPICS[body.topic] ? body.topic : 'pregunta';
  const r = run('INSERT INTO tickets(agency_id,topic,subject,created,updated) VALUES(?,?,?,?,?)', a.agency.id, topic, subject, now(), now()); const t = q1('SELECT * FROM tickets WHERE id=?', Number(r.lastInsertRowid));
  addMsg(t, 'agency', a, body.message); log(a.user.email, `ticket #${t.id} ${topic}`); return ticketFull(q1('SELECT * FROM tickets WHERE id=?', t.id), 'agency');
});
const myTicket = (a, id) => { const t = q1('SELECT * FROM tickets WHERE id=? AND agency_id=?', +id, a.agency.id); if (!t) throw new HttpErr(404, 'Conversación no encontrada.'); return t };
on('GET', '/api/agency/tickets/:id', ({ req, params }) => { const a = need(req, 'agent'), t = myTicket(a, params.id); if (!a.viewer) run('UPDATE tickets SET unread_agency=0 WHERE id=?', t.id); return ticketFull(q1('SELECT * FROM tickets WHERE id=?', t.id), 'agency') });
on('POST', '/api/agency/tickets/:id/messages', ({ req, params, body }) => { const a = need(req, 'agent'), t = myTicket(a, params.id); addMsg(t, 'agency', a, body.message); return ticketFull(q1('SELECT * FROM tickets WHERE id=?', t.id), 'agency') });
on('POST', '/api/agency/tickets/:id/close', ({ req, params }) => { const a = need(req, 'agent'), t = myTicket(a, params.id); closeTicket(t.id, `${a.agency.name} (${a.user.name || a.user.email})`); return { ok: true } });
on('GET', '/api/agency/unread', ({ req }) => { const a = need(req, 'agent'); return { support: q1('SELECT COALESCE(SUM(unread_agency),0) n FROM tickets WHERE agency_id=?', a.agency.id).n } });
on('GET', '/api/admin/tickets', ({ req, url }) => { need(req, 'admin'); const st = url.searchParams.get('status');
  return q(`SELECT * FROM tickets ${st === 'closed' ? "WHERE status='closed'" : st === 'all' ? '' : "WHERE status='open'"} ORDER BY unread_admin>0 DESC, updated DESC LIMIT 300`).map(t => ticketView(t, 'beemo')) });
on('GET', '/api/admin/tickets/:id', ({ req, params }) => { const a = need(req, 'admin'); const t = q1('SELECT * FROM tickets WHERE id=?', +params.id); if (!t) throw new HttpErr(404, 'Conversación no encontrada.'); if (!a.user.readonly) run('UPDATE tickets SET unread_admin=0 WHERE id=?', t.id); return ticketFull(q1('SELECT * FROM tickets WHERE id=?', t.id), 'beemo') });
on('POST', '/api/admin/tickets/:id/messages', ({ req, params, body }) => { const a = need(req, 'admin'); const t = q1('SELECT * FROM tickets WHERE id=?', +params.id); if (!t) throw new HttpErr(404, 'Conversación no encontrada.'); addMsg(t, 'beemo', a, body.message); return ticketFull(q1('SELECT * FROM tickets WHERE id=?', t.id), 'beemo') });
on('POST', '/api/admin/tickets/:id/status', ({ req, params, body }) => { const a = need(req, 'admin'); if (body.status === 'closed') closeTicket(params.id, `Beemo Air (${a.user.name || a.user.email})`); else run("UPDATE tickets SET status='open', updated=? WHERE id=?", now(), +params.id); log(a.user.email, `ticket #${params.id} ${body.status}`); return { ok: true } });
on('GET', '/api/admin/unread', ({ req }) => { need(req, 'admin'); return { support: q1('SELECT COALESCE(SUM(unread_admin),0) n FROM tickets').n } });
on('GET', '/api/admin/mail-status', ({ req }) => { need(req, 'admin'); const c = Object.fromEntries(q('SELECT status, COUNT(*) n FROM outbox GROUP BY status').map(r => [r.status, r.n]));
  return { configured: mailReady(), from: SMTP.from || null, host: SMTP.host || null, support_email: SUPPORT_EMAIL, pending: c.pending || 0, sent: c.sent || 0, error: c.error || 0, last_error: q1("SELECT error FROM outbox WHERE error IS NOT NULL ORDER BY id DESC LIMIT 1")?.error || null } });
on('POST', '/api/admin/mail-test', async ({ req }) => { const a = need(req, 'admin'); if (!mailReady()) bad('El correo saliente aún no está configurado.');
  await smtpSend({ to: [SUPPORT_EMAIL, a.user.email], subject: 'Prueba de correo del portal de agencias', text: 'Si recibes este mensaje, las copias de los casos de soporte cerrados ya salen desde el portal de Beemo Air.', html: '<p>Si recibes este mensaje, las copias de los casos de soporte cerrados ya salen desde el portal de Beemo Air.</p>' }); return { ok: true } });
on('GET', '/api/admin/booking-filters', ({ req }) => {
  need(req, 'admin'); const fl = new Map();
  for (const b of q('SELECT data FROM bookings')) for (const l of JSON.parse(b.data).legs) fl.set(l.route + '|' + l.date, { route: l.route, date: l.date, no: l.no });
  return { flights: [...fl.values()].sort((a, b) => a.date.localeCompare(b.date) || a.route.localeCompare(b.route)), agencies: q('SELECT id,name FROM agencies ORDER BY name') };
});
on('POST', '/api/admin/bookings/:pnr/:action', ({ req, params }) => {
  const a = need(req, 'admin'); const b = q1('SELECT * FROM bookings WHERE pnr=?', params.pnr); if (!b) throw new HttpErr(404, 'Reserva no encontrada.');
  if (params.action === 'paid') { if (!['pending', 'confirmed'].includes(b.status)) bad('Esta reserva ya no está activa.'); confirmPaid(b, a.user.email) }
  else if (params.action === 'cancel') { if (!['pending', 'confirmed'].includes(b.status)) bad('Esta reserva ya no está activa.'); releaseBooking(b, 'cancelled', a.user.email) }
  else if (params.action === 'hold') toHold(b, a.user.email);
  else if (params.action === 'settle') { if (b.pay_method !== 'cash') bad('Solo aplica a cobros en agencia.'); run('UPDATE bookings SET settled=1, paid=total, updated=? WHERE id=?', now(), b.id); log(a.user.email, `settled ${b.pnr}`) }
  else bad('Acción no válida.');
  return bookingView(q1('SELECT * FROM bookings WHERE id=?', b.id), { private: true });
});
on('GET', '/api/admin/agencies', ({ req }) => {
  need(req, 'admin');
  return q('SELECT * FROM agencies ORDER BY name').map(ag => ({ ...ag, active: !!ag.active, users: q('SELECT id,email,username,name,active,must_change FROM users WHERE agency_id=?', ag.id).map(u => ({ ...u, email: u.email.endsWith(NOMAIL) ? null : u.email })), statement: statement(ag.id) }));
});
on('POST', '/api/admin/agencies', ({ req, body }) => {
  const a = need(req, 'admin'); const name = clean(body.name, 80); if (!name) bad('Escribe el nombre de la agencia.');
  const country = clean(body.country, 40); if (!country) bad('Elige el país de la agencia.');
  const r = run('INSERT INTO agencies(name,commission,incentive,active,created,country,city,tax_id,address,contact,email,phone) VALUES(?,?,?,1,?,?,?,?,?,?,?,?)', name, num(body.commission, 3), num(body.incentive, 0), now(),
    country, clean(body.city, 80), clean(body.tax_id, 40), clean(body.address, 160), clean(body.contact, 80), clean(body.email, 120), clean(body.phone, 40));
  log(a.user.email, `agency ${name}`); return { id: Number(r.lastInsertRowid) };
});
const num = (v, d) => { const n = Number(v); return Number.isFinite(n) && n >= 0 && n <= 30 ? n : d };
on('PATCH', '/api/admin/agencies/:id', ({ req, body, params }) => {
  const a = need(req, 'admin'); const ag = q1('SELECT * FROM agencies WHERE id=?', +params.id); if (!ag) throw new HttpErr(404, 'Agencia no encontrada.');
  run('UPDATE agencies SET name=?, commission=?, incentive=?, active=? WHERE id=?', clean(body.name ?? ag.name, 80) || ag.name, num(body.commission ?? ag.commission, ag.commission), num(body.incentive ?? ag.incentive, ag.incentive), body.active == null ? ag.active : (body.active ? 1 : 0), ag.id);
  for (const k of ['country', 'city', 'tax_id', 'address', 'contact', 'email', 'phone']) if (body[k] != null) run(`UPDATE agencies SET ${k}=? WHERE id=?`, clean(body[k], 160), ag.id);
  log(a.user.email, `agency ${ag.id} updated`); return { ok: true };
});
on('POST', '/api/admin/agencies/:id/users', ({ req, body, params }) => {
  const a = need(req, 'admin'); const ag = q1('SELECT * FROM agencies WHERE id=?', +params.id); if (!ag) throw new HttpErr(404, 'Agencia no encontrada.');
  const uname = normUser(body.username); if (uname && !/^[a-z0-9._-]{3,30}$/.test(uname)) bad('El usuario debe tener de 3 a 30 letras o números, sin espacios.');
  const em = norm(body.email); if (em && !okEmail(em)) bad('Revisa el correo del usuario.'); if (!em && !uname) bad('Escribe el correo o el nombre de usuario.');
  if (uname && q1('SELECT 1 FROM users WHERE username=? OR email=?', uname, uname)) bad('Ese nombre de usuario ya existe. Prueba con otro, por ejemplo con la inicial del apellido.');
  const email = em || uname + NOMAIL; if (q1('SELECT 1 FROM users WHERE email=?', email)) bad('Ya existe un usuario con ese correo.');
  const pw = tempPassword();
  run('INSERT INTO users(agency_id,email,username,name,role,pass,must_change,created) VALUES(?,?,?,?,?,?,1,?)', ag.id, email, uname || null, clean(body.name, 80), 'agent', hashPw(pw), now());
  log(a.user.email, `user ${uname || email} for agency ${ag.id}`); return { email: em || null, username: uname || null, temp_password: pw };
});
on('POST', '/api/admin/users/:id/:action', ({ req, params }) => {
  const a = need(req, 'admin'); const u = q1("SELECT * FROM users WHERE id=? AND role='agent'", +params.id); if (!u) throw new HttpErr(404, 'Usuario no encontrado.');
  if (params.action === 'reset') { const pw = tempPassword(); run('UPDATE users SET pass=?, must_change=1 WHERE id=?', hashPw(pw), u.id); run('DELETE FROM sessions WHERE user_id=?', u.id); log(a.user.email, `reset ${u.email}`); return { username: u.username, email: u.email.endsWith(NOMAIL) ? null : u.email, temp_password: pw } }
  if (params.action === 'toggle') { run('UPDATE users SET active=1-active WHERE id=?', u.id); run('DELETE FROM sessions WHERE user_id=?', u.id); return { ok: true } }
  bad('Acción no válida.');
});
/* ============ canales y convenios: mezcla real de canales, costo de venta y base del simulador (pestaña Agencias) ============ */
const CH_DEF = { eco_rt: 266, biz_rt: 24, occ_biz: { basico: 0.6, medio: 0.8, full: 1 }, mix: { light: 0.30, basic: 0.25, classic: 0.25, plus: 0.12, flex: 0.08 }, gateway: 0.032, incentive: 0.01 };
// tarifa administrativa de las agencias en Colombia para tiquetes internacionales (Aerocivil, Res. 1507 de 2012; antes de IVA): la paga el pasajero a la agencia
const TA_CO = [[354, 15], [590, 28], [944, 46], [null, 95]];
function channelBase() {
  const F = getFin(), y = F?.year1; if (!y || !y.tickets_regular) return null; const b = F.base || {}, o = b.orig || {};
  const ops = b.ops_regular || (F.cash?.months || []).reduce((t, m) => t + (m.ops_regular || 0), 0) || 48;
  const eco = b.eco_rt || CH_DEF.eco_rt, biz = b.biz_rt || CH_DEF.biz_rt, ob = b.occ_biz || CH_DEF.occ_biz, mix = b.mix || CH_DEF.mix, sc = {};
  for (const k of ['basico', 'medio', 'full']) sc[k] = { load: y.load[k], tickets: o.tickets?.[k] ?? y.tickets_regular[k], nontariff: o.nontariff?.[k] ?? y.nontariff_regular[k],
    revenue: o.revenue?.[k] ?? y.revenue[k], ebitda: o.ebitda?.[k] ?? y.ebitda[k], pax_rt: o.pax_rt?.[k] ?? r2(ops * (y.load[k] * eco + ob[k] * biz) / 2) };
  const MM = { Ene: '01', Feb: '02', Mar: '03', Abr: '04', May: '05', Jun: '06', Jul: '07', Ago: '08', Sep: '09', Oct: '10', Nov: '11', Dic: '12' };
  const months = (F.cash?.months || []).filter(m => m.ops_regular > 0).map(m => { const [mm, yy] = String(m.month).split('-'); return { month: `20${yy}-${MM[mm] || '01'}`, ops: m.ops_regular } });
  return { source: F.source, updated: F.updated, ops_regular: ops, gateway: b.gateway || CH_DEF.gateway, incentive: b.incentive ?? CH_DEF.incentive, taxes_rt: b.taxes_rt || r2(TAX_LEG * 2), active: b.active || 0,
    has_channels: !!b.orig, months, scenarios: sc, ta_co: TA_CO, families: Object.entries(FAMILIES).map(([k, v]) => ({ key: k, name: v.name, rt: v.rt, mix: k === 'bc' ? 0 : (mix[k] ?? 0) })) };
}
const CH_KEYS = { a_co: [0, 1], a_us: [0, 1], p_co: [0, 0.3], p_us: [0, 0.3], f_co: [0, 500], f_us: [0, 500], fee: [0, 500], loss: [0, 1], transfer: [0, 1], own_us: [0, 500], ask_co: [0, 1000], ask_us: [0, 1000] };
const getChSim = () => { const r = q1("SELECT value FROM settings WHERE key='channel_sim'"); try { return r ? JSON.parse(r.value) : null } catch (e) { return null } };
on('GET', '/api/admin/channels', ({ req }) => {
  need(req, 'admin');
  const ags = q('SELECT * FROM agencies ORDER BY name');
  const kindOf = ag => !ag ? 'web' : ag.country === 'Colombia' ? 'co' : ag.country === 'Estados Unidos' ? 'us' : 'other';
  const mk = (id, name, ag) => ({ id, name, kind: kindOf(ag), country: ag?.country || null, active: ag ? !!ag.active : true, rate: ag ? ag.commission : 0, incentive: ag ? effIncentive(ag) : 0,
    bookings: 0, pax_legs: 0, fare_net: 0, sales: 0, commission: 0, card: 0, cash: 0, cash_due: 0, pending: 0, pending_pax_legs: 0, fam: {} });
  const ch = { web: mk('web', 'beemoair.com', null) }; for (const a of ags) ch[a.id] = mk(a.id, a.name, a);
  const weeks = {}, fm = {};
  for (const b of q("SELECT * FROM bookings WHERE status IN ('confirmed','pending')")) {
    const c = ch[b.agency_id || 'web']; if (!c) continue; const d = JSON.parse(b.data), segs = d.pax.length * d.legs.length;
    if (b.status === 'pending') { c.pending += b.total; c.pending_pax_legs += segs; continue }
    c.bookings++; c.pax_legs += segs; c.fare_net += b.fare_net; c.sales += b.total; c.commission += b.commission;
    if (b.pay_method === 'cash') { c.cash += b.total; if (!b.settled) c.cash_due += b.total } else c.card += b.total;
    for (const l of d.legs) { c.fam[l.fare] = (c.fam[l.fare] || 0) + d.pax.length;
      const mth = String(l.date).slice(0, 7), f = fm[mth] = fm[mth] || { month: mth, web: 0, co: 0, us: 0, other: 0, commission: 0, fare_net: 0 };
      f[c.kind] += d.pax.length; f.commission += b.commission / d.legs.length; f.fare_net += b.fare_net / d.legs.length }
    // semana de venta (de lunes a domingo, hora de Miami)
    const day = new Date(nyDay(b.created) + 'T12:00:00Z'), ws = new Date(day); ws.setUTCDate(day.getUTCDate() - (day.getUTCDay() + 6) % 7);
    const wk = iso(ws); weeks[wk] = weeks[wk] || { week: wk, web: 0, co: 0, us: 0, other: 0 }; weeks[wk][c.kind] += segs;
  }
  const money = ['fare_net', 'sales', 'commission', 'card', 'cash', 'cash_due', 'pending'];
  return { at: now(), base: channelBase(), saved: getChSim(), weeks: Object.values(weeks).sort((a, b) => a.week.localeCompare(b.week)).slice(-16),
    flight_months: Object.values(fm).sort((a, b) => a.month.localeCompare(b.month)).map(f => ({ ...f, commission: r2(f.commission), fare_net: r2(f.fare_net) })),
    channels: Object.values(ch).map(c => ({ ...c, ...Object.fromEntries(money.map(k => [k, r2(c[k])])) })).sort((a, b) => b.pax_legs - a.pax_legs || String(a.name).localeCompare(String(b.name))) };
});
// el administrador guarda el escenario del simulador para volver a encontrarlo en cualquier dispositivo
on('PUT', '/api/admin/channels', ({ req, body }) => {
  const a = need(req, 'admin'), s = { scenario: ['basico', 'medio', 'full'].includes(body.scenario) ? body.scenario : 'medio', replace: body.replace !== false, name: clean(body.name, 60) };
  for (const [k, [lo, hi]] of Object.entries(CH_KEYS)) { const v = Number(body[k]); if (!Number.isFinite(v) || v < lo || v > hi) bad('Revisa los valores del escenario.'); s[k] = v }
  if (s.a_co + s.a_us > 1.0001) bad('Las agencias no pueden vender más del 100 % de los pasajeros.');
  Object.assign(s, { at: now(), by: a.user.email });
  run("INSERT INTO settings(key,value) VALUES('channel_sim',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", JSON.stringify(s)); log(a.user.email, 'channel simulator saved'); return { saved: s };
});
on('GET', '/api/admin/passes', ({ req }) => { need(req, 'admin'); return q('SELECT * FROM passes ORDER BY created DESC LIMIT 500').map(p => ({ ...passView(p), product: p.product_name || `${p.total} trayectos`, name: p.name, email: p.email, created: p.created })) });
on('POST', '/api/admin/passes/:code/paid', ({ req, params }) => { const a = need(req, 'admin'); run("UPDATE passes SET status='paid' WHERE code=? AND status IN ('pending','expired')", params.code); log(a.user.email, `pass ${params.code} paid`); return { ok: true } });
on('GET', '/api/admin/backups', ({ req }) => { need(req, 'admin'); const L = backupList();
  return { backups: L, every_hours: BK_EVERY_H, last: L[0] || null, age_hours: L[0] ? Math.round((Date.now() - Date.parse(L[0].at)) / 36e4) / 10 : null, late: backupAgeH() > BK_EVERY_H * 2, error: BK.error, offsite: { configured: BK_S3_ON, encrypted: !!BK_PASS, last: BK.offsite }, keep: { recent: BK_RECENT, days: BK_DAYS } } });
on('POST', '/api/admin/backups', ({ req }) => { const a = need(req, 'admin'); const name = backupNow('manual'); if (!name) throw new HttpErr(500, BK.error ? `No se pudo crear la copia: ${BK.error.message}.` : 'Ya hay una copia en curso. Intenta en un momento.'); log(a.user.email, `respaldo manual ${name}`); return { name } });
// descargar una copia: trae todos los datos del sistema, así que solo para administradores con acceso completo
on('GET', '/api/admin/backups/:name', ({ req, params }) => { const a = need(req, 'admin'); if ((a.viewer || a.user).readonly) throw new HttpErr(403, 'Tu acceso es de solo lectura: no puedes descargar copias de la base de datos.');
  const name = String(params.name || ''); if (!BK_RE.test(name) || !fs.existsSync(path.join(BK_DIR, name))) throw new HttpErr(404, 'Copia no encontrada.');
  log(a.user.email, `respaldo descargado ${name}`); return new Raw(200, fs.readFileSync(path.join(BK_DIR, name)), { 'Content-Disposition': `attachment; filename="${name}"` }, 'application/gzip') });
/* ---------- visitas a beemoair.com (mapa) y origen de cada reserva (IP) ---------- */
// La web pública avisa cada página vista en POST /api/visit. La ubicación se consulta una sola vez por IP y se guarda en ip_geo.
// GEO_URL cambia el servicio de ubicación ({ip} se reemplaza); GEO_ENABLED=0 lo apaga; VISIT_KEEP_DAYS son los días que se conservan las visitas.
db.exec(`CREATE TABLE IF NOT EXISTS visits(id INTEGER PRIMARY KEY, at TEXT NOT NULL, ip TEXT NOT NULL, path TEXT NOT NULL, ref TEXT, lang TEXT, ua TEXT);
CREATE INDEX IF NOT EXISTS visits_at ON visits(at);
CREATE TABLE IF NOT EXISTS ip_geo(ip TEXT PRIMARY KEY, ok INTEGER NOT NULL DEFAULT 0, cc TEXT, country TEXT, region TEXT, city TEXT, lat REAL, lon REAL, isp TEXT, tries INTEGER NOT NULL DEFAULT 0, at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS booking_origin(booking_id INTEGER PRIMARY KEY REFERENCES bookings(id), ip TEXT, ua TEXT, at TEXT NOT NULL);`);
const GEO_URL = process.env.GEO_URL || 'https://ipwho.is/{ip}', GEO_OFF = process.env.GEO_ENABLED === '0', VISIT_KEEP_DAYS = Math.max(1, +process.env.VISIT_KEEP_DAYS || 180);
const BOT_RE = /bot\b|bot\/|crawl|spider|slurp|preview|prefetch|headless|lighthouse|pingdom|uptime|monitor|whatsapp|facebookexternalhit|telegram|curl\/|wget|python|node-fetch|axios|go-http|okhttp|java\//i;
const ipNorm = ip => String(ip || '').trim().replace(/^::ffff:/i, '');
const GEO_SKIP = new net.BlockList();   // direcciones privadas o reservadas: no se ubican
for (const [a, p] of [['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4]]) GEO_SKIP.addSubnet(a, p, 'ipv4');
for (const [a, p] of [['::', 127], ['64:ff9b::', 96], ['100::', 64], ['2001:db8::', 32], ['fc00::', 7], ['fe80::', 10], ['ff00::', 8]]) GEO_SKIP.addSubnet(a, p, 'ipv6');
const ipPublic = ip => { const f = net.isIP(ip); return !!f && !GEO_SKIP.check(ip, f === 6 ? 'ipv6' : 'ipv4') };
const uaDevice = ua => {
  ua = String(ua || ''); if (!ua) return '';
  const os = /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) ? 'iPad' : /Android/.test(ua) ? 'Android' : /Windows/.test(ua) ? 'Windows' : /Macintosh|Mac OS X/.test(ua) ? 'Mac' : /CrOS/.test(ua) ? 'Chromebook' : /Linux/.test(ua) ? 'Linux' : '';
  const br = /Instagram/.test(ua) ? 'Instagram' : /FBAN|FBAV|FB_IAB/.test(ua) ? 'Facebook' : /TikTok|musical_ly|Bytedance/i.test(ua) ? 'TikTok' : /Edg(e|A|iOS)?\//.test(ua) ? 'Edge' : /OPR\/|Opera/.test(ua) ? 'Opera' : /Firefox|FxiOS/.test(ua) ? 'Firefox' : /Chrome|CriOS/.test(ua) ? 'Chrome' : /Safari/.test(ua) ? 'Safari' : '';
  return [os, br].filter(Boolean).join(' · ');
};
function geoWant(ip) { if (GEO_OFF || !ipPublic(ip)) return; run('INSERT OR IGNORE INTO ip_geo(ip,at) VALUES(?,?)', ip, now()) }
function geoParse(j) {   // entiende la respuesta de ipwho.is, ipinfo.io e ip-api.com
  if (!j || typeof j !== 'object' || j.success === false || j.status === 'fail' || j.bogon) return null;
  let lat = j.latitude ?? j.lat, lon = j.longitude ?? j.lon;
  if (lat == null && typeof j.loc === 'string') [lat, lon] = j.loc.split(',');
  if (lat == null || lon == null || lat === '' || lon === '') return null;
  lat = +lat; lon = +lon; if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  const c = String(j.country || ''), cc = clean(j.country_code || j.countryCode || (c.length === 2 ? c : ''), 2).toUpperCase();
  return { lat: Math.round(lat * 1e3) / 1e3, lon: Math.round(lon * 1e3) / 1e3, cc: /^[A-Z]{2}$/.test(cc) ? cc : null, country: clean(j.country_name || (c.length > 2 ? c : ''), 60) || null,
    region: clean(j.region || j.regionName, 60) || null, city: clean(j.city, 60) || null, isp: clean(j.connection?.isp || j.connection?.org || j.isp || j.org, 80) || null };
}
let GEO_BUSY = false;
async function geoWork() {
  if (GEO_OFF || GEO_BUSY) return; GEO_BUSY = true;
  try {
    // los que fallaron se reintentan con espera: 10 min, 1 h y 6 h; después de eso se dejan sin ubicación
    const t = Date.now(), wait = [0, 600e3, 3600e3, 6 * 3600e3];
    for (const r of q('SELECT ip,tries,at FROM ip_geo WHERE ok=0 AND tries<4 ORDER BY tries, at DESC LIMIT 40').filter(r => t - Date.parse(r.at) >= wait[r.tries]).slice(0, 5)) {
      let g = null;
      try { const res = await fetch(GEO_URL.replace('{ip}', r.ip), { signal: AbortSignal.timeout(6000), headers: { Accept: 'application/json' } }); if (res.ok) g = geoParse(await res.json()) } catch (e) {}
      if (g) run('UPDATE ip_geo SET ok=1,cc=?,country=?,region=?,city=?,lat=?,lon=?,isp=?,at=? WHERE ip=?', g.cc, g.country, g.region, g.city, g.lat, g.lon, g.isp, now(), r.ip);
      else run('UPDATE ip_geo SET tries=tries+1,at=? WHERE ip=?', now(), r.ip);
    }
  } finally { GEO_BUSY = false }
}
setInterval(() => geoWork().catch(e => console.error('geo', e.message)), 4000).unref();
const visitSweep = () => { try { run('DELETE FROM visits WHERE at<?', new Date(Date.now() - VISIT_KEEP_DAYS * 86400e3).toISOString()) } catch (e) { console.error('visitas', e.message) } };
visitSweep(); setInterval(visitSweep, 6 * 3600e3).unref();
// guarda desde dónde se creó una reserva; nunca detiene la reserva si algo falla
function stampOrigin(bid, ip, req) {
  try { ip = ipNorm(ip); run('INSERT OR REPLACE INTO booking_origin(booking_id,ip,ua,at) VALUES(?,?,?,?)', bid, ip || null, clean(req?.headers?.['user-agent'], 300) || null, now()); geoWant(ip) }
  catch (e) { console.error('origen', e.message) }
}
on('POST', '/api/visit', ({ body, ip, req }) => {
  const ua = clean(req.headers['user-agent'], 300); ip = ipNorm(ip);
  if (!ua || BOT_RE.test(ua) || !net.isIP(ip) || String(req.headers.host || '').startsWith('agencias')) return { ok: true };
  try { limit(ip, 'visit', 120, 600e3) } catch (e) { return { ok: true } }
  let p = clean(body.p, 120).split(/[?#]/)[0]; if (!p.startsWith('/')) p = '/';
  let ref = clean(body.r, 80).toLowerCase().replace(/^www\./, ''); if (!/^[a-z0-9.-]+$/.test(ref) || ref === 'beemoair.com' || ref.endsWith('.beemoair.com')) ref = '';
  const lang = clean(body.l, 5).toLowerCase(); 
  run('INSERT INTO visits(at,ip,path,ref,lang,ua) VALUES(?,?,?,?,?,?)', now(), ip, p, ref || null, /^[a-z]{2}(-[a-z]{2})?$/.test(lang) ? lang : null, ua);
  geoWant(ip); return { ok: true };
});
const needFull = req => { const a = need(req, 'admin'); if ((a.viewer || a.user).readonly) throw new HttpErr(403, 'Tu acceso es de solo lectura: no incluye las direcciones IP.'); return a };
on('GET', '/api/admin/visits', ({ req, url }) => {
  needFull(req);
  const days = [1, 7, 30, 90].includes(+url.searchParams.get('days')) ? +url.searchParams.get('days') : 1, since = new Date(Date.now() - days * 86400e3).toISOString(), live = new Date(Date.now() - 5 * 60e3).toISOString();
  const J = 'FROM visits v JOIN ip_geo g ON g.ip=v.ip AND g.ok=1 WHERE v.at>=?';
  const tot = q1('SELECT COUNT(*) n, COUNT(DISTINCT ip) u FROM visits WHERE at>=?', since);
  return { days, since, total: tot.n, unique: tot.u, live: q1('SELECT COUNT(DISTINCT ip) n FROM visits WHERE at>=?', live).n, located: q1(`SELECT COUNT(*) n ${J}`, since).n, geo_on: !GEO_OFF,
    points: q(`SELECT g.lat,g.lon,MAX(g.city) city,MAX(g.region) region,MAX(g.cc) cc,MAX(g.country) country,COUNT(*) n,COUNT(DISTINCT v.ip) u,MAX(v.at) last ${J} GROUP BY g.lat,g.lon ORDER BY n DESC LIMIT 500`, since),
    countries: q(`SELECT g.cc,MAX(g.country) country,COUNT(*) n,COUNT(DISTINCT v.ip) u ${J} GROUP BY g.cc ORDER BY n DESC LIMIT 12`, since),
    cities: q(`SELECT g.city,MAX(g.region) region,g.cc,COUNT(*) n,COUNT(DISTINCT v.ip) u ${J} AND g.city IS NOT NULL GROUP BY g.city,g.cc ORDER BY n DESC LIMIT 12`, since),
    pages: q('SELECT path,COUNT(*) n FROM visits WHERE at>=? GROUP BY path ORDER BY n DESC LIMIT 8', since),
    recent: q('SELECT v.at,v.ip,v.path,v.ref,v.ua,g.city,g.region,g.cc,g.country,g.isp FROM visits v LEFT JOIN ip_geo g ON g.ip=v.ip AND g.ok=1 WHERE v.at>=? ORDER BY v.id DESC LIMIT 200', since).map(({ ua, ...r }) => ({ ...r, device: uaDevice(ua) })) };
});
on('GET', '/api/admin/booking-ips', ({ req }) => {
  needFull(req);
  const rows = q(`SELECT b.id,b.pnr,b.channel,b.status,b.total,b.created,b.data,a.name agency,o.ip,o.ua,g.city,g.region,g.cc,g.country,g.isp
    FROM bookings b LEFT JOIN booking_origin o ON o.booking_id=b.id LEFT JOIN agencies a ON a.id=b.agency_id LEFT JOIN ip_geo g ON g.ip=o.ip AND g.ok=1 ORDER BY b.id DESC LIMIT 500`);
  const same = Object.fromEntries(q('SELECT ip,COUNT(*) n FROM booking_origin WHERE ip IS NOT NULL GROUP BY ip').map(r => [r.ip, r.n]));
  const seen = Object.fromEntries(q('SELECT ip,COUNT(*) n FROM visits WHERE ip IN (SELECT ip FROM booking_origin) GROUP BY ip').map(r => [r.ip, r.n]));
  return rows.map(({ data, ua, id, ...r }) => { let d = {}; try { d = JSON.parse(data) } catch (e) {} const p = (d.pax || [])[0] || {};
    return { ...r, name: clean(`${p.first || ''} ${p.last || ''}`, 80), pax: (d.pax || []).length, email: d.contact?.email || null, device: uaDevice(ua), ua: ua || null, same: r.ip ? same[r.ip] || 1 : 0, visits: r.ip ? seen[r.ip] || 0 : 0 } });
});
on('GET', '/api/admin/log', ({ req }) => { need(req, 'admin'); return q('SELECT * FROM log ORDER BY id DESC LIMIT 200') });

/* ============ http server ============ */
/* ============ aceptación de términos y privacidad: quién aceptó, cuándo, cómo y qué versión ============ */
// Cada formulario de beemoair.com y del portal pide dos casillas separadas (términos / privacidad). Aquí queda la constancia,
// con la versión del documento, el texto exacto de la casilla, la página, la IP y el navegador. Sirve como prueba de aceptación.
const LEGAL_V = { terms: '2026-11-27', privacy: '2026-11-27', cookies: '2026-11-27', refunds: '2026-11-27' };
const LEGAL_DOC = { terms: 'Términos y condiciones', privacy: 'Política de privacidad y tratamiento de datos', marketing: 'Comunicaciones comerciales (opcional)', sensitive: 'Datos sensibles: servicios especiales', cookies_analytics: 'Medición de visitas (cookies)' };
const LEGAL_FORM = { reserva_web: 'Reserva en beemoair.com', club_web: 'Inscripción al BEE CLUB en beemoair.com', pase: 'Compra de pase de temporada', cotizacion: 'Solicitud de cotización', pqrs: 'Peticiones, quejas y reclamos', ucp_web: 'Compra iniciada en una plataforma y terminada en beemoair.com', ucp_plataforma: 'Compra completada en una plataforma (UCP)', reserva_agencia: 'Reserva en el portal de agencias', club_agencia: 'Inscripción al BEE CLUB por una agencia', datos_viaje: 'Datos de viaje en el portal', cookies: 'Aviso de cookies de beemoair.com' };
db.exec(`CREATE TABLE IF NOT EXISTS consents(id INTEGER PRIMARY KEY, at TEXT NOT NULL, form TEXT NOT NULL, doc TEXT NOT NULL, version TEXT, accepted INTEGER NOT NULL, subject TEXT, name TEXT, ref TEXT, channel TEXT NOT NULL, by TEXT, ip TEXT, ua TEXT, lang TEXT, page TEXT, label TEXT);
CREATE INDEX IF NOT EXISTS ix_consents_at ON consents(at); CREATE INDEX IF NOT EXISTS ix_consents_subject ON consents(subject); CREATE INDEX IF NOT EXISTS ix_consents_ref ON consents(ref);`);
const yes = v => v === true || v === 1 || v === 'on' || v === '1' || v === 'true';
const paxNames = d => (d.pax || []).map(p => `${p.first || ''} ${p.last || ''}`.trim()).join(', ');
// las dos casillas obligatorias; en el portal la agencia declara lo que el pasajero aceptó
function consentRead(body, agency = false) {
  const c = body && body.consents && typeof body.consents === 'object' ? body.consents : {};
  if (!yes(c.terms)) bad(agency ? 'Confirma que el pasajero conoce y acepta los Términos y condiciones de Beemo Air.' : 'Para continuar, acepta los Términos y condiciones.', { code: 'consent_terms' });
  if (!yes(c.privacy)) bad(agency ? 'Confirma que el pasajero autorizó el tratamiento de sus datos según la Política de privacidad.' : 'Para continuar, acepta la Política de privacidad y el tratamiento de tus datos.', { code: 'consent_privacy' });
  return c;
}
function consentLog(c, { form, subject = null, name = null, ref = null, channel = 'web', by = null, ip = null, req = null, docs = ['terms', 'privacy'] }) {
  const lab = c && c.labels && typeof c.labels === 'object' ? c.labels : {}, t = now(), ua = clean(req?.headers?.['user-agent'], 300) || null;
  const page = clean(c?.page, 200) || null, lang = /^(es|en)$/.test(c?.lang) ? c.lang : null, ipn = ip ? ipNorm(ip) : null;
  const ins = db.prepare('INSERT INTO consents(at,form,doc,version,accepted,subject,name,ref,channel,by,ip,ua,lang,page,label) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)');
  for (const d of docs) ins.run(t, form, d, d === 'cookies_analytics' ? LEGAL_V.cookies : d === 'terms' ? LEGAL_V.terms : LEGAL_V.privacy, yes(c?.[d]) ? 1 : 0,
    clean(subject, 160) || null, clean(name, 300) || null, clean(ref, 40) || null, channel, clean(by, 160) || null, ipn, ua, lang, page, clean(lab[d], 400) || null);
}
// formularios que no crean nada en el sistema (la cotización y las PQRS se envían por correo) y las preferencias de cookies
on('POST', '/api/consent', ({ body, ip, req }) => {
  limit(ip, 'consent', 40, 600e3);
  const form = String(body.form || '');
  if (form === 'cookies') {
    const cid = String(body.cid || ''); if (!/^[a-z0-9]{12,40}$/.test(cid)) bad('Identificador no válido.');
    const c = { cookies_analytics: yes(body.analytics), labels: { cookies_analytics: body.label }, page: body.page, lang: body.lang };
    consentLog(c, { form: 'cookies', subject: 'navegador ' + cid, ip, req, docs: ['cookies_analytics'] }); return { ok: true };
  }
  if (!['cotizacion', 'pqrs'].includes(form)) bad('Formulario no válido.');
  const email = norm(body.email); if (!okEmail(email)) bad('Revisa el correo electrónico.');
  const c = consentRead(body); consentLog(c, { form, subject: email, name: body.name, ref: body.ref, ip, req }); return { ok: true };
});
// política de reembolsos vigente (la que fija el administrador), para la página pública
on('GET', '/api/refund-policy', () => ({ ...getRefundPolicy(), fares: FARE_NAME, tax_leg: TAX_LEG, version: LEGAL_V.refunds }));
on('GET', '/api/legal', () => ({ versions: LEGAL_V }));
on('GET', '/api/admin/consents', ({ req, url }) => {
  need(req, 'admin'); const s = clean(url.searchParams.get('q'), 80).toLowerCase(), form = url.searchParams.get('form') || '', W = [], P = [];
  if (s) { W.push('(lower(subject) LIKE ? OR lower(name) LIKE ? OR upper(ref) LIKE ? OR lower(by) LIKE ?)'); P.push(`%${s}%`, `%${s}%`, `%${s.toUpperCase()}%`, `%${s}%`) }
  if (LEGAL_FORM[form]) { W.push('form=?'); P.push(form) } else W.push("form<>'cookies'");   // las preferencias de cookies se ven solo al filtrarlas
  const rows = q(`SELECT * FROM consents ${W.length ? 'WHERE ' + W.join(' AND ') : ''} ORDER BY id DESC LIMIT 1000`, ...P);
  const stats = Object.fromEntries(q("SELECT form, COUNT(*) n FROM consents WHERE doc<>'cookies_analytics' GROUP BY form").map(r => [r.form, r.n]));
  const ck = q1("SELECT SUM(accepted) yes, COUNT(*) n FROM consents WHERE doc='cookies_analytics'");
  const events = q1("SELECT COUNT(*) n FROM (SELECT DISTINCT at, form, IFNULL(subject,''), IFNULL(ref,'') FROM consents WHERE form<>'cookies')").n;
  return { versions: LEGAL_V, forms: LEGAL_FORM, docs: LEGAL_DOC, stats, events, cookies: { accepted: ck.yes || 0, total: ck.n || 0 }, rows: rows.map(r => ({ ...r, device: r.ua ? uaDevice(r.ua) : '' })) };
});

/* ============ BEE CLUB: socios, Puntos Miel y consulta para agencias ============ */
db.exec(`CREATE TABLE IF NOT EXISTS club_members(id INTEGER PRIMARY KEY, number TEXT NOT NULL UNIQUE, first TEXT NOT NULL, last TEXT NOT NULL DEFAULT '', email TEXT NOT NULL UNIQUE, phone TEXT NOT NULL DEFAULT '', phone_n TEXT NOT NULL DEFAULT '', city TEXT, consent INTEGER NOT NULL DEFAULT 0, source TEXT NOT NULL DEFAULT 'web', agency_id INTEGER, active INTEGER NOT NULL DEFAULT 1, created TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS club_phone ON club_members(phone_n);
CREATE TABLE IF NOT EXISTS club_ledger(id INTEGER PRIMARY KEY, member_id INTEGER NOT NULL REFERENCES club_members(id), at TEXT NOT NULL, kind TEXT NOT NULL, points INTEGER NOT NULL, booking_id INTEGER, flight TEXT, pax INTEGER, note TEXT, by TEXT);
CREATE UNIQUE INDEX IF NOT EXISTS club_flight_once ON club_ledger(booking_id, flight, pax) WHERE kind='vuelo';
CREATE INDEX IF NOT EXISTS club_ledger_m ON club_ledger(member_id);
CREATE TABLE IF NOT EXISTS club_lookups(id INTEGER PRIMARY KEY, at TEXT NOT NULL, agency_id INTEGER, user_email TEXT, kind TEXT NOT NULL, found INTEGER NOT NULL);`);
try { db.exec('ALTER TABLE club_members ADD COLUMN marketing INTEGER NOT NULL DEFAULT 0') } catch (e) {}
// reglas publicadas en beemoair.com: 1 Punto Miel por dólar de tarifa (sin tasas ni extras); el nivel depende de los vuelos de los últimos 12 meses
const CLUB_LEVELS = [{ name: 'BumbleBee', min: 0, mult: 1 }, { name: 'HoneyBee', min: 3, mult: 1.25 }, { name: 'GoldenBee', min: 6, mult: 1.5 }];
try { db.exec("ALTER TABLE club_members ADD COLUMN pro_until TEXT") } catch {}
// dos planes: Free suma menos; Pro paga una cuota anual y suma más. El nivel (vuelos) multiplica sobre el plan.
const CLUB_RATE = { free: 0.5, pro: 2 }, CLUB_PRO_PRICE = 49, CLUB_EXPIRY_M = 12;
// canje estandarizado: extras a 100 puntos por dólar; bonos de tarifa a 120 por dólar, desde Basic y uno por tiquete
const CLUB_REWARDS = [
  { id: 'asiento', name: 'Selección de asiento estándar', points: 1200, kind: 'extra' },
  { id: 'mano', name: 'Equipaje de mano', points: 1800, kind: 'extra' },
  { id: 'bono25', name: 'Bono de US$25 en tarifa', points: 3000, kind: 'bono' },
  { id: 'maleta', name: 'Maleta de bodega', points: 5500, kind: 'extra' },
  { id: 'bono50', name: 'Bono de US$50 en tarifa', points: 6000, kind: 'bono' },
  { id: 'bono100', name: 'Bono de US$100 en tarifa', points: 12000, kind: 'bono' }];
const clubPlan = (m, date) => m.pro_until && m.pro_until >= (date || new Date().toISOString().slice(0, 10)) ? 'pro' : 'free';
const clubRules = () => ({ levels: CLUB_LEVELS, credit_hours: CLUB_CREDIT_H, point_value: CLUB_PT_VALUE, point_cost: CLUB_PT_COST, rates: CLUB_RATE, pro_price: CLUB_PRO_PRICE, expiry_months: CLUB_EXPIRY_M, rewards: CLUB_REWARDS });
const CLUB_CREDIT_H = 6;           // los puntos se acreditan después de volar: horas tras la salida programada
const CLUB_PT_VALUE = 0.01, CLUB_PT_COST = 0.005; // valor de canje y costo estimado por punto (plan comercial del club)
function clubNumber(v) { const t = String(v ?? '').toUpperCase().replace(/[^A-Z0-9]/g, ''); if (!t) return ''; const d = t.replace(/^BEE/, ''); return /^\d{6}$/.test(d) ? 'BEE' + d : 'X' }
const phoneN = v => String(v ?? '').replace(/\D/g, '').slice(-10);
const clubLevel = n => { let l = CLUB_LEVELS[0], i = 0; CLUB_LEVELS.forEach((x, k) => { if (n >= x.min) { l = x; i = k } }); const nx = CLUB_LEVELS[i + 1]; return { name: l.name, mult: l.mult, next: nx ? { name: nx.name, missing: nx.min - n } : null } };
const clubFlights = id => q1("SELECT COUNT(*) n FROM club_ledger WHERE member_id=? AND kind='vuelo' AND substr(flight, instr(flight,'|')+1) >= ?", id, new Date(Date.now() - 365 * 864e5).toISOString().slice(0, 10)).n;
function clubNewNumber() { for (;;) { const n = 'BEE' + String(crypto.randomInt(0, 1e6)).padStart(6, '0'); if (!q1('SELECT 1 FROM club_members WHERE number=?', n)) return n } }
function clubCreate(body, source, agencyId, who) {
  let first = clean(body.first ?? body.nombre, 60), last = clean(body.last ?? body.apellido, 60);
  if (first && !last && /\s/.test(first)) { const p = first.split(/\s+/); first = p.shift(); last = p.join(' ') }
  const email = norm(body.email ?? body.correo), phone = clean(body.phone ?? body.telefono, 40), pn = phoneN(phone);
  if (!first) bad('Escribe el nombre.'); if (!okEmail(email)) bad('Revisa el correo electrónico.');
  if (phone && pn.length < 10) bad('Escribe el teléfono con indicativo, al menos 10 dígitos, o déjalo vacío.');
  const mkt = yes(body.consents?.marketing) ? 1 : 0;   // comunicaciones comerciales: casilla opcional y aparte
  const ex = q1('SELECT number FROM club_members WHERE email=?', email); if (ex) return { number: ex.number, existing: true };
  const number = clubNewNumber();
  run('INSERT INTO club_members(number,first,last,email,phone,phone_n,city,consent,marketing,source,agency_id,created) VALUES(?,?,?,?,?,?,?,1,?,?,?,?)', number, first, last, email, phone, pn, clean(body.city ?? body.ciudad, 60) || null, mkt, source, agencyId || null, now());
  log(who || email, `club: nuevo socio ${number} (${source})`);
  return { number, existing: false, first };
}
// acredita los vuelos ya volados (reservas emitidas); una sola vez por pasajero y tramo
function clubCredit() {
  const cut = Date.now() - CLUB_CREDIT_H * 3600e3; let n = 0;
  for (const b of q("SELECT id, data FROM bookings WHERE status='confirmed' AND data LIKE '%\"club\":%'")) {
    let d; try { d = JSON.parse(b.data) } catch { continue }
    const legs = (d.legs || []).filter(l => SCHED[l.route] && depTime(l.route, l.date) < cut).sort((x, y) => x.date < y.date ? -1 : 1);
    for (const l of legs) (d.pax || []).forEach((p, i) => {
      if (!p.club || p.inf) return; const m = q1('SELECT id, pro_until FROM club_members WHERE number=?', p.club); if (!m) return;
      const fl = l.route + '|' + l.date; if (q1("SELECT 1 FROM club_ledger WHERE booking_id=? AND flight=? AND pax=? AND kind='vuelo'", b.id, fl, i)) return;
      const lv = clubLevel(clubFlights(m.id)), plan = clubPlan(m, l.date), base = Math.max(0, priceOf(l.date, l.fare) - TAX_LEG), pts = Math.round(base * CLUB_RATE[plan] * lv.mult);
      run("INSERT INTO club_ledger(member_id,at,kind,points,booking_id,flight,pax,note) VALUES(?,?,?,?,?,?,?,?)", m.id, now(), 'vuelo', pts, b.id, fl, i, `${l.route.replace('-', '→')} · ${FARE_NAME[l.fare]} · ${plan === 'pro' ? 'Pro' : 'Free'} · ${lv.name}`); n++ });
  }
  return n;
}
setInterval(() => { try { clubCredit() } catch (e) { console.error('club', e.message) } }, 600e3).unref();
// puntos que el socio sumará por vuelos emitidos que aún no han salido
function clubPending(number, m) { let pts = 0, n = 0;
  for (const b of q("SELECT data FROM bookings WHERE status='confirmed' AND data LIKE ?", `%"club":"${number}"%`)) { const d = JSON.parse(b.data);
    for (const l of d.legs || []) if (SCHED[l.route] && depTime(l.route, l.date) >= Date.now() - CLUB_CREDIT_H * 3600e3) for (const p of d.pax || []) if (p.club === number && !p.inf) { pts += Math.round(Math.max(0, priceOf(l.date, l.fare) - TAX_LEG) * CLUB_RATE[clubPlan(m, l.date)]); n++ } }
  return { points: pts, flights: n } }
function clubView(m, full) {
  const points = q1('SELECT COALESCE(SUM(points),0) p FROM club_ledger WHERE member_id=?', m.id).p, fl = clubFlights(m.id), lv = clubLevel(fl), pend = clubPending(m.number, m), plan = clubPlan(m);
  const v = { number: m.number, name: (m.first + ' ' + m.last).trim(), plan, pro_until: plan === 'pro' ? m.pro_until : null, rate: CLUB_RATE[plan], level: lv.name, next: lv.next, points, flights_12m: fl, pending_points: pend.points, pending_flights: pend.flights, since: m.created.slice(0, 10) };
  if (full) Object.assign(v, { id: m.id, email: m.email, phone: m.phone, city: m.city, source: m.source, agency_id: m.agency_id, consent: !!m.consent, active: !!m.active,
    last_flight: (q1("SELECT MAX(substr(flight, instr(flight,'|')+1)) d FROM club_ledger WHERE member_id=? AND kind='vuelo'", m.id) || {}).d || null });
  return v;
}
// público: inscripción desde beemoair.com
on('POST', '/api/club/join', ({ body, ip, req }) => { limit(ip, 'club-join', 6, 3600e3);
  const c = consentRead(body);
  const r = clubCreate(body, 'web', null, null);
  consentLog(c, { form: 'club_web', subject: norm(body.email ?? body.correo), name: body.first ? `${clean(body.first, 60)} ${clean(body.last, 60)}`.trim() : clean(body.nombre, 120), ref: r.number, ip, req, docs: ['terms', 'privacy', 'marketing'] });
  if (!r.existing && mailReady()) { try { queueMail(norm(body.email ?? body.correo), 'Bienvenido al BEE CLUB de Beemo Air', `Hola ${r.first}:\n\nYa eres parte del BEE CLUB. Tu número de socio es ${r.number.replace('BEE', 'BEE-')}.\nDíctalo al reservar, en la web o con tu agencia, para sumar Puntos Miel después de cada vuelo.\n\nBeemo Air · El milagro que nos une`, `<p>Hola ${r.first}:</p><p>Ya eres parte del <b>BEE CLUB</b>. Tu número de socio es <b>${r.number.replace('BEE', 'BEE-')}</b>.</p><p>Díctalo al reservar, en la web o con tu agencia, para sumar Puntos Miel después de cada vuelo.</p><p>Beemo Air · El milagro que nos une</p>`, 'club:' + r.number) } catch (e) { console.error('club mail', e.message) } }
  // no se confirma por pantalla el número de una cuenta ya existente: solo su dueño lo recibe
  return r.existing ? { ok: true, existing: true } : { ok: true, number: r.number };
});
// agencia: consulta exacta por número de socio o teléfono; no permite listar socios y queda registrada
on('GET', '/api/agency/club', ({ req, url, ip }) => { const a = need(req, 'agent'); limit(ip + '|' + a.user.id, 'club-q', 30, 600e3);
  const raw = String(url.searchParams.get('q') || '').trim(), num = clubNumber(raw), pn = phoneN(raw); let rows = [], kind = 'numero';
  if (num && num !== 'X') rows = q('SELECT * FROM club_members WHERE number=? AND active=1', num);
  else if (pn.length >= 10 && !/[a-z]/i.test(raw)) { kind = 'telefono'; rows = q('SELECT * FROM club_members WHERE phone_n=? AND active=1 LIMIT 5', pn) }
  else bad('Escribe el número de socio completo (BEE y 6 dígitos) o el teléfono con al menos 10 dígitos.');
  clubCredit(); run('INSERT INTO club_lookups(at,agency_id,user_email,kind,found) VALUES(?,?,?,?,?)', now(), a.agency.id, a.user.email, kind, rows.length);
  return { members: rows.map(m => clubView(m, false)), rules: clubRules() };
});
on('POST', '/api/agency/club', ({ req, body, ip }) => { const a = need(req, 'agent'); const c = consentRead(body, true); const r = clubCreate(body, 'agencia', a.agency.id, a.user.email);
  if (r.existing) bad('Ese correo ya está inscrito en el BEE CLUB. Pídele al cliente su número de socio o búscalo por teléfono.');
  consentLog(c, { form: 'club_agencia', subject: norm(body.email ?? body.correo), name: body.first ? `${clean(body.first, 60)} ${clean(body.last, 60)}`.trim() : clean(body.nombre, 120), ref: r.number, channel: 'agencia', by: `${a.agency.name} · ${a.user.email}`, ip, req, docs: ['terms', 'privacy', 'marketing'] });
  return { number: r.number } });
// administrador: socios, métricas, detalle y ajustes
on('GET', '/api/admin/club', ({ req, url }) => { need(req, 'admin'); clubCredit();
  const term = norm(url.searchParams.get('q') || ''), all = q('SELECT * FROM club_members ORDER BY id DESC'), ag = Object.fromEntries(q('SELECT id,name FROM agencies').map(x => [x.id, x.name]));
  const views = all.map(m => ({ ...clubView(m, true), agency: m.agency_id ? ag[m.agency_id] || null : null }));
  const hit = v => !term || norm(v.name).includes(term) || v.email.includes(term) || v.number.toLowerCase().includes(term.replace(/[^a-z0-9]/g, '')) || (phoneN(term).length >= 4 && phoneN(v.phone).includes(phoneN(term)));
  const day = d => d.slice(0, 10), since = n => new Date(Date.now() - n * 864e5).toISOString();
  const led = q1("SELECT COALESCE(SUM(CASE WHEN points>0 THEN points ELSE 0 END),0) issued, COALESCE(SUM(CASE WHEN kind='canje' THEN -points ELSE 0 END),0) redeemed, COALESCE(SUM(points),0) balance FROM club_ledger");
  const weeks = []; for (let i = 7; i >= 0; i--) { const a0 = new Date(Date.now() - (i + 1) * 7 * 864e5).toISOString(), a1 = new Date(Date.now() - i * 7 * 864e5).toISOString(); weeks.push({ from: day(a0), to: day(a1), n: all.filter(m => m.created > a0 && m.created <= a1).length }) }
  const by = (f) => { const o = {}; views.forEach(v => { const k = f(v); o[k] = (o[k] || 0) + 1 }); return o };
  const flown = views.filter(v => v.last_flight).length, paxAll = q1("SELECT COUNT(*) n FROM club_ledger WHERE kind='vuelo'").n;
  const lk = q('SELECT agency_id, COUNT(*) n, SUM(found>0) hits FROM club_lookups GROUP BY agency_id').map(x => ({ agency: ag[x.agency_id] || '—', n: x.n, hits: x.hits || 0, members: all.filter(m => m.agency_id === x.agency_id).length }));
  for (const [id, name] of Object.entries(ag)) if (!lk.some(x => x.agency === name)) { const n = all.filter(m => m.agency_id === +id).length; if (n) lk.push({ agency: name, n: 0, hits: 0, members: n }) }
  return { metrics: { members: all.length, new_7d: all.filter(m => m.created > since(7)).length, new_30d: all.filter(m => m.created > since(30)).length, flown, active_rate: all.length ? flown / all.length : 0,
      member_legs: paxAll, pro: views.filter(v => v.plan === 'pro').length, pro_income: q1("SELECT COALESCE(SUM(CAST(flight AS REAL)),0) t FROM club_ledger WHERE kind='pro'").t, consent: all.filter(m => m.consent).length, near_level: views.filter(v => v.next && v.next.missing === 1).length,
      points_issued: led.issued, points_redeemed: led.redeemed, points_balance: led.balance, pending_points: views.reduce((s, v) => s + v.pending_points, 0),
      liability_value: r2(led.balance * CLUB_PT_VALUE), liability_cost: r2(led.balance * CLUB_PT_COST) },
    levels: by(v => v.level), sources: by(v => v.source), cities: by(v => v.city || 'Sin ciudad'), weeks, agencies: lk.sort((a, b) => b.members - a.members), rules: clubRules(),
    total: views.length, members: views.filter(hit).slice(0, 500) };
});
on('GET', '/api/admin/club/:id', ({ req, params }) => { need(req, 'admin'); const m = q1('SELECT * FROM club_members WHERE id=?', +params.id); if (!m) throw new HttpErr(404, 'Socio no encontrado.');
  return { member: clubView(m, true), ledger: q('SELECT l.at,l.kind,l.points,l.flight,l.note,l.by,b.pnr FROM club_ledger l LEFT JOIN bookings b ON b.id=l.booking_id WHERE l.member_id=? ORDER BY l.id DESC LIMIT 200', m.id) } });
on('POST', '/api/admin/club', ({ req, body }) => { const a = need(req, 'admin'); const r = clubCreate(body, 'admin', null, a.user.email); if (r.existing) bad('Ese correo ya está inscrito: socio ' + r.number + '.'); return { number: r.number } });
on('POST', '/api/admin/club/:id/adjust', ({ req, params, body }) => { const a = need(req, 'admin'); const m = q1('SELECT * FROM club_members WHERE id=?', +params.id); if (!m) throw new HttpErr(404, 'Socio no encontrado.');
  const pts = Math.round(Number(body.points)), note = clean(body.note, 160); if (!Number.isFinite(pts) || !pts || Math.abs(pts) > 1e6) bad('Escribe los puntos a sumar o restar (con signo menos para restar).'); if (note.length < 4) bad('Escribe el motivo del ajuste.');
  const bal = q1('SELECT COALESCE(SUM(points),0) p FROM club_ledger WHERE member_id=?', m.id).p; if (bal + pts < 0) bad(`El socio solo tiene ${bal} puntos; no puede quedar en negativo.`);
  run("INSERT INTO club_ledger(member_id,at,kind,points,note,by) VALUES(?,?,?,?,?,?)", m.id, now(), 'ajuste', pts, note, a.user.email); log(a.user.email, `club: ajuste ${pts} a ${m.number} (${note})`); return clubView(m, true) });
on('POST', '/api/admin/club/:id/pro', ({ req, params, body }) => { const a = need(req, 'admin'); const m = q1('SELECT * FROM club_members WHERE id=?', +params.id); if (!m) throw new HttpErr(404, 'Socio no encontrado.');
  const paid = Number(body.paid); if (!Number.isFinite(paid) || paid < 0 || paid > 1000) bad('Escribe el valor cobrado por la membresía (0 si es cortesía).');
  const today = new Date().toISOString().slice(0, 10), from = new Date((m.pro_until && m.pro_until > today ? m.pro_until : today) + 'T12:00:00Z'); from.setUTCFullYear(from.getUTCFullYear() + 1); const until = from.toISOString().slice(0, 10);
  run('UPDATE club_members SET pro_until=? WHERE id=?', until, m.id);
  run("INSERT INTO club_ledger(member_id,at,kind,points,flight,note,by) VALUES(?,?,?,?,?,?,?)", m.id, now(), 'pro', 0, String(r2(paid)), `BEE CLUB Pro hasta ${until} · cobrado US$${r2(paid)}`, a.user.email);
  log(a.user.email, `club: Pro ${m.number} hasta ${until} (US$${r2(paid)})`); return clubView(q1('SELECT * FROM club_members WHERE id=?', m.id), true) });
on('POST', '/api/admin/club/:id/redeem', ({ req, params, body }) => { const a = need(req, 'admin'); const m = q1('SELECT * FROM club_members WHERE id=?', +params.id); if (!m) throw new HttpErr(404, 'Socio no encontrado.');
  const rw = CLUB_REWARDS.find(x => x.id === body.reward); if (!rw) bad('Elige la recompensa.'); const ref = clean(body.ref, 40);
  if (ref.length < 4) bad('Escribe el código de la reserva donde se aplica el canje.');
  clubCredit(); const bal = q1('SELECT COALESCE(SUM(points),0) p FROM club_ledger WHERE member_id=?', m.id).p; if (bal < rw.points) bad(`Le faltan ${rw.points - bal} puntos: tiene ${bal} y esta recompensa pide ${rw.points}.`);
  run("INSERT INTO club_ledger(member_id,at,kind,points,note,by) VALUES(?,?,?,?,?,?)", m.id, now(), 'canje', -rw.points, `${rw.name} · reserva ${ref.toUpperCase()}`, a.user.email);
  log(a.user.email, `club: canje ${rw.id} de ${m.number} en ${ref}`); return clubView(m, true) });
on('PATCH', '/api/admin/club/:id', ({ req, params, body }) => { const a = need(req, 'admin'); const m = q1('SELECT * FROM club_members WHERE id=?', +params.id); if (!m) throw new HttpErr(404, 'Socio no encontrado.');
  if ('active' in body) run('UPDATE club_members SET active=? WHERE id=?', body.active ? 1 : 0, m.id);
  if (body.phone != null) { const pn = phoneN(body.phone); if (pn.length < 10) bad('El teléfono debe tener al menos 10 dígitos.'); run('UPDATE club_members SET phone=?, phone_n=? WHERE id=?', clean(body.phone, 40), pn, m.id) }
  log(a.user.email, `club: socio ${m.number} actualizado`); return clubView(q1('SELECT * FROM club_members WHERE id=?', m.id), true) });

/* ============ cupos por tarifa y sobreventa ============ */
// Cada tarifa de económica tiene un cupo por vuelo. Los cupos se suman de la más barata a la más cara: Light no pasa de su cupo,
// Light + Basic no pasan de la suma de los dos, y así; la más cara (Flex) vende cualquier silla libre. Flex BC tiene la cabina Business.
// Sobreventa: sillas de económica que se pueden vender por encima de la cabina; esos pasajeros quedan sin silla (SB1, SB2…) y
// reciben una en cuanto se libera. El límite arranca en cero.
db.exec(`CREATE TABLE IF NOT EXISTS flight_caps(flight TEXT PRIMARY KEY, caps TEXT, overbook INTEGER, updated TEXT NOT NULL, by TEXT)`);
const ECO_FARES = ['light', 'basic', 'classic', 'plus', 'flex'], ECO_SEATS = ALL_SEATS.filter(s => parseInt(s) > BIZ).length, OB_MAX = 15;
const CAPS_DEFAULT = { on: true, normal: { light: 30, basic: 35, classic: 35, plus: 23, flex: 15 }, peak: { light: 15, basic: 25, classic: 40, plus: 33, flex: 25 }, peaks: [['2026-12-18', '2026-12-24'], ['2027-01-02', '2027-01-08']], overbook: 0 };
const isSB = s => /^SB\d+$/.test(String(s || ''));
function getCaps() { const r = q1("SELECT value FROM settings WHERE key='fare_caps'"); try { const c = r ? JSON.parse(r.value) : null; if (c && c.normal && c.peak && Array.isArray(c.peaks)) return c } catch (e) {} return CAPS_DEFAULT }
function capsInput(c, what) { const o = {}; for (const k of ECO_FARES) { const v = Math.round(Number(c?.[k])); if (!Number.isFinite(v) || v < 0 || v > ECO_SEATS) bad(`Revisa el cupo de ${FARE_NAME[k]}${what}: va de 0 a ${ECO_SEATS}.`); o[k] = v } return o }
const obInput = v => { const n = Math.round(Number(v)); if (!Number.isFinite(n) || n < 0 || n > OB_MAX) bad(`La sobreventa va de 0 a ${OB_MAX} sillas.`); return n };
function flightCaps(route, date) {
  const G = getCaps(), o = q1('SELECT * FROM flight_caps WHERE flight=?', route + '|' + date), peak = G.peaks.some(([a, b]) => date >= a && date <= b); let own = null; try { own = o && o.caps ? JSON.parse(o.caps) : null } catch (e) {}
  return { on: G.on !== false, caps: own || (peak ? G.peak : G.normal), overbook: o && o.overbook != null ? o.overbook : G.overbook || 0, peak, own: !!own, own_overbook: !!(o && o.overbook != null) };
}
// pasajeros con silla (o en espera de silla) en un vuelo, por tarifa; «skip» deja por fuera una reserva (la que se está editando)
function fareSold(flight, skip) { const sold = Object.fromEntries([...ECO_FARES, 'bc'].map(k => [k, 0])); let standby = 0, skipped = 0, cache = new Map();
  for (const r of q("SELECT i.seat, i.booking_id, b.data FROM seat_inv i JOIN bookings b ON b.id=i.booking_id WHERE i.flight=? AND b.status IN ('pending','confirmed')", flight)) {
    if (r.booking_id === skip) { if (!isSB(r.seat) && parseInt(r.seat) > BIZ) skipped++; continue }
    let f = cache.get(r.booking_id); if (!f) { f = JSON.parse(r.data).legs.find(l => l.route + '|' + l.date === flight)?.fare; cache.set(r.booking_id, f) }
    if (sold[f] != null) sold[f]++; if (isSB(r.seat)) standby++ }
  return { sold, standby, skipped };
}
// cuántos pasajeros más se pueden vender en cada tarifa de un vuelo
function fareLeft(route, date, skip) {
  const f = route + '|' + date, C = flightCaps(route, date), S = fareSold(f, skip), av = availability(route, date), room = av.eco + S.skipped + Math.max(0, C.overbook - S.standby), left = { bc: av.biz };
  // tope acumulado de cada tarifa; una tarifa cara que usa cupo de las baratas también se lo quita a ellas
  let cap = 0, sold = 0; const lim = ECO_FARES.map(k => { cap += C.caps[k] || 0; sold += S.sold[k]; return !C.on || k === 'flex' ? room : cap - sold });
  ECO_FARES.forEach((k, i) => { left[k] = Math.max(0, Math.min(room, ...lim.slice(i))) });
  return left;
}
// silla para un pasajero sin silla elegida: una libre de su cabina o, si la cabina está llena y hay sobreventa, un puesto en espera
function seatFor(l, taken) { const p = pickSeat(l.fare, taken); if (p || l.fare === 'bc') return p;
  const ob = flightCaps(l.route, l.date).overbook, sb = [...taken].filter(isSB).length; if (sb >= ob) return null; let k = 1; while (taken.has('SB' + k)) k++; return 'SB' + k }
// cuando se libera una silla, pasa al primero que está en espera
function promoteStandby() {
  const rows = q("SELECT i.flight, i.seat, i.pax, i.booking_id, b.pnr, b.data FROM seat_inv i JOIN bookings b ON b.id=i.booking_id WHERE i.seat LIKE 'SB%' AND b.status IN ('pending','confirmed') ORDER BY b.id, i.pax"); if (!rows.length) return 0; let n = 0;
  tx(() => { for (const r of rows) { const d = JSON.parse(q1('SELECT data FROM bookings WHERE id=?', r.booking_id).data), li = d.legs.findIndex(l => l.route + '|' + l.date === r.flight); if (li < 0) continue;
    const s = pickSeat(d.legs[li].fare, new Set(takenSeats(r.flight))); if (!s) continue;
    run('UPDATE seat_inv SET seat=? WHERE flight=? AND seat=?', s, r.flight, r.seat); d.legs[li].seats[r.pax] = s; run('UPDATE bookings SET data=?, updated=? WHERE id=?', JSON.stringify(d), now(), r.booking_id);
    log('system', `silla ${s} asignada a ${r.pnr} (estaba en espera ${r.seat})`); n++ } });
  return n;
}
const capsView = (route, date) => { const f = route + '|' + date, C = flightCaps(route, date), S = fareSold(f); return { ...C, sold: S.sold, standby: S.standby, left: fareLeft(route, date), eco_seats: ECO_SEATS, max_overbook: OB_MAX, fares: FARE_NAME } };
on('GET', '/api/admin/caps', ({ req }) => { need(req, 'admin'); return { ...getCaps(), defaults: CAPS_DEFAULT, eco_seats: ECO_SEATS, max_overbook: OB_MAX, fares: FARE_NAME } });
on('PUT', '/api/admin/caps', ({ req, body }) => { const a = need(req, 'admin');
  const peaks = (Array.isArray(body.peaks) ? body.peaks : []).slice(0, 12).map(p => [String(p?.[0] || ''), String(p?.[1] || '')]); for (const [x, y] of peaks) if (!okDay(x) || !okDay(y) || y < x) bad('Revisa las fechas pico: cada rango va de una fecha a otra igual o posterior.');
  const c = { on: body.on !== false, normal: capsInput(body.normal, ' normal'), peak: capsInput(body.peak, ' en fechas pico'), peaks, overbook: obInput(body.overbook ?? 0) };
  run("INSERT INTO settings(key,value) VALUES('fare_caps',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", JSON.stringify(c)); log(a.user.email, `cupos por tarifa actualizados${c.overbook ? ` · sobreventa ${c.overbook}` : ''}`); return { ...c, defaults: CAPS_DEFAULT, eco_seats: ECO_SEATS, max_overbook: OB_MAX, fares: FARE_NAME } });
on('PUT', '/api/admin/flight/caps', ({ req, body }) => { const a = need(req, 'admin'), route = String(body.route || ''), date = String(body.date || ''); if (!scheduled(route, date)) bad('Vuelo no encontrado.');
  const caps = body.caps ? JSON.stringify(capsInput(body.caps, '')) : null, ob = body.overbook === '' || body.overbook == null ? null : obInput(body.overbook), f = route + '|' + date;
  if (caps == null && ob == null) run('DELETE FROM flight_caps WHERE flight=?', f);
  else run('INSERT INTO flight_caps(flight,caps,overbook,updated,by) VALUES(?,?,?,?,?) ON CONFLICT(flight) DO UPDATE SET caps=excluded.caps, overbook=excluded.overbook, updated=excluded.updated, by=excluded.by', f, caps, ob, now(), a.user.email);
  log(a.user.email, `cupos del vuelo ${route} ${date}: ${caps ? 'propios' : 'generales'}${ob != null ? ` · sobreventa ${ob}` : ''}`); return capsView(route, date) });

/* ============ operación irregular: cancelar, cambiar de hora, agregar un vuelo y reacomodar pasajeros ============ */
// Un vuelo cancelado sale de la venta pero sigue visible para atender a sus pasajeros: cada reserva se reacomoda en otra fecha
// sin costo (conserva la silla si está libre) o se reembolsa por causa de operación. Cada novedad deja un aviso para las agencias.
const okHM = v => /^([01]\d|2[0-3]):[0-5]\d$/.test(String(v || ''));
function setFlightOp(route, date, patch, who) {
  const f = route + '|' + date, cur = flightOp(route, date) || { status: null, dep: null, arr: null, note: null }, n = { ...cur, ...patch };
  run('INSERT INTO flight_ops(flight,status,dep,arr,note,updated,by) VALUES(?,?,?,?,?,?,?) ON CONFLICT(flight) DO UPDATE SET status=excluded.status, dep=excluded.dep, arr=excluded.arr, note=excluded.note, updated=excluded.updated, by=excluded.by', f, n.status, n.dep, n.arr, n.note, now(), who);
  if (!n.status && !n.dep && !n.arr) run('DELETE FROM flight_ops WHERE flight=?', f);
  FO = null;
}
const flightNotice = (route, date, kind, message, who) => run('INSERT INTO notices(flight,kind,message,active,created,by) VALUES(?,?,?,1,?,?)', route + '|' + date, kind, clean(message, 400), now(), who);
const dayEs = date => new Intl.DateTimeFormat('es', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' }).format(new Date(date + 'T12:00:00Z'));
const flightName = (route, date) => `${SCHED[route].no} ${route.replace('-', ' → ')} del ${dayEs(date)}`;
// reservas activas con un trayecto en este vuelo
function flightBookings(route, date) { const f = route + '|' + date, names = agencyNames();
  return q("SELECT DISTINCT b.* FROM bookings b JOIN seat_inv i ON i.booking_id=b.id WHERE i.flight=? AND b.status IN ('pending','confirmed') ORDER BY b.id", f).map(b => { const d = JSON.parse(b.data), li = d.legs.findIndex(l => l.route + '|' + l.date === f);
    return { b, d, li, view: { pnr: b.pnr, status: b.status, channel: chName(names, b), agency_id: b.agency_id, pax: d.pax.map(p => `${p.first} ${p.last}`), seats: d.legs[li]?.seats || [], fare: d.legs[li]?.fare, email: d.contact?.email || '', phone: d.contact?.phone || '', total: b.total,
      other: d.legs.filter((_, k) => k !== li).map(l => ({ route: l.route, date: l.date })), refund: q1("SELECT status FROM refunds WHERE booking_id=? AND status IN ('requested','approved') ORDER BY id DESC LIMIT 1", b.id)?.status || null } } });
}
// pasa el trayecto de una reserva a otra fecha de la misma ruta, sin costo: misma silla si está libre; si no, una de su cabina
function moveLeg(b, li, toDate, who) {
  return tx(() => { const d = JSON.parse(b.data), l = d.legs[li], route = l.route, from = l.date; if (toDate === from) bad('La reserva ya está en ese vuelo.');
    if (!SCHED[route] || !operates(route, toDate)) bad(`No hay vuelo ${route} a la venta el ${toDate}.`);
    for (const [k, o] of d.legs.entries()) if (k !== li && ((k < li && o.date >= toDate) || (k > li && o.date <= toDate))) bad(`La reserva ${b.pnr} tiene el otro trayecto el ${o.date}: con esa fecha el regreso quedaría antes de la ida. Reacomódala a mano o cambia también el otro trayecto.`);
    const nf = route + '|' + toDate, taken = new Set(takenSeats(nf)), seats = [];
    for (const s0 of l.seats) { let s = s0 && !isSB(s0) && !taken.has(s0) ? s0 : pickSeat(l.fare, taken); if (!s) throw new HttpErr(409, `No quedan sillas ${l.fare === 'bc' ? 'en Business' : 'en económica'} el ${toDate} para la reserva ${b.pnr}.`, { code: 'sold_out' }); taken.add(s); seats.push(s) }
    run('DELETE FROM seat_inv WHERE booking_id=? AND flight=?', b.id, route + '|' + from);
    const ins = db.prepare('INSERT INTO seat_inv(flight,seat,booking_id,pax) VALUES(?,?,?,?)'); seats.forEach((s, i) => ins.run(nf, s, b.id, i));
    d.legs[li] = { ...l, date: toDate, seats, ...flightTimes(route, toDate), moved: { from, at: now(), by: who } };
    run('UPDATE bookings SET data=?, updated=? WHERE id=?', JSON.stringify(d), now(), b.id);
    log(who, `reacomodo ${b.pnr}: ${route} ${from} -> ${toDate} (${seats.join(', ')})`);
    return { pnr: b.pnr, from, to: toDate, seats, kept: seats.every((s, i) => s === l.seats[i]) } });
}
function flightStatus(route, date) {
  const o = flightOp(route, date), s = SCHED[route], t = flightTimes(route, date), list = flightBookings(route, date), av = availability(route, date);
  const alts = allDates(route).filter(x => x !== date && operates(route, x) && x >= todayISO()).slice(0, 12).map(x => { const a = availability(route, x); return { date: x, eco: a.eco, biz: a.biz, ...flightTimes(route, x) } });
  const pax = list.reduce((n, x) => n + x.view.pax.length, 0);
  return { route, date, no: s.no, status: o?.status === 'cancelled' ? 'cancelled' : o?.status === 'extra' ? 'extra' : 'scheduled', dep: t.dep, arr: t.arr, base: { dep: s.dep, arr: s.arr }, retimed: t.dep !== s.dep || t.arr !== s.arr, note: o?.note || '', updated: o?.updated || null,
    on_sale: operates(route, date), flown: depTime(route, date) <= Date.now(), free: av.eco + av.biz, bookings: list.map(x => x.view), pax, alternatives: alts };
}
on('GET', '/api/admin/flight/status', ({ req, url }) => { need(req, 'admin'); return flightStatus(...flightParam(url)) });
on('POST', '/api/admin/flight/:action', ({ req, params, body }) => {
  const a = need(req, 'admin'), who = a.user.email, route = String(body.route || ''), date = String(body.date || ''), act = params.action;
  if (!SCHED[route] || !okDay(date)) bad('Vuelo no válido.');
  if (act === 'add') {
    if (date < todayISO()) bad('La fecha ya pasó.'); if (scheduled(route, date) && flightOp(route, date)?.status !== 'cancelled') bad('Ese vuelo ya está en la programación.');
    if (body.dep && !okHM(body.dep) || body.arr && !okHM(body.arr)) bad('Las horas van en formato 24 horas, por ejemplo 09:40.');
    setFlightOp(route, date, { status: inPattern(route, date) ? null : 'extra', dep: body.dep && body.dep !== SCHED[route].dep ? body.dep : null, arr: body.arr && body.arr !== SCHED[route].arr ? body.arr : null, note: clean(body.note, 200) || null }, who);
    log(who, `vuelo adicional ${route} ${date}`); return flightStatus(route, date) }
  if (!scheduled(route, date)) bad('Ese vuelo no está en la programación.'); if (depTime(route, date) <= Date.now()) bad('Ese vuelo ya salió.');
  const cur = flightOp(route, date);
  if (act === 'cancel') {
    if (cur?.status === 'cancelled') bad('Ese vuelo ya está cancelado.'); const note = clean(body.note, 200); if (note.length < 3) bad('Escribe el motivo de la cancelación.');
    setFlightOp(route, date, { status: 'cancelled', note }, who); flightNotice(route, date, 'operacion', `Vuelo ${flightName(route, date)} cancelado. ${note}. Beemo Air reacomoda sin costo a los pasajeros o devuelve el 100 % de lo pagado.`, who);
    log(who, `vuelo cancelado ${route} ${date}: ${note}`);
  } else if (act === 'reopen') {
    if (cur?.status !== 'cancelled') bad('Ese vuelo no está cancelado.'); setFlightOp(route, date, { status: inPattern(route, date) ? null : 'extra', note: null }, who);
    flightNotice(route, date, 'operacion', `El vuelo ${flightName(route, date)} vuelve a operar y está de nuevo a la venta.`, who); log(who, `vuelo reabierto ${route} ${date}`);
  } else if (act === 'retime') {
    if (!okHM(body.dep) || !okHM(body.arr)) bad('Las horas van en formato 24 horas, por ejemplo 09:40.'); const s = SCHED[route], old = flightTimes(route, date);
    if (old.dep === body.dep && old.arr === body.arr) bad('El vuelo ya tiene ese horario.');
    tx(() => { setFlightOp(route, date, { dep: body.dep === s.dep ? null : body.dep, arr: body.arr === s.arr ? null : body.arr, note: clean(body.note, 200) || cur?.note || null }, who);
      // el horario va copiado en cada reserva: se actualiza para que el tiquete y el portal muestren la hora nueva
      for (const { b, d, li } of flightBookings(route, date)) { d.legs[li] = { ...d.legs[li], dep: body.dep, arr: body.arr, retimed: { from: old.dep, at: now() } }; run('UPDATE bookings SET data=?, updated=? WHERE id=?', JSON.stringify(d), now(), b.id) } });
    flightNotice(route, date, 'horario', `Cambio de horario del vuelo ${flightName(route, date)}: sale a las ${body.dep} y llega a las ${body.arr} (antes ${old.dep} → ${old.arr}).${body.note ? ' ' + clean(body.note, 200) : ''}`, who);
    log(who, `cambio de hora ${route} ${date}: ${old.dep} -> ${body.dep}`);
  } else if (act === 'move') {
    // una reserva (pnr) o todas las del vuelo, hacia otra fecha de la misma ruta
    const to = String(body.to || ''); if (!okDay(to)) bad('Elige el vuelo de destino.');
    const list = flightBookings(route, date).filter(x => !body.pnr || x.view.pnr === String(body.pnr).toUpperCase()); if (!list.length) bad(body.pnr ? 'Esa reserva no está en este vuelo.' : 'Este vuelo no tiene reservas activas.');
    const moved = [], failed = [];
    for (const x of list) { if (x.view.refund) { failed.push({ pnr: x.view.pnr, error: 'Tiene un reembolso en curso.' }); continue } try { moved.push(moveLeg(x.b, x.li, to, who)) } catch (e) { if (!(e instanceof HttpErr)) throw e; failed.push({ pnr: x.view.pnr, error: e.message }) } }
    if (body.pnr && failed.length) throw new HttpErr(409, failed[0].error);
    return { ...flightStatus(route, date), moved, failed };
  } else if (act === 'refund') {
    // abre el reembolso por operación de una reserva del vuelo; se aprueba en Reservas → Reembolsos
    const x = flightBookings(route, date).find(k => k.view.pnr === String(body.pnr || '').toUpperCase()); if (!x) bad('Esa reserva no está en este vuelo.');
    if (x.b.status !== 'confirmed') { releaseBooking(x.b, 'cancelled', who); return { ...flightStatus(route, date), released: x.view.pnr } }
    refundCreate(x.b, { cause: 'operacion', note: `Vuelo ${flightName(route, date)}: ${flightOp(route, date)?.status === 'cancelled' ? 'cancelado' : 'cambio de operación'}` }, 'admin', who);
  } else bad('Acción no válida.');
  return flightStatus(route, date);
});

/* ============ reembolsos: política por tarifa, monto sugerido, aprobación con monto fijado y pago ============ */
// Tres causas. «operacion» (Beemo canceló o cambió el vuelo): todo lo pagado. «voluntaria» (el pasajero no viaja): un porcentaje de
// la tarifa según la familia y la anticipación, más las tasas de los trayectos sin volar. «excepcion»: monto que fija el administrador.
// El sistema sugiere; el administrador aprueba y puede fijar otro monto con su motivo. Ninguna tarifa devuelve más que Flex BC.
db.exec(`CREATE TABLE IF NOT EXISTS refunds(id INTEGER PRIMARY KEY, booking_id INTEGER NOT NULL REFERENCES bookings(id), cause TEXT NOT NULL, status TEXT NOT NULL, cancel INTEGER NOT NULL DEFAULT 1, side TEXT NOT NULL, requested_by TEXT, note TEXT,
  basis REAL NOT NULL DEFAULT 0, suggested REAL NOT NULL DEFAULT 0, amount REAL, retained REAL, payer TEXT, method TEXT, ref TEXT, reason TEXT, detail TEXT, created TEXT NOT NULL, decided TEXT, decided_by TEXT, paid_at TEXT, paid_by TEXT);
CREATE INDEX IF NOT EXISTS ix_refunds_b ON refunds(booking_id); CREATE INDEX IF NOT EXISTS ix_refunds_s ON refunds(status);`);
const RF_CAUSE = { operacion: 'Operación de Beemo Air', voluntaria: 'Voluntaria del pasajero', excepcion: 'Excepción' };
const RF_DEFAULT = { days: 7, hours: 24, pct: { light: [0, 0, 0], basic: [0, 0, 0], classic: [25, 0, 0], plus: [50, 25, 0], flex: [75, 50, 0], bc: [90, 75, 0] } };
function getRefundPolicy() { const r = q1("SELECT value FROM settings WHERE key='refund_policy'"); try { const p = r ? JSON.parse(r.value) : null; if (p && p.pct && Object.keys(RF_DEFAULT.pct).every(k => Array.isArray(p.pct[k]) && p.pct[k].length === 3)) return p } catch (e) {} return RF_DEFAULT }
function refundPolicyInput(body) {
  const days = Math.round(+body.days), hours = Math.round(+body.hours); if (!(days >= 1 && days <= 60)) bad('El primer plazo va entre 1 y 60 días antes del vuelo.'); if (!(hours >= 0 && hours < days * 24)) bad('El segundo plazo, en horas, debe ser menor que el primero.');
  const pct = {};
  for (const k of Object.keys(RF_DEFAULT.pct)) { const a = (body.pct?.[k] || []).map(Number); if (a.length !== 3 || a.some(v => !Number.isFinite(v) || v < 0 || v > 100)) bad(`Revisa los porcentajes de ${FARE_NAME[k]}: van de 0 a 100.`);
    if (a[1] > a[0] || a[2] > a[1]) bad(`En ${FARE_NAME[k]} el porcentaje no puede subir al acercarse el vuelo.`); pct[k] = a.map(v => Math.round(v * 10) / 10) }
  for (const k of Object.keys(pct)) for (let i = 0; i < 3; i++) if (k !== 'bc' && pct[k][i] > pct.bc[i]) bad(`${FARE_NAME[k]} no puede devolver más que ${FARE_NAME.bc} en el mismo plazo.`);
  return { days, hours, pct };
}
on('GET', '/api/admin/refund-policy', ({ req }) => { need(req, 'admin'); return { ...getRefundPolicy(), fares: FARE_NAME, defaults: RF_DEFAULT } });
on('PUT', '/api/admin/refund-policy', ({ req, body }) => { const a = need(req, 'admin'), p = refundPolicyInput(body); run("INSERT INTO settings(key,value) VALUES('refund_policy',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", JSON.stringify(p)); log(a.user.email, 'política de reembolsos actualizada'); return { ...p, fares: FARE_NAME, defaults: RF_DEFAULT } });
on('GET', '/api/agency/refund-policy', ({ req }) => { need(req, 'agent'); return { ...getRefundPolicy(), fares: FARE_NAME } });
// lo que el cliente ha pagado por la reserva: total, más extras y cambios ya cobrados, menos lo ya devuelto
function refundBasis(b) {
  const adds = q1("SELECT COALESCE(SUM(qty*unit),0) n FROM addons WHERE booking_id=? AND status='paid'", b.id).n, chg = q1("SELECT COALESCE(SUM(amount),0) n FROM changes WHERE booking_id=? AND status IN ('paid','confirmed','settled')", b.id).n;
  const back = q1("SELECT COALESCE(SUM(amount),0) n FROM refunds WHERE booking_id=? AND status IN ('approved','paid')", b.id).n;
  return { paid: r2(b.total + adds + chg), refunded: r2(back), basis: Math.max(0, r2(b.total + adds + chg - back)) };
}
// promesa publicada en /reembolsos/: quien compra con 7 días o más de anticipación puede cancelar sin costo dentro de las 24 horas siguientes
const in24h = (b, d, nowMs = Date.now()) => { const made = Date.parse(b.created), dep = Math.min(...d.legs.map(l => depTime(l.route, l.date)));
  return nowMs - made <= 24 * 36e5 && dep - made >= 7 * 864e5 };
function refundQuote(b, cause) {
  if (!RF_CAUSE[cause]) bad('Elige la causa del reembolso.');
  const d = JSON.parse(b.data), P = getRefundPolicy(), B = refundBasis(b), n = d.pax.length, lines = [], nowMs = Date.now(); let sug = 0;
  if (cause === 'operacion') { sug = B.basis; lines.push({ label: 'Todo lo pagado: tarifa, tasas y extras', amount: B.basis }) }
  else if (cause === 'voluntaria' && in24h(b, d, nowMs)) { sug = B.basis; lines.push({ label: 'Cancelación dentro de las 24 horas siguientes a la compra (hecha 7 días o más antes del vuelo): todo lo pagado', amount: B.basis }) }
  else if (cause === 'voluntaria') for (const l of d.legs) {
    const h = (depTime(l.route, l.date) - nowMs) / 36e5, name = `${l.route.replace('-', ' → ')} · ${l.date} · ${FARE_NAME[l.fare]}`;
    if (h <= 0) { lines.push({ label: `${name}: ya voló`, amount: 0 }); continue }
    const i = h > P.days * 24 ? 0 : h > P.hours ? 1 : 2, pct = P.pct[l.fare]?.[i] ?? 0, net = Math.max(0, priceOf(l.date, l.fare) - TAX_LEG) * n, tax = r2(TAX_LEG * n), fare = r2(net * pct / 100);
    const when = i === 0 ? `más de ${P.days} días antes` : i === 1 ? `entre ${P.days} días y ${P.hours} horas antes` : `menos de ${P.hours} horas antes`;
    lines.push({ label: `${name}: ${pct} % de la tarifa (${when})`, amount: fare }, { label: `${name}: tasas no usadas`, amount: tax }); sug += fare + tax }
  else lines.push({ label: 'Excepción: el monto lo fija Beemo Air', amount: 0 });
  if (b.pass_code && cause !== 'excepcion') lines.push({ label: 'Reserva con pase de temporada: los trayectos del pase vuelven al pase; solo se devuelve lo pagado en dinero', amount: 0 });
  sug = Math.min(r2(sug), B.basis);
  return { cause, ...B, suggested: sug, lines, pay_method: b.pay_method, settled: !!b.settled };
}
const refundView = (r, names) => { const b = q1('SELECT pnr, agency_id, channel, pay_method, settled, status, data FROM bookings WHERE id=?', r.booking_id), d = JSON.parse(b.data);
  return { id: r.id, pnr: b.pnr, channel: chName(names, b), agency_id: b.agency_id, booking_status: b.status, pax: d.pax.map(p => `${p.first} ${p.last}`), legs: d.legs.map(l => ({ route: l.route, date: l.date, fare: l.fare })), cause: r.cause, status: r.status, cancel: !!r.cancel, side: r.side, requested_by: r.requested_by, note: r.note,
    basis: r.basis, suggested: r.suggested, amount: r.amount, retained: r.retained, payer: r.payer, method: r.method, ref: r.ref, reason: r.reason, lines: (() => { try { return JSON.parse(r.detail || '[]') } catch (e) { return [] } })(), created: r.created, decided: r.decided, decided_by: r.decided_by, paid_at: r.paid_at } };
function refundCreate(b, body, side, who) {
  const cause = String(body.cause || ''); if (side === 'agency' && cause === 'excepcion') bad('Las excepciones las abre Beemo Air. Elige otra causa y explica el caso en la nota.');
  if (b.status !== 'confirmed') bad(b.status === 'pending' ? 'Esta reserva no se ha pagado: anúlala en lugar de pedir reembolso.' : 'Esta reserva ya no está activa.');
  if (q1("SELECT 1 FROM refunds WHERE booking_id=? AND status='requested'", b.id)) bad('Esta reserva ya tiene una solicitud de reembolso en revisión.');
  const Q = refundQuote(b, cause), note = clean(body.note, 500); if (side === 'agency' && note.length < 5) bad('Cuéntanos el motivo en la nota.');
  if (Q.basis <= 0) bad('Esta reserva no tiene dinero por devolver.');
  const id = Number(run('INSERT INTO refunds(booking_id,cause,status,cancel,side,requested_by,note,basis,suggested,detail,created) VALUES(?,?,?,?,?,?,?,?,?,?,?)', b.id, cause, 'requested', cause === 'excepcion' && body.cancel === false ? 0 : 1, side, who, note, Q.basis, Q.suggested, JSON.stringify(Q.lines), now()).lastInsertRowid);
  log(who, `reembolso solicitado ${b.pnr} (${cause}) sugerido ${Q.suggested}`); return id;
}
on('GET', '/api/agency/bookings/:pnr/refund-quote', ({ req, params, url }) => { const a = need(req, 'agent'); return refundQuote(myBooking(a, params.pnr), url.searchParams.get('cause') || 'voluntaria') });
on('POST', '/api/agency/bookings/:pnr/refund', ({ req, params, body }) => { const a = need(req, 'agent'), id = refundCreate(myBooking(a, params.pnr), body, 'agency', a.user.email); return refundView(q1('SELECT * FROM refunds WHERE id=?', id), agencyNames()) });
on('GET', '/api/agency/refunds', ({ req }) => { const a = need(req, 'agent'), names = agencyNames(); return q('SELECT r.* FROM refunds r JOIN bookings b ON b.id=r.booking_id WHERE b.agency_id=? ORDER BY r.id DESC LIMIT 300', a.agency.id).map(r => refundView(r, names)) });
const adminBooking = pnr => { const b = q1('SELECT * FROM bookings WHERE pnr=?', String(pnr || '').toUpperCase()); if (!b) throw new HttpErr(404, 'Reserva no encontrada.'); return b };
on('GET', '/api/admin/bookings/:pnr/refund-quote', ({ req, params, url }) => { need(req, 'admin'); return refundQuote(adminBooking(params.pnr), url.searchParams.get('cause') || 'voluntaria') });
on('POST', '/api/admin/refunds', ({ req, body }) => { const a = need(req, 'admin'), id = refundCreate(adminBooking(body.pnr), body, 'admin', a.user.email); return refundView(q1('SELECT * FROM refunds WHERE id=?', id), agencyNames()) });
on('GET', '/api/admin/refunds', ({ req, url }) => { need(req, 'admin'); const names = agencyNames(), st = url.searchParams.get('status');
  const L = (st ? q('SELECT * FROM refunds WHERE status=? ORDER BY id DESC LIMIT 500', st) : q('SELECT * FROM refunds ORDER BY id DESC LIMIT 500')).map(r => refundView(r, names)), sum = (k, f) => r2(L.filter(x => x.status === k).reduce((t, x) => t + (f(x) || 0), 0));
  return { refunds: L, totals: { requested: L.filter(x => x.status === 'requested').length, to_pay: sum('approved', x => x.amount), paid: sum('paid', x => x.amount), retained: r2(sum('approved', x => x.retained) + sum('paid', x => x.retained)) }, causes: RF_CAUSE } });
on('POST', '/api/admin/refunds/:id/:action', ({ req, params, body }) => {
  const a = need(req, 'admin'), r = q1('SELECT * FROM refunds WHERE id=?', +params.id); if (!r) throw new HttpErr(404, 'Solicitud no encontrada.');
  const b = q1('SELECT * FROM bookings WHERE id=?', r.booking_id), who = a.user.email;
  if (params.action === 'quote') return refundQuote(b, String(body.cause || r.cause));
  if (params.action === 'approve') {
    if (r.status !== 'requested') bad('Esta solicitud ya fue resuelta.');
    const cause = RF_CAUSE[body.cause] ? body.cause : r.cause, Q = refundQuote(b, cause), cancel = cause === 'excepcion' ? body.cancel !== false && !!r.cancel : true;
    const amount = body.amount === '' || body.amount == null ? Q.suggested : r2(Number(body.amount)); if (!Number.isFinite(amount) || amount < 0) bad('Revisa el monto a devolver.');
    if (amount > Q.basis) bad(`No se puede devolver más de lo pagado: US$${Q.basis.toFixed(2)}.`);
    const reason = clean(body.reason, 300); if (Math.abs(amount - Q.suggested) >= 0.01 && reason.length < 5) bad('El monto es distinto al sugerido: escribe el motivo.');
    if (cancel && b.status !== 'confirmed') bad('La reserva ya no está emitida. Rechaza esta solicitud o apruébala como excepción sin anular.');
    // quién le entrega el dinero al cliente: la agencia si ella lo tiene (cobro en agencia sin consignar); si no, Beemo Air
    const payer = b.pay_method === 'cash' && !b.settled && b.agency_id ? 'agencia' : 'beemo', retained = cancel ? r2(Q.basis - amount) : 0;
    run("UPDATE refunds SET status='approved', cause=?, cancel=?, basis=?, suggested=?, amount=?, retained=?, payer=?, reason=?, detail=?, decided=?, decided_by=? WHERE id=?", cause, cancel ? 1 : 0, Q.basis, Q.suggested, amount, retained, payer, reason || null, JSON.stringify(Q.lines), now(), who, r.id);
    if (cancel) releaseBooking(b, 'cancelled', who);
    log(who, `reembolso aprobado ${b.pnr}: ${amount} de ${Q.basis} (${cause})${cancel ? ', reserva anulada' : ''}`);
  } else if (params.action === 'reject') {
    if (r.status !== 'requested') bad('Esta solicitud ya fue resuelta.'); const reason = clean(body.reason, 300); if (reason.length < 5) bad('Escribe el motivo del rechazo: la agencia lo verá.');
    run("UPDATE refunds SET status='rejected', reason=?, decided=?, decided_by=? WHERE id=?", reason, now(), who, r.id); log(who, `reembolso rechazado ${b.pnr}`);
  } else if (params.action === 'paid') {
    if (r.status !== 'approved') bad('Solo se marca como pagado un reembolso aprobado.'); const method = ['tarjeta', 'transferencia', 'efectivo', 'agencia'].includes(body.method) ? body.method : null; if (!method) bad('Elige por dónde se devolvió el dinero.');
    run("UPDATE refunds SET status='paid', method=?, ref=?, paid_at=?, paid_by=? WHERE id=?", method, clean(body.ref, 80) || null, now(), who, r.id); log(who, `reembolso pagado ${b.pnr}: ${r.amount} por ${method}`);
  } else bad('Acción no válida.');
  return refundView(q1('SELECT * FROM refunds WHERE id=?', r.id), agencyNames());
});
// lo retenido de un reembolso cuyo dinero tiene la agencia sigue siendo de Beemo Air: va a su saldo por consignar hasta que se cierre
const refundAgencyDue = agencyId => r2(q1("SELECT COALESCE(SUM(r.retained),0) n FROM refunds r JOIN bookings b ON b.id=r.booking_id WHERE b.agency_id=? AND r.status='approved' AND r.payer='agencia'", agencyId).n);

/* ============ CRM de pasajeros: una ficha por persona, vista por agencia y vista central ============ */
// Cada pasajero de cada reserva queda unido a una ficha (crm_customers). La agencia ve solo las fichas que tienen
// reservas suyas y solo sus propias reservas, notas y datos de viaje; el administrador ve todo, con filtro por canal.
// Los datos de viaje (documento, nacionalidad, nacimiento) van por pasajero y reserva: son los que pide el manifiesto.
db.exec(`CREATE TABLE IF NOT EXISTS crm_customers(id INTEGER PRIMARY KEY, key TEXT NOT NULL UNIQUE, first TEXT NOT NULL, last TEXT NOT NULL, created TEXT NOT NULL, updated TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS crm_pax(booking_id INTEGER NOT NULL REFERENCES bookings(id), pax INTEGER NOT NULL, customer_id INTEGER NOT NULL REFERENCES crm_customers(id), doc_type TEXT, doc_no TEXT, doc_country TEXT, doc_exp TEXT, nationality TEXT, dob TEXT, gender TEXT, updated TEXT, by TEXT, PRIMARY KEY(booking_id, pax));
CREATE INDEX IF NOT EXISTS ix_crm_pax_c ON crm_pax(customer_id);
CREATE INDEX IF NOT EXISTS ix_crm_pax_doc ON crm_pax(doc_no);
CREATE TABLE IF NOT EXISTS crm_notes(id INTEGER PRIMARY KEY, customer_id INTEGER NOT NULL REFERENCES crm_customers(id), agency_id INTEGER, author TEXT, body TEXT NOT NULL, created TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS ix_crm_notes_c ON crm_notes(customer_id);`);
for (const c of ['phone TEXT', 'email TEXT', 'ssr TEXT', 'ssr_note TEXT', 'inf_first TEXT', 'inf_last TEXT', 'inf_dob TEXT', 'inf_gender TEXT', 'inf_doc_no TEXT', 'inf_doc_country TEXT', 'inf_doc_exp TEXT', 'inf_nationality TEXT']) { try { db.exec('ALTER TABLE crm_pax ADD COLUMN ' + c) } catch (e) {} }
try { db.exec('ALTER TABLE bookings ADD COLUMN op_ref TEXT') } catch (e) {}   // localizador de la reserva en el sistema del operador
db.exec(`CREATE TABLE IF NOT EXISTS manifest_sends(id INTEGER PRIMARY KEY, flight TEXT NOT NULL, at TEXT NOT NULL, by TEXT, pax INTEGER NOT NULL, rows TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS ix_msend_f ON manifest_sends(flight);`);
const TRAVEL_F = ['doc_type', 'doc_no', 'doc_country', 'doc_exp', 'nationality', 'dob', 'gender'];
const TRAVEL_INF = ['inf_first', 'inf_last', 'inf_dob', 'inf_gender', 'inf_doc_no', 'inf_doc_country', 'inf_doc_exp', 'inf_nationality'];
const TRAVEL_X = ['phone', 'email', 'ssr', 'ssr_note', ...TRAVEL_INF], TRAVEL_ALL = [...TRAVEL_F, ...TRAVEL_X];
// servicios especiales (códigos de uso común en aerolíneas): son solicitudes, Beemo Air las confirma con el operador
const SSR = { WCHR: 'Silla de ruedas hasta la puerta del avión', WCHS: 'Silla de ruedas, no sube escaleras', WCHC: 'Silla de ruedas hasta el asiento', BLND: 'Pasajero con discapacidad visual', DEAF: 'Pasajero con discapacidad auditiva', UMNR: 'Menor que viaja sin acompañante', PETC: 'Mascota en cabina', MAAS: 'Necesita asistencia en el aeropuerto' };
const SSR_SENSITIVE = new Set(['WCHR', 'WCHS', 'WCHC', 'BLND', 'DEAF']);   // salud o discapacidad: dato sensible
const ssrOf = r => { try { const a = JSON.parse(r?.ssr || '[]'); return Array.isArray(a) ? a.filter(k => SSR[k]) : [] } catch (e) { return [] } };
const DOC_TYPES_PAX = { P: 'Pasaporte', C: 'Cédula', O: 'Otro documento' };
const travelOf = r => r && r.doc_no ? { ...Object.fromEntries(TRAVEL_F.map(k => [k, r[k] || ''])), phone: r.phone || '', email: r.email || '', ssr: ssrOf(r), ssr_note: r.ssr_note || '',
  infant: r.inf_first ? { first: r.inf_first, last: r.inf_last || '', dob: r.inf_dob || '', gender: r.inf_gender || '', doc_no: r.inf_doc_no || '', doc_country: r.inf_doc_country || '', doc_exp: r.inf_doc_exp || '', nationality: r.inf_nationality || '' } : null } : null;
// completos: los del adulto y, si lleva un bebé en brazos, también los del bebé
const travelDone = (r, inf) => !!r && TRAVEL_F.every(k => r[k]) && (!inf || TRAVEL_INF.every(k => r[k]));
const crmName = p => norm(p.first + ' ' + p.last).replace(/\s+/g, ' ');
const crmNameKey = (p, contact) => crmName(p) + '|' + norm(contact?.email);
function crmNew(key, p) { const ts = now(); if (q1('SELECT 1 FROM crm_customers WHERE key=?', key)) key += '#' + rnd(6); return Number(run('INSERT INTO crm_customers(key,first,last,created,updated) VALUES(?,?,?,?,?)', key, p.first, p.last, ts, ts).lastInsertRowid) }
// une la ficha «from» a «to»: sus reservas y sus notas pasan a la otra
function crmMerge(from, to) { if (from === to) return; run('UPDATE crm_pax SET customer_id=? WHERE customer_id=?', to, from); run('UPDATE crm_notes SET customer_id=? WHERE customer_id=?', to, from); run('DELETE FROM crm_customers WHERE id=?', from) }
function crmTidy(id, to) { if (!id || id === to || q1('SELECT 1 FROM crm_pax WHERE customer_id=?', id)) return; if (to) run('UPDATE crm_notes SET customer_id=? WHERE customer_id=?', to, id); if (!q1('SELECT 1 FROM crm_notes WHERE customer_id=?', id)) run('DELETE FROM crm_customers WHERE id=?', id) }
// decide a qué ficha pertenece un pasajero. Mismo nombre y mismo correo de contacto: misma persona, aunque viaje con otro
// documento (doble nacionalidad, pasaporte renovado). Mismo documento en otra reserva: misma persona, aunque cambie el correo.
function crmAssign(bid, i, p, contact) {
  const row = q1('SELECT * FROM crm_pax WHERE booking_id=? AND pax=?', bid, i), cur = row ? q1('SELECT * FROM crm_customers WHERE id=?', row.customer_id) : null;
  const nk = crmNameKey(p, contact), byName = q1('SELECT * FROM crm_customers WHERE key=?', nk), alone = cur && !q1('SELECT 1 FROM crm_pax WHERE customer_id=? AND NOT (booking_id=? AND pax=?)', cur.id, bid, i);
  let id;
  if (cur && crmName(cur) === crmName(p)) id = cur.id;
  else if (byName) id = byName.id;
  else if (alone) { id = cur.id; run('UPDATE crm_customers SET key=?, first=?, last=?, updated=? WHERE id=?', nk, p.first, p.last, now(), id) }   // corrección del nombre en su única reserva
  else id = crmNew(nk, p);
  if (row && row.doc_no) {
    const other = q1('SELECT customer_id FROM crm_pax WHERE doc_country=? AND doc_no=? AND customer_id<>? ORDER BY updated LIMIT 1', row.doc_country, row.doc_no, id);
    // quien ya tiene otro documento distinto en sus reservas no se une entera: solo pasa este pasajero
    if (other) { if (!q1('SELECT 1 FROM crm_pax WHERE customer_id=? AND doc_no IS NOT NULL AND NOT (doc_country=? AND doc_no=?)', id, row.doc_country, row.doc_no)) crmMerge(id, other.customer_id); id = other.customer_id }
  }
  if (row) { if (row.customer_id !== id) run('UPDATE crm_pax SET customer_id=? WHERE booking_id=? AND pax=?', id, bid, i) }
  else {
    run('INSERT INTO crm_pax(booking_id,pax,customer_id) VALUES(?,?,?)', bid, i, id);
    // cliente que vuelve: se traen sus datos de viaje de la última reserva del mismo canal (misma agencia, o venta directa)
    const b = q1('SELECT agency_id FROM bookings WHERE id=?', bid), prev = q1(`SELECT cp.* FROM crm_pax cp JOIN bookings b ON b.id=cp.booking_id WHERE cp.customer_id=? AND cp.doc_no IS NOT NULL AND b.agency_id IS ? AND NOT (cp.booking_id=? AND cp.pax=?) ORDER BY cp.updated DESC LIMIT 1`, id, b.agency_id, bid, i);
    if (prev) run(`UPDATE crm_pax SET ${[...TRAVEL_F, 'phone', 'email'].map(k => k + '=?').join(', ')}, updated=?, by=? WHERE booking_id=? AND pax=?`, ...[...TRAVEL_F, 'phone', 'email'].map(k => prev[k]), prev.updated, prev.by, bid, i);
  }
  if (cur && cur.id !== id) crmTidy(cur.id, id);
  return id;
}
function crmLinkBooking(bid) { const b = q1('SELECT data FROM bookings WHERE id=?', bid); if (!b) return; const d = JSON.parse(b.data); d.pax.forEach((p, i) => crmAssign(bid, i, p, d.contact)) }
// al editar una reserva pendiente los pasajeros pueden cambiar de posición: «from» dice de dónde viene cada uno
function crmRemap(bid, from) {
  const old = q('SELECT * FROM crm_pax WHERE booking_id=?', bid), byPax = Object.fromEntries(old.map(r => [r.pax, r]));
  run('DELETE FROM crm_pax WHERE booking_id=?', bid);
  const ins = db.prepare(`INSERT INTO crm_pax(booking_id,pax,customer_id,${TRAVEL_ALL.join(',')},updated,by) VALUES(?,?,?,${TRAVEL_ALL.map(() => '?').join(',')},?,?)`);
  from.forEach((f, i) => { const r = f == null ? null : byPax[f]; if (r) ins.run(bid, i, r.customer_id, ...TRAVEL_ALL.map(k => r[k]), r.updated, r.by) });
  crmLinkBooking(bid);
  for (const r of old) crmTidy(r.customer_id, null);
}
// reservas anteriores a este módulo: se enlazan al arrancar
try { tx(() => { for (const b of q('SELECT id FROM bookings b WHERE NOT EXISTS (SELECT 1 FROM crm_pax cp WHERE cp.booking_id=b.id)')) crmLinkBooking(b.id) }) } catch (e) { console.error('crm backfill', e) }

const ISO3 = /^[A-Z]{3}$/, okDate = v => /^\d{4}-\d{2}-\d{2}$/.test(v) && !isNaN(Date.parse(v + 'T12:00:00Z')) && new Date(v + 'T12:00:00Z').toISOString().slice(0, 10) === v;
function travelInput(body, p, last) {
  const up3 = v => String(v || '').toUpperCase().trim(), docNo = v => String(v || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  const t = { doc_type: String(body.doc_type || '').toUpperCase(), doc_no: docNo(body.doc_no), doc_country: up3(body.doc_country), doc_exp: String(body.doc_exp || '').trim(),
    nationality: up3(body.nationality), dob: String(body.dob || '').trim(), gender: String(body.gender || '').toUpperCase() };
  if (!DOC_TYPES_PAX[t.doc_type]) bad('Elige el tipo de documento.');
  if (t.doc_no.length < 4 || t.doc_no.length > 20) bad('Revisa el número del documento: solo letras y números, sin espacios.');
  if (!ISO3.test(t.doc_country)) bad('El país que expidió el documento va con su código de tres letras, por ejemplo COL o USA.');
  if (!ISO3.test(t.nationality)) bad('La nacionalidad va con su código de tres letras, por ejemplo COL o USA.');
  if (!okDate(t.dob) || t.dob >= todayISO() || t.dob < '1900-01-01') bad('Revisa la fecha de nacimiento.');
  if (t.doc_exp && !okDate(t.doc_exp)) bad('Revisa la fecha de vencimiento del documento.');
  if (t.doc_type === 'P' && !t.doc_exp) bad('Falta la fecha de vencimiento del pasaporte.');
  if (t.doc_exp && t.doc_exp < last) bad(`El documento vence antes del vuelo del ${last}. Pide al pasajero uno vigente.`);
  if (!['M', 'F', 'X'].includes(t.gender)) bad('Elige el género tal como aparece en el documento.');
  // contacto propio del pasajero (opcional) y servicios especiales
  t.phone = clean(body.phone, 40); t.email = clean(body.email, 120).toLowerCase(); if (t.email && !okEmail(t.email)) bad('Revisa el correo del pasajero.');
  const ssr = [...new Set((Array.isArray(body.ssr) ? body.ssr : []).map(k => String(k).toUpperCase()).filter(k => SSR[k]))];
  t.ssr = ssr.length ? JSON.stringify(ssr) : null; t.ssr_note = clean(body.ssr_note, 300);
  if (ssr.includes('UMNR') && t.dob <= new Date(Date.parse(last + 'T12:00:00Z') - 18 * 365.25 * 864e5).toISOString().slice(0, 10)) bad('«Menor sin acompañante» solo aplica a menores de 18 años.');
  // bebé en brazos: viaja sin silla, pero va en el manifiesto con su nombre y su documento
  for (const k of TRAVEL_INF) t[k] = null;
  if (p.inf) { const b = body.infant || {}, f = { inf_first: clean(b.first, 40), inf_last: clean(b.last, 40), inf_dob: String(b.dob || '').trim(), inf_gender: String(b.gender || '').toUpperCase(), inf_doc_no: docNo(b.doc_no), inf_doc_country: up3(b.doc_country), inf_doc_exp: String(b.doc_exp || '').trim(), inf_nationality: up3(b.nationality) };
    if (!f.inf_first || !f.inf_last) bad('Falta el nombre o el apellido del bebé.');
    if (!okDate(f.inf_dob) || f.inf_dob >= todayISO()) bad('Revisa la fecha de nacimiento del bebé.');
    const two = new Date(Date.parse(f.inf_dob + 'T12:00:00Z')); two.setUTCFullYear(two.getUTCFullYear() + 2);
    if (two.toISOString().slice(0, 10) <= last) bad(`El bebé ya tendrá 2 años el ${last}: necesita su propia silla. Quita «bebé en brazos» y agrégalo como pasajero.`);
    if (!['M', 'F', 'X'].includes(f.inf_gender)) bad('Elige el género del bebé tal como aparece en su documento.');
    if (f.inf_doc_no.length < 4 || f.inf_doc_no.length > 20) bad('Revisa el número del documento del bebé.');
    if (!ISO3.test(f.inf_doc_country) || !ISO3.test(f.inf_nationality)) bad('El país del documento y la nacionalidad del bebé van con su código de tres letras, por ejemplo COL o USA.');
    if (!okDate(f.inf_doc_exp)) bad('Falta la fecha de vencimiento del documento del bebé.');
    if (f.inf_doc_exp < last) bad(`El documento del bebé vence antes del vuelo del ${last}.`);
    Object.assign(t, f) }
  return t;
}
function travelSave(b, body, who, ctx = {}) {
  const d = JSON.parse(b.data), i = +body.pax; if (!Number.isInteger(i) || !d.pax[i]) bad('Pasajero no válido.');
  if (!['pending', 'confirmed'].includes(b.status)) bad('Esta reserva ya no está activa.');
  const t = travelInput(body, d.pax[i], d.legs.reduce((m, l) => l.date > m ? l.date : m, ''));
  const sens = ssrOf(t).filter(k => SSR_SENSITIVE.has(k));
  if (sens.length && !yes(body.sensitive_ok)) bad('Confirma que el pasajero autorizó compartir esta información de salud o discapacidad con la aerolínea para recibir asistencia.', { code: 'consent_sensitive' });
  tx(() => { crmAssign(b.id, i, d.pax[i], d.contact);
    run(`UPDATE crm_pax SET ${TRAVEL_ALL.map(k => k + '=?').join(', ')}, updated=?, by=? WHERE booking_id=? AND pax=?`, ...TRAVEL_ALL.map(k => t[k] || null), now(), who, b.id, i);
    crmAssign(b.id, i, d.pax[i], d.contact) });
  if (sens.length) consentLog({ sensitive: true, labels: { sensitive: body.sensitive_label }, page: 'portal:datos-de-viaje', lang: 'es' }, { form: 'datos_viaje', subject: t.email || d.contact?.email, name: `${d.pax[i].first} ${d.pax[i].last}`, ref: b.pnr, channel: b.agency_id ? 'agencia' : 'web', by: ctx.by || who, ip: ctx.ip, req: ctx.req, docs: ['sensitive'] });
  log(who, `datos de viaje ${b.pnr} pasajero ${i + 1}`);
  return bookingView(q1('SELECT * FROM bookings WHERE id=?', b.id), { private: true });
}
on('PUT', '/api/agency/bookings/:pnr/travel', ({ req, params, body, ip }) => { const a = need(req, 'agent'); return travelSave(myBooking(a, params.pnr), body, a.user.email, { ip, req, by: `${a.agency.name} · ${a.user.email}` }) });
on('PUT', '/api/admin/bookings/:pnr/travel', ({ req, params, body, ip }) => { const a = need(req, 'admin'); const b = q1('SELECT * FROM bookings WHERE pnr=?', String(params.pnr || '').toUpperCase()); if (!b) throw new HttpErr(404, 'Reserva no encontrada.'); return travelSave(b, body, a.user.email, { ip, req, by: `Beemo Air · ${a.user.email}` }) });

// fichas visibles en un alcance: { agency: id } para una agencia, { agency: 'web' } para venta directa, {} para todo
function crmRows(scope) {
  const w = scope.agency === 'web' ? 'WHERE b.agency_id IS NULL' : scope.agency ? 'WHERE b.agency_id=?' : '';
  return q(`SELECT cp.customer_id cid, cp.pax, cp.doc_no, cp.doc_type, cp.doc_country, cp.doc_exp, cp.nationality, cp.dob, cp.gender, cp.phone, cp.email, cp.ssr, cp.ssr_note, ${TRAVEL_INF.map(k => 'cp.' + k).join(', ')}, b.id bid, b.pnr, b.status, b.channel, b.agency_id, b.total, b.data, b.created FROM crm_pax cp JOIN bookings b ON b.id=cp.booking_id ${w} ORDER BY b.id DESC LIMIT 20000`, ...(w.includes('?') ? [+scope.agency] : []));
}
function crmList(scope, term, own = false) {   // own: conserva las reservas que hizo la propia persona, para crmDevices
  const rows = crmRows(scope), today = todayISO(), names = agencyNames(), by = new Map();
  for (const r of rows) {
    const d = JSON.parse(r.data), p = d.pax[r.pax]; if (!p) continue;
    let c = by.get(r.cid); if (!c) { c = { id: r.cid, bookings: 0, issued: 0, legs: 0, flown: 0, spend: 0, next: null, last: null, email: d.contact?.email || '', phone: d.contact?.phone || '', club: null, channels: new Set(), travel: false, pending: 0, _b: new Set(), _pnr: [], _own: [] }; by.set(r.cid, c) }
    if (!c._b.has(r.bid)) { c._b.add(r.bid); c.bookings++; c._pnr.push(r.pnr); if (r.channel !== 'agency') c._own.push(r.bid) }
    c.channels.add(chName(names, r)); if (p.club && !c.club) c.club = p.club;
    if (r.status === 'pending') c.pending++;
    if (r.status === 'confirmed') { c.issued++; c.spend += r.total / d.pax.length;
      for (const l of d.legs) { c.legs++; if (l.date < today) { c.flown++; if (!c.last || l.date > c.last) c.last = l.date } else if (!c.next || l.date < c.next) c.next = l.date } }
    if (!c.travel && travelDone(r, p.inf)) c.travel = true;
  }
  const cs = Object.fromEntries(q('SELECT id, first, last, created FROM crm_customers').map(c => [c.id, c])), t = norm(term);
  let out = [...by.values()].map(c => ({ ...c, name: cs[c.id] ? `${cs[c.id].first} ${cs[c.id].last}` : '', since: cs[c.id]?.created, spend: r2(c.spend), channels: [...c.channels], kind: c.issued ? (c.issued > 1 ? 'frecuente' : 'cliente') : 'prospecto', _b: undefined }));
  if (t) out = out.filter(c => norm(c.name).includes(t) || norm(c.email).includes(t) || (/^[\d\s+()-]{4,}$/.test(t) && String(c.phone).replace(/\D/g, '').includes(t.replace(/\D/g, ''))) || norm(c.club).includes(t) || c._pnr.some(x => norm(x) === t));
  out.forEach(c => { delete c._pnr; if (!own) delete c._own });
  out.sort((a, b) => (a.next || '9999').localeCompare(b.next || '9999') || b.spend - a.spend || a.name.localeCompare(b.name));
  return out;
}
// dispositivo de cada cliente: el de su reserva más reciente hecha por él mismo (web o UCP); las que crea una agencia salen del equipo de la agencia
function crmDevices(L) {
  const o = Object.fromEntries(q('SELECT booking_id bid, ua FROM booking_origin WHERE ua IS NOT NULL').map(r => [r.bid, r.ua]));
  for (const c of L) { const bid = (c._own || []).find(b => o[b]); c.device = bid ? uaDevice(o[bid]) : ''; delete c._own }
  return L;
}
const crmStats = L => ({ total: L.length, clients: L.filter(c => c.issued).length, repeat: L.filter(c => c.issued > 1).length, prospects: L.filter(c => !c.issued).length, upcoming: L.filter(c => c.next).length, no_travel: L.filter(c => c.next && !c.travel).length, spend: r2(L.reduce((s, c) => s + c.spend, 0)) });
function crmDetail(id, scope, side) {
  const c = q1('SELECT * FROM crm_customers WHERE id=?', +id), rows = c ? crmRows(scope).filter(r => r.cid === c.id) : [];
  if (!c || !rows.length) throw new HttpErr(404, 'Cliente no encontrado.');
  const names = agencyNames(), item = crmList(scope, '').find(x => x.id === c.id), seen = new Set(), bookings = [], adm = side === 'admin', ips = new Set(), devs = new Set(); let place = null;
  for (const r of rows) { if (seen.has(r.bid)) continue; seen.add(r.bid); const v = bookingView(q1('SELECT * FROM bookings WHERE id=?', r.bid), { private: true });
    bookings.push({ pnr: v.pnr, status: v.status, created: v.created, total: v.total, legs: v.legs.map(l => ({ route: l.route, date: l.date, no: l.no, fare: l.fare })), pax: v.pax, travel: v.travel, travel_ok: v.travel_ok, contact: v.contact, channel: chName(names, r),
      mine: rows.filter(x => x.bid === r.bid).map(x => x.pax) });
    if (adm) { const o = q1('SELECT o.ip,o.ua,g.city,g.region,g.cc,g.country FROM booking_origin o LEFT JOIN ip_geo g ON g.ip=o.ip AND g.ok=1 WHERE o.booking_id=?', r.bid), self = r.channel !== 'agency';
      if (o) { const dev = uaDevice(o.ua), pl = o.cc || o.city ? { city: o.city, region: o.region, cc: o.cc, country: o.country } : null;
        bookings[bookings.length - 1].origin = { device: dev, self, ...(pl || {}) };
        if (self) { if (o.ip) ips.add(o.ip); if (dev) devs.add(dev); if (!place && pl) place = pl } } } }
  let access = null;
  if (adm) { const L = [...ips], inq = L.map(() => '?').join(','), v = L.length ? q1(`SELECT COUNT(*) n, MAX(at) last FROM visits WHERE ip IN (${inq})`, ...L) : { n: 0, last: null };
    access = { devices: [...devs].slice(0, 6), place, visits: v.n, last_visit: v.last } }
  const notes = (side === 'admin' ? q('SELECT * FROM crm_notes WHERE customer_id=? ORDER BY id DESC', c.id) : q('SELECT * FROM crm_notes WHERE customer_id=? AND agency_id=? ORDER BY id DESC', c.id, +scope.agency))
    .map(n => ({ id: n.id, body: n.body, author: n.author, created: n.created, from: n.agency_id ? names[n.agency_id] || 'Agencia' : 'Beemo Air' }));
  const tr = rows.find(r => r.doc_no);
  const member = item.club ? q1('SELECT * FROM club_members WHERE number=?', item.club) : null;
  return { customer: item, travel: travelOf(tr), bookings, notes, club: member ? clubView(member) : null, ...(adm ? { access } : {}) };
}
function crmNote(id, scope, side, a, body) {
  const text = clean(body.body, 1000); if (text.length < 2) bad('Escribe la nota.');
  crmDetail(id, scope, side);   // 404 si la ficha no es de este alcance
  run('INSERT INTO crm_notes(customer_id,agency_id,author,body,created) VALUES(?,?,?,?,?)', +id, side === 'admin' ? null : a.agency.id, (a.viewer || a.user).name || (a.viewer || a.user).email, text, now());
  return crmDetail(id, scope, side);
}
on('GET', '/api/agency/crm', ({ req, url }) => { const a = need(req, 'agent'), all = crmList({ agency: a.agency.id }, ''), L = url.searchParams.get('q') ? crmList({ agency: a.agency.id }, url.searchParams.get('q')) : all; return { stats: crmStats(all), customers: L.slice(0, 500), count: L.length } });
on('GET', '/api/agency/crm/:id', ({ req, params }) => { const a = need(req, 'agent'); return crmDetail(params.id, { agency: a.agency.id }, 'agency') });
on('POST', '/api/agency/crm/:id/notes', ({ req, params, body }) => { const a = need(req, 'agent'); return crmNote(params.id, { agency: a.agency.id }, 'agency', a, body) });
const crmScope = url => { const ag = url.searchParams.get('agency'); return ag === 'web' ? { agency: 'web' } : +ag ? { agency: +ag } : {} };
on('GET', '/api/admin/crm', ({ req, url }) => {
  need(req, 'admin'); const scope = crmScope(url), all = crmList(scope, ''), L = crmDevices(crmList(scope, url.searchParams.get('q') || '', true));
  const ags = q('SELECT id,name,active FROM agencies ORDER BY name').map(g => ({ id: g.id, name: g.name, active: !!g.active, ...crmStats(crmList({ agency: g.id }, '')) }));
  return { stats: crmStats(all), customers: L.slice(0, 500), count: L.length, agencies: ags, direct: crmStats(crmList({ agency: 'web' }, '')), overall: crmStats(crmList({}, '')) };
});
on('GET', '/api/admin/crm/:id', ({ req, params }) => { need(req, 'admin'); return crmDetail(params.id, {}, 'admin') });
on('POST', '/api/admin/crm/:id/notes', ({ req, params, body }) => { const a = need(req, 'admin'); return crmNote(params.id, {}, 'admin', a, body) });

/* ============ UCP · Universal Commerce Protocol: venta de tiquetes a través de agentes de IA ============ */
// Perfil en /.well-known/ucp, catálogo de vuelos, checkout nativo (sesiones), pedidos y eventos firmados.
// Un solo inventario y una sola tarifa: todo precio sale de quote() y toda silla de createBooking().
// Protocolo: ucp.dev (versiones 2026-08-25 y 2026-04-08). Guía de Google: developers.google.com/merchant/ucp
const UCP_ON = process.env.UCP_ENABLED !== '0';
const UCP_ALL = ['2026-08-25', '2026-04-08'];
const UCP_V = UCP_ALL.includes(process.env.UCP_VERSION) ? process.env.UCP_VERSION : UCP_ALL[0];   // versión del perfil raíz
const UCP_VS = UCP_ALL.filter(v => v <= UCP_V);                                                    // versiones que se atienden
const UCP_BASE = PUBLIC_URL + '/api/ucp/v1', UCP_PROFILE = PUBLIC_URL + '/.well-known/ucp';
let UCP_HOST = 'beemoair.com'; try { UCP_HOST = new URL(PUBLIC_URL).host } catch (e) { console.error('ucp: PUBLIC_URL no es una URL válida') }   // dominio para el que deben venir firmadas las solicitudes
const UCP_TTL_MIN = Math.min(360, Math.max(15, +(process.env.UCP_SESSION_MIN || 120) || 120));
const UCP_HOLD_MIN = 15;                                                 // minutos que la silla queda apartada mientras se cobra
const UCP_BUYER_IS_PAX = process.env.UCP_BUYER_IS_PASSENGER === '1';     // un solo tiquete: se emite a nombre del comprador
const UCP_INSECURE = process.env.UCP_ALLOW_INSECURE_PROFILES === '1';    // solo para pruebas locales (perfiles por http)
const UCP_REQUIRE_AUTH = process.env.UCP_REQUIRE_AUTH === '1';           // exige llave o firma en cada solicitud
const UCP_KEYS = (process.env.UCP_API_KEYS || '').split(',').map(x => x.trim()).filter(Boolean).map(x => { const i = x.indexOf(':'); return i > 0 ? { name: x.slice(0, i), hash: sha(x.slice(i + 1)) } : { name: 'api', hash: sha(x) } });
const STRIPE_PK = process.env.STRIPE_PUBLISHABLE_KEY || '', STRIPE_PROFILE = process.env.STRIPE_UCP_PROFILE || '';
const GPAY_ID = process.env.UCP_GPAY_MERCHANT_ID || '', GPAY_ENV = process.env.UCP_GPAY_ENV === 'PRODUCTION' ? 'PRODUCTION' : 'TEST';
const UCP_GOOGLE_WH = process.env.UCP_GOOGLE_WEBHOOK_URL || '';          // eventos de pedido hacia Google (lo entrega Google al aprobar la integración)
const UCP_CHK = 'dev.ucp.shopping.checkout', UCP_ORD = 'dev.ucp.shopping.order', UCP_SRCH = 'dev.ucp.shopping.catalog.search', UCP_LOOK = 'dev.ucp.shopping.catalog.lookup';
const UCP_PAX = 'com.beemoair.shopping.passengers', UCP_PAX_V = '2026-11-24';   // extensión propia: nombres de los pasajeros
// capacidad → [documento en 2026-04-08, documento en 2026-08-25, esquema]
const UCP_CAPS = { [UCP_CHK]: ['checkout', 'shopping/checkout', 'shopping/checkout.json'], [UCP_ORD]: ['order', 'shopping/order', 'shopping/order.json'],
  [UCP_SRCH]: ['catalog/search', 'shopping/catalog/search', 'shopping/catalog_search.json'], [UCP_LOOK]: ['catalog/lookup', 'shopping/catalog/lookup', 'shopping/catalog_lookup.json'] };

db.exec(`CREATE TABLE IF NOT EXISTS ucp_sessions(id TEXT PRIMARY KEY, platform TEXT NOT NULL, version TEXT NOT NULL, status TEXT NOT NULL, data TEXT NOT NULL, booking_id INTEGER, order_id TEXT, pi TEXT, pay_error TEXT, created TEXT NOT NULL, updated TEXT NOT NULL, expires INTEGER NOT NULL);
CREATE UNIQUE INDEX IF NOT EXISTS ucp_sess_order ON ucp_sessions(order_id) WHERE order_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS ucp_sess_booking ON ucp_sessions(booking_id);
CREATE TABLE IF NOT EXISTS ucp_idem(platform TEXT NOT NULL, key TEXT NOT NULL, op TEXT NOT NULL, body_sha TEXT NOT NULL, status INTEGER, response TEXT, created INTEGER NOT NULL, PRIMARY KEY(platform, key));
CREATE TABLE IF NOT EXISTS ucp_events(id INTEGER PRIMARY KEY, event TEXT NOT NULL UNIQUE, order_id TEXT NOT NULL, url TEXT NOT NULL, body TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', tries INTEGER NOT NULL DEFAULT 0, next_at INTEGER NOT NULL, error TEXT, created TEXT NOT NULL, sent TEXT);`);

/* ---------- utilidades ---------- */
class Raw { constructor(status, body, headers = {}, type = 'application/json') { Object.assign(this, { status, body, headers, type }) } }
class UcpErr extends Error { constructor(status, code, content, headers) { super(content); Object.assign(this, { status, code, headers }) } }
const ucpCents = n => Math.round(n * 100);
const ucpId = (p, n = 26) => p + rnd(n).toLowerCase();
const ucpT = (lang, es, en) => lang === 'en' ? en : es;
const ucpLang = (req, ctx) => /^en\b/i.test(String(ctx?.language || req?.headers['accept-language'] || '')) ? 'en' : 'es';
const ucpDay = (date, lang, long) => new Date(date + 'T12:00:00Z').toLocaleDateString(lang === 'en' ? 'en-US' : 'es-CO', { weekday: long ? 'long' : 'short', day: 'numeric', month: long ? 'long' : 'short', year: 'numeric', timeZone: 'UTC' });
const ucpMoney = c => 'US$' + (c / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const ucpContinue = id => `${PUBLIC_URL}/api/ucp/continue/${id}`;
const ucpLinks = lang => [{ type: 'privacy_policy', url: PUBLIC_URL + '/privacidad/', title: ucpT(lang, 'Privacidad', 'Privacy') }, { type: 'terms_of_service', url: PUBLIC_URL + '/terminos/', title: ucpT(lang, 'Términos y condiciones', 'Terms and conditions') },
  { type: 'refund_policy', url: PUBLIC_URL + '/reembolsos/', title: ucpT(lang, 'Cambios y reembolsos', 'Changes and refunds') }, { type: 'faq', url: PUBLIC_URL + '/ayuda/#faq', title: ucpT(lang, 'Preguntas frecuentes', 'FAQ') }];

/* ---------- vuelos como artículos: un vuelo es un producto y cada familia de tarifa, una variante ---------- */
const UCP_CITY = { MIA: 'Miami', AXM: 'Armenia', BAQ: 'Barranquilla' };
const UCP_FARE = {   // lo mismo que muestra beemoair.com en cada familia
  light: { es: ['Artículo personal de 6 kg', 'Sin cambios ni reembolso'], en: ['6 kg personal item', 'No changes or refunds'] },
  basic: { es: ['Equipaje de mano de 10 kg', 'Cambio con penalidad de US$175'], en: ['10 kg carry-on', 'Changes with a US$175 fee'] },
  classic: { es: ['Mano 10 kg y maleta de 23 kg', 'Cambio con penalidad de US$175', 'Reembolso parcial de la tarifa'], en: ['10 kg carry-on and 23 kg checked bag', 'Changes with a US$175 fee', 'Partial fare refund'] },
  plus: { es: ['Mano 10 kg y maleta de 23 kg', 'Asiento incluido', 'Un cambio sin penalidad'], en: ['10 kg carry-on and 23 kg checked bag', 'Seat included', 'One change with no fee'] },
  flex: { es: ['Mano 10 kg y maleta de 30 kg', 'Asiento incluido', 'Cambios sin cargo'], en: ['10 kg carry-on and 30 kg checked bag', 'Seat included', 'Free changes'] },
  bc: { es: ['Cabina Business (12 asientos)', '2 maletas de 30 kg', 'Cambios sin cargo'], en: ['Business cabin (12 seats)', 'Two 30 kg checked bags', 'Free changes'] } };
const UCP_FLIGHT = Object.fromEntries(Object.entries(SCHED).map(([r, s]) => [s.no.replace(/\s/g, ''), r]));
const ucpProductId = (route, date) => SCHED[route].no.replace(/\s/g, '') + '-' + date.replace(/-/g, '');   // BM701-20261214
const ucpItemId = (route, date, fare) => ucpProductId(route, date) + '-' + fare;                           // BM701-20261214-classic
function ucpParseItem(id) {
  const m = /^(BM\d{3})-(\d{4})(\d{2})(\d{2})(?:-([a-z]+))?$/i.exec(String(id ?? '').trim()); if (!m) return null;
  const route = UCP_FLIGHT[m[1].toUpperCase()], fare = m[5] ? m[5].toLowerCase() : null, date = `${m[2]}-${m[3]}-${m[4]}`;
  if (!route || (fare && !FARE_NAME[fare]) || !scheduled(route, date)) return null;
  return { route, date, fare };
}
const ucpRouteName = route => { const [o, d] = route.split('-'); return `${UCP_CITY[o]} (${o}) → ${UCP_CITY[d]} (${d})` };
const ucpItemTitle = (it, lang) => `${ucpRouteName(it.route)} · ${ucpDay(it.date, lang)} · ${SCHED[it.route].no} · ${FARE_NAME[it.fare]}`;
const ucpFareLine = (fare, lang) => (lang === 'en' ? `${FARE_NAME[fare]} fare: ` : `Tarifa ${FARE_NAME[fare]}: `) + UCP_FARE[fare][lang].join(' · ');
const ucpFree = (route, date, fare) => fareLeft(route, date)[fare] ?? 0;
function ucpProduct(route, date, lang, fares) {
  const sc = { ...SCHED[route], ...flightTimes(route, date) }, [o, d] = route.split('-'), av = availability(route, date), T = (es, en) => ucpT(lang, es, en), live = operates(route, date), opt = T('Tarifa', 'Fare');
  const variants = (fares || Object.keys(FAMILIES)).map(f => ({ id: ucpItemId(route, date, f), sku: ucpItemId(route, date, f), title: `${ucpRouteName(route)} · ${ucpDay(date, lang)} · ${FARE_NAME[f]}`,
    description: { plain: UCP_FARE[f][lang].join(' · ') }, price: { amount: ucpCents(priceOf(date, f)), currency: 'USD' }, availability: { available: live && (f === 'bc' ? av.biz : av.eco) > 0 },
    options: [{ name: opt, label: FARE_NAME[f] }], url: PUBLIC_URL + '/#reservar' }));
  const all = Object.keys(FAMILIES).map(f => ucpCents(priceOf(date, f)));
  return { id: ucpProductId(route, date), handle: ucpProductId(route, date).toLowerCase(), title: `${ucpRouteName(route)} · ${ucpDay(date, lang)} · ${sc.no}`,
    description: { plain: T(`Vuelo directo ${sc.no} de Beemo Air. Sale a las ${sc.dep} y llega a las ${sc.arr}, hora local. Precio por pasajero y por trayecto, con tasas e impuestos incluidos.`,
      `Beemo Air nonstop flight ${sc.no}. Departs ${sc.dep}, arrives ${sc.arr}, local time. Price per passenger, one way, taxes and fees included.`) },
    url: PUBLIC_URL + '/#reservar', categories: [{ value: T('Vuelos', 'Flights'), taxonomy: 'merchant' }],
    price_range: { min: { amount: Math.min(...all), currency: 'USD' }, max: { amount: Math.max(...all), currency: 'USD' } },
    options: [{ name: opt, values: Object.keys(FAMILIES).map(f => ({ label: FARE_NAME[f] })) }], variants,
    metadata: { flight_number: sc.no, origin: o, destination: d, date, departure_time: sc.dep, arrival_time: sc.arr, seats_left: { economy: av.eco, business: av.biz } } };
}
const ucpPriceOk = (v, f) => !f || ((f.min == null || v.price.amount >= +f.min) && (f.max == null || v.price.amount <= +f.max));

/* ---------- llave de firma (ES256). Se crea una sola vez y vive en el volumen de datos; UCP_SIGNING_KEY (JWK) la reemplaza ---------- */
let ucpKeyMemo = null;
function ucpKey() {
  if (ucpKeyMemo) return ucpKeyMemo;
  let jwk = null;
  if (process.env.UCP_SIGNING_KEY) { try { const j = JSON.parse(process.env.UCP_SIGNING_KEY); if (j.kty === 'EC' && j.crv === 'P-256' && j.d) jwk = j; else throw new Error('tipo') } catch (e) { console.error('ucp: UCP_SIGNING_KEY no es una llave EC P-256 en formato JWK; se usa la llave guardada') } }
  if (!jwk) { const r = q1("SELECT value FROM settings WHERE key='ucp_signing_key'"); if (r) { try { jwk = JSON.parse(r.value) } catch (e) {} } }
  if (!jwk) { jwk = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' }).privateKey.export({ format: 'jwk' });
    run("INSERT INTO settings(key,value) VALUES('ucp_signing_key',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", JSON.stringify(jwk)); log('system', 'ucp: llave de firma creada') }
  const kid = crypto.createHash('sha256').update(JSON.stringify({ crv: jwk.crv, kty: jwk.kty, x: jwk.x, y: jwk.y })).digest('base64url');   // huella RFC 7638
  return ucpKeyMemo = { priv: crypto.createPrivateKey({ key: jwk, format: 'jwk' }), kid, pub: { kid, kty: 'EC', crv: 'P-256', x: jwk.x, y: jwk.y, use: 'sig', alg: 'ES256' } };
}
/* ---------- firmas de mensajes HTTP (RFC 9421) ---------- */
const ucpDigest = buf => 'sha-256=:' + crypto.createHash('sha256').update(buf).digest('base64') + ':';
const ucpSigBase = (comps, val, params) => comps.map(c => `"${c}": ${val(c)}`).join('\n') + `\n"@signature-params": ${params}`;
function ucpSignHeaders(comps, val) {
  const k = ucpKey(), params = `(${comps.map(c => `"${c}"`).join(' ')});created=${Math.floor(Date.now() / 1000)};keyid="${k.kid}"`;
  const sig = crypto.sign('sha256', Buffer.from(ucpSigBase(comps, val, params)), { key: k.priv, dsaEncoding: 'ieee-p1363' });
  return { 'Signature-Input': 'sig1=' + params, Signature: 'sig1=:' + sig.toString('base64') + ':' };
}
function ucpSigInputs(h) {
  const out = [], re = /([a-z][a-z0-9_.*-]*)=(\(([^()]*)\)((?:;[a-z][a-z0-9_.*-]*(?:="[^"]*"|=[^;,\s]+)?)*))/gi; let m;
  while ((m = re.exec(String(h || '')))) {
    const comps = []; let plain = true, c; const cre = /"([^"]*)"((?:;[^\s"]+)*)/g;
    while ((c = cre.exec(m[3]))) { if (c[2]) plain = false; comps.push(c[1].toLowerCase()) }
    const params = {}; for (const p of m[4].split(';').filter(Boolean)) { const i = p.indexOf('='); params[(i < 0 ? p : p.slice(0, i)).toLowerCase()] = i < 0 ? true : p.slice(i + 1).replace(/^"|"$/g, '') }
    out.push({ label: m[1], comps, params, raw: m[2], plain });
  }
  return out;
}
// Verifica la firma de una solicitud con las llaves publicadas en el perfil de la plataforma. Lanza UcpErr si ninguna firma la autentica.
function ucpVerify(c, profile) {
  const req = c.req, inputs = ucpSigInputs(req.headers['signature-input']);
  const sigs = Object.fromEntries([...String(req.headers.signature || '').matchAll(/([a-z][a-z0-9_.*-]*)=:([A-Za-z0-9+/=]+):/gi)].map(m => [m[1], m[2]]));
  if (!inputs.length || !Object.keys(sigs).length) throw new UcpErr(401, 'signature_missing', 'Signature and Signature-Input headers are required.');
  const keys = [...(Array.isArray(profile.signing_keys) ? profile.signing_keys : []), ...(Array.isArray(profile.keys) ? profile.keys : [])].filter(k => k && typeof k === 'object');
  const hasBody = c.rawBuf.length > 0, need = ['@method', '@authority', '@path'];
  if (c.url.search) need.push('@query'); if (hasBody) need.push('content-digest', 'content-type');
  for (const h of ['idempotency-key', 'ucp-agent', 'signature-agent']) if (req.headers[h] != null) need.push(h);
  const digest = (/sha-256=:([A-Za-z0-9+/=]+):/.exec(String(req.headers['content-digest'] || '')) || [])[1];
  let why = [401, 'signature_invalid'];
  for (const s of inputs) {
    const b = sigs[s.label]; if (!b) continue;
    const jwk = keys.find(k => k.kid === s.params.keyid); if (!jwk) { why = [401, 'key_not_found']; continue }
    const ed = jwk.kty === 'OKP' && jwk.crv === 'Ed25519', ec = jwk.kty === 'EC' && (jwk.crv === 'P-256' || jwk.crv === 'P-384');
    if (!ed && !ec) { why = [400, 'algorithm_unsupported']; continue }
    why = [401, 'signature_invalid'];
    if (!s.plain || need.some(n => !s.comps.includes(n))) continue;                                                     // no cubre el destino, el cuerpo o los encabezados
    if (s.comps.some(k => k.startsWith('@') ? !['@method', '@authority', '@path', '@query'].includes(k) : req.headers[k] == null)) continue;
    if (s.params.expires && +s.params.expires < Date.now() / 1000) continue;
    if (s.comps.includes('content-digest') && digest !== crypto.createHash('sha256').update(c.rawBuf).digest('base64')) { why = [400, 'digest_mismatch']; continue }
    const val = k => k === '@method' ? req.method : k === '@authority' ? UCP_HOST : k === '@path' ? c.url.pathname : k === '@query' ? (c.url.search || '?') : String(req.headers[k]).trim();
    try {
      const pub = crypto.createPublicKey({ key: jwk, format: 'jwk' }), data = Buffer.from(ucpSigBase(s.comps, val, s.raw)), sig = Buffer.from(b, 'base64');
      if (ed ? crypto.verify(null, data, pub, sig) : crypto.verify(jwk.crv === 'P-384' ? 'sha384' : 'sha256', data, { key: pub, dsaEncoding: 'ieee-p1363' }, sig)) return true;
    } catch (e) { /* llave o firma mal formada: no autentica */ }
  }
  throw new UcpErr(why[0], why[1], 'The request signature could not be verified.');
}

/* ---------- salidas a internet (perfil de la plataforma y webhooks): solo https hacia direcciones públicas ---------- */
const UCP_BLOCK = new net.BlockList();
for (const [a, p] of [['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4]]) UCP_BLOCK.addSubnet(a, p, 'ipv4');
for (const [a, p] of [['::', 127], ['::ffff:0:0', 96], ['64:ff9b::', 96], ['100::', 64], ['2001:db8::', 32], ['fc00::', 7], ['fe80::', 10], ['ff00::', 8]]) UCP_BLOCK.addSubnet(a, p, 'ipv6');
function ucpFetch(target, o = {}) {
  return new Promise((resolve, reject) => {
    let u; try { u = new URL(target) } catch (e) { return reject(new Error('url')) }
    const plain = UCP_INSECURE && u.protocol === 'http:';
    if ((u.protocol !== 'https:' && !plain) || u.username || u.password || (!UCP_INSECURE && u.port && u.port !== '443')) return reject(new Error('url'));
    const host = u.hostname.replace(/^\[|\]$/g, '');
    dns.lookup(host, { all: true }, (err, addrs) => {
      if (err || !addrs || !addrs.length) return reject(new Error('dns'));
      if (!UCP_INSECURE && addrs.some(a => UCP_BLOCK.check(a.address, a.family === 6 ? 'ipv6' : 'ipv4'))) return reject(new Error('address'));
      const a = addrs[0], body = o.body ? Buffer.from(o.body) : null;   // se conecta a la dirección ya validada (evita que el DNS cambie entre la revisión y la conexión)
      const req = (plain ? http : https).request({ protocol: u.protocol, hostname: host, port: u.port || (plain ? 80 : 443), path: u.pathname + u.search, method: o.method || 'GET', timeout: o.timeout || 5000,
        headers: { 'User-Agent': `BeemoAir-UCP/1.0 (+${PUBLIC_URL})`, Accept: 'application/json', ...(body ? { 'Content-Length': body.length } : {}), ...(o.headers || {}) },
        lookup: (h, opt, cb) => (opt && opt.all) ? cb(null, [{ address: a.address, family: a.family }]) : cb(null, a.address, a.family) }, res => {
        const chunks = []; let n = 0;
        res.on('data', d => { n += d.length; if (n > (o.max || 262144)) req.destroy(new Error('size')); else chunks.push(d) });
        res.on('end', () => resolve({ status: res.statusCode, text: Buffer.concat(chunks).toString('utf8') }));
        res.on('error', reject);
      });
      const deadline = setTimeout(() => req.destroy(new Error('timeout')), (o.timeout || 5000) * 2);
      req.on('timeout', () => req.destroy(new Error('timeout'))); req.on('error', reject); req.on('close', () => clearTimeout(deadline)); req.end(body || undefined);
    });
  });
}
const UCP_PROFILES = new Map();   // perfil de cada plataforma, en memoria: 1 h si se leyó bien, 2 min si falló
async function ucpPlatform(c) {
  const m = /(?:^|[\s,;])profile="([^"\\]{8,500})"/.exec(String(c.req.headers['ucp-agent'] || ''));
  let u = null; try { u = m && new URL(m[1]) } catch (e) {}
  if (!u || (u.protocol !== 'https:' && !(UCP_INSECURE && u.protocol === 'http:')) || u.username || u.password)
    throw new UcpErr(400, 'invalid_profile_url', 'Send the UCP-Agent header with your platform profile URL: UCP-Agent: profile="https://…".');
  const url = u.href, hit = UCP_PROFILES.get(url);
  if (hit && Date.now() - hit.at < (hit.profile ? 3600e3 : 120e3)) { if (hit.profile) return { url, profile: hit.profile }; throw new UcpErr(...hit.err) }
  try { limit(c.ip, 'ucp-profile', 20, 600e3) } catch (e) { throw new UcpErr(429, 'rate_limited', 'Too many requests.', { 'Retry-After': '60' }) }
  let profile = null, err = null;
  try {
    const r = await ucpFetch(url, { timeout: 4000 });
    if (r.status < 200 || r.status > 299) err = [424, 'profile_unreachable', `Unable to fetch the platform profile (HTTP ${r.status}).`];
    else { try { profile = JSON.parse(r.text) } catch (e) {}
      if (!profile || typeof profile !== 'object' || !profile.ucp || typeof profile.ucp !== 'object' || !/^\d{4}-\d{2}-\d{2}$/.test(String(profile.ucp.version || ''))) { profile = null; err = [422, 'profile_malformed', 'The platform profile is not a valid UCP profile.'] } }
  } catch (e) { err = ['url', 'address'].includes(e.message) ? [400, 'invalid_profile_url', 'The platform profile URL must be a public https URL.'] : [424, 'profile_unreachable', 'Unable to fetch the platform profile.'] }
  if (UCP_PROFILES.size > 500) UCP_PROFILES.delete(UCP_PROFILES.keys().next().value);
  UCP_PROFILES.set(url, { at: Date.now(), profile, err });
  if (!profile) throw new UcpErr(...err);
  return { url, profile };
}
function ucpTheirCaps(profile) {   // capacidad → versiones que declara la plataforma
  const out = new Map(), caps = profile.ucp.capabilities, add = (name, e) => { if (typeof name !== 'string' || !e || typeof e !== 'object') return; if (!out.has(name)) out.set(name, []); out.get(name).push(e) };
  if (Array.isArray(caps)) for (const e of caps) add(e?.name, e);
  else if (caps && typeof caps === 'object') for (const [name, list] of Object.entries(caps)) for (const e of Array.isArray(list) ? list : [list]) add(name, e);
  return out;
}
function ucpNegotiate(profile, url) {   // versión del protocolo y capacidades en común (la tienda decide)
  const v = String(profile.ucp.version);
  if (!UCP_VS.includes(v)) throw new UcpErr(422, 'version_unsupported', `Protocol version ${v} is not supported. This business supports ${UCP_VS.join(' and ')}.`);
  const theirs = ucpTheirCaps(profile), caps = new Set(), has = (n, ver) => (theirs.get(n) || []).some(e => String(e.version) === ver);
  for (const n of Object.keys(UCP_CAPS)) if (has(n, v)) caps.add(n);
  if (caps.has(UCP_CHK) && has(UCP_PAX, UCP_PAX_V)) caps.add(UCP_PAX);
  let hook = ((theirs.get(UCP_ORD) || []).find(e => String(e.version) === v)?.config || {}).webhook_url;
  try { const h = new URL(url).hostname; if (UCP_GOOGLE_WH && (h === 'ucp.goog' || h.endsWith('.ucp.goog'))) hook = UCP_GOOGLE_WH } catch (e) {}
  const ph = profile.ucp.payment_handlers, theirPay = new Set(ph && typeof ph === 'object' ? (Array.isArray(ph) ? ph.map(x => x?.name) : Object.keys(ph)) : []);
  return { v, caps, hook: typeof hook === 'string' && /^https?:\/\//.test(hook) ? hook : null, pay: theirPay };
}
function ucpAuth(req) {   // llave de plataforma (X-API-Key o Bearer), si Beemo Air entregó alguna
  const h = String(req.headers.authorization || ''), key = String(req.headers['x-api-key'] || '') || (h.startsWith('Bearer ') ? h.slice(7).trim() : '');
  if (!key || !UCP_KEYS.length) return null;
  const hx = Buffer.from(sha(key)), k = UCP_KEYS.find(k => crypto.timingSafeEqual(Buffer.from(k.hash), hx));
  if (!k) throw new UcpErr(401, 'unauthorized', 'Invalid API key.', { 'WWW-Authenticate': 'Bearer realm="ucp"' });
  return k.name;
}

/* ---------- medios de pago que se anuncian. Sin llaves configuradas no se anuncia ninguno y el pago se termina en beemoair.com ---------- */
function ucpHandlers() {
  const h = {};
  if (STRIPE_KEY && STRIPE_PK && GPAY_ID) h['com.google.pay'] = [{ id: 'gpay', version: '2026-01-23', spec: 'https://pay.google.com/gp/p/ucp/2026-01-23/', schema: 'https://pay.google.com/gp/p/ucp/2026-01-23/schemas/config.json',
    config: { api_version: 2, api_version_minor: 0, environment: GPAY_ENV, merchant_info: { merchant_name: 'Beemo Air', merchant_id: GPAY_ID, merchant_origin: UCP_HOST },
      allowed_payment_methods: [{ type: 'CARD', parameters: { allowed_auth_methods: ['PAN_ONLY'], allowed_card_networks: ['VISA', 'MASTERCARD', 'AMEX', 'DISCOVER'], billing_address_required: true, billing_address_parameters: { format: 'FULL', phone_number_required: true } },
        tokenization_specification: { type: 'PAYMENT_GATEWAY', parameters: { gateway: 'stripe', 'stripe:version': '2018-10-31', 'stripe:publishableKey': STRIPE_PK } } }] } }];
  if (STRIPE_KEY && STRIPE_PROFILE) h['com.stripe.payments'] = [{ id: 'stripe_payments', version: '2026-06-25', spec: 'https://docs.stripe.com/agentic-commerce/protocols/ucp/stripe-payments-handler', schema: 'https://ucp.stripe.com/payments/2026-06-25/schema.json',
    available_instruments: [{ type: 'card' }], config: { environment: process.env.STRIPE_UCP_ENV || (/^(sk|rk)_live_/.test(STRIPE_KEY) ? 'livemode' : 'testmode'), business_profile: STRIPE_PROFILE } }];
  return h;
}
const ucpPayFor = neg => Object.fromEntries(Object.entries(ucpHandlers()).filter(([name]) => neg.pay.has(name)));   // solo los que la plataforma también maneja

/* ---------- perfil público ---------- */
function ucpProfileDoc(v) {
  const spec = d => `https://ucp.dev/${v}/specification/${d}`, key = ucpKey().pub, caps = {};
  for (const [n, [d0, d1, schema]] of Object.entries(UCP_CAPS)) caps[n] = [{ version: v, spec: spec(v >= '2026-08-25' ? d1 : d0), schema: `https://ucp.dev/${v}/schemas/${schema}` }];
  caps[UCP_PAX] = [{ version: UCP_PAX_V, spec: PUBLIC_URL + '/api/ucp/spec/passengers', schema: PUBLIC_URL + '/api/ucp/schemas/passengers.json', extends: UCP_CHK }];
  const older = UCP_VS.filter(x => x < v), root = v === UCP_V;
  return { ucp: { version: v, ...(root && older.length ? { supported_versions: Object.fromEntries(older.map(x => [x, `${UCP_PROFILE}/${x}`])) } : {}),
      services: { 'dev.ucp.shopping': [{ version: v, spec: spec('overview'), transport: 'rest', endpoint: UCP_BASE, schema: `https://ucp.dev/${v}/services/shopping/rest.openapi.json` }] },
      capabilities: caps, payment_handlers: ucpHandlers() },
    signing_keys: [key], keys: [key] };
}
const UCP_PAX_SCHEMA = { $schema: 'https://json-schema.org/draft/2020-12/schema', $id: PUBLIC_URL + '/api/ucp/schemas/passengers.json', name: UCP_PAX, title: 'Beemo Air · Passengers',
  description: 'Names of the travelers on a flight checkout, exactly as printed on their passports. One entry per seat, in order.', requires: { protocol: { min: '2026-04-08' } },
  $defs: { passenger: { type: 'object', required: ['first_name', 'last_name'], properties: { first_name: { type: 'string', maxLength: 40, description: 'Given names as printed on the passport.' }, last_name: { type: 'string', maxLength: 40, description: 'Surnames as printed on the passport.' } } },
    [UCP_CHK]: { title: 'Checkout with Passengers', allOf: [{ $ref: 'https://ucp.dev/schemas/shopping/checkout.json' }, { type: 'object', properties: { passengers: { type: 'array', maxItems: 9, items: { $ref: '#/$defs/passenger' },
      description: 'One passenger per seat (line item quantity). Optional on create and update; required before the checkout can be completed.' } } }] } } };
const UCP_PAX_SPEC = `# Passengers extension · ${UCP_PAX} (${UCP_PAX_V})

Extends \`${UCP_CHK}\`. A flight ticket is issued to a named traveler, and the name must match the passport.
The buyer is not always the traveler, so Beemo Air asks for the passenger names explicitly.

## Field

\`passengers\` (array, on the checkout): one object per seat, in order, with \`first_name\` and \`last_name\`
exactly as printed on the passport. The number of entries must equal the line item \`quantity\`.
Send it on Create Checkout or Update Checkout; the business echoes it in every response.

## Behavior

- Platform declares this extension in its profile: while names are missing the checkout is \`incomplete\` with a
  \`recoverable\` error at \`$.passengers\`; send them with Update Checkout.
- Platform does not declare it: the checkout is \`requires_escalation\` (\`requires_buyer_input\`) and the buyer
  enters the names at \`continue_url\`.

Schema: ${PUBLIC_URL}/api/ucp/schemas/passengers.json
Contact: ${SUPPORT_EMAIL}
`;
const UCP_OPEN = { 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'public, max-age=300' };
function ucpProfileRoute({ params }) {
  if (!UCP_ON) throw new HttpErr(404, 'No encontrado.');
  const v = params.version || UCP_V;
  if (!UCP_VS.includes(v)) return new Raw(422, JSON.stringify({ code: 'version_unsupported', content: `Protocol version ${v} is not supported. This business supports ${UCP_VS.join(' and ')}.` }), UCP_OPEN);
  return new Raw(200, JSON.stringify(ucpProfileDoc(v)), UCP_OPEN);
}
on('GET', '/api/ucp/profile', ucpProfileRoute);
on('GET', '/api/ucp/profile/:version', ucpProfileRoute);
on('GET', '/api/ucp/schemas/passengers.json', () => { if (!UCP_ON) throw new HttpErr(404, 'No encontrado.'); return new Raw(200, JSON.stringify(UCP_PAX_SCHEMA), UCP_OPEN, 'application/schema+json') });
on('GET', '/api/ucp/spec/passengers', () => { if (!UCP_ON) throw new HttpErr(404, 'No encontrado.'); return new Raw(200, UCP_PAX_SPEC, UCP_OPEN, 'text/markdown; charset=utf-8') });

/* ---------- sesiones de checkout ---------- */
function ucpLoad(id) { const r = q1('SELECT * FROM ucp_sessions WHERE id=?', String(id || '')); if (!r) return null; try { r.data = JSON.parse(r.data) } catch (e) { return null } return r }
function ucpSave(S) { run('UPDATE ucp_sessions SET status=?, data=?, booking_id=?, order_id=?, pi=?, pay_error=?, updated=?, expires=? WHERE id=?', S.status, JSON.stringify(S.data), S.booking_id ?? null, S.order_id ?? null, S.pi ?? null, S.pay_error ?? null, now(), S.expires, S.id) }
const ucpBooking = S => S.booking_id ? q1('SELECT * FROM bookings WHERE id=?', S.booking_id) : null;
const ucpName = v => clean(v, 40);
function ucpReadLines(body) {   // líneas pedidas → vuelos. Lo que no se reconoce se informa y no entra a la sesión
  const src = Array.isArray(body.line_items) ? body.line_items.slice(0, 8) : [], items = [], unknown = [], adjusted = [];
  for (const l of src) {
    const raw = String(l?.item?.id ?? '').slice(0, 80), p = ucpParseItem(raw), n = Math.floor(Number(l?.quantity));
    if (!p || !p.fare) { unknown.push(raw); continue }
    const qty = Number.isFinite(n) && n >= 1 ? Math.min(n, 9) : 1; if (qty !== n) adjusted.push(items.length);
    items.push({ id: 'li_' + (items.length + 1), item: ucpItemId(p.route, p.date, p.fare), route: p.route, date: p.date, fare: p.fare, qty });
  }
  return { items, unknown, adjusted };
}
function ucpReadBuyer(b) { const o = {}; if (!b || typeof b !== 'object') return o;
  for (const k of ['first_name', 'last_name']) if (b[k] != null && ucpName(b[k])) o[k] = ucpName(b[k]);
  if (b.email != null && clean(b.email, 120)) o.email = clean(b.email, 120); if (b.phone_number != null && clean(b.phone_number, 40)) o.phone_number = clean(b.phone_number, 40); return o }
const ucpReadPax = list => Array.isArray(list) ? list.slice(0, 9).map(p => ({ first_name: ucpName(p?.first_name), last_name: ucpName(p?.last_name) })) : [];
// Pasajeros con los que se emitiría: los que envió la plataforma o, si está permitido y es un solo tiquete, el comprador
function ucpPaxOf(d) {
  const n = d.items[0]?.qty || 0, list = d.passengers || [];
  if (n && list.length === n && list.every(p => p.first_name && p.last_name)) return { pax: list, from: 'passengers' };
  if (UCP_BUYER_IS_PAX && n === 1 && !list.length && d.buyer?.first_name && d.buyer?.last_name) return { pax: [{ first_name: d.buyer.first_name, last_name: d.buyer.last_name }], from: 'buyer' };
  return { pax: null };
}
const ucpLegs = d => d.items.slice().sort((a, b) => a.date < b.date ? -1 : 1).map(it => ({ route: it.route, date: it.date, fare: it.fare }));
const ucpBody = (d, pax, email, phone) => ({ legs: ucpLegs(d), pax: pax.map(p => ({ first: p.first_name, last: p.last_name })), contact: { email, phone: phone || '' } });
function ucpTotals(lang, total, taxes) {
  const T = (es, en) => ucpT(lang, es, en), sub = { type: 'subtotal', display_text: T('Tarifa aérea, tasas e impuestos incluidos', 'Airfare, taxes and fees included'), amount: total };
  if (taxes > 0 && taxes < total) sub.lines = [{ display_text: T('Tarifa', 'Fare'), amount: total - taxes }, { display_text: T('Tasas e impuestos', 'Taxes and fees'), amount: taxes }];
  return [sub, { type: 'total', display_text: 'Total', amount: total }];
}
const ucpLines = (d, lang) => d.items.map(it => { const p = ucpCents(priceOf(it.date, it.fare)), t = p * it.qty; return { id: it.id, item: { id: it.item, title: ucpItemTitle(it, lang), price: p }, quantity: it.qty, totals: [{ type: 'subtotal', amount: t }, { type: 'total', amount: t }] } });
// Estado de una sesión abierta: líneas, totales, mensajes y qué falta para poder completarla
function ucpState(S, neg) {
  const d = S.data, lang = d.lang, T = (es, en) => ucpT(lang, es, en), msgs = [], lines = ucpLines(d, lang);
  const err = (code, content, path, severity = 'recoverable') => msgs.push({ type: 'error', code, content, severity, ...(path ? { path } : {}) });
  const sum = lines.reduce((t, l) => t + l.totals[1].amount, 0);
  let totals = ucpTotals(lang, sum, 0), linesOk = true, pax = null;
  d.items.forEach((it, i) => {
    if (!operates(it.route, it.date)) { linesOk = false; return err('item_unavailable', T(`El vuelo ${SCHED[it.route].no} del ${ucpDay(it.date, lang)} ya no está a la venta.`, `Flight ${SCHED[it.route].no} on ${ucpDay(it.date, lang)} is no longer on sale.`), `$.line_items[${i}]`) }
    const free = ucpFree(it.route, it.date, it.fare), cabin = it.fare === 'bc' ? T('en Business', 'in Business') : T('en económica', 'in economy');
    if (free < it.qty) { linesOk = false; err('out_of_stock', free ? T(`Solo ${free === 1 ? 'queda 1 silla' : `quedan ${free} sillas`} ${cabin} en el vuelo ${SCHED[it.route].no} del ${ucpDay(it.date, lang)}.`, `Only ${free} ${free === 1 ? 'seat is' : 'seats are'} left ${cabin} on flight ${SCHED[it.route].no} on ${ucpDay(it.date, lang)}.`)
      : T(`No quedan sillas ${cabin} en el vuelo ${SCHED[it.route].no} del ${ucpDay(it.date, lang)}.`, `No seats are left ${cabin} on flight ${SCHED[it.route].no} on ${ucpDay(it.date, lang)}.`), `$.line_items[${i}].quantity`) }
  });
  if (d.items.length > 2) { linesOk = false; err('invalid', T('Una compra admite un vuelo de ida y uno de regreso. Quita los demás vuelos.', 'A purchase takes one outbound and one return flight. Remove the other flights.'), '$.line_items[2]') }
  else if (d.items.length === 2) {
    if (d.items[0].date === d.items[1].date) { linesOk = false; err('invalid', T('El regreso debe ser en una fecha posterior a la ida.', 'The return must be on a later date than the outbound flight.'), '$.line_items[1]') }
    if (d.items[0].qty !== d.items[1].qty) { linesOk = false; err('invalid', T('La ida y el regreso deben tener el mismo número de pasajeros.', 'The outbound and return flights must have the same number of passengers.'), '$.line_items[1].quantity') }
  }
  if (linesOk) {   // precio autoritativo: el mismo cálculo de beemoair.com
    try { const Q = quote(ucpBody(d, Array.from({ length: d.items[0].qty }, () => ({ first_name: 'Pasajero', last_name: 'Beemo' })), 'ucp@beemoair.com'), 'web');
      if (ucpCents(Q.total) === sum) totals = ucpTotals(lang, sum, ucpCents(Q.breakdown.taxes)); else { linesOk = false; console.error('ucp: total distinto', S.id, sum, Q.total); err('invalid', T('No pudimos calcular el precio. Intenta de nuevo.', 'We could not price this trip. Please try again.')) } }
    catch (e) { if (!(e instanceof HttpErr)) throw e; linesOk = false; err('invalid', e.message) }
  }
  d.items.forEach((it, i) => {   // condiciones de la tarifa, a la vista antes de pagar
    const text = ucpFareLine(it.fare, lang) + '.';
    if (it.fare === 'light') msgs.push({ type: 'warning', code: 'final_sale', path: `$.line_items[${i}]`, content: text, url: PUBLIC_URL + '/reembolsos/' }); else msgs.push({ type: 'info', code: 'fare_conditions', path: `$.line_items[${i}]`, content: text });
  });
  msgs.push({ type: 'info', code: 'travel_documents', content: T(`Vuelo internacional: revisa pasaporte y requisitos de viaje en ${PUBLIC_URL}/ayuda/#documentos`, `International flight: check passport and travel requirements at ${PUBLIC_URL}/ayuda/#documentos`) });
  if (S.booking_id) {   // la reserva ya se creó en beemoair.com y espera el pago
    const b = ucpBooking(S); err('payment_pending', T(`La reserva ${b?.pnr || ''} está pendiente de pago en beemoair.com.`, `Booking ${b?.pnr || ''} is awaiting payment at beemoair.com.`), null, 'requires_buyer_input');
    return { status: 'requires_escalation', messages: msgs.filter(m => m.type !== 'error' || m.severity !== 'recoverable'), lines, totals, total: sum, pax: null, pay: {} };
  }
  const pay = neg ? ucpPayFor(neg) : {}, native = Object.keys(pay).length > 0, P = ucpPaxOf(d);
  if (linesOk) {
    if (P.pax) { pax = P.pax; if (P.from === 'buyer') msgs.push({ type: 'warning', code: 'passenger_is_buyer', presentation: 'disclosure', path: '$.buyer', url: PUBLIC_URL + '/ayuda/#documentos',
      content: T(`El tiquete se emite a nombre de ${pax[0].first_name} ${pax[0].last_name}. Debe coincidir con el pasaporte de quien viaja.`, `The ticket will be issued to ${pax[0].first_name} ${pax[0].last_name}. It must match the traveler's passport.`) }) }
    else if (UCP_BUYER_IS_PAX && d.items[0].qty === 1 && !(d.passengers || []).length) { /* viaja el comprador: su nombre se pide más abajo, por API */ }
    else if (native && neg.caps.has(UCP_PAX)) err('missing', T(`Faltan los nombres de los pasajeros: envía passengers con ${d.items[0].qty} ${d.items[0].qty === 1 ? 'persona' : 'personas'}, con nombre y apellido como aparecen en el pasaporte.`, `Passenger names are missing: send passengers with ${d.items[0].qty} ${d.items[0].qty === 1 ? 'traveler' : 'travelers'}, first and last name as printed on the passport.`), '$.passengers');
    else err('passenger_details_required', T('Escribe los nombres de los pasajeros, tal como aparecen en el pasaporte, para terminar la compra en beemoair.com.', 'Enter the passenger names, exactly as printed on their passports, to finish the purchase at beemoair.com.'), null, 'requires_buyer_input');
    if (!native) err('payment_on_business_site', T('El pago se hace de forma segura en beemoair.com.', 'Payment is completed securely at beemoair.com.'), null, 'requires_buyer_input');
  }
  const handoff = msgs.some(m => m.type === 'error' && m.severity !== 'recoverable');
  if (linesOk && !handoff) {   // solo se pide por API lo que hace falta para completar aquí; si la compra termina en la web, allá se pide
    if (!d.buyer?.email) err('missing', T('Falta el correo del comprador.', 'Buyer email is required.'), '$.buyer.email');
    else if (!okEmail(d.buyer.email)) err('invalid', T('Revisa el correo del comprador.', 'Check the buyer email.'), '$.buyer.email');
    if (!d.buyer?.first_name) err('missing', T('Falta el nombre del comprador.', 'Buyer first name is required.'), '$.buyer.first_name');
    if (!d.buyer?.last_name) err('missing', T('Falta el apellido del comprador.', 'Buyer last name is required.'), '$.buyer.last_name');
    if (S.pay_error) err('payment_failed', S.pay_error, '$.payment');
  }
  const blocked = msgs.some(m => m.type === 'error');
  return { status: handoff ? 'requires_escalation' : blocked ? 'incomplete' : 'ready_for_complete', messages: msgs, lines, totals, total: sum, pax: blocked ? null : pax, pay };
}
function ucpEnvelope(ctx, names, pay) {
  const caps = {}; for (const n of names) if (ctx.caps.has(n)) caps[n] = [{ version: n === UCP_PAX ? UCP_PAX_V : ctx.v }];
  return { version: ctx.v, capabilities: caps, ...(pay ? { payment_handlers: pay } : {}) };
}
const ucpFail = (ctx, names, code, content, more = {}) => ({ ucp: { ...ucpEnvelope(ctx, names), status: 'error' }, messages: [{ type: 'error', code, content, severity: 'unrecoverable' }], continue_url: PUBLIC_URL + '/', ...more });
function ucpCheckout(ctx, S, st, extra = []) {   // la sesión tal como la ve la plataforma
  const d = S.data, open = S.status === 'open', snap = open ? null : d.snapshot || ucpSnapshot(S); if (open && !st) st = ucpState(S, ctx);
  const status = S.status === 'completed' ? 'completed' : S.status === 'canceled' ? 'canceled' : S.status === 'in_progress' ? 'complete_in_progress' : st.status;
  const messages = [...extra, ...(open ? st.messages : [])];
  const o = { ucp: ucpEnvelope(ctx, [UCP_CHK, UCP_PAX], open ? st.pay : ucpPayFor(ctx)), id: S.id, status, currency: 'USD', line_items: open ? st.lines : snap.lines, totals: open ? st.totals : snap.totals,
    ...(messages.length ? { messages } : {}), links: ucpLinks(d.lang), expires_at: new Date(S.expires).toISOString() };
  if (d.buyer && Object.keys(d.buyer).length) o.buyer = d.buyer;
  if (d.passengers?.length) o.passengers = d.passengers;
  if (open || S.status === 'in_progress') o.continue_url = ucpContinue(S.id);
  if (d.payment && S.status !== 'open') o.payment = d.payment;
  if (S.status === 'completed') o.order = { id: S.order_id, label: d.order.pnr, permalink_url: ucpContinue(S.id) };
  return o;
}
function ucpSnapshot(S, b, bd) {   // foto de líneas y totales; con la reserva delante, el total es exactamente lo cobrado
  const lang = S.data.lang, lines = ucpLines(S.data, lang), sum = lines.reduce((t, l) => t + l.totals[1].amount, 0), paid = b ? ucpCents(b.total) : sum;
  if (paid !== sum) console.error('ucp: el total de la reserva no coincide con las líneas', S.id, paid, sum);
  return { lines, totals: ucpTotals(lang, paid, bd?.breakdown?.taxes != null ? ucpCents(bd.breakdown.taxes) : ucpCents(TAX_LEG) * S.data.items.reduce((t, it) => t + it.qty, 0)) };
}
function ucpClose(S, why) { S.status = 'canceled'; S.data.snapshot = ucpSnapshot(S); S.data.closed = why; S.pay_error = null; ucpSave(S) }
// Sesión de la solicitud: debe ser de la misma plataforma. Una sesión abierta que ya venció queda cancelada.
function ucpSession(ctx) {
  const S = ucpLoad(ctx.params.id); if (!S || S.platform !== ctx.platform) return null;
  if (S.status === 'open' && !S.booking_id && S.expires < Date.now()) ucpClose(S, 'expired');
  return S;
}
const ucpClosedMsg = (S, lang) => ({ type: 'error', code: S.data.closed === 'expired' ? 'checkout_expired' : 'checkout_canceled', severity: 'unrecoverable',
  content: S.data.closed === 'expired' ? ucpT(lang, 'Esta compra venció. Inicia una nueva.', 'This checkout expired. Start a new one.') : ucpT(lang, 'Esta compra fue cancelada. Inicia una nueva.', 'This checkout was canceled. Start a new one.') });

/* ---------- operación UCP: límites, identidad de la plataforma, firma, negociación, idempotencia y respuesta firmada ---------- */
function ucpReply(status, obj, headers = {}) {
  const body = Buffer.from(JSON.stringify(obj)), h = { 'Content-Digest': ucpDigest(body), ...headers };
  Object.assign(h, ucpSignHeaders(['@status', 'content-digest', 'content-type'], k => k === '@status' ? String(status) : k === 'content-digest' ? h['Content-Digest'] : 'application/json'));
  return new Raw(status, body, h);
}
function ucpOp(method, path, op, cap, fn, mutates) {
  on(method, '/api/ucp/v1' + path, async c => {
    if (!UCP_ON) throw new HttpErr(404, 'No encontrado.');
    const rid = String(c.req.headers['request-id'] || '').slice(0, 100), trace = /^[\w.:-]+$/.test(rid) ? { 'Request-Id': rid } : {}; let idem = null, platform = null;
    try {
      try { limit(c.ip, 'ucp-all', 3000, 600e3) } catch (e) { throw new UcpErr(429, 'rate_limited', 'Too many requests.', { 'Retry-After': '60' }) }
      if (c.body === null || typeof c.body !== 'object' || Array.isArray(c.body)) throw new UcpErr(400, 'invalid_request', 'The request body must be a JSON object.');
      const key = ucpAuth(c.req), P = await ucpPlatform(c); platform = P.url;
      const signed = c.req.headers['signature-input'] != null || c.req.headers.signature != null ? ucpVerify(c, P.profile) : false;
      if (!key && !signed) { try { limit(c.ip, 'ucp', 300, 600e3) } catch (e) { throw new UcpErr(429, 'rate_limited', 'Too many requests.', { 'Retry-After': '60' }) } }
      if (UCP_REQUIRE_AUTH && !key && !signed) throw new UcpErr(401, 'signature_missing', 'Authentication is required: an API key or an HTTP Message Signature.', { 'WWW-Authenticate': 'Bearer realm="ucp"' });
      const neg = ucpNegotiate(P.profile, P.url), ctx = { ...c, ...neg, platform, profile: P.profile, authed: !!(key || signed), op };
      ctx.lang = ucpLang(c.req, c.body.context);
      if (!neg.caps.has(cap)) return ucpReply(200, ucpFail(ctx, [], 'capabilities_incompatible', `This operation needs the ${cap} capability at version ${neg.v}, and the platform profile does not declare it.`), trace);
      const ik = String(c.req.headers['idempotency-key'] || '').trim();
      if (mutates && ik) {   // reintentos seguros: la misma llave con el mismo cuerpo devuelve la misma respuesta
        if (ik.length < 8 || ik.length > 200) throw new UcpErr(400, 'invalid_request', 'Idempotency-Key must be between 8 and 200 characters.');
        const bsha = sha(c.rawBuf), opk = op + ' ' + c.url.pathname, row = q1('SELECT * FROM ucp_idem WHERE platform=? AND key=?', platform, ik);
        if (row) {
          if (row.body_sha !== bsha || row.op !== opk) throw new UcpErr(409, 'idempotency_conflict', 'This Idempotency-Key was already used with a different request.');
          if (row.status != null) return ucpReply(row.status, JSON.parse(row.response), { ...trace, 'Idempotent-Replayed': 'true' });
          if (Date.now() - row.created < 120e3) throw new UcpErr(409, 'request_in_progress', 'A request with this Idempotency-Key is still being processed.', { 'Retry-After': '2' });
          run('DELETE FROM ucp_idem WHERE platform=? AND key=?', platform, ik);   // quedó a medias (por ejemplo, por un reinicio): se procesa de nuevo; el estado de la compra evita cobros dobles
        }
        run('INSERT INTO ucp_idem(platform,key,op,body_sha,created) VALUES(?,?,?,?,?)', platform, ik, opk, bsha, Date.now()); idem = ik;
      }
      const [status, obj] = await fn(ctx);
      if (idem) run('UPDATE ucp_idem SET status=?, response=? WHERE platform=? AND key=?', status, JSON.stringify(obj), platform, idem);
      return ucpReply(status, obj, trace);
    } catch (e) {
      if (idem) run('DELETE FROM ucp_idem WHERE platform=? AND key=? AND status IS NULL', platform, idem);
      if (e instanceof UcpErr) return new Raw(e.status, JSON.stringify({ code: e.code, content: e.message, continue_url: PUBLIC_URL + '/' }), { ...trace, ...(e.headers || {}) });
      if (e instanceof HttpErr) return new Raw(e.status, JSON.stringify({ code: e.status === 429 ? 'rate_limited' : 'invalid_request', content: e.message, continue_url: PUBLIC_URL + '/' }), { ...trace, ...(e.status === 429 ? { 'Retry-After': '60' } : {}) });
      console.error('ucp', op, e); return new Raw(500, JSON.stringify({ code: 'internal_error', content: 'Unexpected error.', continue_url: PUBLIC_URL + '/' }), trace);
    }
  });
}

/* ---------- catálogo: buscar vuelos y consultar por identificador ---------- */
const UCP_MONTHS = { enero: 1, january: 1, febrero: 2, february: 2, marzo: 3, march: 3, abril: 4, april: 4, mayo: 5, may: 5, junio: 6, june: 6, julio: 7, july: 7, agosto: 8, august: 8, septiembre: 9, september: 9, octubre: 10, october: 10, noviembre: 11, november: 11, diciembre: 12, december: 12 };
function ucpFind(body) {   // rutas y fechas que pide la búsqueda, en texto libre o en filtros
  const text = ' ' + norm(String(body.query ?? '').slice(0, 300)).replace(/[^a-z0-9-]+/g, ' ') + ' ', f = body.filters && typeof body.filters === 'object' ? body.filters : {};
  const where = { MIA: /\b(mia|miami|florida|fll|fort lauderdale)\b/, AXM: /\b(axm|armenia|quindio|eje cafetero|coffee region)\b/, BAQ: /\b(baq|barranquilla|carnaval|carnival)\b/ };
  const pos = Object.fromEntries(Object.entries(where).map(([k, re]) => [k, text.search(re)]));
  let from = f.origin ? String(f.origin).toUpperCase() : null, to = f.destination ? String(f.destination).toUpperCase() : null;
  let routes = Object.keys(SCHED).filter(r => { const [o, d] = r.split('-');
    if (from || to) return (!from || o === from) && (!to || d === to);
    const named = Object.keys(pos).filter(k => pos[k] >= 0); if (!named.length) return true;
    if (!named.includes(o) && !named.includes(d)) return false;
    if (named.includes(o) && named.includes(d)) return pos[o] < pos[d];               // «miami a armenia»: el orden del texto da el sentido
    return named.length === 1 });
  const dates = [...text.matchAll(/\b(20\d\d-\d\d-\d\d)\b/g)].map(m => m[1]); for (const k of ['date', 'departure_date']) if (/^\d{4}-\d{2}-\d{2}$/.test(String(f[k] || ''))) dates.push(String(f[k]));
  const month = Object.entries(UCP_MONTHS).find(([k]) => text.includes(' ' + k + ' '))?.[1];
  const lo = /^\d{4}-\d{2}-\d{2}$/.test(String(f.from || '')) ? String(f.from) : todayISO(), hi = /^\d{4}-\d{2}-\d{2}$/.test(String(f.to || '')) ? String(f.to) : '9999-12-31';
  const out = [];
  for (const r of routes) for (const d of opDates(r, lo, 200)) { if (d > hi) break; if (dates.length && !dates.includes(d)) continue; if (month && +d.slice(5, 7) !== month) continue; out.push([r, d]) }
  return out.sort((a, b) => a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : a[0] < b[0] ? -1 : 1);
}
ucpOp('POST', '/catalog/search', 'search_catalog', UCP_SRCH, async ctx => {
  const b = ctx.body, f = b.filters && typeof b.filters === 'object' ? b.filters : null;
  if (!(typeof b.query === 'string' && b.query.trim()) && !(f && Object.keys(f).length)) return [200, ucpFail(ctx, [UCP_SRCH], 'invalid_request', ucpT(ctx.lang, 'Envía un texto de búsqueda o al menos un filtro.', 'Send a search query or at least one filter.'))];
  const inRange = (r, d) => !f?.price || Object.keys(FAMILIES).some(k => ucpPriceOk({ price: { amount: ucpCents(priceOf(d, k)) } }, f.price)), all = ucpFind(b).filter(([r, d]) => inRange(r, d));
  const limitN = Math.min(25, Math.max(1, Math.floor(+b.pagination?.limit) || 10)); let off = 0; try { off = Math.max(0, +Buffer.from(String(b.pagination?.cursor || ''), 'base64url').toString() || 0) } catch (e) {}
  const page = all.slice(off, off + limitN).map(([r, d]) => { const p = ucpProduct(r, d, ctx.lang); p.variants = p.variants.filter(v => ucpPriceOk(v, f?.price)); return p }), more = off + limitN < all.length;
  return [200, { ucp: ucpEnvelope(ctx, [UCP_SRCH]), products: page, pagination: { has_next_page: more, total_count: all.length, ...(more ? { cursor: Buffer.from(String(off + limitN)).toString('base64url') } : {}) } }];
});
ucpOp('POST', '/catalog/lookup', 'lookup_catalog', UCP_LOOK, async ctx => {
  const ids = Array.isArray(ctx.body.ids) ? [...new Set(ctx.body.ids.map(x => String(x).slice(0, 80)))] : [];
  if (!ids.length) throw new UcpErr(400, 'invalid_request', 'ids is required.'); if (ids.length > 50) throw new UcpErr(400, 'request_too_large', 'Send at most 50 identifiers per request.');
  const byProduct = new Map(), messages = [];
  for (const id of ids) { const p = ucpParseItem(id); if (!p) { messages.push({ type: 'info', code: 'not_found', content: id }); continue }
    const k = p.route + '|' + p.date; if (!byProduct.has(k)) byProduct.set(k, { route: p.route, date: p.date, hits: new Map() });
    const fare = p.fare || 'classic', hits = byProduct.get(k).hits; if (!hits.has(fare)) hits.set(fare, []); hits.get(fare).push({ id, match: p.fare ? 'exact' : 'featured' }) }   // por vuelo se muestra Classic como tarifa de referencia
  const products = []; for (const x of byProduct.values()) { const p = ucpProduct(x.route, x.date, ctx.lang, [...x.hits.keys()]);
    p.variants = p.variants.filter(v => ucpPriceOk(v, ctx.body.filters?.price)).map(v => ({ ...v, inputs: x.hits.get(v.id.split('-').pop()) })); if (p.variants.length) products.push(p) }
  return [200, { ucp: ucpEnvelope(ctx, [UCP_LOOK]), products, ...(messages.length ? { messages } : {}) }];
});
ucpOp('POST', '/catalog/product', 'get_product', UCP_LOOK, async ctx => {
  const p = ucpParseItem(ctx.body.id); if (!p) return [200, ucpFail(ctx, [UCP_LOOK], 'not_found', ucpT(ctx.lang, 'No encontramos ese vuelo.', 'Flight not found.'))];
  const prod = ucpProduct(p.route, p.date, ctx.lang), opt = prod.options[0].name, want = Array.isArray(ctx.body.selected) ? ctx.body.selected.find(s => norm(s?.name) === norm(opt)) : null;
  const pick = p.fare || Object.keys(FAMILIES).find(f => norm(FARE_NAME[f]) === norm(want?.label)) || null;   // el identificador de variante manda sobre la selección
  if (pick) { prod.variants.sort((a, b) => (b.id.endsWith('-' + pick) ? 1 : 0) - (a.id.endsWith('-' + pick) ? 1 : 0)); prod.variants = prod.variants.slice(0, 1) }
  else prod.variants.sort((a, b) => (b.id.endsWith('-classic') ? 1 : 0) - (a.id.endsWith('-classic') ? 1 : 0));
  prod.variants = prod.variants.filter(v => ucpPriceOk(v, ctx.body.filters?.price));
  if (!prod.variants.length) return [200, ucpFail(ctx, [UCP_LOOK], 'not_found', ucpT(ctx.lang, 'Ninguna tarifa de este vuelo cumple los filtros.', 'No fare on this flight matches the filters.'))];
  prod.selected = pick ? [{ name: opt, label: FARE_NAME[pick] }] : [];
  prod.options[0].values = Object.keys(FAMILIES).map(f => ({ label: FARE_NAME[f], exists: true, available: operates(p.route, p.date) && ucpFree(p.route, p.date, f) > 0 }));
  return [200, { ucp: ucpEnvelope(ctx, [UCP_LOOK]), product: prod }];
});

/* ---------- checkout: crear, consultar, actualizar, completar y cancelar ---------- */
function ucpApply(S, ctx, first) {   // datos que envía la plataforma en crear y actualizar
  const b = ctx.body, d = S.data, extra = [], T = (es, en) => ucpT(d.lang, es, en);
  if (first || b.line_items !== undefined) { const r = ucpReadLines(b);
    for (const id of r.unknown) extra.push({ type: 'error', code: 'item_unavailable', severity: 'recoverable', content: T(`No reconocemos el artículo «${id}». Usa los identificadores del catálogo, por ejemplo BM701-20261214-classic.`, `Unknown item "${id}". Use the catalog identifiers, for example BM701-20261214-classic.`) });
    if (r.items.length) { d.items = r.items; for (const i of r.adjusted) extra.push({ type: 'warning', code: 'quantity_adjusted', path: `$.line_items[${i}].quantity`, content: T(`La cantidad quedó en ${r.items[i].qty}: una compra admite de 1 a 9 pasajeros. Para grupos escribe a ${SUPPORT_EMAIL}.`, `Quantity set to ${r.items[i].qty}: a purchase takes 1 to 9 passengers. For groups write to ${SUPPORT_EMAIL}.`) }) }
    else if (!first) extra.push({ type: 'error', code: 'invalid', severity: 'recoverable', path: '$.line_items', content: T('La compra necesita al menos un vuelo; se conservaron los anteriores.', 'The checkout needs at least one flight; the previous ones were kept.') }) }
  if (first || b.buyer !== undefined) d.buyer = ucpReadBuyer(b.buyer);
  if (first || b.passengers !== undefined) d.passengers = ucpReadPax(b.passengers);
  if (b.context && typeof b.context === 'object') d.lang = ctx.lang;
  d.hook = ctx.hook || null;
  return extra;
}
ucpOp('POST', '/checkout-sessions', 'create_checkout', UCP_CHK, async ctx => {
  if (!ctx.authed) { try { limit(ctx.ip, 'ucp-create', 40, 600e3) } catch (e) { throw new UcpErr(429, 'rate_limited', 'Too many checkouts. Try again later.', { 'Retry-After': '120' }) } }
  const T = (es, en) => ucpT(ctx.lang, es, en), ts = now();
  const S = { id: ucpId('chk_'), platform: ctx.platform, version: ctx.v, status: 'open', data: { lang: ctx.lang, items: [] }, created: ts, updated: ts, expires: Date.now() + UCP_TTL_MIN * 60e3 };
  const extra = ucpApply(S, ctx, true), d = S.data;
  if (!d.items.length) return [200, ucpFail(ctx, [UCP_CHK], 'item_unavailable', T('Ninguno de los vuelos pedidos existe. Consulta el catálogo: los identificadores tienen la forma BM701-20261214-classic.', 'None of the requested flights exist. Check the catalog: identifiers look like BM701-20261214-classic.'))];
  if (d.items.every(it => !operates(it.route, it.date))) return [200, ucpFail(ctx, [UCP_CHK], 'item_unavailable', T('Los vuelos pedidos ya no están a la venta.', 'The requested flights are no longer on sale.'))];
  if (d.items.every(it => operates(it.route, it.date) && ucpFree(it.route, it.date, it.fare) < 1)) return [200, ucpFail(ctx, [UCP_CHK], 'out_of_stock', T('No quedan sillas en los vuelos pedidos.', 'The requested flights are sold out.'))];
  run('INSERT INTO ucp_sessions(id,platform,version,status,data,created,updated,expires) VALUES(?,?,?,?,?,?,?,?)', S.id, S.platform, S.version, S.status, JSON.stringify(d), ts, ts, S.expires);
  return [201, ucpCheckout(ctx, S, null, extra)];
}, true);
const ucpMissing = ctx => [200, ucpFail(ctx, [UCP_CHK], 'not_found', ucpT(ctx.lang, 'No encontramos esa compra o ya venció.', 'Checkout not found or expired.'))];
ucpOp('GET', '/checkout-sessions/:id', 'get_checkout', UCP_CHK, async ctx => {
  let S = ucpSession(ctx); if (!S) return ucpMissing(ctx);
  if (S.status === 'in_progress') { await ucpReconcile(S); S = ucpLoad(S.id) }
  return [200, ucpCheckout(ctx, S, null, S.status === 'canceled' ? [ucpClosedMsg(S, S.data.lang)] : [])];
});
ucpOp('PUT', '/checkout-sessions/:id', 'update_checkout', UCP_CHK, async ctx => {
  const S = ucpSession(ctx); if (!S) return ucpMissing(ctx); const T = (es, en) => ucpT(S.data.lang, es, en);
  if (S.status === 'canceled') return [200, ucpCheckout(ctx, S, null, [ucpClosedMsg(S, S.data.lang)])];
  if (S.status === 'completed') return [200, ucpCheckout(ctx, S, null, [{ type: 'error', code: 'checkout_completed', severity: 'unrecoverable', content: T('Esta compra ya se completó y no admite cambios.', 'This checkout is completed and can no longer be changed.') }])];
  if (S.status === 'in_progress') return [200, ucpCheckout(ctx, S, null, [{ type: 'error', code: 'complete_in_progress', severity: 'recoverable', content: T('El pago se está procesando; la compra no se modificó.', 'Payment is being processed; the checkout was not changed.') }])];
  if (S.booking_id) return [200, ucpCheckout(ctx, S)];   // ya hay una reserva esperando pago en la web: no se toca
  const extra = ucpApply(S, ctx, false); S.pay_error = null; ucpSave(S);
  return [200, ucpCheckout(ctx, S, null, extra)];
}, true);
ucpOp('POST', '/checkout-sessions/:id/cancel', 'cancel_checkout', UCP_CHK, async ctx => {
  const S = ucpSession(ctx); if (!S) return ucpMissing(ctx); const T = (es, en) => ucpT(S.data.lang, es, en);
  if (S.status === 'canceled') return [200, ucpCheckout(ctx, S, null, [ucpClosedMsg(S, S.data.lang)])];
  if (S.status === 'completed') return [200, ucpCheckout(ctx, S, null, [{ type: 'error', code: 'checkout_completed', severity: 'unrecoverable', content: T(`Esta compra ya se completó. Para cambios o anulaciones escribe a ${SUPPORT_EMAIL}.`, `This checkout is completed. For changes or cancellations write to ${SUPPORT_EMAIL}.`) }])];
  if (S.status === 'in_progress') return [200, ucpCheckout(ctx, S, null, [{ type: 'error', code: 'complete_in_progress', severity: 'recoverable', content: T('El pago se está procesando y la compra no se puede cancelar en este momento.', 'Payment is being processed and the checkout cannot be canceled right now.') }])];
  const b = ucpBooking(S); S.booking_id = null; ucpClose(S, 'canceled');
  if (b && b.status === 'pending') releaseBooking(b, 'cancelled', 'ucp');
  return [200, ucpCheckout(ctx, S)];
}, true);

/* ---------- cobro con Stripe del medio de pago que entrega la plataforma ---------- */
const ucpSleep = ms => new Promise(r => setTimeout(r, ms));
async function ucpCharge(S, b, kind, token, inst) {   // → { ok } | { failed } | { unknown }: nunca se cobra dos veces la misma reserva
  const d = S.data, f = new URLSearchParams(), headers = { Authorization: 'Bearer ' + STRIPE_KEY, 'Content-Type': 'application/x-www-form-urlencoded', 'Idempotency-Key': `ucp_${S.id}_${b.pnr}` };
  f.set('amount', String(ucpCents(b.total))); f.set('currency', 'usd'); f.set('confirm', 'true');
  f.set('description', `Beemo Air · Reserva ${b.pnr}`); f.set('metadata[ref]', 'B:' + b.pnr); f.set('metadata[ucp_session]', S.id);
  if (kind === 'com.stripe.payments') { f.set('payment_method_data[shared_payment_granted_token]', token); headers['Stripe-Version'] = '2026-09-30.preview' }
  else {   // Google Pay con Stripe como pasarela: el token trae un token de Stripe (tok_…)
    let tok = token; try { const j = JSON.parse(token); if (j && typeof j.id === 'string') tok = j.id } catch (e) {}
    if (!/^tok_[A-Za-z0-9]+$/.test(tok)) return { failed: 'token' };
    f.set('payment_method_data[type]', 'card'); f.set('payment_method_data[card][token]', tok); f.set('error_on_requires_action', 'true');
    const a = inst.billing_address && typeof inst.billing_address === 'object' ? inst.billing_address : {}, name = [a.first_name, a.last_name].filter(Boolean).join(' ') || [d.buyer.first_name, d.buyer.last_name].filter(Boolean).join(' ');
    if (name) f.set('payment_method_data[billing_details][name]', clean(name, 80)); if (okEmail(d.buyer.email)) { f.set('payment_method_data[billing_details][email]', d.buyer.email); f.set('receipt_email', d.buyer.email) }
    for (const [k, s] of [['street_address', 'line1'], ['extended_address', 'line2'], ['address_locality', 'city'], ['address_region', 'state'], ['postal_code', 'postal_code'], ['address_country', 'country']]) if (a[k]) f.set(`payment_method_data[billing_details][address][${s}]`, clean(a[k], 80));
  }
  for (let i = 0; i < 2; i++) {
    try {
      const r = await fetch(STRIPE_API + '/v1/payment_intents', { method: 'POST', headers, body: f, signal: AbortSignal.timeout(25000) }), j = await r.json().catch(() => ({}));
      if (r.ok && j.id) {
        run('UPDATE ucp_sessions SET pi=? WHERE id=?', j.id, S.id);
        if (j.status === 'succeeded') return { ok: true };
        if (j.status === 'processing') return { unknown: true };
        // pide una verificación adicional del banco u otro paso que aquí no se puede dar: se anula el intento
        try { await fetch(`${STRIPE_API}/v1/payment_intents/${j.id}/cancel`, { method: 'POST', headers: { Authorization: 'Bearer ' + STRIPE_KEY }, signal: AbortSignal.timeout(15000) }) } catch (e) {}
        return { failed: j.status || 'not_succeeded' };
      }
      if (r.status < 500 && r.status !== 429 && r.status !== 409) { console.error('ucp stripe', r.status, j.error?.code, j.error?.message); return { failed: j.error?.decline_code || j.error?.code || 'stripe_' + r.status } }
    } catch (e) { console.error('ucp stripe', e.message) }
    await ucpSleep(900);
  }
  return { unknown: true };
}
function ucpPayFailed(S, b) {   // el cobro no pasó: se liberan las sillas y la compra queda lista para otro medio de pago
  S.status = 'open'; S.booking_id = null; S.pi = null; delete S.data.payment; delete S.data.charge; delete S.data.snapshot;
  S.pay_error = ucpT(S.data.lang, 'No pudimos procesar el pago. Intenta con otro medio de pago.', 'We could not process the payment. Try another payment method.'); ucpSave(S);
  if (b && b.status === 'pending') releaseBooking(b, 'cancelled', 'ucp');
}
// Un cobro que quedó sin respuesta: se consulta en Stripe hasta saber si pasó
async function ucpReconcile(S) {
  const b = ucpBooking(S); if (S.status !== 'in_progress' || !b) return;
  if (b.status === 'confirmed') return ucpBookingPaid(b);
  if (!STRIPE_KEY) return;
  let pi = null;
  try { const h = { Authorization: 'Bearer ' + STRIPE_KEY }, t = AbortSignal.timeout(15000);
    if (S.pi) { const r = await fetch(`${STRIPE_API}/v1/payment_intents/${S.pi}`, { headers: h, signal: t }); if (!r.ok) return; pi = await r.json() }
    else { const r = await fetch(`${STRIPE_API}/v1/payment_intents/search?limit=1&query=${encodeURIComponent(`metadata['ref']:'B:${b.pnr}'`)}`, { headers: h, signal: t }); if (!r.ok) return; pi = (await r.json()).data?.[0] || null }
  } catch (e) { return }
  const fresh = ucpLoad(S.id); if (!fresh || fresh.status !== 'in_progress') return;
  if (pi?.status === 'succeeded') { const cur = q1('SELECT * FROM bookings WHERE id=?', b.id); if (cur.status === 'pending') confirmPaid(cur, 'ucp'); return }
  if (pi && ['canceled', 'requires_payment_method'].includes(pi.status)) return ucpPayFailed(fresh, q1('SELECT * FROM bookings WHERE id=?', b.id));
  if (!pi && Date.now() - (fresh.data.charge?.at || 0) > 10 * 60e3) ucpPayFailed(fresh, q1('SELECT * FROM bookings WHERE id=?', b.id));   // Stripe no tiene ningún cobro para esta reserva
}
ucpOp('POST', '/checkout-sessions/:id/complete', 'complete_checkout', UCP_CHK, async ctx => {
  let S = ucpSession(ctx); if (!S) return ucpMissing(ctx); const d = S.data, T = (es, en) => ucpT(d.lang, es, en);
  const fail = (code, content, path) => [200, ucpCheckout(ctx, S, null, [{ type: 'error', code, content, severity: 'recoverable', ...(path ? { path } : {}) }])];
  if (S.status === 'completed') return [200, ucpCheckout(ctx, S)];
  if (S.status === 'canceled') return [200, ucpCheckout(ctx, S, null, [ucpClosedMsg(S, d.lang)])];
  if (S.status === 'in_progress') { await ucpReconcile(S); S = ucpLoad(S.id); return [200, ucpCheckout(ctx, S, null, S.status === 'in_progress' ? [{ type: 'error', code: 'complete_in_progress', severity: 'recoverable', content: T('El pago ya se está procesando.', 'Payment is already being processed.') }] : [])] }
  if (S.booking_id) return [200, ucpCheckout(ctx, S)];
  if (S.pay_error) { S.pay_error = null; ucpSave(S) }
  const st = ucpState(S, ctx);
  if (st.status !== 'ready_for_complete') return [200, ucpCheckout(ctx, S, st)];
  const list = Array.isArray(ctx.body.payment?.instruments) ? ctx.body.payment.instruments.filter(x => x && typeof x === 'object') : [], inst = list.find(x => x.selected) || (list.length === 1 ? list[0] : null);
  const kind = inst && Object.keys(st.pay).find(n => st.pay[n].some(h => h.id === inst.handler_id)), token = inst?.credential?.token;
  const unready = r => { const [code, obj] = r; obj.status = 'incomplete'; return [code, obj] };
  if (!inst) return unready(fail('missing', T('Falta el medio de pago.', 'A payment instrument is required.'), '$.payment.instruments'));
  if (!kind) return unready(fail('invalid', T('Ese medio de pago no está entre los que acepta esta compra.', 'That payment handler is not accepted for this checkout.'), '$.payment.instruments[0].handler_id'));
  if (typeof token !== 'string' || !token || token.length > 20000) return unready(fail('missing', T('Falta la credencial del medio de pago.', 'The payment credential is missing.'), '$.payment.instruments[0].credential'));
  if (!ctx.authed) { try { limit(ctx.ip, 'ucp-pay', 60, 3600e3) } catch (e) { throw new UcpErr(429, 'rate_limited', 'Too many payment attempts. Try again later.', { 'Retry-After': '300' }) } }
  // 1) apartar las sillas; 2) cobrar; 3) emitir. Si el cobro falla, las sillas se liberan.
  let bid; try { bid = createBooking(ucpBody(d, st.pax, d.buyer.email, d.buyer.phone_number), { channel: 'ucp', holdMin: UCP_HOLD_MIN }) }
  catch (e) { if (!(e instanceof HttpErr)) throw e; return unready(fail(e.extra?.code === 'sold_out' ? 'out_of_stock' : 'invalid', e.message)) }
  stampOrigin(bid, ctx.ip, ctx.req);   // en una compra nativa es la dirección de la plataforma, no la del comprador
  const b = q1('SELECT * FROM bookings WHERE id=?', bid);
  { const d0 = JSON.parse(b.data), txt = `Aceptación en la plataforma de compra ${S.platform || ''}: el comprador completó la compra con los enlaces de Términos, Privacidad y Reembolsos que Beemo Air entrega en el checkout (UCP).`;
    consentLog({ terms: true, privacy: true, labels: { terms: txt, privacy: txt }, lang: d.lang }, { form: 'ucp_plataforma', subject: d0.contact?.email, name: paxNames(d0), ref: b.pnr, channel: 'plataforma', by: S.platform || null, ip: ctx.ip, req: ctx.req }) }
  if (ucpCents(b.total) !== st.total) { releaseBooking(b, 'cancelled', 'ucp'); return unready(fail('invalid', T('El precio cambió. Revisa el total e intenta de nuevo.', 'The price changed. Review the total and try again.'))) }
  S.status = 'in_progress'; S.booking_id = bid; S.pi = null; d.charge = { at: Date.now(), handler: kind }; d.snapshot = { lines: st.lines, totals: st.totals };
  d.payment = { instruments: [{ id: String(inst.id || 'instr_1').slice(0, 80), handler_id: String(inst.handler_id), type: String(inst.type || 'card').slice(0, 40), selected: true, ...(inst.display && typeof inst.display === 'object' ? { display: Object.fromEntries(Object.entries(inst.display).filter(([, v]) => typeof v === 'string').map(([k, v]) => [k, v.slice(0, 120)])) } : {}) }] };
  ucpSave(S);
  const r = await ucpCharge(S, b, kind, token, inst), cur = q1('SELECT * FROM bookings WHERE id=?', bid); S = ucpLoad(S.id);
  if (r.ok) { if (cur.status === 'pending') confirmPaid(cur, 'ucp'); else if (cur.status !== 'confirmed') log('ucp', `PAGO RECIBIDO PARA RESERVA ${cur.status} ${cur.pnr}: revisar y reembolsar o reubicar`); S = ucpLoad(S.id) }
  else if (r.failed) { log('ucp', `pago rechazado ${cur.pnr} (${r.failed})`); if (S.status === 'in_progress') ucpPayFailed(S, cur); S = ucpLoad(S.id); return [200, { ...ucpCheckout(ctx, S), status: 'incomplete' }] }
  return [200, ucpCheckout(ctx, S)];
}, true);

/* ---------- pedido: lo que se vendió, cómo se entrega y qué ha pasado después ---------- */
function ucpOrder(S) {
  const d = S.data, o = d.order, snap = d.snapshot, lang = d.lang, T = (es, en) => ucpT(lang, es, en), flown = new Set(o.flown || []);
  const line_items = d.items.map((it, i) => ({ ...snap.lines[i], quantity: { original: it.qty, total: o.canceled ? 0 : it.qty, fulfilled: !o.canceled && flown.has(it.id) ? it.qty : 0 }, status: o.canceled ? 'removed' : flown.has(it.id) ? 'fulfilled' : 'processing' }));
  return { ucp: { version: S.version, capabilities: { [UCP_ORD]: [{ version: S.version }] } }, id: S.order_id, label: o.pnr, checkout_id: S.id, permalink_url: ucpContinue(S.id), currency: 'USD', line_items,
    fulfillment: { expectations: o.canceled ? [] : d.items.map((it, i) => ({ id: 'exp_' + (i + 1), line_items: [{ id: it.id, quantity: it.qty }], method_type: 'digital', destination: { address_country: it.route.endsWith('MIA') ? 'US' : 'CO' },
        description: T(`Tiquete electrónico enviado al correo. Vuelo ${SCHED[it.route].no}: ${ucpRouteName(it.route)}, ${ucpDay(it.date, lang)}, sale a las ${flightTimes(it.route, it.date).dep}.`, `E-ticket sent by email. Flight ${SCHED[it.route].no}: ${ucpRouteName(it.route)}, ${ucpDay(it.date, lang)}, departs ${flightTimes(it.route, it.date).dep}.`), fulfillable_on: new Date(depTime(it.route, it.date)).toISOString() })),
      events: o.events || [] },
    adjustments: o.adjustments || [], totals: snap.totals };
}
function ucpEmit(S) {   // foto completa del pedido hacia la plataforma, firmada y con reintentos
  if (!S.data.hook) return;
  const event = ucpId('evt_', 20), ts = now();
  run('INSERT INTO ucp_events(event,order_id,url,body,next_at,created) VALUES(?,?,?,?,?,?)', event, S.order_id, S.data.hook, JSON.stringify({ ...ucpOrder(S), event_id: event, created_time: ts }), Date.now(), ts);
  setTimeout(() => ucpFlush().catch(e => console.error('ucp events', e.message)), 50).unref();
}
let ucpFlushing = false;
async function ucpFlush() {
  if (ucpFlushing) return; ucpFlushing = true;
  const wait = new Set();   // un pedido con un evento en espera no adelanta los siguientes: la plataforma los recibe en orden
  try { for (const e of q("SELECT * FROM ucp_events WHERE status='pending' ORDER BY id LIMIT 200")) {
    if (wait.has(e.order_id)) continue; if (e.next_at > Date.now()) { wait.add(e.order_id); continue }
    let stop = false;
    try {
      const u = new URL(e.url), body = Buffer.from(e.body), h = { 'content-type': 'application/json', 'ucp-agent': `profile="${UCP_PROFILE}"`, 'idempotency-key': e.event, 'webhook-id': e.event, 'webhook-timestamp': String(Math.floor(Date.parse(e.created) / 1000)), 'content-digest': ucpDigest(body) };
      const comps = ['@method', '@authority', '@path', ...(u.search ? ['@query'] : []), 'ucp-agent', 'idempotency-key', 'content-digest', 'content-type'];
      Object.assign(h, ucpSignHeaders(comps, k => k === '@method' ? 'POST' : k === '@authority' ? u.host.toLowerCase() : k === '@path' ? u.pathname : k === '@query' ? u.search : h[k]));
      const r = await ucpFetch(e.url, { method: 'POST', headers: h, body, timeout: 10000 });
      if (r.status >= 200 && r.status < 300) { run("UPDATE ucp_events SET status='sent', sent=?, error=NULL, tries=tries+1 WHERE id=?", now(), e.id); continue }
      stop = r.status >= 400 && r.status < 500 && ![408, 409, 425, 429].includes(r.status); throw new Error('HTTP ' + r.status);
    } catch (x) { const t = e.tries + 1, gaveUp = stop || t >= 8; if (!gaveUp) wait.add(e.order_id);
      run('UPDATE ucp_events SET tries=?, error=?, next_at=?, status=? WHERE id=?', t, String(x.message).slice(0, 200), Date.now() + Math.min(6 * 3600e3, 30e3 * 4 ** t), gaveUp ? 'error' : 'pending', e.id) }
  } } finally { ucpFlushing = false }
}
// La reserva ligada a una compra UCP quedó pagada (cobro nativo, Stripe en la web o confirmación manual): nace el pedido
function ucpBookingPaid(b0) {
  const r = q1("SELECT id FROM ucp_sessions WHERE booking_id=? AND status IN ('open','in_progress')", b0.id); if (!r) return;
  const S = ucpLoad(r.id), b = q1('SELECT * FROM bookings WHERE id=?', b0.id), bd = JSON.parse(b.data);
  S.status = 'completed'; S.order_id = ucpId('ord_', 20); S.pay_error = null; delete S.data.charge;
  S.data.passengers = bd.pax.map(p => ({ first_name: p.first, last_name: p.last })); S.data.buyer = { ...S.data.buyer, email: bd.contact.email, ...(bd.contact.phone ? { phone_number: bd.contact.phone } : {}) };
  S.data.snapshot = ucpSnapshot(S, b, bd); S.data.order = { pnr: b.pnr, at: now(), events: [], adjustments: [], flown: [] };
  ucpSave(S); log('ucp', `pedido ${S.order_id} · reserva ${b.pnr} · ${b.total}`);
  try { ucpEmit(S) } catch (e) { console.error('ucp emit', e.message) }
  try { ucpMail(S, b, bd) } catch (e) { console.error('ucp mail', e.message) }
}
// La reserva ligada a una compra UCP se anuló o venció
function ucpBookingReleased(b, st) {
  const r = q1('SELECT id FROM ucp_sessions WHERE booking_id=?', b.id); if (!r) return; const S = ucpLoad(r.id);
  if (S.status === 'completed') { if (S.data.order.canceled) return;   // tiquete emitido que se anula: el pedido queda cancelado
    S.data.order.canceled = true; S.data.order.adjustments.push({ id: ucpId('adj_', 12), type: 'cancellation', occurred_at: now(), status: 'completed', line_items: S.data.items.map(it => ({ id: it.id, quantity: -it.qty })), description: ucpT(S.data.lang, 'Reserva anulada por Beemo Air.', 'Booking canceled by Beemo Air.') });
    ucpSave(S); ucpEmit(S) }
  else if (S.status === 'open') { S.booking_id = null; ucpSave(S) }   // la reserva pendiente de pago en la web venció o se anuló: se puede intentar de nuevo
  else if (S.status === 'in_progress') { log('ucp', `COBRO SIN CONFIRMAR: la reserva ${b.pnr} quedó ${st} mientras se cobraba. Revisar en Stripe.`); S.status = 'open'; S.booking_id = null; delete S.data.snapshot;
    S.pay_error = ucpT(S.data.lang, 'No pudimos confirmar el pago. Si ves un cargo, escríbenos y lo resolvemos.', 'We could not confirm the payment. If you see a charge, write to us and we will sort it out.'); ucpSave(S) }
}
function ucpFlown() {   // después de volar, cada trayecto queda entregado
  const cut = Date.now() - CLUB_CREDIT_H * 3600e3;
  for (const r of q("SELECT id FROM ucp_sessions WHERE status='completed' AND data NOT LIKE '%\"done\":true%'")) { const S = ucpLoad(r.id), o = S?.data.order; if (!o) continue;
    if (o.canceled) { o.done = true; ucpSave(S); continue }
    const news = S.data.items.filter(it => !o.flown.includes(it.id) && depTime(it.route, it.date) < cut); if (!news.length) continue;
    for (const it of news) { o.flown.push(it.id); o.events.push({ id: ucpId('ful_', 12), occurred_at: now(), type: 'delivered', line_items: [{ id: it.id, quantity: it.qty }], description: ucpT(S.data.lang, `Vuelo ${SCHED[it.route].no} del ${ucpDay(it.date, S.data.lang)} operado.`, `Flight ${SCHED[it.route].no} on ${ucpDay(it.date, S.data.lang)} operated.`) }) }
    if (o.flown.length === S.data.items.length) o.done = true; ucpSave(S); ucpEmit(S) }
}
ucpOp('GET', '/orders/:id', 'get_order', UCP_ORD, async ctx => {
  const r = q1('SELECT id FROM ucp_sessions WHERE order_id=?', String(ctx.params.id || '')), S = r && ucpLoad(r.id);
  if (!ctx.authed) return [200, ucpFail(ctx, [UCP_ORD], 'unauthorized', 'Not authorized to access this order.', { continue_url: undefined })];   // los pedidos solo se entregan a una plataforma autenticada
  if (!S || S.platform !== ctx.platform) return [200, ucpFail(ctx, [UCP_ORD], 'not_found', 'Order not found.', { continue_url: undefined })];
  return [200, { ...ucpOrder(S), ucp: ucpEnvelope(ctx, [UCP_ORD]) }];
});

/* ---------- correo de confirmación (el protocolo lo exige al completar una compra) ---------- */
function ucpMail(S, b, bd) {
  if (!mailReady() || !okEmail(bd.contact.email)) return;
  const lang = S.data.lang, T = (es, en) => ucpT(lang, es, en), legs = bd.legs.map(l => `${SCHED[l.route].no} · ${ucpRouteName(l.route)} · ${ucpDay(l.date, lang, true)} · ${l.dep} → ${l.arr} · ${FARE_NAME[l.fare]}`);
  const pax = bd.pax.map((p, i) => `${p.first} ${p.last} · ${T('sillas', 'seats')} ${bd.legs.map(l => l.seats[i]).join(' / ')}`), total = ucpMoney(ucpCents(b.total));
  const subject = T(`Tu reserva ${b.pnr} con Beemo Air está confirmada`, `Your Beemo Air booking ${b.pnr} is confirmed`);
  const text = [T(`Hola ${bd.pax[0].first}:`, `Hi ${bd.pax[0].first},`), '', T(`Tu reserva está confirmada. Código de reserva: ${b.pnr}`, `Your booking is confirmed. Booking code: ${b.pnr}`), '', ...legs, '', T('Pasajeros:', 'Passengers:'), ...pax, '', T(`Total pagado: ${total}`, `Total paid: ${total}`), '',
    T(`Consulta tu reserva y haz check-in en ${PUBLIC_URL}/#mi-reserva con el código y el apellido.`, `Manage your booking and check in at ${PUBLIC_URL}/#mi-reserva with the code and last name.`), T(`Documentos de viaje: ${PUBLIC_URL}/ayuda/#documentos`, `Travel documents: ${PUBLIC_URL}/ayuda/#documentos`), '',
    T(`Condiciones de tu compra (versión ${LEGAL_V.terms}): Términos y condiciones ${PUBLIC_URL}/terminos/ · Reembolsos ${PUBLIC_URL}/reembolsos/ · Privacidad ${PUBLIC_URL}/privacidad/`, `Terms of your purchase (version ${LEGAL_V.terms}): Terms and Conditions ${PUBLIC_URL}/terminos/ · Refunds ${PUBLIC_URL}/reembolsos/ · Privacy ${PUBLIC_URL}/privacidad/`), '', 'Beemo Air · El milagro que nos une'].join('\n');
  const li = a => a.map(x => `<li style="margin:0 0 4px">${escH(x)}</li>`).join('');
  const html = `<div style="font-family:Arial,sans-serif;max-width:640px;color:#101B36"><h2 style="margin:0 0 6px;font-size:20px">${escH(T('Tu reserva está confirmada', 'Your booking is confirmed'))}</h2>
    <p style="margin:0 0 14px;font-size:14px">${escH(T('Código de reserva', 'Booking code'))}: <b style="font-size:18px;letter-spacing:1px">${escH(b.pnr)}</b></p><ul style="padding-left:18px;font-size:14px">${li(legs)}</ul>
    <p style="margin:12px 0 4px;font-size:13px;color:#56617E">${escH(T('Pasajeros', 'Passengers'))}</p><ul style="padding-left:18px;font-size:14px">${li(pax)}</ul><p style="font-size:14px"><b>${escH(T('Total pagado', 'Total paid'))}: ${escH(total)}</b></p>
    <p style="font-size:14px"><a href="${PUBLIC_URL}/#mi-reserva">${escH(T('Consulta tu reserva y haz check-in', 'Manage your booking and check in'))}</a> · <a href="${PUBLIC_URL}/ayuda/#documentos">${escH(T('Documentos de viaje', 'Travel documents'))}</a></p>
    <p style="font-size:12px;color:#56617E">${escH(T(`Condiciones de tu compra (versión ${LEGAL_V.terms}):`, `Terms of your purchase (version ${LEGAL_V.terms}):`))} <a href="${PUBLIC_URL}/terminos/">${escH(T('Términos y condiciones', 'Terms and Conditions'))}</a> · <a href="${PUBLIC_URL}/reembolsos/">${escH(T('Reembolsos', 'Refunds'))}</a> · <a href="${PUBLIC_URL}/privacidad/">${escH(T('Privacidad', 'Privacy'))}</a></p>
    <p style="font-size:12px;color:#56617E">Beemo Air · El milagro que nos une</p></div>`;
  queueMail([bd.contact.email], subject, text, html, 'ucp:' + S.order_id);
}

/* ---------- terminar la compra en beemoair.com (continue_url): nombres de los pasajeros y pago ---------- */
function ucpPage(S, req, url) {
  const lang = url.searchParams.get('lang') === 'en' || (!url.searchParams.get('lang') && (S ? S.data.lang === 'en' : ucpLang(req) === 'en')) ? 'en' : 'es', T = (es, en) => ucpT(lang, es, en), e = escH;
  const shell = (title, inner, refresh) => `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex">${refresh ? `<meta http-equiv="refresh" content="${refresh}">` : ''}<title>${e(title)} · Beemo Air</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link href="https://fonts.googleapis.com/css2?family=Urbanist:wght@600;700;800&family=Instrument+Sans:wght@400;500;600&display=swap" rel="stylesheet">
<style>:root{--navy:#101B36;--lime:#B9F44D;--cloud:#E9EEF5;--soft:#56617E;--line:#CBD3E1}*{box-sizing:border-box}body{margin:0;background:#F4F7FB;color:var(--navy);font:16px/1.5 "Instrument Sans",system-ui,-apple-system,Arial,sans-serif}
.top{background:var(--navy);padding:18px 20px}.top a{color:#fff;text-decoration:none;font:800 22px/1 Urbanist,system-ui,sans-serif;letter-spacing:-.02em}.top a span{color:var(--lime);font-size:13px;font-weight:700;letter-spacing:.14em;margin-left:6px}
main{max-width:640px;margin:0 auto;padding:28px 18px 60px}h1{font:800 28px/1.15 Urbanist,system-ui,sans-serif;letter-spacing:-.02em;margin:0 0 6px}.lead{color:var(--soft);margin:0 0 22px}
.card{background:#fff;border:1px solid var(--line);border-radius:16px;padding:20px;margin:0 0 16px}.card h2{font:700 13px/1 Urbanist,system-ui,sans-serif;letter-spacing:.08em;text-transform:uppercase;color:var(--soft);margin:0 0 14px}
.leg{display:flex;justify-content:space-between;gap:12px;padding:10px 0;border-top:1px solid var(--cloud)}.leg:first-of-type{border-top:0;padding-top:0}.leg b{display:block}.leg small,.fine{color:var(--soft);font-size:13px}.amt{white-space:nowrap;font-weight:600}
.tot{display:flex;justify-content:space-between;padding-top:12px;margin-top:6px;border-top:1px solid var(--line);font:700 18px/1.2 Urbanist,system-ui,sans-serif}.ck{display:flex;gap:10px;align-items:flex-start;margin:12px 0;font-size:14px;line-height:1.45}.ck input{width:20px;height:20px;margin:1px 0 0;flex:none;accent-color:var(--navy)}.ck a{color:var(--navy);font-weight:600}.row{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin:0 0 12px}
label{display:block;font-size:13px;font-weight:600;margin:0 0 5px}input{width:100%;padding:12px;border:1px solid var(--line);border-radius:10px;font:inherit;color:inherit;background:#fff}input:focus{outline:2px solid var(--navy);outline-offset:1px}
.pax{font-weight:600;margin:14px 0 8px}.pax:first-of-type{margin-top:0}button,.btn{display:block;width:100%;border:0;border-radius:999px;background:var(--lime);color:var(--navy);font:700 17px/1 Urbanist,system-ui,sans-serif;padding:17px;cursor:pointer;text-align:center;text-decoration:none}
button[disabled]{opacity:.6;cursor:wait}.err{background:#FDECEC;border:1px solid #F3B8B8;color:#8A1F1F;border-radius:10px;padding:12px;margin:0 0 14px;font-size:14px}.ok{background:#F1FBDD;border:1px solid var(--lime);border-radius:12px;padding:14px;margin:0 0 16px}
.pnr{font:800 30px/1 Urbanist,system-ui,sans-serif;letter-spacing:.08em}a{color:var(--navy)}@media(max-width:480px){.row{grid-template-columns:1fr}h1{font-size:24px}}</style></head>
<body><div class="top"><a href="${PUBLIC_URL}/">beemo<span>AIR</span></a></div><main>${inner}</main></body></html>`;
  const home = `<p><a href="${PUBLIC_URL}/#reservar">${e(T('Buscar vuelos en beemoair.com', 'Search flights at beemoair.com'))}</a></p>`;
  if (!S || S.status === 'canceled' || (S.status === 'open' && !S.booking_id && S.expires < Date.now()))
    return shell(T('Compra no disponible', 'Checkout unavailable'), `<h1>${e(T('Esta compra ya no está disponible', 'This checkout is no longer available'))}</h1><p class="lead">${e(T('El enlace venció o la compra fue cancelada. Puedes iniciar una nueva en un minuto.', 'The link expired or the checkout was canceled. You can start a new one in a minute.'))}</p>${home}`);
  const d = S.data, b = ucpBooking(S), bd = b ? JSON.parse(b.data) : null, st = S.status === 'open' && !b ? ucpState(S, null) : null, snap = st || d.snapshot || ucpSnapshot(S);
  const total = snap.totals[snap.totals.length - 1].amount, taxes = snap.totals[0].lines?.[1]?.amount;
  const trip = `<div class="card"><h2>${e(T('Tu viaje', 'Your trip'))}</h2>${d.items.map((it, i) => `<div class="leg"><div><b>${e(ucpRouteName(it.route))}</b><small>${e(ucpDay(it.date, lang, true))} · ${e(flightTimes(it.route, it.date).dep)} → ${e(flightTimes(it.route, it.date).arr)} · ${e(SCHED[it.route].no)}<br>${e(ucpFareLine(it.fare, lang))}</small></div><div class="amt">${it.qty} × ${e(ucpMoney(snap.lines[i].item.price))}</div></div>`).join('')}
    <div class="tot"><span>Total</span><span>${e(ucpMoney(total))}</span></div><p class="fine" style="margin:6px 0 0">${e(taxes ? T(`Incluye ${ucpMoney(taxes)} de tasas e impuestos.`, `Includes ${ucpMoney(taxes)} in taxes and fees.`) : T('Tasas e impuestos incluidos.', 'Taxes and fees included.'))}</p></div>`;
  if (S.status === 'completed' || b?.status === 'confirmed')
    return shell(T('Reserva confirmada', 'Booking confirmed'), `<h1>${e(T('Reserva confirmada', 'Booking confirmed'))}</h1><p class="lead">${e(mailReady() ? T(`Te enviamos la confirmación a ${bd.contact.email}.`, `We sent the confirmation to ${bd.contact.email}.`) : T('Guarda tu código de reserva: lo necesitas para consultar el viaje y hacer check-in.', 'Keep your booking code: you need it to manage the trip and check in.'))}</p>
      <div class="ok"><div class="fine">${e(T('Código de reserva', 'Booking code'))}</div><div class="pnr">${e(b.pnr)}</div></div>${trip}
      <div class="card"><h2>${e(T('Pasajeros', 'Passengers'))}</h2>${bd.pax.map((p, i) => `<div class="leg"><div><b>${e(p.first)} ${e(p.last)}</b><small>${e(T('Sillas', 'Seats'))}: ${e(bd.legs.map(l => l.seats[i]).join(' / '))}</small></div></div>`).join('')}</div>
      <a class="btn" href="${PUBLIC_URL}/#mi-reserva">${e(T('Consultar mi reserva y hacer check-in', 'Manage my booking and check in'))}</a><p class="fine" style="text-align:center;margin-top:14px"><a href="${PUBLIC_URL}/ayuda/#documentos">${e(T('Documentos de viaje', 'Travel documents'))}</a></p>`);
  if (S.status === 'in_progress')
    return shell(T('Procesando el pago', 'Processing payment'), `<h1>${e(T('Estamos procesando tu pago', 'We are processing your payment'))}</h1><p class="lead">${e(T('Esta página se actualiza sola. No cierres la ventana.', 'This page refreshes on its own. Please keep it open.'))}</p>${trip}`, 5);
  if (b && b.status === 'pending') {   // reserva creada, falta el pago
    const until = new Date(b.expires).toLocaleString(lang === 'en' ? 'en-US' : 'es-CO', { timeZone: 'America/New_York', day: 'numeric', month: 'long', hour: 'numeric', minute: '2-digit' }), paid = url.searchParams.get('pago') === 'ok';
    return shell(T('Pago pendiente', 'Payment pending'), `<h1>${e(paid ? T('Estamos confirmando tu pago', 'We are confirming your payment') : T('Tu reserva está apartada', 'Your booking is on hold'))}</h1>
      <p class="lead">${e(paid ? T('Esta página se actualiza sola en unos segundos.', 'This page refreshes on its own in a few seconds.') : T(`Tus sillas están apartadas hasta el ${until} (hora de Miami).`, `Your seats are held until ${until} (Miami time).`))}</p>
      <div class="ok"><div class="fine">${e(T('Código de reserva', 'Booking code'))}</div><div class="pnr">${e(b.pnr)}</div></div>${trip}
      ${paid ? '' : b.stripe_url ? `<a class="btn" href="${e(b.stripe_url)}">${e(T(`Pagar ${ucpMoney(total)}`, `Pay ${ucpMoney(total)}`))}</a><p class="fine" style="text-align:center;margin-top:12px">${e(T('Pago seguro con tarjeta.', 'Secure card payment.'))}</p>`
        : `<p>${e(T(`Te escribiremos al correo ${bd.contact.email} para completar el pago. También puedes escribirnos a ${SUPPORT_EMAIL} con tu código de reserva.`, `We will email ${bd.contact.email} to complete the payment. You can also write to ${SUPPORT_EMAIL} with your booking code.`))}</p>`}`, paid ? 4 : 0);
  }
  const blocked = st.messages.filter(m => m.type === 'error' && m.severity === 'recoverable');
  if (blocked.length) return shell(T('Compra no disponible', 'Checkout unavailable'), `<h1>${e(T('No podemos continuar con esta compra', 'We cannot continue with this checkout'))}</h1>${blocked.map(m => `<div class="err">${e(m.content)}</div>`).join('')}${trip}${home}`);
  const n = d.items[0].qty, pre = i => d.passengers?.[i] || (i === 0 && d.buyer?.first_name ? d.buyer : {}), light = d.items.some(it => it.fare === 'light');
  return shell(T('Termina tu compra', 'Finish your purchase'), `<h1>${e(T('Termina tu compra', 'Finish your purchase'))}</h1><p class="lead">${e(T('Confirma quién viaja y pasa al pago. Toma un minuto.', 'Confirm who is traveling and continue to payment. It takes a minute.'))}</p>${trip}
    <form id="f" class="card" novalidate><h2>${e(T('Pasajeros', 'Passengers'))}</h2><p class="fine" style="margin:-6px 0 14px">${e(T('Nombre y apellido tal como aparecen en el pasaporte.', 'First and last name exactly as printed on the passport.'))}</p>
    ${Array.from({ length: n }, (_, i) => `<div class="pax">${e(T('Pasajero', 'Passenger'))} ${i + 1}</div><div class="row"><div><label for="fn${i}">${e(T('Nombre', 'First name'))}</label><input id="fn${i}" name="first_name" maxlength="40" autocomplete="${i ? 'off' : 'given-name'}" required value="${e(pre(i).first_name || '')}"></div>
      <div><label for="ln${i}">${e(T('Apellido', 'Last name'))}</label><input id="ln${i}" name="last_name" maxlength="40" autocomplete="${i ? 'off' : 'family-name'}" required value="${e(pre(i).last_name || '')}"></div></div>`).join('')}
    <h2 style="margin-top:22px">${e(T('Contacto', 'Contact'))}</h2><div class="row"><div><label for="em">${e(T('Correo electrónico', 'Email'))}</label><input id="em" type="email" name="email" maxlength="120" autocomplete="email" required value="${e(d.buyer?.email || '')}"></div>
      <div><label for="ph">${e(T('Teléfono (opcional)', 'Phone (optional)'))}</label><input id="ph" type="tel" name="phone" maxlength="40" autocomplete="tel" value="${e(d.buyer?.phone_number || '')}"></div></div>
    ${light ? `<p class="fine">${e(T('La tarifa Light no admite cambios ni reembolso de la tarifa.', 'The Light fare allows no changes or fare refunds.'))}</p>` : ''}
    <label class="ck"><input type="checkbox" id="ckT"> <span id="ckTt">${T('Acepto los', 'I accept the')} <a href="${PUBLIC_URL}/terminos/" target="_blank" rel="noopener">${e(T('Términos y condiciones', 'Terms and Conditions'))}</a> ${T('y la', 'and the')} <a href="${PUBLIC_URL}/reembolsos/" target="_blank" rel="noopener">${e(T('Política de reembolsos', 'Refund Policy'))}</a>.</span></label>
    <label class="ck"><input type="checkbox" id="ckP"> <span id="ckPt">${T('Autorizo el tratamiento de mis datos personales según la', 'I authorize the processing of my personal data under the')} <a href="${PUBLIC_URL}/privacidad/" target="_blank" rel="noopener">${e(T('Política de privacidad', 'Privacy Policy'))}</a>.</span></label>
    <div id="err" class="err" hidden role="alert"></div><button id="go" type="submit">${e(T(`Continuar al pago · ${ucpMoney(total)}`, `Continue to payment · ${ucpMoney(total)}`))}</button></form>
<script>(function(){var f=document.getElementById('f'),go=document.getElementById('go'),er=document.getElementById('err'),txt=go.textContent;function fail(m){er.textContent=m;er.hidden=false;go.disabled=false;go.textContent=txt}
f.addEventListener('submit',function(ev){ev.preventDefault();er.hidden=true;var fn=f.querySelectorAll('[name=first_name]'),ln=f.querySelectorAll('[name=last_name]'),px=[];
for(var i=0;i<fn.length;i++){if(!fn[i].value.trim()||!ln[i].value.trim())return fail(${JSON.stringify(T('Escribe el nombre y el apellido de cada pasajero.', 'Enter the first and last name of each passenger.'))});px.push({first_name:fn[i].value.trim(),last_name:ln[i].value.trim()})}
if(!f.email.value.trim())return fail(${JSON.stringify(T('Escribe tu correo electrónico.', 'Enter your email.'))});var ckT=document.getElementById('ckT'),ckP=document.getElementById('ckP');if(!ckT.checked)return fail(${JSON.stringify(T('Para continuar, acepta los Términos y condiciones.', 'To continue, accept the Terms and Conditions.'))});if(!ckP.checked)return fail(${JSON.stringify(T('Para continuar, acepta la Política de privacidad.', 'To continue, accept the Privacy Policy.'))});go.disabled=true;go.textContent=${JSON.stringify(T('Reservando…', 'Booking…'))};
fetch(location.pathname,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({passengers:px,email:f.email.value.trim(),phone:f.phone.value.trim(),consents:{terms:ckT.checked,privacy:ckP.checked,labels:{terms:document.getElementById('ckTt').textContent.trim(),privacy:document.getElementById('ckPt').textContent.trim()},page:location.pathname,lang:document.documentElement.lang}})}).then(function(r){return r.json().then(function(j){return{ok:r.ok,j:j}})})
.then(function(x){if(!x.ok)return fail(x.j.error||${JSON.stringify(T('No pudimos crear la reserva. Intenta de nuevo.', 'We could not create the booking. Please try again.'))});if(x.j.pay_url)location.href=x.j.pay_url;else location.reload()})
.catch(function(){fail(${JSON.stringify(T('No pudimos conectar con Beemo Air. Intenta de nuevo.', 'We could not reach Beemo Air. Please try again.'))})})})})();</script>`);
}
const UCP_PAGE_HEADERS = { 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; script-src 'unsafe-inline'; connect-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'", 'Referrer-Policy': 'no-referrer', 'X-Robots-Tag': 'noindex, nofollow' };
on('GET', '/api/ucp/continue/:id', ({ params, req, url, ip }) => {
  if (!UCP_ON) throw new HttpErr(404, 'No encontrado.'); limit(ip, 'ucp-page', 120, 600e3);
  const S = ucpLoad(params.id); return new Raw(S ? 200 : 404, ucpPage(S, req, url), UCP_PAGE_HEADERS, 'text/html; charset=utf-8');
});
on('POST', '/api/ucp/continue/:id', async ({ params, body, ip, req }) => {
  if (!UCP_ON) throw new HttpErr(404, 'No encontrado.'); limit(ip, 'book', 8, 3600e3);   // el mismo límite de la reserva pública de beemoair.com
  const S = ucpLoad(params.id), gone = 'Esta compra ya no está disponible. Inicia una nueva en beemoair.com.';
  if (!S || S.status !== 'open') throw new HttpErr(409, gone);
  let b = ucpBooking(S);
  if (!b) {
    if (S.expires < Date.now()) throw new HttpErr(409, gone);
    const st = ucpState(S, null), stop = st.messages.find(m => m.type === 'error' && m.severity === 'recoverable'); if (stop) throw new HttpErr(409, stop.content);
    const pax = ucpReadPax(body.passengers), n = S.data.items[0].qty;
    if (pax.length !== n || pax.some(p => !p.first_name || !p.last_name)) bad('Escribe el nombre y el apellido de cada pasajero.');
    const c = consentRead(body);
    const bid = createBooking(ucpBody(S.data, pax, clean(body.email, 120), clean(body.phone, 40)), { channel: 'ucp' }); stampOrigin(bid, ip, req);
    { const b0 = q1('SELECT pnr, data FROM bookings WHERE id=?', bid), d0 = JSON.parse(b0.data); consentLog(c, { form: 'ucp_web', subject: d0.contact?.email, name: paxNames(d0), ref: b0.pnr, by: S.platform || null, ip, req }) }
    S.booking_id = bid; S.data.passengers = pax; S.data.buyer = { ...S.data.buyer, email: clean(body.email, 120), ...(clean(body.phone, 40) ? { phone_number: clean(body.phone, 40) } : {}) }; ucpSave(S);
    await attachPayLink(bid, ucpContinue(S.id));
    b = q1('SELECT * FROM bookings WHERE id=?', bid); log('ucp', `reserva ${b.pnr} creada en la web para la compra ${S.id}`);
  }
  return { pnr: b.pnr, status: b.status, pay_url: b.status === 'pending' ? b.stripe_url || null : null, expires: b.expires ? new Date(b.expires).toISOString() : null };
});

/* ---------- administración y tareas periódicas ---------- */
on('GET', '/api/admin/ucp', ({ req }) => { need(req, 'admin'); const hs = ucpHandlers();
  return { enabled: UCP_ON, profile_url: UCP_PROFILE, endpoint: UCP_BASE, version: UCP_V, versions: UCP_VS, signing_kid: UCP_ON ? ucpKey().kid : null, payment_handlers: Object.keys(hs), native_payment: Object.keys(hs).length > 0,
    google_pay: { ready: !!hs['com.google.pay'], stripe_secret: !!STRIPE_KEY, stripe_publishable: !!STRIPE_PK, merchant_id: !!GPAY_ID, environment: GPAY_ENV }, stripe_payments: { ready: !!hs['com.stripe.payments'], profile: !!STRIPE_PROFILE },
    buyer_is_passenger: UCP_BUYER_IS_PAX, require_auth: UCP_REQUIRE_AUTH, api_keys: UCP_KEYS.map(k => k.name), mail: mailReady(),
    sessions: q('SELECT status, COUNT(*) n FROM ucp_sessions GROUP BY status'), events: q('SELECT status, COUNT(*) n FROM ucp_events GROUP BY status'),
    orders: q("SELECT s.order_id, s.platform, s.updated, b.pnr, b.total, b.status FROM ucp_sessions s JOIN bookings b ON b.id=s.booking_id WHERE s.status='completed' ORDER BY s.updated DESC LIMIT 100"),
    platforms: q('SELECT platform, COUNT(*) sessions, SUM(status=\'completed\') orders FROM ucp_sessions GROUP BY platform ORDER BY sessions DESC LIMIT 50') };
});
// reintenta ya los eventos de pedido pendientes y corre las tareas periódicas (botón de «reintentar» del panel)
on('POST', '/api/admin/ucp/retry', async ({ req }) => { const a = need(req, 'admin'); if (!UCP_ON) bad('UCP está apagado.');
  run("UPDATE ucp_events SET next_at=? WHERE status='pending'", Date.now()); ucpSweep(); ucpFlown(); await ucpFlush(); log(a.user.email, 'ucp: reintento de eventos');
  return { events: q('SELECT status, COUNT(*) n FROM ucp_events GROUP BY status'), sessions: q('SELECT status, COUNT(*) n FROM ucp_sessions GROUP BY status') };
});
function ucpSweep() {
  for (const r of q("SELECT id FROM ucp_sessions WHERE status='open' AND booking_id IS NULL AND expires<?", Date.now())) { const S = ucpLoad(r.id); if (S) ucpClose(S, 'expired') }
  run('DELETE FROM ucp_idem WHERE created<?', Date.now() - 48 * 3600e3);
  run("DELETE FROM ucp_sessions WHERE status='canceled' AND updated<?", new Date(Date.now() - 30 * 86400e3).toISOString());
  run("DELETE FROM ucp_events WHERE status='sent' AND created<?", new Date(Date.now() - 90 * 86400e3).toISOString());
}
if (UCP_INSECURE) console.warn('ucp: UCP_ALLOW_INSECURE_PROFILES=1 permite perfiles por http y hacia redes privadas. SOLO PARA PRUEBAS LOCALES: no usar en producción.');
if (UCP_ON) {
  setInterval(() => { try { ucpSweep(); ucpFlown() } catch (e) { console.error('ucp sweep', e.message) } ucpFlush().catch(e => console.error('ucp events', e.message));
    for (const r of q("SELECT id FROM ucp_sessions WHERE status='in_progress' AND updated<?", new Date(Date.now() - 20e3).toISOString())) { const S = ucpLoad(r.id); if (S) ucpReconcile(S).catch(e => console.error('ucp reconcile', e.message)) } }, 60e3).unref();
}

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json', '.ico': 'image/x-icon', '.webp': 'image/webp', '.jpg': 'image/jpeg' };
const SEC = { 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'strict-origin-when-cross-origin', 'X-Frame-Options': 'DENY' };
function sendStatic(res, root, p) {
  let f = path.normalize(path.join(root, decodeURIComponent(p)));
  if (!f.startsWith(root)) { res.writeHead(403); return res.end() }
  try { if (fs.statSync(f).isDirectory()) f = path.join(f, 'index.html') } catch { f = path.join(root, 'index.html') }
  if (!fs.existsSync(f)) f = path.join(root, 'index.html');
  const gz = /\.(js|css|html|svg|json)$/.test(f) && /\bgzip\b/.test(String(res.req?.headers['accept-encoding'] || ''));
  res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream', 'Cache-Control': f.endsWith('.html') ? 'no-cache' : 'public, max-age=300', ...(gz ? { 'Content-Encoding': 'gzip', Vary: 'Accept-Encoding' } : {}), ...SEC });
  const rs = fs.createReadStream(f); gz ? rs.pipe(zlib.createGzip()).pipe(res) : rs.pipe(res);
}
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x'); const ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',').pop().trim();
  { const wk = /^\/\.well-known\/ucp(\/[\w-]+)?\/?$/.exec(url.pathname); if (wk) url.pathname = '/api/ucp/profile' + (wk[1] || '') }   // perfil UCP público
  if (!url.pathname.startsWith('/api/')) {
    const host = String(req.headers.host || '');
    if (DEV_STATIC && !host.startsWith('agencias')) return sendStatic(res, DEV_STATIC, url.pathname);
    if (url.pathname === '/robots.txt') { res.writeHead(200, { 'Content-Type': 'text/plain' }); return res.end('User-agent: *\nDisallow: /\n') }
    return sendStatic(res, PORTAL_DIR, url.pathname);
  }
  const r = routes.find(x => x.m === req.method && x.re.test(url.pathname));
  const send = (st, obj) => { res.writeHead(st, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...SEC }); res.end(JSON.stringify(obj)) };
  if (url.pathname === '/api/admin/docs' && req.method === 'POST') { try { return await uploadDoc(req, res, url, send) } catch (e) { return e instanceof HttpErr ? send(e.status, { error: e.message }) : (console.error(e), send(500, { error: 'No pudimos guardar el archivo.' })) } }
  { const m = url.pathname.match(/^\/api\/admin\/docs\/(\d+)\/file$/); if (m && req.method === 'GET') { try { return downloadDoc(req, res, m[1]) } catch (e) { return e instanceof HttpErr ? send(e.status, { error: e.message }) : send(500, { error: 'No pudimos leer el archivo.' }) } } }
  if (!r) return send(404, { error: 'No encontrado.' });
  let raw = '', rawBuf = Buffer.alloc(0);
  try {
    if (req.method !== 'GET') { const chunks = []; let size = 0; for await (const c of req) { chunks.push(c); size += c.length; if (size > 200e3) throw new HttpErr(413, 'Solicitud demasiado grande.') } rawBuf = Buffer.concat(chunks); raw = rawBuf.toString('utf8') }
    const body = raw && !url.pathname.endsWith('/stripe/webhook') ? JSON.parse(raw) : {};
    const out = await r.fn({ req, url, params: url.pathname.match(r.re).groups || {}, body, raw, rawBuf, ip });
    if (out instanceof Raw) { res.writeHead(out.status, { 'Content-Type': out.type, 'Cache-Control': 'no-store', ...SEC, ...out.headers }); return res.end(out.body) }
    send(200, out);
  } catch (e) {
    if (e instanceof HttpErr) return send(e.status, { error: e.message, ...(e.extra || {}) });
    if (e instanceof SyntaxError) return send(400, url.pathname.startsWith('/api/ucp/v1/') ? { code: 'invalid_request', content: 'Malformed JSON body.' } : { error: 'Solicitud no válida.' });
    console.error(e); send(500, { error: 'Algo falló de nuestro lado. Intenta de nuevo.' });
  }
});
sweep();
server.listen(PORT, () => console.log(`beemo api on :${PORT} · db ${DB_PATH} · stripe ${STRIPE_KEY ? 'on' : 'off'}`));
