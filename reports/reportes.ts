// Informes exportables (Excel, PDF, CSV). Todos se construyen como un documento con secciones y tablas,
// y luego se renderizan al formato pedido. Los valores no disponibles se muestran como "N/D" con su motivo.
import * as XLSX from 'xlsx';
import PDFDocument from 'pdfkit';
import { config } from '../config/app.config.ts';
import type { Db } from '../database/db.ts';
import type { Datos } from '../analytics/datos.ts';
import type { Filtro, ResumenMes, V } from '../analytics/motor.ts';
import {
  analisisGastos, comparacionMeses, FORMULAS, inventarioPeriodo, nombrePeriodo, periodosFiltro, periodosOperacion, porDimension, porProducto,
  ranking, tablaMensual,
} from '../analytics/motor.ts';
import { liquidez, situacionFinanciera } from '../analytics/financiero.ts';
import { calcularAlertas } from '../analytics/alertas.ts';
import { datosFaltantes, informeCalidad } from '../analytics/calidad.ts';

type Celda = string | number | null;
type Tabla = { titulo: string; columnas: string[]; filas: Celda[][] };
type Seccion = { titulo: string; parrafos: string[]; tablas: Tabla[] };
type Documento = { titulo: string; subtitulo: string; secciones: Seccion[] };

export const TIPOS_REPORTE: Record<string, string> = {
  ejecutivo: 'Informe ejecutivo', financiero: 'Informe financiero', inventarios: 'Informe de inventarios', ventas: 'Informe de ventas',
  rentabilidad: 'Informe de rentabilidad', comparativo: 'Informe comparativo Cochabamba vs La Paz', mensual: 'Análisis mensual (CBB / LPZ / Total)',
  calidad: 'Informe de calidad de datos',
};

const bs = (n: number | null | undefined) => (n === null || n === undefined ? 'N/D' : `Bs ${n.toLocaleString('es-BO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
const pc = (n: number | null | undefined) => (n === null || n === undefined ? 'N/D' : `${n.toLocaleString('es-BO', { maximumFractionDigits: 2 })}%`);
const cel = (x: V | undefined): Celda => (!x ? null : x.v === null ? (x.e === 'sin_operacion' ? '—' : 'N/D') : x.v);
const marca = (x: V | undefined) => (x?.e === 'parcial' ? ' *' : '');
const NOM_EST: Record<string, string> = { CBB: 'Cochabamba', LPZ: 'La Paz', TOTAL: 'Total empresa' };

const FILAS_MENSUAL: [string, string][] = [
  ['inv_inicial', 'Inventario inicial (u.)'], ['compras_pagadas', 'Compras (pagos de mercadería Bs)'], ['unidades', 'Unidades vendidas'],
  ['ventas_netas', 'Ventas netas'], ['costo_ventas', 'Costo de ventas'], ['utilidad_bruta', 'Utilidad bruta'], ['margen_bruto', 'Margen bruto %'],
  ['gastos_operativos', 'Gastos operativos'], ['utilidad_operativa', 'Utilidad operativa'], ['margen_operativo', 'Margen operativo %'],
  ['inv_final_teorico', 'Inventario final (u.)'], ['inv_diferencia', 'Diferencia inventario (u.)'], ['caja_bancos', 'Caja y bancos'],
];

function tablaMes(t: any): Tabla {
  const ests = ['CBB', 'LPZ', 'TOTAL'].filter((e) => t[e]);
  return {
    titulo: `${t.nombre}`, columnas: ['Indicador', ...ests.map((e) => NOM_EST[e])],
    filas: FILAS_MENSUAL.map(([k, n]) => [n + (ests.some((e) => (t[e] as any)[k]?.e === 'parcial') ? ' *' : ''), ...ests.map((e) => cel((t[e] as any)[k]))]),
  };
}

function notasMes(t: any): string[] {
  const n: string[] = [];
  for (const e of ['CBB', 'LPZ']) {
    const r = t[e] as ResumenMes | undefined;
    if (!r?.operando) continue;
    for (const k of ['costo_ventas', 'gastos_operativos', 'caja_bancos'] as const) if ((r as any)[k].e === 'parcial' || (r as any)[k].e === 'nd') n.push(`${NOM_EST[e]} · ${k.replace('_', ' ')}: ${(r as any)[k].m}`);
    for (const x of r.notas) n.push(`${NOM_EST[e]}: ${x}`);
  }
  return [...new Set(n)];
}

function recomendaciones(db: Db, d: Datos, f: Filtro): string[] {
  const rec: string[] = [];
  const al = calcularAlertas(db, d, f);
  for (const a of al) if (a.recomendacion && !rec.includes(a.recomendacion)) rec.push(a.recomendacion);
  const top = ranking(d, f, 'utilidad', 3);
  if (top.disponible && top.filas.length) rec.push(`Priorizar los productos de mayor utilidad bruta (${top.filas.map((p) => `${p.producto}: ${bs(p.utilidad)}`).join('; ')}).`);
  const falt = datosFaltantes(d).filter((x) => x.prioridad === 'alta');
  if (falt.length) rec.push(`Completar la información de alta prioridad para cerrar el análisis: ${falt.slice(0, 3).map((x) => x.dato).join('; ')}.`);
  return rec.slice(0, 10);
}

function docMensual(d: Datos, f: Filtro): Seccion[] {
  return tablaMensual(d, f).map((t) => ({ titulo: `Análisis mensual — ${t.nombre}`, parrafos: notasMes(t), tablas: [tablaMes(t)] }));
}

function secVentas(d: Datos, f: Filtro): Seccion[] {
  const prods = porProducto(d, f);
  return [
    { titulo: 'Ventas por mes', parrafos: [FORMULAS.ventas_netas], tablas: [{ titulo: 'Ventas por mes', columnas: ['Periodo', 'Ventas netas', 'Unidades', 'Participación %'], filas: porDimension(d, f, 'periodo').sort((a, b) => a.clave.localeCompare(b.clave)).map((x) => [nombrePeriodo(x.clave), x.ventas, x.unidades, x.participacion]) }] },
    { titulo: 'Ventas por establecimiento, marca, categoría y presentación', parrafos: [], tablas: [
      { titulo: 'Por establecimiento', columnas: ['Establecimiento', 'Ventas', 'Unidades', 'Part. %'], filas: porDimension(d, f, 'est').map((x) => [NOM_EST[x.clave] ?? x.clave, x.ventas, x.unidades, x.participacion]) },
      { titulo: 'Por marca (top 20)', columnas: ['Marca', 'Ventas', 'Unidades', 'Part. %'], filas: porDimension(d, f, 'marca').slice(0, 20).map((x) => [x.clave, x.ventas, x.unidades, x.participacion]) },
      { titulo: 'Por categoría', columnas: ['Categoría', 'Ventas', 'Unidades', 'Part. %'], filas: porDimension(d, f, 'categoria').map((x) => [x.clave, x.ventas, x.unidades, x.participacion]) },
      { titulo: 'Por presentación', columnas: ['Presentación', 'Ventas', 'Unidades', 'Part. %'], filas: porDimension(d, f, 'presentacion').map((x) => [x.clave, x.ventas, x.unidades, x.participacion]) },
      { titulo: 'Por medio de pago', columnas: ['Medio', 'Ventas', 'Part. %'], filas: porDimension(d, f, 'tipo_pago').map((x) => [x.clave, x.ventas, x.participacion]) },
    ] },
    { titulo: 'Productos', parrafos: [], tablas: [{ titulo: 'Ventas por producto', columnas: ['Producto', 'Marca', 'Unidades', 'Ventas netas', 'Part. %', 'Precio prom.', 'Crec. % último mes'], filas: prods.map((p) => [p.producto, p.marca, p.unidades, p.ventas, p.participacion, p.precio_promedio, p.crecimiento]) }] },
  ];
}

function secRentabilidad(d: Datos, f: Filtro): Seccion[] {
  const prods = porProducto(d, f);
  return [{
    titulo: 'Rentabilidad por producto', parrafos: [FORMULAS.costo_ventas, FORMULAS.utilidad_bruta, FORMULAS.rentabilidad_producto, 'Productos con alguna venta sin costo registrado muestran la utilidad como N/D.'],
    tablas: [
      { titulo: 'Rentabilidad por producto', columnas: ['Producto', 'Marca', 'Unidades', 'Ventas', 'Costo', 'Utilidad bruta', 'Margen %'], filas: prods.map((p) => [p.producto, p.marca, p.unidades, p.ventas, p.costo, p.utilidad, p.margen]) },
      { titulo: 'Rentabilidad por presentación', columnas: ['Presentación', 'Ventas', 'Costo', 'Utilidad', 'Margen %'], filas: porDimension(d, f, 'presentacion').map((x) => [x.clave, x.ventas, x.costo, x.utilidad, x.margen]) },
    ],
  }];
}

function secGastos(d: Datos, f: Filtro): Seccion {
  const g = analisisGastos(d, f);
  return {
    titulo: 'Gastos', parrafos: [FORMULAS.gastos_operativos, g.faltantes.length ? `Sin rendición de gastos: ${g.faltantes.join(', ')}.` : 'Rendiciones completas en el rango.'],
    tablas: [
      { titulo: 'Gastos por categoría y mes', columnas: ['Categoría', ...g.periodos.map(nombrePeriodo), 'Total', 'Part. %'], filas: g.por_categoria.map((c) => [c.categoria, ...c.serie.map((s) => s.v), c.total, c.participacion]) },
      { titulo: 'Mayores egresos', columnas: ['Est.', 'Periodo', 'Descripción', 'Categoría', 'Monto', 'Origen'], filas: g.mayores.map((e) => [e.est, e.periodo, e.descripcion, e.categoria, e.monto_bob, `${e.hoja} fila ${e.fila}`]) },
    ],
  };
}

function secFinanciero(d: Datos, periodo: string): Seccion[] {
  return ['TOTAL', 'CBB', 'LPZ'].map((e) => {
    const s = situacionFinanciera(d, periodo, e);
    const l = liquidez(d, periodo, e);
    const lin = (xs: any[]) => xs.map((x) => [x.cuenta, cel(x.valor), x.valor.m ?? '']);
    return {
      titulo: `Situación financiera y liquidez — ${NOM_EST[e]} al cierre de ${nombrePeriodo(periodo)}`,
      parrafos: [s.nota ?? `Validación Activo = Pasivo + Patrimonio: diferencia ${bs(s.diferencia)}.`],
      tablas: [
        { titulo: 'Activos', columnas: ['Cuenta', 'Valor', 'Observación'], filas: lin(s.activos) },
        { titulo: 'Pasivos', columnas: ['Cuenta', 'Valor', 'Observación'], filas: lin(s.pasivos) },
        { titulo: 'Patrimonio', columnas: ['Cuenta', 'Valor', 'Observación'], filas: lin(s.patrimonio) },
        { titulo: 'Aportes por socio (inversión inicial)', columnas: ['Socio', 'Participación', 'Monto'], filas: s.aportes_por_socio.map((a) => [a.socio, a.participacion * 100, a.monto]) },
        { titulo: 'Indicadores de liquidez', columnas: ['Indicador', 'Fórmula', 'Valor', 'Observación'], filas: l.indicadores.map((i) => [i.nombre, i.formula, cel(i.valor), i.valor.m ?? '']) },
      ],
    };
  });
}

function secInventarios(d: Datos, f: Filtro): Seccion[] {
  const out: Seccion[] = [];
  if (!d.movimientos.length) {
    out.push({ titulo: 'Inventarios', parrafos: ['No se han proporcionado inventarios ni movimientos en unidades. No es posible calcular mercadería disponible, inventario teórico, diferencias ni rotación.', ...datosFaltantes(d).filter((x) => x.id.startsWith('inventario')).map((x) => `${x.dato}. Afecta: ${x.afecta}`), FORMULAS.mercaderia_disponible, FORMULAS.inventario_teorico, FORMULAS.diferencia_inventario], tablas: [] });
    return out;
  }
  for (const p of periodosFiltro(d, f)) for (const e of d.establecimientos.map((x) => x.id)) {
    if (!periodosOperacion(d, e).includes(p)) continue;
    const inv = inventarioPeriodo(d, e, p, f);
    out.push({ titulo: `Inventario ${NOM_EST[e]} — ${nombrePeriodo(p)}`, parrafos: inv.faltantes.slice(0, 10), tablas: [{ titulo: 'Control por producto', columnas: ['Producto', 'Inicial', 'Compras', 'Transf. entrada', 'Transf. salida', 'Vendidas', 'Devoluciones', 'Bajas', 'Teórico', 'Físico', 'Diferencia'], filas: inv.productos.map((x) => [x.producto, x.inicial, x.compras, x.t_in, x.t_out, x.vendidas, x.devoluciones, x.bajas, x.teorico, x.fisico, x.diferencia]) }] });
  }
  return out;
}

function secComparativo(d: Datos, f: Filtro): Seccion[] {
  const t = tablaMensual(d, f);
  const mets: [string, string][] = [['ventas_netas', 'Ventas netas'], ['unidades', 'Unidades'], ['costo_ventas', 'Costo'], ['utilidad_bruta', 'Utilidad bruta'], ['gastos_operativos', 'Gastos'], ['utilidad_operativa', 'Utilidad operativa'], ['margen_operativo', 'Margen operativo %'], ['inv_final_teorico', 'Inventario (u.)'], ['caja_bancos', 'Caja y bancos']];
  return [{
    titulo: 'Cochabamba vs La Paz', parrafos: ['Las transferencias internas entre establecimientos no se consideran ventas y se eliminan en el total empresa.'],
    tablas: mets.map(([k, n]) => ({ titulo: n, columnas: ['Periodo', 'Cochabamba', 'La Paz', 'Total empresa'], filas: t.map((x) => [x.nombre, cel(x.CBB?.[k as keyof ResumenMes] as V), cel(x.LPZ?.[k as keyof ResumenMes] as V), cel(x.TOTAL[k as keyof ResumenMes] as V)]) })),
  }];
}

export function construir(db: Db, d: Datos, tipo: string, f: Filtro): Documento {
  const ps = periodosFiltro(d, f);
  const ult = ps.at(-1);
  const sub = `${config.empresa.razon_social} — ${config.empresa.nombre_comercial} · ${ps.length ? `${nombrePeriodo(ps[0])} a ${nombrePeriodo(ult!)}` : 'sin datos'}${f.est ? ` · ${NOM_EST[f.est]}` : ''} · generado ${new Date().toLocaleString('es-BO')}`;
  const titulo = TIPOS_REPORTE[tipo];
  if (!titulo) throw new Error('Tipo de informe no válido');
  if (!ult) return { titulo, subtitulo: sub, secciones: [{ titulo: 'Sin datos', parrafos: ['No hay información procesada.'], tablas: [] }] };
  const sec: Seccion[] = [];
  const cm = comparacionMeses(d, f, f.est ?? 'TOTAL');
  const alertas = calcularAlertas(db, d, f);
  switch (tipo) {
    case 'mensual': sec.push(...docMensual(d, f)); break;
    case 'ventas': sec.push(...secVentas(d, f)); break;
    case 'rentabilidad': sec.push(...secRentabilidad(d, f)); break;
    case 'financiero': sec.push(...docMensual(d, f).slice(-1), secGastos(d, f), ...secFinanciero(d, ult)); break;
    case 'inventarios': sec.push(...secInventarios(d, f)); break;
    case 'comparativo': sec.push(...secComparativo(d, f)); break;
    case 'calidad': {
      const q = informeCalidad(db, d);
      sec.push({ titulo: 'Validaciones', parrafos: [], tablas: [{ titulo: 'Resultado de validaciones', columnas: ['Validación', 'Pregunta', 'Resultado', 'Detalle'], filas: q.secciones.map((s) => [s.nombre, s.pregunta, s.resultado, s.detalle.join(' | ')]) }] });
      sec.push({ titulo: 'Datos faltantes', parrafos: [], tablas: [{ titulo: 'Datos faltantes', columnas: ['Prioridad', 'Dato', 'Afecta', 'Cómo proporcionarlo'], filas: q.faltantes.map((x) => [x.prioridad, x.dato, x.afecta, x.como]) }] });
      sec.push({ titulo: 'Egresos duplicados detectados', parrafos: [], tablas: [{ titulo: 'Duplicados', columnas: ['Est.', 'Periodo', 'Descripción', 'Monto', 'Registro excluido', 'Registro conservado'], filas: q.duplicados.map((x) => [x.est, x.periodo, x.descripcion, x.monto, x.origen, x.conservado]) }] });
      sec.push({ titulo: 'Observaciones por hoja', parrafos: [], tablas: [{ titulo: 'Mensajes', columnas: ['Nivel', 'Archivo', 'Hoja', 'Fila', 'Mensaje'], filas: q.mensajes.map((m: any) => [m.nivel, m.archivo, m.hoja, m.fila ?? null, m.texto]) }] });
      break;
    }
    case 'ejecutivo': {
      const tot = tablaMensual(d, f).map((t) => t[f.est ?? 'TOTAL'] as ResumenMes).filter((r) => r?.operando);
      const suma = (k: keyof ResumenMes) => tot.reduce((a, r) => a + (((r[k] as V).v) ?? 0), 0);
      const r = cm.resumen;
      const topU = ranking(d, f, 'utilidad', 5), caida = ranking(d, f, 'caida', 5), lento = ranking(d, f, 'rotacion', 500);
      const sf = situacionFinanciera(d, ult, f.est ?? 'TOTAL');
      const lq = liquidez(d, ult, f.est ?? 'TOTAL');
      sec.push({ titulo: '1. Resumen ejecutivo', parrafos: [
        `Ventas netas acumuladas: ${bs(suma('ventas_netas'))} en ${tot.length} mes(es) con operaciones. Utilidad bruta: ${bs(suma('utilidad_bruta'))}${tot.some((x) => x.utilidad_bruta.e === 'parcial') ? ' (parcial: hay ventas sin costo registrado)' : ''}.`,
        `Utilidad operativa de los meses con gastos registrados: ${bs(tot.filter((x) => x.utilidad_operativa.v !== null).reduce((a, x) => a + x.utilidad_operativa.v!, 0))}. Meses sin rendición de gastos: ${tot.filter((x) => x.gastos_operativos.v === null).map((x) => x.nombre).join(', ') || 'ninguno'}.`,
        `Mejor mes en ventas: ${r.ventas_netas.mejor ? `${nombrePeriodo(r.ventas_netas.mejor.periodo)} (${bs(r.ventas_netas.mejor.v)})` : 'N/D'}; peor mes: ${r.ventas_netas.peor ? `${nombrePeriodo(r.ventas_netas.peor.periodo)} (${bs(r.ventas_netas.peor.v)})` : 'N/D'} (se excluyen meses con registro parcial: ${r.ventas_netas.excluidos.map(nombrePeriodo).join(', ') || 'ninguno'}).`,
        `Alertas: ${alertas.filter((a) => a.severidad === 'critica').length} críticas, ${alertas.filter((a) => a.severidad === 'advertencia').length} advertencias, ${alertas.filter((a) => a.severidad === 'positiva').length} positivas.`,
      ], tablas: [] });
      const serie = (k: string, n: string): Tabla => ({ titulo: n, columnas: ['Periodo', 'Valor', 'Var. abs.', 'Var. %', 'Registro'], filas: cm.filas.map((x: any) => [x.nombre, x[k].v, x[k].var_abs, x[k].var_pct, x.parcial ? 'parcial' : 'completo']) });
      sec.push({ titulo: '2. Evolución de ventas', parrafos: [FORMULAS.ventas_netas], tablas: [serie('ventas_netas', 'Ventas netas'), serie('unidades', 'Unidades')] });
      sec.push({ titulo: '3. Evolución de costos', parrafos: [FORMULAS.costo_ventas, 'Método de valuación: costo estándar del proveedor por presentación (tabla COSTOS AURELLA).'], tablas: [{ titulo: 'Costo de ventas', columnas: ['Periodo', 'Costo', '% sobre ventas', 'Cobertura de costeo %'], filas: tot.map((x) => [x.nombre + marca(x.costo_ventas), x.costo_ventas.v, x.costo_ventas.v !== null && x.ventas_netas.v ? Math.round((x.costo_ventas.v / x.ventas_netas.v) * 10000) / 100 : null, x.cobertura_costeo.v]) }] });
      sec.push({ titulo: '4. Utilidad bruta', parrafos: [FORMULAS.utilidad_bruta, FORMULAS.margen_bruto], tablas: [serie('utilidad_bruta', 'Utilidad bruta'), serie('margen_bruto', 'Margen bruto %')] });
      sec.push({ titulo: '5. Utilidad operativa', parrafos: [FORMULAS.utilidad_operativa, FORMULAS.margen_operativo], tablas: [serie('utilidad_operativa', 'Utilidad operativa'), serie('margen_operativo', 'Margen operativo %')] });
      sec.push({ ...secGastos(d, f), titulo: '6. Gastos' });
      sec.push({ titulo: '7. Inventarios', parrafos: secInventarios(d, f)[0]?.parrafos.slice(0, 3) ?? [], tablas: [] });
      sec.push({ titulo: '8. Rentabilidad', parrafos: [FORMULAS.rentabilidad_producto], tablas: [{ titulo: 'Por presentación', columnas: ['Presentación', 'Ventas', 'Utilidad', 'Margen %'], filas: porDimension(d, f, 'presentacion').map((x) => [x.clave, x.ventas, x.utilidad, x.margen]) }] });
      sec.push({ titulo: '9. Liquidez', parrafos: [sf.nota ?? '', `Fondo de caja al cierre de ${nombrePeriodo(ult)}: ${bs(sf.activos[0].valor.v)}.`], tablas: [{ titulo: 'Indicadores', columnas: ['Indicador', 'Valor', 'Observación'], filas: lq.indicadores.map((i) => [i.nombre, cel(i.valor), i.valor.m ?? '']) }, { titulo: 'Flujo neto registrado', columnas: ['Periodo', 'Flujo', 'Fondo de caja'], filas: lq.serie.map((x: any) => [nombrePeriodo(x.periodo), x.flujo_neto, x.fondo_caja]) }] });
      sec.push({ ...secComparativo(d, { ...f, est: undefined })[0], titulo: '10. Comparación Cochabamba vs La Paz' });
      sec.push({ titulo: '11. Productos destacados', parrafos: [], tablas: [{ titulo: topU.titulo, columnas: ['Producto', 'Marca', 'Ventas', 'Utilidad', 'Margen %'], filas: topU.filas.map((p) => [p.producto, p.marca, p.ventas, p.utilidad, p.margen]) }] });
      sec.push({ titulo: '12. Productos problemáticos', parrafos: [caida.disponible ? '' : caida.motivo ?? '', lento.nota ?? ''], tablas: [
        { titulo: 'Mayor caída vs mes anterior', columnas: ['Producto', 'Ventas mes ant.', 'Ventas último mes', 'Var. %'], filas: caida.filas.map((p) => [p.producto, p.ventas_ant, p.ventas_ult, p.crecimiento]) },
        { titulo: 'Menor velocidad de venta', columnas: ['Producto', 'Unidades', 'u./mes'], filas: [...lento.filas].reverse().slice(0, 10).map((p) => [p.producto, p.unidades, p.velocidad]) },
      ] });
      sec.push({ titulo: '13. Alertas', parrafos: [], tablas: [{ titulo: 'Alertas', columnas: ['Severidad', 'Periodo', 'Est.', 'Alerta', 'Detalle'], filas: alertas.slice(0, 40).map((a) => [a.severidad, a.periodo, a.est, a.titulo, a.mensaje]) }] });
      sec.push({ titulo: '14. Tendencias', parrafos: Object.entries(cm.resumen).map(([k, v]: any) => `${k.replace(/_/g, ' ')}: promedio ${v.promedio ?? 'N/D'}; mejor ${v.mejor ? nombrePeriodo(v.mejor.periodo) : 'N/D'}; peor ${v.peor ? nombrePeriodo(v.peor.periodo) : 'N/D'}.`), tablas: [] });
      sec.push({ titulo: '15. Recomendaciones', parrafos: recomendaciones(db, d, f).map((x, i) => `${i + 1}. ${x}`), tablas: [] });
      sec.push({ titulo: '16. Datos faltantes', parrafos: [], tablas: [{ titulo: 'Datos faltantes', columnas: ['Prioridad', 'Dato', 'Afecta'], filas: datosFaltantes(d).map((x) => [x.prioridad, x.dato, x.afecta]) }] });
      break;
    }
  }
  return { titulo, subtitulo: sub, secciones: sec };
}

// ---------- Renderizadores ----------
function aXlsx(doc: Documento): Buffer {
  const wb = XLSX.utils.book_new();
  const portada: Celda[][] = [[doc.titulo], [doc.subtitulo], [], ['Valores "N/D" = dato no disponible (ver observaciones). Filas con * = valor parcial.'], []];
  for (const s of doc.secciones) { portada.push([s.titulo]); for (const p of s.parrafos.filter(Boolean)) portada.push(['', p]); portada.push([]); }
  const ws0 = XLSX.utils.aoa_to_sheet(portada);
  ws0['!cols'] = [{ wch: 45 }, { wch: 120 }];
  XLSX.utils.book_append_sheet(wb, ws0, 'Informe');
  const usados = new Set<string>(['Informe']);
  for (const s of doc.secciones) for (const t of s.tablas) {
    let nombre = t.titulo.replace(/[\\/?*[\]:]/g, ' ').slice(0, 28).trim() || 'Tabla';
    let i = 2;
    while (usados.has(nombre)) nombre = `${nombre.slice(0, 25)} ${i++}`;
    usados.add(nombre);
    const ws = XLSX.utils.aoa_to_sheet([[`${s.titulo} — ${t.titulo}`], [], t.columnas, ...t.filas]);
    ws['!cols'] = t.columnas.map((c, j) => ({ wch: Math.min(60, Math.max(c.length + 2, ...t.filas.slice(0, 200).map((f) => String(f[j] ?? '').length + 2), 10)) }));
    XLSX.utils.book_append_sheet(wb, ws, nombre);
  }
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

function aCsv(doc: Documento): Buffer {
  const esc = (v: Celda) => { const s = v === null ? '' : typeof v === 'number' ? String(v).replace('.', ',') : String(v); return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const lineas: string[] = [esc(doc.titulo), esc(doc.subtitulo), ''];
  for (const s of doc.secciones) {
    lineas.push(esc(s.titulo));
    for (const p of s.parrafos.filter(Boolean)) lineas.push(esc(p));
    for (const t of s.tablas) { lineas.push(esc(t.titulo), t.columnas.map(esc).join(';'), ...t.filas.map((f) => f.map(esc).join(';')), ''); }
    lineas.push('');
  }
  return Buffer.from('﻿' + lineas.join('\r\n'), 'utf8');
}

function aPdf(doc: Documento): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const pdf = new PDFDocument({ size: 'A4', margin: 40, bufferPages: true, info: { Title: doc.titulo, Author: config.empresa.razon_social } });
    const chunks: Buffer[] = [];
    pdf.on('data', (c) => chunks.push(c));
    pdf.on('end', () => resolve(Buffer.concat(chunks)));
    pdf.on('error', reject);
    const AZUL = '#0f2340', ORO = '#b8892b', GRIS = '#5b6472';
    const ancho = pdf.page.width - 80;
    pdf.rect(0, 0, pdf.page.width, 90).fill(AZUL);
    pdf.fillColor('#ffffff').fontSize(18).font('Helvetica-Bold').text(`${config.empresa.razon_social} · ${config.empresa.nombre_comercial}`, 40, 28);
    pdf.fontSize(12).font('Helvetica').fillColor('#e8d9b0').text(doc.titulo, 40, 54);
    pdf.moveDown(3);
    pdf.fillColor(GRIS).fontSize(8.5).text(doc.subtitulo, 40, 104, { width: ancho });
    pdf.text('Valores "N/D" = dato no disponible. * = valor parcial. Ningún valor es estimado.', { width: ancho });
    pdf.moveDown(0.8);
    const fmt = (v: Celda, col: string) => (v === null ? 'N/D' : typeof v === 'number' ? (/%/.test(col) ? pc(v) : /unid|u\.|inicial|compras$|vendidas|teórico|físico|diferencia|devol|bajas|transf|l[ií]neas/i.test(col) && Number.isInteger(v) ? v.toLocaleString('es-BO') : bs(v)) : String(v));
    for (const s of doc.secciones) {
      if (pdf.y > pdf.page.height - 140) pdf.addPage();
      pdf.moveDown(0.5).fillColor(AZUL).font('Helvetica-Bold').fontSize(12.5).text(s.titulo, { width: ancho });
      pdf.moveTo(40, pdf.y + 2).lineTo(40 + ancho, pdf.y + 2).strokeColor(ORO).lineWidth(1).stroke();
      pdf.moveDown(0.4);
      pdf.font('Helvetica').fontSize(9).fillColor('#222');
      for (const p of s.parrafos.filter(Boolean)) pdf.text(p, { width: ancho, align: 'justify' }).moveDown(0.25);
      for (const t of s.tablas) {
        if (!t.filas.length) continue;
        if (pdf.y > pdf.page.height - 120) pdf.addPage();
        pdf.moveDown(0.3).font('Helvetica-Bold').fontSize(9.5).fillColor(AZUL).text(t.titulo);
        const n = t.columnas.length;
        const primera = Math.min(ancho * 0.36, Math.max(90, ancho / n * 1.6));
        const resto = (ancho - primera) / Math.max(n - 1, 1);
        const anchos = [primera, ...Array(n - 1).fill(resto)];
        const fs2 = n > 8 ? 6.5 : n > 5 ? 7.5 : 8.5;
        const fila = (vals: string[], cab: boolean) => {
          pdf.font(cab ? 'Helvetica-Bold' : 'Helvetica').fontSize(fs2);
          const h = Math.max(...vals.map((v, j) => pdf.heightOfString(v, { width: anchos[j] - 6 }))) + 5;
          if (pdf.y + h > pdf.page.height - 50) pdf.addPage();
          const y = pdf.y;
          if (cab) pdf.rect(40, y, ancho, h).fill('#eef1f6');
          let x = 40;
          vals.forEach((v, j) => {
            pdf.fillColor(cab ? AZUL : v === 'N/D' ? '#a15c00' : '#222').text(v, x + 3, y + 2.5, { width: anchos[j] - 6, align: j === 0 ? 'left' : 'right' });
            x += anchos[j];
          });
          pdf.y = y + h;
          pdf.moveTo(40, pdf.y).lineTo(40 + ancho, pdf.y).strokeColor('#dde2ea').lineWidth(0.5).stroke();
        };
        fila(t.columnas, true);
        for (const f of t.filas.slice(0, 300)) fila(f.map((v, j) => (j === 0 ? String(v ?? '') : fmt(v, t.columnas[j]))), false);
        if (t.filas.length > 300) pdf.fontSize(7.5).fillColor(GRIS).text(`… ${t.filas.length - 300} filas más en la versión Excel.`);
        pdf.x = 40;
        pdf.moveDown(0.5);
      }
    }
    const rango = pdf.bufferedPageRange();
    for (let i = rango.start; i < rango.start + rango.count; i++) {
      pdf.switchToPage(i);
      pdf.fontSize(7.5).fillColor(GRIS).text(`${config.empresa.razon_social} · ${doc.titulo} · Página ${i + 1} de ${rango.count}`, 40, pdf.page.height - 30, { width: ancho, align: 'center', lineBreak: false });
    }
    pdf.end();
  });
}

export async function generarReporte(db: Db, d: Datos, tipo: string, formato: 'xlsx' | 'pdf' | 'csv', f: Filtro) {
  const doc = construir(db, d, tipo, f);
  const base = `${config.empresa.nombre_comercial}_${tipo}_${new Date().toISOString().slice(0, 10)}`;
  if (formato === 'xlsx') return { buffer: aXlsx(doc), mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', nombre: `${base}.xlsx` };
  if (formato === 'csv') return { buffer: aCsv(doc), mime: 'text/csv; charset=utf-8', nombre: `${base}.csv` };
  return { buffer: await aPdf(doc), mime: 'application/pdf', nombre: `${base}.pdf` };
}

