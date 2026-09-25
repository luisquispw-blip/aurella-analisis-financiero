// Clasificación de egresos por reglas configurables (config/reglas_gastos.json).
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config/app.config.ts';
import type { Db } from '../database/db.ts';
import { norm } from '../importers/utilidades.ts';

export type ReglaGasto = { id: string; patron: string; clase: string; categoria: string };

export const CLASES: Record<string, string> = {
  gasto_operativo: 'Gasto operativo',
  compra_mercaderia: 'Pago de mercadería (no es gasto)',
  inversion_activo: 'Inversión / activo',
  preoperativo: 'Gasto preoperativo (financiado con la inversión)',
  retiro: 'Retiro de socios',
  no_operativo: 'No operativo',
};
export const CATEGORIAS_GASTO = ['Alquiler', 'Sueldos', 'Servicios', 'Transporte', 'Publicidad', 'Comisiones', 'Impuestos', 'Otros'];

let cache: { reglas: ReglaGasto[]; re: RegExp[] } | null = null;
export function reglas(): { reglas: ReglaGasto[]; re: RegExp[] } {
  if (!cache) {
    const r: ReglaGasto[] = JSON.parse(fs.readFileSync(path.join(config.root, 'config', 'reglas_gastos.json'), 'utf8')).reglas;
    cache = { reglas: r, re: r.map((x) => new RegExp(x.patron)) };
  }
  return cache;
}

export function clasificarEgreso(descripcion: string, origen: string): { clase: string; categoria: string; regla_id: string } {
  const t = norm(descripcion);
  const { reglas: rs, re } = reglas();
  for (let i = 0; i < rs.length; i++) {
    if (re[i].test(t)) {
      let clase = rs[i].clase;
      if (origen === 'inversion' && clase === 'gasto_operativo') clase = 'preoperativo';
      return { clase, categoria: rs[i].categoria, regla_id: rs[i].id };
    }
  }
  return { clase: origen === 'inversion' ? 'preoperativo' : 'gasto_operativo', categoria: 'Otros', regla_id: 'SIN_REGLA' };
}

export function clasificarEgresosPendientes(db: Db) {
  const filas = db.all<{ id: number; descripcion: string; origen: string }>('SELECT id, descripcion, origen FROM egreso WHERE clasificacion_manual = 0');
  const upd = db.raw.prepare('UPDATE egreso SET clase = ?, categoria = ?, regla_id = ? WHERE id = ?');
  db.tx(() => {
    for (const f of filas) {
      const c = clasificarEgreso(f.descripcion, f.origen);
      upd.run(c.clase, c.categoria, c.regla_id, f.id);
    }
  });
}
