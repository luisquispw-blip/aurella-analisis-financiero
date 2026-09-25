// Identifica el tipo de información de cada hoja y delega en el importador correspondiente.
import type { HojaLeida } from './lector.ts';
import type { ContextoLibro, ResultadoHoja } from './tipos.ts';
import { resultadoVacio } from './tipos.ts';
import { detectarRegistroVentas, importarRegistroVentas } from './ventas_registro.ts';
import { detectarGastos, importarGastos } from './gastos.ts';
import {
  detectarCatalogo, detectarCostos, detectarResumenGastos, detectarTabla, importarCatalogo, importarCostos,
  importarResumenGastos, importarTabla,
} from './otros.ts';
import { vacio } from './utilidades.ts';

export type Candidata = { tipo: string; puntaje: number };

export function puntajes(h: HojaLeida): Candidata[] {
  const tabla = detectarTabla(h);
  const c: Candidata[] = [
    { tipo: 'ventas_registro', puntaje: detectarRegistroVentas(h) },
    { tipo: 'gastos', puntaje: detectarGastos(h) },
    { tipo: 'resumen_gastos', puntaje: detectarResumenGastos(h) },
    { tipo: 'costos', puntaje: detectarCostos(h) },
    { tipo: 'catalogo', puntaje: detectarCatalogo(h) },
  ];
  if (tabla) c.push({ tipo: tabla.tipo, puntaje: tabla.puntaje });
  return c.sort((a, b) => b.puntaje - a.puntaje);
}

export function analizarHoja(h: HojaLeida, ctx: ContextoLibro, forzarTipo?: string): ResultadoHoja {
  const conDatos = h.filas.filter((f) => f.some((v) => !vacio(v))).length;
  if (!conDatos) return resultadoVacio('vacia', 1);
  const cands = puntajes(h);
  const tipo = forzarTipo ?? (cands[0].puntaje >= 0.5 ? cands[0].tipo : null);
  let r: ResultadoHoja;
  switch (tipo) {
    case 'ventas_registro': r = importarRegistroVentas(h, ctx); break;
    case 'gastos': case 'inversion': r = importarGastos(h, ctx); break;
    case 'resumen_gastos': r = importarResumenGastos(h, ctx); break;
    case 'costos': r = importarCostos(h); break;
    case 'catalogo': r = importarCatalogo(h); break;
    case 'ventas_tabla': case 'inventario': case 'saldos': r = importarTabla(h, ctx, tipo); break;
    default: {
      r = resultadoVacio('desconocida', cands[0]?.puntaje ?? 0);
      const muestra = h.filas.find((f) => f.filter((v) => !vacio(v)).length >= 2)?.filter((v) => !vacio(v)).slice(0, 8).map(String) ?? [];
      r.mensajes.push({ nivel: 'error', texto: `No se pudo identificar qué información contiene la hoja "${h.nombre}" (${conDatos} filas con datos; primeras celdas: ${muestra.join(' | ')}). Indique el tipo de información para procesarla.` });
    }
  }
  if (forzarTipo) r.mensajes.unshift({ nivel: 'info', texto: `Tipo de información indicado por el usuario: ${forzarTipo}.` });
  return r;
}
