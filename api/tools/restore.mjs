// Abre una copia de seguridad de Beemo Air y la deja lista para usar como base de datos.
// Sirve para las copias del servidor (beemo-AAAAMMDD-HHMMSS.db.gz) y para las externas cifradas (….db.gz.enc).
// Uso:  node --no-warnings api/tools/restore.mjs <copia> <salida.db>          (las cifradas piden BACKUP_PASSPHRASE)
// Para restaurar en producción: detener el contenedor beemoapi, reemplazar /data/beemo.db por la salida
// (y borrar beemo.db-wal y beemo.db-shm si existen) y volver a iniciar el contenedor.
import fs from 'node:fs';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';

export function openBackup(buf, pass) {
  if (buf.subarray(0, 4).toString() === 'BMO1') {
    if (!pass) throw new Error('Esta copia está cifrada: define BACKUP_PASSPHRASE con la misma clave del servidor.');
    const salt = buf.subarray(4, 20), iv = buf.subarray(20, 32), tag = buf.subarray(buf.length - 16), d = crypto.createDecipheriv('aes-256-gcm', crypto.scryptSync(pass, salt, 32), iv);
    d.setAuthTag(tag);
    try { buf = Buffer.concat([d.update(buf.subarray(32, buf.length - 16)), d.final()]) } catch (e) { throw new Error('No se pudo descifrar: la clave no coincide o el archivo está dañado.') }
  }
  return zlib.gunzipSync(buf);
}
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split(/[\\/]/).pop())) {
  const [src, out] = process.argv.slice(2);
  if (!src || !out) { console.error('Uso: node --no-warnings api/tools/restore.mjs <copia> <salida.db>'); process.exit(2) }
  if (fs.existsSync(out)) { console.error(`Ya existe ${out}. Elige otro nombre para no sobrescribir nada.`); process.exit(2) }
  try {
    fs.writeFileSync(out, openBackup(fs.readFileSync(src), process.env.BACKUP_PASSPHRASE || ''));
    const db = new DatabaseSync(out, { readOnly: true }), ok = db.prepare('PRAGMA integrity_check').get().integrity_check;
    const n = t => db.prepare(`SELECT COUNT(*) n FROM ${t}`).get().n, last = db.prepare('SELECT MAX(created) c FROM bookings').get().c;
    console.log(`Integridad: ${ok}\nReservas: ${n('bookings')} · sillas vendidas o apartadas: ${n('seat_inv')} · agencias: ${n('agencies')} · usuarios: ${n('users')}\nÚltima reserva: ${last || '—'}\nBase lista en ${out}`);
    db.close(); if (ok !== 'ok') process.exit(1);
  } catch (e) { try { fs.unlinkSync(out) } catch (x) {} console.error(String(e.message || e)); process.exit(1) }
}
