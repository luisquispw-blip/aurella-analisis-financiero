import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config/app.config.ts';
import { hashPassword, passwordAleatoria } from '../services/seguridad.ts';

export type Row = Record<string, any>;

export class Db {
  raw: DatabaseSync;
  constructor(file: string) {
    if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
    this.raw = new DatabaseSync(file);
    this.raw.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  }
  all<T = Row>(sql: string, ...params: any[]): T[] {
    return this.raw.prepare(sql).all(...params) as T[];
  }
  get<T = Row>(sql: string, ...params: any[]): T | undefined {
    return this.raw.prepare(sql).get(...params) as T | undefined;
  }
  run(sql: string, ...params: any[]) {
    return this.raw.prepare(sql).run(...params);
  }
  tx<T>(fn: () => T): T {
    this.raw.exec('BEGIN');
    try {
      const r = fn();
      this.raw.exec('COMMIT');
      return r;
    } catch (e) {
      this.raw.exec('ROLLBACK');
      throw e;
    }
  }
  parametro(clave: string): string | null {
    return this.get<{ valor: string }>('SELECT valor FROM parametro WHERE clave = ?', clave)?.valor ?? null;
  }
  setParametro(clave: string, valor: string | null, usuario = 'sistema', descripcion?: string) {
    this.run(
      `INSERT INTO parametro (clave, valor, descripcion, actualizado_por, fecha) VALUES (?, ?, ?, ?, datetime('now'))
       ON CONFLICT(clave) DO UPDATE SET valor = excluded.valor, actualizado_por = excluded.actualizado_por, fecha = excluded.fecha,
       descripcion = COALESCE(excluded.descripcion, parametro.descripcion)`,
      clave, valor, descripcion ?? null, usuario,
    );
  }
  auditar(usuario: string | null, accion: string, detalle?: unknown) {
    this.run('INSERT INTO auditoria (usuario, accion, detalle) VALUES (?, ?, ?)', usuario, accion,
      detalle === undefined ? null : typeof detalle === 'string' ? detalle : JSON.stringify(detalle));
  }
}

export function abrirDb(file = config.dbPath, opciones: { log?: (m: string) => void } = {}): Db {
  const db = new Db(file);
  db.raw.exec(fs.readFileSync(path.join(config.root, 'database', 'schema.sql'), 'utf8'));
  migrar(db);
  sembrar(db, opciones.log ?? console.log);
  return db;
}

// Migraciones de columnas añadidas después de la primera versión (idempotentes)
function migrar(db: Db) {
  const cols = new Set(db.all<{ name: string }>("PRAGMA table_info(hoja)").map((c) => c.name));
  if (!cols.has('firmas')) db.raw.exec('ALTER TABLE hoja ADD COLUMN firmas TEXT');
}

function sembrar(db: Db, log: (m: string) => void) {
  const e = config.empresa;
  db.run(`INSERT OR IGNORE INTO empresa (id, razon_social, nombre_comercial, nit, moneda) VALUES (?, ?, ?, ?, ?)`,
    e.id, e.razon_social, e.nombre_comercial, e.nit, e.moneda);
  for (const est of config.establecimientos) {
    db.run(`INSERT OR IGNORE INTO establecimiento (id, empresa_id, nombre, ciudad, tipo) VALUES (?, ?, ?, ?, ?)`,
      est.id, e.id, est.nombre, est.ciudad, est.tipo);
  }
  const reglas = JSON.parse(fs.readFileSync(path.join(config.root, 'config', 'reglas_alertas.json'), 'utf8')).reglas;
  for (const r of reglas) {
    db.run(`INSERT OR IGNORE INTO regla_alerta (codigo, nombre, severidad, parametro, valor, activo) VALUES (?, ?, ?, ?, ?, ?)`,
      r.codigo, r.nombre, r.severidad, r.parametro, r.valor, r.activo);
  }
  const defaults: [string, string | null, string][] = [
    ['metodo_valuacion', null, 'Método de valuación del costo de ventas. Se fija automáticamente a COSTO_ESTANDAR_PROVEEDOR cuando se carga una tabla de costos por presentación; puede definirse manualmente.'],
    ['tipo_cambio_usd', null, 'Tipo de cambio Bs por USD para convertir egresos registrados en dólares. Sin este dato los montos en USD no se suman.'],
    ['precio_lista_vigencia', 'toda_la_serie', 'El archivo de costos no indica vigencia: el precio público se aplica a todo el histórico para calcular descuentos implícitos.'],
  ];
  for (const [k, v, d] of defaults) {
    db.run('INSERT OR IGNORE INTO parametro (clave, valor, descripcion) VALUES (?, ?, ?)', k, v, d);
  }
  const hayUsuarios = db.get<{ n: number }>('SELECT COUNT(*) n FROM usuario')!.n;
  if (!hayUsuarios) {
    const usuario = process.env.ADMIN_USER || 'admin';
    const generada = !process.env.ADMIN_PASSWORD;
    const pass = process.env.ADMIN_PASSWORD || passwordAleatoria();
    const { hash, salt } = hashPassword(pass);
    db.run(`INSERT INTO usuario (usuario, nombre, rol, hash, salt, debe_cambiar) VALUES (?, ?, 'admin', ?, ?, ?)`,
      usuario, 'Administrador', hash, salt, generada ? 1 : 0);
    if (generada) {
      log(`[seguridad] Usuario inicial creado: ${usuario} / contraseña temporal: ${pass}  (defina ADMIN_PASSWORD para fijarla)`);
    }
  }
}
