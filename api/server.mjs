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

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PORT = +(process.env.PORT || 8080);
const DB_PATH = process.env.DB_PATH || '/data/beemo.db';
const PUBLIC_URL = (process.env.PUBLIC_URL || 'https://beemoair.com').replace(/\/$/, '');
const AGENCY_URL = (process.env.AGENCY_URL || 'https://agencias.beemoair.com').replace(/\/$/, '');
const STRIPE_KEY = process.env.STRIPE_SECRET_KEY || '';
const STRIPE_WH = process.env.STRIPE_WEBHOOK_SECRET || '';
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
const SEASONS = [
  { from: '2026-12-01', to: '2027-01-31', name: 'Temporada alta', p: { classic: 395, flex: 729.86, bc: 937.36 } },
  { from: '2027-02-01', to: '2027-06-15', name: 'Temporada regular', p: { classic: 395, flex: 654.86, bc: 709.86 } },
];
const FARE_NAME = { classic: 'Classic', flex: 'Flex', bc: 'Flex BC' };
const TAX_LEG = (198 + 241) / 2;
const ROWS = 26, BIZ = 3, COLS = ['A', 'B', 'C', 'D', 'E', 'F'], EXIT = [13, 14];
const isSeat = (r, c) => r >= 1 && r <= ROWS && COLS.includes(c) && !(r <= BIZ && (c === 'B' || c === 'E'));
const zoneOf = r => r <= BIZ ? 0 : r <= 6 ? 1 : EXIT.includes(r) ? 2 : r <= 12 ? 3 : r <= 22 ? 4 : 5;
const ZONE_P = { 1: 25, 2: 30, 3: 15, 4: 8, 5: 0 };
const EXTRA_P = { bag: 35, bag2: 55, prio: 8 };
const INF_P = 40;
const PASS_KIND = { 4: { n: 4, price: 1399 }, 6: { n: 6, price: 1999 } };
const PASS_ROUTES = ['MIA-AXM', 'AXM-MIA'];
// post-booking ladder: [hasta 7 días antes, hasta 24 h antes, aeropuerto]
const LADDER = { bag: [45, 55, 65], bag2: [65, 75, 90], front: [25, 30, 40], prio: [10, 12, 15], flex: [70, 80, null], biz: [200, 175, 150] };
const HOLD_WEB_H = 24, HOLD_CARD_MIN = 45;

const seasonOf = d => SEASONS.find(s => d >= s.from && d <= s.to) || SEASONS[SEASONS.length - 1];
const priceOf = (d, f) => seasonOf(d).p[f];
const r2 = n => Math.round(n * 100) / 100;
const iso = d => d.toISOString().slice(0, 10);
const todayISO = () => new Date(Date.now() - 5 * 3600e3).toISOString().slice(0, 10); // Miami time, close enough
function operates(route, date) {
  const s = SCHED[route]; if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  if (date < todayISO()) return false;
  if (s.dates) return s.dates.includes(date);
  if (date < SALES_FROM || date > SALES_TO) return false;
  return s.days.includes(new Date(date + 'T12:00:00Z').getUTCDay());
}
function opDates(route, from, n) {
  const s = SCHED[route]; if (!s) return [];
  if (s.dates) return s.dates.filter(d => d >= from && d >= todayISO()).slice(0, n);
  const out = []; let d = new Date((from < SALES_FROM ? SALES_FROM : from) + 'T12:00:00Z');
  for (let i = 0; i < 200 && out.length < n; i++) { const x = iso(d); if (x > SALES_TO) break; if (operates(route, x)) out.push(x); d.setUTCDate(d.getUTCDate() + 1); }
  return out;
}
const depTime = (route, date) => new Date(`${date}T${SCHED[route].dep}:00-05:00`).getTime();
function seatPrice(fare, id) {
  const z = zoneOf(parseInt(id)); if (!z || fare === 'bc') return 0;
  const p = ZONE_P[z]; if (fare === 'flex') return z >= 3 ? 0 : p - ZONE_P[3]; return p;
}
const cabinOk = (fare, r) => fare === 'bc' ? r <= BIZ : r > BIZ;
const ALL_SEATS = []; for (let r = 1; r <= ROWS; r++) for (const c of COLS) if (isSeat(r, c)) ALL_SEATS.push(r + c);

/* ============ database ============ */
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
const db = new DatabaseSync(DB_PATH);
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
for (const [col, type] of [['country', "TEXT NOT NULL DEFAULT ''"], ['city', 'TEXT'], ['tax_id', 'TEXT'], ['address', 'TEXT'], ['contact', 'TEXT'], ['email', 'TEXT'], ['phone', 'TEXT']]) {
  try { db.exec(`ALTER TABLE agencies ADD COLUMN ${col} ${type}`) } catch (e) { /* already there */ }
}
db.exec(`CREATE TABLE IF NOT EXISTS pass_products(id INTEGER PRIMARY KEY, name TEXT NOT NULL, name_en TEXT, description TEXT, description_en TEXT, badge TEXT, badge_en TEXT,
  segments INTEGER, price REAL, routes TEXT NOT NULL DEFAULT '[]', valid_months INTEGER NOT NULL DEFAULT 12, status TEXT NOT NULL DEFAULT 'inactive', sort INTEGER NOT NULL DEFAULT 100, created TEXT NOT NULL, updated TEXT NOT NULL)`);
for (const [col, type] of [['product_id', 'INTEGER'], ['routes', 'TEXT'], ['product_name', 'TEXT']]) { try { db.exec(`ALTER TABLE passes ADD COLUMN ${col} ${type}`) } catch (e) {} }
const q = (sql, ...a) => db.prepare(sql).all(...a);
const q1 = (sql, ...a) => db.prepare(sql).get(...a);
const run = (sql, ...a) => db.prepare(sql).run(...a);
const now = () => new Date().toISOString();
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
const okEmail = v => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(v || ''));
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
  const order = fare === 'bc' ? [0] : fare === 'flex' ? [4, 3, 5, 1, 2] : [5, 4, 3, 1, 2];
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
function quote(body, channel) {
  const legsIn = Array.isArray(body.legs) ? body.legs.slice(0, 2) : [];
  const paxIn = Array.isArray(body.pax) ? body.pax.slice(0, 9) : [];
  if (!legsIn.length) bad('Elige al menos un vuelo.');
  if (!paxIn.length) bad('Agrega al menos un pasajero.');
  const pax = paxIn.map((p, i) => {
    const first = clean(p.first, 40), last = clean(p.last, 40);
    if (!first || !last) bad(`Falta el nombre o el apellido del pasajero ${i + 1}.`);
    return { first, last, inf: !!p.inf };
  });
  const contact = { email: clean(body.contact?.email, 120), phone: clean(body.contact?.phone, 40) };
  if (!okEmail(contact.email)) bad('Revisa el correo electrónico de contacto.');
  const legs = legsIn.map((l, li) => {
    const route = String(l.route || ''), date = String(l.date || ''), fare = String(l.fare || '');
    if (!SCHED[route]) bad('Ruta no válida.');
    if (!operates(route, date)) bad(`No hay vuelo ${route} el ${date}.`);
    if (!FARE_NAME[fare]) bad('Tarifa no válida.');
    if (li === 1 && date <= legsIn[0].date) bad('El regreso debe ser después de la ida.');
    const seats = pax.map((_, i) => { const s = l.seats?.[i]; if (s == null || s === '') return null; const id = String(s).toUpperCase(); const r = parseInt(id), c = id.slice(-1);
      if (!isSeat(r, c) || String(r) + c !== id) bad(`Asiento ${id} no válido.`); if (!cabinOk(fare, r)) bad(`El asiento ${id} no corresponde a la tarifa ${FARE_NAME[fare]}.`); return id });
    if (new Set(seats.filter(Boolean)).size !== seats.filter(Boolean).length) bad('Dos pasajeros no pueden tener el mismo asiento.');
    const extras = pax.map((_, i) => { const e = l.extras?.[i] || {}; const x = {};
      for (const k of ['bag', 'bag2', 'prio']) if (e[k]) x[k] = true;
      if (fare === 'bc') return {};
      if (fare === 'flex') delete x.bag;
      if (fare === 'classic' && x.bag2 && !x.bag) delete x.bag2;
      return x });
    return { route, date, fare, seats, extras, no: SCHED[route].no, dep: SCHED[route].dep, arr: SCHED[route].arr };
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
      l.seats = l.seats.map(s => { if (s) return s; const p = pickSeat(l.fare, taken); if (!p) throw new HttpErr(409, `No quedan sillas ${l.fare === 'bc' ? 'en Business' : 'en económica'} en el vuelo ${l.no} del ${l.date}.`, { code: 'sold_out', leg: li }); taken.add(p); return p });
      l.seats.forEach((s, i) => claims.push([flight, s, i]));
    }
    // recompute seat price after auto-assign (auto seats are free zones)
    const pnr = newPnr(), ts = now();
    let status, expires = null, payMethod = ctx.pay || 'card';
    if (Q.total <= 0) status = 'confirmed';
    else if (ctx.channel === 'agency' && payMethod === 'cash') status = 'confirmed';
    else { status = 'pending'; expires = Date.now() + (STRIPE_KEY ? HOLD_CARD_MIN * 60e3 : HOLD_WEB_H * 3600e3) }
    // a pending hold never outlives the flight's check-in close
    if (expires) { const first = Math.min(...Q.legs.map(l => depTime(l.route, l.date))); expires = Math.min(expires, first - 3 * 3600e3); if (expires <= Date.now()) throw new HttpErr(409, 'Este vuelo ya no admite reservas pendientes de pago.') }
    const ag = ctx.agency; const rate = ag ? (ag.commission + ag.incentive) / 100 : 0;
    const commission = r2(Q.net * rate);
    const data = { pax: Q.pax, contact: Q.contact, legs: Q.legs.map(l => ({ route: l.route, date: l.date, fare: l.fare, no: l.no, dep: l.dep, arr: l.arr, seats: l.seats, extras: l.extras })), breakdown: Q.breakdown, rate: rate * 100 };
    const res = run(`INSERT INTO bookings(pnr,channel,agency_id,user_id,status,pay_method,total,paid,fare_net,commission,pass_code,pass_n,data,expires,created,updated) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      pnr, ctx.channel, ag?.id ?? null, ctx.user?.id ?? null, status, payMethod, Q.total, status === 'confirmed' && payMethod !== 'cash' ? Q.total : 0, Q.net, commission, Q.pass?.code ?? null, Q.passN, JSON.stringify(data), expires, ts, ts);
    const bid = Number(res.lastInsertRowid);
    const ins = db.prepare('INSERT INTO seat_inv(flight,seat,booking_id,pax) VALUES(?,?,?,?)');
    for (const [f, s, i] of claims) { try { ins.run(f, s, bid, i) } catch (e) { throw new HttpErr(409, `El asiento ${s} acaba de venderse. Elige otro.`, { code: 'seat_taken', seats: [s] }) } }
    if (Q.pass) run('UPDATE passes SET left_n=left_n-? WHERE code=?', Q.passN, Q.pass.code);
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
}
function confirmPaid(b, who) {
  tx(() => {
    run("UPDATE bookings SET status='confirmed', paid=total, expires=NULL, updated=? WHERE id=?", now(), b.id);
    run("UPDATE addons SET status='paid' WHERE booking_id=? AND status='pending'", b.id);
  });
  log(who, `booking ${b.pnr} paid`);
}
// expire unpaid holds
function sweep() {
  for (const b of q("SELECT * FROM bookings WHERE status='pending' AND expires IS NOT NULL AND expires<?", Date.now())) releaseBooking(b, 'expired', 'system');
  for (const p of q("SELECT * FROM passes WHERE status='pending' AND created<?", new Date(Date.now() - 7 * 86400e3).toISOString())) run("UPDATE passes SET status='expired' WHERE code=?", p.code);
}
setInterval(sweep, 60e3).unref();

function bookingView(b, opts = {}) {
  const d = JSON.parse(b.data);
  const adds = q('SELECT id,leg,key,qty,unit,status FROM addons WHERE booking_id=? ORDER BY id', b.id);
  const addDue = adds.filter(a => a.status === 'pending').reduce((s, a) => s + a.qty * a.unit, 0);
  const v = { pnr: b.pnr, status: b.status, channel: b.channel, pay_method: b.pay_method, total: b.total, paid: b.paid, due: r2((b.status === 'pending' ? b.total : 0) + addDue),
    expires: b.expires ? new Date(b.expires).toISOString() : null, pay_url: b.status === 'pending' ? b.stripe_url : null, created: b.created,
    pax: d.pax, legs: d.legs, breakdown: d.breakdown, pass_code: b.pass_code, pass_n: b.pass_n, addons: adds };
  if (opts.private) Object.assign(v, { contact: d.contact, commission: b.commission, rate: d.rate, fare_net: b.fare_net, settled: !!b.settled, agency_id: b.agency_id });
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
  const r = await fetch('https://api.stripe.com/v1/checkout/sessions', { method: 'POST', headers: { Authorization: 'Bearer ' + STRIPE_KEY, 'Content-Type': 'application/x-www-form-urlencoded' }, body: f });
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
  const b = q1('SELECT * FROM bookings WHERE id=?', bid); if (b.status !== 'pending' || !STRIPE_KEY) return;
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
  const u = q1('SELECT * FROM users WHERE id=? AND active=1', s.user_id); if (!u) return null;
  const ag = u.agency_id ? q1('SELECT * FROM agencies WHERE id=?', u.agency_id) : null;
  if (u.role === 'agent' && (!ag || !ag.active)) return null;
  return { user: u, agency: ag };
}
function need(req, role) {
  const a = authUser(req); if (!a) throw new HttpErr(401, 'Inicia sesión.');
  if (role === 'admin' && a.user.role !== 'admin') throw new HttpErr(403, 'Solo para administradores.');
  if (role === 'agent' && a.user.role !== 'agent') throw new HttpErr(403, 'Solo para agencias.');
  return a;
}
const userView = (u, ag) => ({ id: u.id, email: u.email, name: u.name, role: u.role, must_change: !!u.must_change, agency: ag ? { id: ag.id, name: ag.name, country: ag.country, commission: ag.commission, incentive: ag.incentive } : null });
const tempPassword = () => rnd(4) + '-' + rnd(4) + '-' + rnd(4);

/* ============ routes ============ */
const routes = [];
const on = (m, p, fn) => routes.push({ m, re: new RegExp('^' + p.replace(/:(\w+)/g, '(?<$1>[^/]+)') + '$'), fn });

on('GET', '/api/health', () => ({ ok: true, time: now(), stripe: !!STRIPE_KEY }));
on('GET', '/api/routes', () => Object.entries(SCHED).map(([k, v]) => ({ route: k, no: v.no, seasonal: !!v.dates })));
on('GET', '/api/config', () => ({ stripe: !!STRIPE_KEY, hold_hours: STRIPE_KEY ? HOLD_CARD_MIN / 60 : HOLD_WEB_H }));

on('GET', '/api/flights', ({ url }) => {
  const route = url.searchParams.get('route'), from = url.searchParams.get('from') || todayISO(), n = Math.min(+url.searchParams.get('n') || 8, 40);
  if (!SCHED[route]) bad('Ruta no válida.');
  return opDates(route, from, n).map(date => ({ date, route, ...SCHED[route], days: undefined, dates: undefined, season: seasonOf(date).name, prices: seasonOf(date).p, avail: availability(route, date) }));
});
on('GET', '/api/seats', ({ url }) => {
  const route = url.searchParams.get('route'), date = url.searchParams.get('date');
  if (!SCHED[route]) bad('Ruta no válida.');
  return { taken: takenSeats(route + '|' + date), avail: availability(route, date) };
});
on('POST', '/api/quote', ({ body }) => { const Q = quote(body, 'web'); return Q.breakdown });

// public booking from beemoair.com
on('POST', '/api/bookings', async ({ body, ip }) => {
  limit(ip, 'book', 8, 3600e3);
  const bid = createBooking(body, { channel: 'web' });
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
  const unit = LADDER[key][w]; if (unit == null) bad('Este extra ya no está disponible.');
  if (q1("SELECT 1 FROM addons WHERE booking_id=? AND leg=? AND key=? AND status!='cancelled'", b.id, li, key)) bad('Ya agregaste este extra.');
  if (key === 'biz') { const av = availability(l.route, l.date); if (av.biz < d.pax.length) bad('No quedan sillas libres en Business para este vuelo.') }
  run('INSERT INTO addons(booking_id,leg,key,qty,unit,status,created) VALUES(?,?,?,?,?,?,?)', b.id, li, key, d.pax.length, unit, 'pending', now());
  log('web', `addon ${b.pnr} ${key}`);
  return bookingView(q1('SELECT * FROM bookings WHERE id=?', b.id));
});

// season pass
on('POST', '/api/passes', async ({ body, ip }) => {
  limit(ip, 'pass', 5, 3600e3);
  let pr = body.product_id ? q1("SELECT * FROM pass_products WHERE id=? AND status='active'", +body.product_id) : q1("SELECT * FROM pass_products WHERE segments=? AND status='active' ORDER BY sort LIMIT 1", +body.kind || 0);
  if (!pr) bad('Este pase ya no está a la venta.');
  const name = clean(body.name, 80), email = clean(body.email, 120);
  if (!name) bad('Escribe tu nombre.'); if (!okEmail(email)) bad('Revisa tu correo electrónico.');
  let code; for (let i = 0; i < 20; i++) { code = 'PT-' + rnd(4) + '-' + rnd(4); if (!q1('SELECT 1 FROM passes WHERE code=?', code)) break }
  const exp = new Date(); exp.setMonth(exp.getMonth() + pr.valid_months);
  run('INSERT INTO passes(code,kind,total,left_n,price,name,email,status,exp,created,product_id,routes,product_name) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)', code, pr.segments, pr.segments, pr.segments, pr.price, name, email, 'pending', iso(exp), now(), pr.id, pr.routes, pr.name);
  const url = await stripeCheckout({ ref: 'P:' + code, amount: pr.price, name: `Beemo Air · Pase de temporada ${pr.name}`, email, successUrl: `${PUBLIC_URL}/pase-de-temporada/?pago=ok&pase=${code}`, cancelUrl: `${PUBLIC_URL}/pase-de-temporada/?pago=cancelado&pase=${code}`, minutes: 60 });
  if (url) run('UPDATE passes SET stripe_url=? WHERE code=?', url, code);
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
    if (ref.startsWith('B:')) { const b = q1('SELECT * FROM bookings WHERE pnr=?', ref.slice(2)); if (b && b.status === 'pending') confirmPaid(b, 'stripe'); else if (b && b.status === 'expired') log('stripe', `PAID AFTER EXPIRY ${b.pnr}: revisar y reembolsar o reubicar`) }
    if (ref.startsWith('P:')) { run("UPDATE passes SET status='paid' WHERE code=? AND status='pending'", ref.slice(2)); log('stripe', `pass ${ref.slice(2)} paid`) }
  }
  return { received: true };
});

// auth
on('POST', '/api/auth/login', ({ body, ip }) => {
  limit(ip, 'login', 10, 900e3);
  const u = q1('SELECT * FROM users WHERE email=? AND active=1', norm(body.email));
  if (!u || !checkPw(String(body.password || ''), u.pass)) throw new HttpErr(401, 'El correo o la contraseña no coinciden.');
  const ag = u.agency_id ? q1('SELECT * FROM agencies WHERE id=?', u.agency_id) : null;
  if (u.role === 'agent' && (!ag || !ag.active)) throw new HttpErr(403, 'Tu agencia no está activa. Escríbenos a management@beemoair.com.');
  const t = crypto.randomBytes(32).toString('hex');
  run('INSERT INTO sessions(token,user_id,expires) VALUES(?,?,?)', sha(t), u.id, Date.now() + 12 * 3600e3);
  run('DELETE FROM sessions WHERE expires<?', Date.now());
  log(u.email, 'login');
  return { token: t, user: userView(u, ag) };
});
on('POST', '/api/auth/logout', ({ req }) => { const h = req.headers.authorization || ''; if (h.startsWith('Bearer ')) run('DELETE FROM sessions WHERE token=?', sha(h.slice(7))); return { ok: true } });
on('GET', '/api/me', ({ req }) => { const a = need(req); return userView(a.user, a.agency) });
on('POST', '/api/me/password', ({ req, body }) => {
  const a = need(req); const pw = String(body.password || '');
  if (pw.length < 10) bad('La contraseña debe tener al menos 10 caracteres.');
  if (!a.user.must_change && !checkPw(String(body.current || ''), a.user.pass)) bad('La contraseña actual no coincide.');
  run('UPDATE users SET pass=?, must_change=0 WHERE id=?', hashPw(pw), a.user.id); log(a.user.email, 'password changed'); return { ok: true };
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
function routeFlights(url) { const route = url.searchParams.get('route'), from = url.searchParams.get('from') || todayISO(); if (!SCHED[route]) bad('Ruta no válida.'); return opDates(route, from, Math.min(+url.searchParams.get('n') || 10, 40)).map(date => ({ date, route, no: SCHED[route].no, dep: SCHED[route].dep, arr: SCHED[route].arr, season: seasonOf(date).name, prices: seasonOf(date).p, avail: availability(route, date) })) }
on('POST', '/api/agency/quote', ({ req, body }) => { const a = need(req, 'agent'); const Q = quote(body, 'agency'); return { ...Q.breakdown, commission: r2(Q.net * (a.agency.commission + a.agency.incentive) / 100), rate: a.agency.commission + a.agency.incentive } });
on('POST', '/api/agency/bookings', async ({ req, body }) => {
  const a = need(req, 'agent'); const pay = body.pay === 'cash' ? 'cash' : 'card';
  const bid = createBooking(body, { channel: 'agency', agency: a.agency, user: a.user, pay });
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
on('GET', '/api/agency/statement', ({ req }) => { const a = need(req, 'agent'); return statement(a.agency.id) });
function statement(agencyId) {
  const rows = q("SELECT * FROM bookings WHERE agency_id=? AND status='confirmed'", agencyId);
  const sum = f => r2(rows.reduce((s, b) => s + f(b), 0));
  return { bookings: rows.length, sales: sum(b => b.total), net: sum(b => b.fare_net), commission: sum(b => b.commission),
    cash_due: sum(b => b.pay_method === 'cash' && !b.settled ? b.total : 0), cash_settled: sum(b => b.pay_method === 'cash' && b.settled ? b.total : 0),
    pending: q("SELECT COUNT(*) n FROM bookings WHERE agency_id=? AND status='pending'", agencyId)[0].n };
}

// admin
on('GET', '/api/admin/overview', ({ req }) => {
  need(req, 'admin');
  const flights = []; for (const route of Object.keys(SCHED)) for (const date of opDates(route, todayISO(), 60)) {
    const av = availability(route, date); const sold = q("SELECT COUNT(*) n FROM seat_inv i JOIN bookings b ON b.id=i.booking_id WHERE i.flight=? AND b.status='confirmed'", route + '|' + date)[0].n;
    const held = q("SELECT COUNT(*) n FROM seat_inv i JOIN bookings b ON b.id=i.booking_id WHERE i.flight=? AND b.status='pending'", route + '|' + date)[0].n;
    flights.push({ route, date, no: SCHED[route].no, sold, held, free: av.eco + av.biz, biz_free: av.biz }) }
  flights.sort((x, y) => x.date.localeCompare(y.date) || x.route.localeCompare(y.route));
  const tot = q("SELECT status, COUNT(*) n, SUM(total) t FROM bookings GROUP BY status");
  return { flights, totals: tot, stripe: !!STRIPE_KEY };
});
/* ============ dashboard: live business vs the year-1 financial plan (escenario medio) ============ */
const PLAN = { revenue: 8161808, ebitda: 3261672, margin: 0.40, ops: 56, pax: 15100, load: 0.80, load_min: 0.70, breakeven_load: 0.35, breakeven_tickets_only: 0.68,
  rev_per_op: 146496, charter_per_op: 80400, nontariff_share: 0.29, cash_need: 645784, avg_fare: 395,
  monthly: { '2026-12': 439488, '2027-01': 585984, '2027-02': 727234, '2027-03': 727234, '2027-04': 727234, '2027-05': 585984, '2027-06': 727234, '2027-07': 873730, '2027-08': 727234, '2027-09': 585984, '2027-10': 727234, '2027-11': 727234 } };
const ECO = 138;
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
      const ch = names[b.agency_id] || 'beemoair.com'; channels[ch] = (channels[ch] || 0) + b.total }
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
  for (const date of opDates('MIA-AXM', '2026-12-01', 400)) ops.push({ date, legs: ['MIA-AXM|' + date, 'AXM-MIA|' + date], label: 'MIA ⇄ AXM', cost: PLAN.charter_per_op, dep: depTime('MIA-AXM', date) });
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
    filtered: !!(chF || scope), months, upcoming: upcoming.slice(0, 16), daily: daily.slice(-30).map(d => ({ ...d, revenue: r2(d.revenue) })),
    channel_options: [{ id: 'web', name: 'beemoair.com' }, ...q('SELECT id,name FROM agencies WHERE active=1 ORDER BY name')], mix: Object.fromEntries(Object.entries(mix).map(([k, v]) => [k, r2(v)])),
    channels: Object.entries(channels).map(([name, v]) => ({ name, revenue: r2(v) })).sort((a, b) => b.revenue - a.revenue), milestones };
});

// seasonal flights: occupancy, sales by channel and the 90-seats-at-45-days go/no-go rule
const SEASON_MIN = 90, SEASON_DAYS = 45;
on('GET', '/api/admin/seasons', ({ req }) => {
  need(req, 'admin'); const names = Object.fromEntries(q('SELECT id,name FROM agencies').map(a => [a.id, a.name]));
  const out = [];
  for (const [route, sc] of Object.entries(SCHED)) { if (!sc.dates) continue;
    for (const date of sc.dates) {
      const f = route + '|' + date, rows = q('SELECT i.pax, b.status, b.agency_id, b.data FROM seat_inv i JOIN bookings b ON b.id=i.booking_id WHERE i.flight=?', f);
      let sold = 0, held = 0, revenue = 0, biz = 0; const ch = {};
      for (const r of rows) { const d = JSON.parse(r.data), l = d.legs.find(x => x.route + '|' + x.date === f); const k = names[r.agency_id] || 'beemoair.com';
        ch[k] = ch[k] || { sold: 0, held: 0 }; if (r.status === 'confirmed') { sold++; ch[k].sold++; revenue += priceOf(date, l.fare) } else { held++; ch[k].held++ }
        if (l.fare === 'bc') biz++ }
      const av = availability(route, date), dep = depTime(route, date), deadline = new Date(dep - SEASON_DAYS * 86400e3);
      out.push({ route, date, no: sc.no, dep: sc.dep, arr: sc.arr, sold, held, biz, free: av.eco + av.biz, revenue: r2(revenue), channels: Object.entries(ch).map(([name, v]) => ({ name, ...v })).sort((a, b) => b.sold - a.sold),
        min_seats: SEASON_MIN, deadline: iso(deadline), days_to_deadline: Math.ceil((deadline - Date.now()) / 86400e3), days_to_flight: Math.ceil((dep - Date.now()) / 86400e3) });
    } }
  return out.sort((a, b) => a.date.localeCompare(b.date));
});
on('GET', '/api/admin/manifest', ({ req, url }) => {
  need(req, 'admin'); const f = url.searchParams.get('route') + '|' + url.searchParams.get('date');
  return q('SELECT i.seat, i.pax, b.pnr, b.status, b.channel, b.agency_id, b.data FROM seat_inv i JOIN bookings b ON b.id=i.booking_id WHERE i.flight=? ORDER BY CAST(i.seat AS INTEGER), i.seat', f)
    .map(r => { const d = JSON.parse(r.data); const p = d.pax[r.pax]; const li = d.legs.findIndex(l => l.route + '|' + l.date === f); const ag = r.agency_id ? q1('SELECT name FROM agencies WHERE id=?', r.agency_id)?.name : null;
      return { seat: r.seat, pnr: r.pnr, status: r.status, channel: ag || 'beemoair.com', name: `${p.first} ${p.last}`, inf: p.inf, fare: FARE_NAME[d.legs[li]?.fare], extras: d.legs[li]?.extras?.[r.pax] || {} } });
});
on('GET', '/api/admin/bookings', ({ req, url }) => {
  need(req, 'admin'); const sp = url.searchParams, st = sp.get('status'), flight = sp.get('flight'), ag = sp.get('agency'), term = norm(sp.get('q') || '');
  let rows = st ? q('SELECT * FROM bookings WHERE status=? ORDER BY id DESC LIMIT 5000', st) : q('SELECT * FROM bookings ORDER BY id DESC LIMIT 5000');
  if (ag === 'web') rows = rows.filter(b => !b.agency_id); else if (ag) rows = rows.filter(b => b.agency_id === +ag);
  if (flight || term) rows = rows.filter(b => { const d = JSON.parse(b.data);
    if (flight && !d.legs.some(l => l.route + '|' + l.date === flight)) return false;
    if (term && !(norm(b.pnr).includes(term) || norm(d.contact.email).includes(term) || d.pax.some(p => norm(p.first + ' ' + p.last).includes(term)))) return false;
    return true });
  const names = Object.fromEntries(q('SELECT id,name FROM agencies').map(a => [a.id, a.name]));
  const out = rows.slice(0, 500).map(b => ({ ...bookingView(b, { private: true }), agency: names[b.agency_id] || null }));
  const sum = k => r2(rows.reduce((t, b) => t + (k(b) || 0), 0));
  return { bookings: out, count: rows.length, totals: { pax: rows.reduce((t, b) => t + JSON.parse(b.data).pax.length, 0), confirmed: sum(b => b.status === 'confirmed' ? b.total : 0), pending: sum(b => b.status === 'pending' ? b.total : 0), cash_due: sum(b => b.status === 'confirmed' && b.pay_method === 'cash' && !b.settled ? b.total : 0) } };
});
on('GET', '/api/admin/booking-filters', ({ req }) => {
  need(req, 'admin'); const fl = new Map();
  for (const b of q('SELECT data FROM bookings')) for (const l of JSON.parse(b.data).legs) fl.set(l.route + '|' + l.date, { route: l.route, date: l.date, no: l.no });
  return { flights: [...fl.values()].sort((a, b) => a.date.localeCompare(b.date) || a.route.localeCompare(b.route)), agencies: q('SELECT id,name FROM agencies ORDER BY name') };
});
on('POST', '/api/admin/bookings/:pnr/:action', ({ req, params }) => {
  const a = need(req, 'admin'); const b = q1('SELECT * FROM bookings WHERE pnr=?', params.pnr); if (!b) throw new HttpErr(404, 'Reserva no encontrada.');
  if (params.action === 'paid') { if (!['pending', 'confirmed'].includes(b.status)) bad('Esta reserva ya no está activa.'); confirmPaid(b, a.user.email) }
  else if (params.action === 'cancel') { if (!['pending', 'confirmed'].includes(b.status)) bad('Esta reserva ya no está activa.'); releaseBooking(b, 'cancelled', a.user.email) }
  else if (params.action === 'settle') { if (b.pay_method !== 'cash') bad('Solo aplica a cobros en agencia.'); run('UPDATE bookings SET settled=1, paid=total, updated=? WHERE id=?', now(), b.id); log(a.user.email, `settled ${b.pnr}`) }
  else bad('Acción no válida.');
  return bookingView(q1('SELECT * FROM bookings WHERE id=?', b.id), { private: true });
});
on('GET', '/api/admin/agencies', ({ req }) => {
  need(req, 'admin');
  return q('SELECT * FROM agencies ORDER BY name').map(ag => ({ ...ag, active: !!ag.active, users: q('SELECT id,email,name,active,must_change FROM users WHERE agency_id=?', ag.id), statement: statement(ag.id) }));
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
  const email = norm(body.email); if (!okEmail(email)) bad('Revisa el correo del usuario.');
  if (q1('SELECT 1 FROM users WHERE email=?', email)) bad('Ya existe un usuario con ese correo.');
  const pw = tempPassword();
  run('INSERT INTO users(agency_id,email,name,role,pass,must_change,created) VALUES(?,?,?,?,?,1,?)', ag.id, email, clean(body.name, 80), 'agent', hashPw(pw), now());
  log(a.user.email, `user ${email} for agency ${ag.id}`); return { email, temp_password: pw };
});
on('POST', '/api/admin/users/:id/:action', ({ req, params }) => {
  const a = need(req, 'admin'); const u = q1("SELECT * FROM users WHERE id=? AND role='agent'", +params.id); if (!u) throw new HttpErr(404, 'Usuario no encontrado.');
  if (params.action === 'reset') { const pw = tempPassword(); run('UPDATE users SET pass=?, must_change=1 WHERE id=?', hashPw(pw), u.id); run('DELETE FROM sessions WHERE user_id=?', u.id); log(a.user.email, `reset ${u.email}`); return { email: u.email, temp_password: pw } }
  if (params.action === 'toggle') { run('UPDATE users SET active=1-active WHERE id=?', u.id); run('DELETE FROM sessions WHERE user_id=?', u.id); return { ok: true } }
  bad('Acción no válida.');
});
on('GET', '/api/admin/passes', ({ req }) => { need(req, 'admin'); return q('SELECT * FROM passes ORDER BY created DESC LIMIT 500').map(p => ({ ...passView(p), product: p.product_name || `${p.total} trayectos`, name: p.name, email: p.email, created: p.created })) });
on('POST', '/api/admin/passes/:code/paid', ({ req, params }) => { const a = need(req, 'admin'); run("UPDATE passes SET status='paid' WHERE code=? AND status IN ('pending','expired')", params.code); log(a.user.email, `pass ${params.code} paid`); return { ok: true } });
on('GET', '/api/admin/log', ({ req }) => { need(req, 'admin'); return q('SELECT * FROM log ORDER BY id DESC LIMIT 200') });

/* ============ http server ============ */
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
  if (!url.pathname.startsWith('/api/')) {
    const host = String(req.headers.host || '');
    if (DEV_STATIC && !host.startsWith('agencias')) return sendStatic(res, DEV_STATIC, url.pathname);
    if (url.pathname === '/robots.txt') { res.writeHead(200, { 'Content-Type': 'text/plain' }); return res.end('User-agent: *\nDisallow: /\n') }
    return sendStatic(res, PORTAL_DIR, url.pathname);
  }
  const r = routes.find(x => x.m === req.method && x.re.test(url.pathname));
  const send = (st, obj) => { res.writeHead(st, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...SEC }); res.end(JSON.stringify(obj)) };
  if (!r) return send(404, { error: 'No encontrado.' });
  let raw = '';
  try {
    if (req.method !== 'GET') { for await (const c of req) { raw += c; if (raw.length > 200e3) throw new HttpErr(413, 'Solicitud demasiado grande.') } }
    const body = raw && !url.pathname.endsWith('/stripe/webhook') ? JSON.parse(raw) : {};
    const out = await r.fn({ req, url, params: url.pathname.match(r.re).groups || {}, body, raw, ip });
    send(200, out);
  } catch (e) {
    if (e instanceof HttpErr) return send(e.status, { error: e.message, ...(e.extra || {}) });
    if (e instanceof SyntaxError) return send(400, { error: 'Solicitud no válida.' });
    console.error(e); send(500, { error: 'Algo falló de nuestro lado. Intenta de nuevo.' });
  }
});
sweep();
server.listen(PORT, () => console.log(`beemo api on :${PORT} · db ${DB_PATH} · stripe ${STRIPE_KEY ? 'on' : 'off'}`));
