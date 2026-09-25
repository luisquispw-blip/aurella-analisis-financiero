// Detección de egresos duplicados entre hojas/archivos (p. ej. la garantía del local de La Paz registrada
// en la hoja MARZO de Cochabamba y también en INVERSION LA PAZ). El duplicado se marca, nunca se borra.
import type { Db } from '../database/db.ts';
import { claveTexto, similitud } from '../importers/utilidades.ts';

type E = { id: number; establecimiento_id: string; periodo: string | null; hoja_id: number; fila: number; fecha: string | null; descripcion: string; documento: string | null; monto: number; origen: string; nivel: string; con_factura: number | null; hoja: string; archivo: string };

// Prioridad de conservación: inversión > rendición con/sin factura > hoja general
function prioridad(e: E): number {
  if (e.origen === 'inversion') return 0;
  if (e.con_factura !== null) return 1;
  return 2;
}

function docValido(d: string | null): string | null {
  if (!d) return null;
  const t = d.replace(/\D/g, '');
  return t.length >= 5 ? t : null;
}

export function detectarDuplicadosEgresos(db: Db): number {
  // Reinicia solo las marcas automáticas; duplicado_de = -1 significa "confirmado como no duplicado"
  db.run(`UPDATE egreso SET estado = 'valido', duplicado_de = NULL WHERE estado = 'duplicado' AND duplicado_de > 0`);
  const filas = db.all<E>(`SELECT e.id, e.establecimiento_id, e.periodo, e.hoja_id, e.fila, e.fecha, e.descripcion, e.documento, e.monto, e.origen, e.nivel, e.con_factura,
      h.nombre hoja, a.nombre archivo
    FROM egreso e JOIN hoja h ON h.id = e.hoja_id JOIN archivo a ON a.id = h.archivo_id
    WHERE h.estado = 'importada' AND e.nivel = 'detalle' AND e.estado IN ('valido','observado') AND COALESCE(e.duplicado_de, 0) >= 0`);
  const grupos = new Map<string, E[]>();
  for (const e of filas) {
    const d = docValido(e.documento);
    if (d) {
      const k = `D|${e.establecimiento_id}|${e.periodo}|${d}|${e.monto}`;
      (grupos.get(k) || grupos.set(k, []).get(k)!).push(e);
    }
    if (e.fecha) {
      const k = `F|${e.establecimiento_id}|${e.fecha}|${e.monto}`;
      (grupos.get(k) || grupos.set(k, []).get(k)!).push(e);
    }
  }
  const marcado = new Set<number>();
  const upd = db.raw.prepare(`UPDATE egreso SET estado = 'duplicado', duplicado_de = ? WHERE id = ?`);
  let n = 0;
  db.tx(() => {
    for (const [k, g] of grupos) {
      if (g.length < 2) continue;
      const orden = [...g].sort((a, b) => prioridad(a) - prioridad(b) || a.hoja_id - b.hoja_id || a.fila - b.fila);
      const base = orden[0];
      for (const e of orden.slice(1)) {
        if (marcado.has(e.id) || marcado.has(base.id) || e.id === base.id) continue;
        const mismaHoja = e.hoja_id === base.hoja_id;
        if (k.startsWith('F|')) {
          // por fecha+monto exigimos descripción parecida y hojas distintas
          if (mismaHoja) continue;
          if (similitud(claveTexto(e.descripcion), claveTexto(base.descripcion)) < 0.6) continue;
        } else if (mismaHoja && e.fila === base.fila) continue;
        upd.run(base.id, e.id);
        marcado.add(e.id);
        n++;
      }
    }
  });

  // Partidas de la hoja de INVERSIÓN que el propietario también incluyó en su resumen mensual de gastos
  // (p. ej. "Renta Febrero" 4.000): se conserva como gasto operativo del mes y se excluye de la inversión.
  const resumen = db.all<{ id: number; establecimiento_id: string; periodo: string; descripcion: string; monto: number }>(`
    SELECT e.id, e.establecimiento_id, e.periodo, e.descripcion, e.monto FROM egreso e JOIN hoja h ON h.id = e.hoja_id
    WHERE h.estado = 'importada' AND e.nivel = 'resumen' AND e.estado = 'valido'`);
  const inv = db.all<{ id: number; establecimiento_id: string; periodo: string; descripcion: string; monto: number }>(`
    SELECT e.id, e.establecimiento_id, e.periodo, e.descripcion, e.monto FROM egreso e JOIN hoja h ON h.id = e.hoja_id
    WHERE h.estado = 'importada' AND e.origen = 'inversion' AND e.estado IN ('valido','observado') AND COALESCE(e.duplicado_de, 0) >= 0`);
  db.tx(() => {
    for (const r of resumen) {
      const palabra = claveTexto(r.descripcion).split(' ').find((w) => w.length >= 4);
      if (!palabra) continue;
      const m = inv.find((i) => !marcado.has(i.id) && i.establecimiento_id === r.establecimiento_id && i.periodo === r.periodo
        && Math.abs(i.monto - r.monto) < 0.01 && claveTexto(i.descripcion).split(' ').includes(palabra));
      if (m) { upd.run(r.id, m.id); marcado.add(m.id); n++; }
    }
  });
  return n;
}
