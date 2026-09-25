// Panel visual de cada respuesta del agente: tarjetas (importes y porcentajes con variación), gráfico y tabla.
// Se arma directamente con el motor financiero, por lo que las cifras son exactas e idénticas a las del dashboard.
import type { Db } from '../database/db.ts';
import type { Datos } from '../analytics/datos.ts';
import type { ResumenMes, V } from '../analytics/motor.ts';
import { analisisGastos, comparacionMeses, nombrePeriodo, porDimension, ranking } from '../analytics/motor.ts';
import { situacionFinanciera } from '../analytics/financiero.ts';
import { datosFaltantes } from '../analytics/calidad.ts';
import { redondear, norm } from '../importers/utilidades.ts';
import { mesDe } from './herramientas.ts';
import { anterior, contexto, ultimoCompleto } from './local.ts';

export type Tarjeta = { titulo: string; valor: number | null; tipo: 'bs' | 'pc' | 'num'; estado: string; nota?: string; variacion_pct?: number | null; variacion_pp?: number | null; referencia?: string };
export type Panel = {
  titulo: string;
  tarjetas: Tarjeta[];
  grafico?: { titulo: string; tipo: 'barras' | 'barras_h'; formato: 'bs' | 'pc' | 'num'; series: { clave: string; nombre: string; color: string }[]; datos: Record<string, any>[] };
  tabla?: { titulo: string; columnas: { k: string; t: string; tipo?: 'bs' | 'pc' | 'num' | 'texto' }[]; filas: Record<string, any>[] };
};

const NOM: Record<string, string> = { CBB: 'Cochabamba', LPZ: 'La Paz', TOTAL: 'Total empresa' };
const AZUL = '#2a5298', ORO = '#c8912e', VERDE = '#1baf7a';

function tarjeta(titulo: string, x: V | undefined, tipo: Tarjeta['tipo'], prev?: V | null, refNombre?: string): Tarjeta {
  const t: Tarjeta = { titulo, valor: x?.v ?? null, tipo, estado: x?.e ?? 'nd', nota: x?.m };
  if (prev && x?.v !== null && x?.v !== undefined && prev.v !== null && prev.v !== undefined) {
    if (tipo === 'pc') t.variacion_pp = redondear(x.v - prev.v);
    else if (prev.v) t.variacion_pct = redondear(((x.v - prev.v) / Math.abs(prev.v)) * 100);
    t.referencia = refNombre;
  }
  return t;
}

function panelMes(d: Datos, periodo: string, est: string, foco: 'ventas' | 'completo'): Panel | null {
  const r = mesDe(d, periodo, est) as ResumenMes | null;
  if (!r || !r.operando) return null;
  const pa = anterior(d, periodo);
  const p = pa ? (mesDe(d, pa, est) as ResumenMes) : null;
  const ref = p?.operando ? p.nombre : undefined;
  const pv = (k: keyof ResumenMes) => (p?.operando ? (p[k] as V) : null);
  const tarjetas = foco === 'ventas'
    ? [tarjeta('Ventas netas', r.ventas_netas, 'bs', pv('ventas_netas'), ref), tarjeta('Unidades vendidas', r.unidades, 'num', pv('unidades'), ref),
      tarjeta('Ticket promedio', r.ticket_promedio, 'bs', pv('ticket_promedio'), ref), tarjeta('Descuento implícito', r.descuento_implicito, 'bs', pv('descuento_implicito'), ref),
      tarjeta('Margen bruto', r.margen_bruto, 'pc', pv('margen_bruto'), ref)]
    : [tarjeta('Ventas netas', r.ventas_netas, 'bs', pv('ventas_netas'), ref), tarjeta('Utilidad bruta', r.utilidad_bruta, 'bs', pv('utilidad_bruta'), ref),
      tarjeta('Margen bruto', r.margen_bruto, 'pc', pv('margen_bruto'), ref), tarjeta('Gastos operativos', r.gastos_operativos, 'bs', pv('gastos_operativos'), ref),
      tarjeta('Utilidad operativa', r.utilidad_operativa, 'bs', pv('utilidad_operativa'), ref), tarjeta('Margen operativo', r.margen_operativo, 'pc', pv('margen_operativo'), ref)];
  const panel: Panel = { titulo: `${NOM[est]} · ${r.nombre}${r.cobertura?.parcial ? ' (registro parcial)' : ''}`, tarjetas };
  if (foco === 'ventas') {
    const tot = Object.values(r.por_medio).reduce((a, b) => a + b, 0);
    panel.grafico = { titulo: 'Ventas por medio de pago', tipo: 'barras_h', formato: 'bs', series: [{ clave: 'valor', nombre: 'Ventas', color: AZUL }],
      datos: Object.entries(r.por_medio).sort((a, b) => b[1] - a[1]).map(([k, v]) => ({ nombre: `${k} (${tot ? redondear((v / tot) * 100, 1) : 0}%)`, valor: redondear(v) })) };
  } else {
    const g = Object.entries(r.gastos_categoria).sort((a, b) => b[1] - a[1]);
    const tg = g.reduce((a, [, v]) => a + v, 0);
    if (g.length) panel.grafico = { titulo: 'Gastos operativos por categoría', tipo: 'barras_h', formato: 'bs', series: [{ clave: 'valor', nombre: 'Gasto', color: ORO }],
      datos: g.map(([k, v]) => ({ nombre: `${k} (${redondear((v / tg) * 100, 1)}%)`, valor: redondear(v) })) };
  }
  if (est === 'TOTAL') {
    const partes = ['CBB', 'LPZ'].map((e) => mesDe(d, periodo, e) as ResumenMes).filter((x) => x.operando);
    const vt = r.ventas_netas.v || 0;
    panel.tabla = { titulo: 'Detalle por establecimiento', columnas: [{ k: 'est', t: 'Establecimiento', tipo: 'texto' }, { k: 'ventas', t: 'Ventas', tipo: 'bs' }, { k: 'part', t: 'Participación', tipo: 'pc' }, { k: 'ub', t: 'Utilidad bruta', tipo: 'bs' }, { k: 'mb', t: 'Margen bruto', tipo: 'pc' }, { k: 'uo', t: 'Utilidad operativa', tipo: 'bs' }, { k: 'mo', t: 'Margen operativo', tipo: 'pc' }],
      filas: partes.map((x) => ({ est: NOM[x.est], ventas: x.ventas_netas.v, part: vt ? redondear(((x.ventas_netas.v || 0) / vt) * 100) : null, ub: x.utilidad_bruta.v, mb: x.margen_bruto.v, uo: x.utilidad_operativa.v, mo: x.margen_operativo.v })) };
  }
  return panel;
}

export function panelPara(db: Db, d: Datos, pregunta: string): Panel | null {
  void db;
  if (!d.periodos.length) return null;
  const t = norm(pregunta);
  const c = contexto(pregunta, d);
  const periodo = c.periodo ?? ultimoCompleto(d)!;
  const estF = c.est === 'TOTAL' ? undefined : c.est;

  if (/FALTA|FALTANTE|QUE INFORMACION|QUE DATOS/.test(t)) {
    const f = datosFaltantes(d);
    return {
      titulo: 'Información pendiente', tarjetas: ['alta', 'media', 'baja'].map((p) => ({ titulo: `Prioridad ${p}`, valor: f.filter((x) => x.prioridad === p).length, tipo: 'num' as const, estado: 'ok' })),
      tabla: { titulo: 'Datos faltantes', columnas: [{ k: 'prioridad', t: 'Prioridad', tipo: 'texto' }, { k: 'dato', t: 'Dato', tipo: 'texto' }], filas: f.slice(0, 12).map((x) => ({ prioridad: x.prioridad, dato: x.dato })) },
    };
  }
  if ((/COMPAR|VS|VERSUS/.test(t) && /COCHABAMBA|CBB|LA PAZ|LPZ|SUCURSAL/.test(t)) || /QUE SUCURSAL|CUAL SUCURSAL|QUE ESTABLECIMIENTO/.test(t)) {
    const a = mesDe(d, periodo, 'CBB') as ResumenMes, b = mesDe(d, periodo, 'LPZ') as ResumenMes, tt = mesDe(d, periodo, 'TOTAL') as ResumenMes;
    const vt = tt.ventas_netas.v || 0;
    const acum = porDimension(d, {}, 'est');
    return {
      titulo: `Cochabamba vs La Paz · ${nombrePeriodo(periodo)}`,
      tarjetas: [
        tarjeta('Ventas Cochabamba', a.ventas_netas, 'bs'), { titulo: 'Participación Cochabamba', valor: vt ? redondear(((a.ventas_netas.v || 0) / vt) * 100) : null, tipo: 'pc', estado: 'ok' },
        tarjeta('Ventas La Paz', b.ventas_netas, 'bs'), { titulo: 'Participación La Paz', valor: vt ? redondear(((b.ventas_netas.v || 0) / vt) * 100) : null, tipo: 'pc', estado: 'ok' },
        tarjeta('Margen operativo Cochabamba', a.margen_operativo, 'pc'), tarjeta('Margen operativo La Paz', b.margen_operativo, 'pc'),
      ],
      grafico: { titulo: 'Comparativo del mes (Bs)', tipo: 'barras', formato: 'bs', series: [{ clave: 'CBB', nombre: 'Cochabamba', color: AZUL }, { clave: 'LPZ', nombre: 'La Paz', color: ORO }],
        datos: [['Ventas netas', 'ventas_netas'], ['Utilidad bruta', 'utilidad_bruta'], ['Gastos', 'gastos_operativos'], ['Utilidad operativa', 'utilidad_operativa']].map(([n, k]) => ({ nombre: n, CBB: (a as any)[k].v, LPZ: (b as any)[k].v })) },
      tabla: { titulo: 'Histórico acumulado', columnas: [{ k: 'est', t: 'Establecimiento', tipo: 'texto' }, { k: 'ventas', t: 'Ventas', tipo: 'bs' }, { k: 'part', t: 'Participación', tipo: 'pc' }, { k: 'margen', t: 'Margen bruto', tipo: 'pc' }],
        filas: acum.map((x) => ({ est: NOM[x.clave] ?? x.clave, ventas: x.ventas, part: x.participacion, margen: x.margen ?? x.margen_parcial })) },
    };
  }
  if (/POR QUE|CAUSA|EXPLICA/.test(t) && /UTILIDAD|GANANCIA|MARGEN|VENTA/.test(t)) {
    const pa = anterior(d, periodo);
    if (!pa) return null;
    const r = mesDe(d, periodo, c.est) as ResumenMes, p = mesDe(d, pa, c.est) as ResumenMes;
    const dif = (k: keyof ResumenMes) => ((r[k] as V).v !== null && (p[k] as V).v !== null ? redondear(((r[k] as V).v as number) - ((p[k] as V).v as number)) : null);
    return {
      titulo: `Variación ${p.nombre} → ${r.nombre} · ${NOM[c.est]}`,
      tarjetas: [tarjeta('Utilidad operativa', r.utilidad_operativa, 'bs', p.utilidad_operativa, p.nombre), tarjeta('Ventas netas', r.ventas_netas, 'bs', p.ventas_netas, p.nombre),
        tarjeta('Gastos operativos', r.gastos_operativos, 'bs', p.gastos_operativos, p.nombre), tarjeta('Margen operativo', r.margen_operativo, 'pc', p.margen_operativo, p.nombre)],
      grafico: { titulo: 'Efecto de cada componente sobre la utilidad operativa (Bs)', tipo: 'barras_h', formato: 'bs', series: [{ clave: 'valor', nombre: 'Efecto', color: AZUL }],
        datos: [{ nombre: 'Ventas netas', valor: dif('ventas_netas') }, { nombre: 'Costo de ventas', valor: dif('costo_ventas') === null ? null : -dif('costo_ventas')! },
          { nombre: 'Gastos operativos', valor: dif('gastos_operativos') === null ? null : -dif('gastos_operativos')! }, { nombre: 'Utilidad operativa (total)', valor: dif('utilidad_operativa') }] },
    };
  }
  if (/RENTABLE|MARGEN|MAS GANANCIA/.test(t) && /PRODUCTO|PERFUME/.test(t)) {
    const r = ranking(d, { est: estF }, /MARGEN/.test(t) ? 'margen' : 'utilidad', 10);
    if (!r.disponible) return null;
    return {
      titulo: r.titulo, tarjetas: r.filas.slice(0, 3).map((x, i) => ({ titulo: `${i + 1}. ${x.producto}`, valor: x.utilidad, tipo: 'bs' as const, estado: 'ok', nota: `Margen ${x.margen}%`, variacion_pct: null })),
      grafico: { titulo: 'Utilidad bruta por producto (Bs)', tipo: 'barras_h', formato: 'bs', series: [{ clave: 'valor', nombre: 'Utilidad', color: VERDE }], datos: r.filas.map((x) => ({ nombre: x.producto, valor: x.utilidad })) },
      tabla: { titulo: 'Ranking', columnas: [{ k: 'producto', t: 'Producto', tipo: 'texto' }, { k: 'ventas', t: 'Ventas', tipo: 'bs' }, { k: 'utilidad', t: 'Utilidad bruta', tipo: 'bs' }, { k: 'margen', t: 'Margen', tipo: 'pc' }, { k: 'participacion', t: 'Part. ventas', tipo: 'pc' }],
        filas: r.filas.map((x) => ({ producto: x.producto, ventas: x.ventas, utilidad: x.utilidad, margen: x.margen, participacion: x.participacion })) },
    };
  }
  if (/ROTACION|NO SE VENDE|LENTO|MENOS SE VENDE/.test(t)) {
    const r = ranking(d, { est: estF }, 'rotacion', 400);
    const lentos = [...r.filas].reverse().slice(0, 12);
    return { titulo: 'Productos con menor velocidad de venta', tarjetas: [{ titulo: 'Productos analizados', valor: r.filas.length, tipo: 'num', estado: 'ok' }, { titulo: 'Con menos de 1 u./mes', valor: r.filas.filter((x) => x.velocidad < 1).length, tipo: 'num', estado: 'ok' }],
      tabla: { titulo: 'Menor rotación', columnas: [{ k: 'producto', t: 'Producto', tipo: 'texto' }, { k: 'unidades', t: 'Unidades', tipo: 'num' }, { k: 'velocidad', t: 'u./mes', tipo: 'num' }, { k: 'ventas', t: 'Ventas', tipo: 'bs' }, { k: 'participacion', t: 'Part.', tipo: 'pc' }],
        filas: lentos.map((x) => ({ producto: x.producto, unidades: x.unidades, velocidad: x.velocidad, ventas: x.ventas, participacion: x.participacion })) } };
  }
  if (/INVENTARIO|STOCK|EXISTENCIA/.test(t)) {
    const r = mesDe(d, periodo, c.est) as ResumenMes;
    return { titulo: `Inventario · ${NOM[c.est]} · ${nombrePeriodo(periodo)}`, tarjetas: [tarjeta('Inventario final teórico (u.)', r.inv_final_teorico, 'num'), tarjeta('Inventario físico (u.)', r.inv_fisico, 'num'), tarjeta('Diferencia (u.)', r.inv_diferencia, 'num')] };
  }
  if (/DINERO|DISPONIBLE|CAJA|LIQUIDEZ|EFECTIVO|BANCO/.test(t)) {
    const s = situacionFinanciera(d, periodo, c.est);
    const r = mesDe(d, periodo, c.est) as ResumenMes;
    const tot = Object.values(r.por_medio).reduce((a, b) => a + b, 0);
    return { titulo: `Disponibilidad · ${NOM[c.est]} · ${s.nombre}`,
      tarjetas: [tarjeta('Fondo de caja (efectivo)', s.activos[0].valor, 'bs'), tarjeta('Bancos', s.activos[1].valor, 'bs'), tarjeta('Caja y bancos', r.caja_bancos, 'bs'), tarjeta('Flujo neto del mes', r.flujo_neto, 'bs')],
      grafico: { titulo: 'Cobros del mes por medio de pago', tipo: 'barras_h', formato: 'bs', series: [{ clave: 'valor', nombre: 'Cobros', color: AZUL }],
        datos: Object.entries(r.por_medio).sort((a, b) => b[1] - a[1]).map(([k, v]) => ({ nombre: `${k} (${tot ? redondear((v / tot) * 100, 1) : 0}%)`, valor: redondear(v) })) } };
  }
  if (/GASTO/.test(t)) {
    const g = analisisGastos(d, { est: estF, desde: c.periodo ?? undefined, hasta: c.periodo ?? undefined });
    const r = mesDe(d, periodo, c.est) as ResumenMes;
    return { titulo: `Gastos operativos · ${NOM[c.est]} · ${c.periodo ? nombrePeriodo(c.periodo) : 'todo el periodo'}`,
      tarjetas: [{ titulo: 'Gasto operativo total', valor: g.total, tipo: 'bs', estado: g.faltantes.length ? 'parcial' : 'ok', nota: g.faltantes.length ? `Sin rendición: ${g.faltantes.join(', ')}` : undefined },
        ...g.por_categoria.slice(0, 2).map((x) => ({ titulo: `${x.categoria} (% del gasto)`, valor: x.participacion, tipo: 'pc' as const, estado: 'ok', nota: `Bs ${x.total.toLocaleString('es-BO')}` })),
        { titulo: `Gasto / ventas (${nombrePeriodo(periodo)})`, valor: r.gastos_operativos.v !== null && r.ventas_netas.v ? redondear((r.gastos_operativos.v / r.ventas_netas.v) * 100) : null, tipo: 'pc', estado: 'ok' }],
      grafico: { titulo: 'Gasto por categoría (Bs y % del total)', tipo: 'barras_h', formato: 'bs', series: [{ clave: 'valor', nombre: 'Gasto', color: ORO }], datos: g.por_categoria.map((x) => ({ nombre: `${x.categoria} (${x.participacion}%)`, valor: x.total })) } };
  }
  if (/MEJOR MES|PEOR MES|TENDENCIA|EVOLUCION/.test(t)) {
    const cm = comparacionMeses(d, {}, c.est);
    return { titulo: `Evolución mensual · ${NOM[c.est]}`, tarjetas: [{ titulo: 'Promedio mensual de ventas', valor: cm.resumen.ventas_netas.promedio, tipo: 'bs', estado: 'ok' }, { titulo: `Mejor mes${cm.resumen.ventas_netas.mejor ? ` (${nombrePeriodo(cm.resumen.ventas_netas.mejor.periodo)})` : ''}`, valor: cm.resumen.ventas_netas.mejor?.v ?? null, tipo: 'bs', estado: 'ok' }, { titulo: `Peor mes${cm.resumen.ventas_netas.peor ? ` (${nombrePeriodo(cm.resumen.ventas_netas.peor.periodo)})` : ''}`, valor: cm.resumen.ventas_netas.peor?.v ?? null, tipo: 'bs', estado: 'ok' }],
      grafico: { titulo: 'Ventas netas por mes (Bs)', tipo: 'barras', formato: 'bs', series: [{ clave: 'valor', nombre: 'Ventas netas', color: AZUL }], datos: cm.filas.map((f: any) => ({ nombre: f.nombre + (f.parcial ? '*' : ''), valor: f.ventas_netas.v })) } };
  }
  if (/VEND|VENTA|FACTUR|INGRESO/.test(t) && /PRODUCTO|MAS VENDIDO|TOP/.test(t)) {
    const r = ranking(d, { est: estF, desde: c.periodo ?? undefined, hasta: c.periodo ?? undefined }, /UNIDAD/.test(t) ? 'unidades' : 'ventas', 10);
    return { titulo: r.titulo, tarjetas: r.filas.slice(0, 3).map((x, i) => ({ titulo: `${i + 1}. ${x.producto}`, valor: x.ventas, tipo: 'bs' as const, estado: 'ok', nota: `${x.participacion}% de las ventas` })),
      grafico: { titulo: 'Ventas por producto (Bs)', tipo: 'barras_h', formato: 'bs', series: [{ clave: 'valor', nombre: 'Ventas', color: AZUL }], datos: r.filas.map((x) => ({ nombre: `${x.producto} (${x.participacion}%)`, valor: x.ventas })) } };
  }
  if (/VEND|VENTA|FACTUR|INGRESO/.test(t)) return panelMes(d, periodo, c.est, 'ventas');
  return panelMes(d, periodo, c.est, 'completo');
}
