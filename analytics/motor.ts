// Motor financiero: ventas, costos, rentabilidad, gastos, inventario, caja. Principio: si falta un dato,
// el indicador queda "nd" (no disponible) con el motivo y el dato requerido; nunca se estima.
import type { Datos, Egreso, Venta } from './datos.ts';
import { NOMBRE_MES, redondear } from '../importers/utilidades.ts';

export type Estado = 'ok' | 'parcial' | 'nd' | 'sin_operacion';
export type V = { v: number | null; e: Estado; m?: string };
export const ok = (v: number): V => ({ v: redondear(v), e: 'ok' });
export const nd = (m: string): V => ({ v: null, e: 'nd', m });
const parcial = (v: number, m: string): V => ({ v: redondear(v), e: 'parcial', m });
const sinOp = (): V => ({ v: null, e: 'sin_operacion', m: 'El establecimiento no operaba en este periodo.' });

export type Filtro = {
  desde?: string; hasta?: string; periodos?: string[]; est?: string; producto_id?: number; marca?: string; categoria?: string; presentacion?: string;
};

export const FORMULAS: Record<string, string> = {
  ventas_netas: 'Ventas netas = Σ total de cada línea de venta registrada (incluye devoluciones con signo negativo)',
  ventas_lista: 'Ventas a precio de lista = Σ (unidades × precio público de su presentación, según tabla de costos)',
  descuento_implicito: 'Descuento implícito = Σ máx(0, unidades × precio público − total cobrado)',
  unidades: 'Unidades vendidas = Σ cantidad de líneas con precio > 0 (sin obsequios)',
  precio_promedio: 'Precio promedio = Ventas netas ÷ Unidades vendidas',
  ticket_promedio: 'Ticket promedio = Ventas netas ÷ N° de tickets',
  costo_ventas: 'Costo de ventas = Σ (unidades × costo unitario de la presentación)  [método: costo estándar del proveedor]',
  utilidad_bruta: 'Utilidad bruta = Ventas netas − Costo de ventas',
  margen_bruto: 'Margen bruto = Utilidad bruta ÷ Ventas netas × 100',
  gastos_operativos: 'Gastos operativos = Σ egresos clasificados como gasto operativo (excluye pagos de mercadería e inversiones)',
  utilidad_operativa: 'Utilidad operativa = Utilidad bruta − Gastos operativos',
  margen_operativo: 'Margen operativo = Utilidad operativa ÷ Ventas netas × 100',
  compras_pagadas: 'Pagos de mercadería = Σ egresos clasificados como compra de mercadería',
  flujo_neto: 'Flujo neto registrado = Ventas netas − Gastos operativos − Pagos de mercadería − Inversiones pagadas con fondos de la operación (la inversión inicial de socios no se descuenta)',
  fondo_caja: 'Fondo de caja = último "FONDO DE CAJA" registrado en el cierre diario del mes',
  ajustes: 'Los ajustes de inventario se suman con su signo al inventario teórico',
  mercaderia_disponible: 'Mercadería disponible = Inventario inicial + Compras + Transferencias recibidas − Transferencias enviadas',
  inventario_teorico: 'Inventario final teórico = Mercadería disponible − Unidades vendidas − Devoluciones − Bajas',
  diferencia_inventario: 'Diferencia de inventario = Inventario físico − Inventario teórico',
  rentabilidad_producto: 'Rentabilidad del producto = Utilidad bruta del producto ÷ Ventas netas del producto × 100',
};

export function periodosFiltro(d: Datos, f: Filtro): string[] {
  let ps = d.periodos;
  if (f.periodos?.length) ps = ps.filter((p) => f.periodos!.includes(p));
  if (f.desde) ps = ps.filter((p) => p >= f.desde!);
  if (f.hasta) ps = ps.filter((p) => p <= f.hasta!);
  return ps;
}

export function nombrePeriodo(p: string): string {
  return `${NOMBRE_MES[Number(p.slice(5, 7))]} ${p.slice(0, 4)}`;
}

function filtroProducto(f: Filtro) {
  return (v: Venta) => (!f.producto_id || v.producto_id === f.producto_id) && (!f.marca || v.marca === f.marca)
    && (!f.categoria || v.categoria === f.categoria) && (!f.presentacion || v.presentacion === f.presentacion);
}
export function hayFiltroProducto(f: Filtro) { return !!(f.producto_id || f.marca || f.categoria || f.presentacion); }

// ---------- Agregación de ventas y costo ----------
export type AggVentas = {
  lineas: number; ventas_netas: number; devoluciones: number; unidades: number; obsequios: number; tickets: number;
  ventas_lista: number; descuento: number; lineas_con_lista: number;
  costo: number; ventas_costeadas: number; unidades_costeadas: number;
  sin_costo: { lineas: number; unidades: number; ventas: number; motivos: Record<string, number> };
  por_medio: Record<string, number>;
};

export function motivoSinCosto(v: Venta, d: Datos): string | null {
  if (!d.metodoValuacion) return 'método de valuación no definido';
  if (d.metodoValuacion !== 'COSTO_ESTANDAR_PROVEEDOR') return `método ${d.metodoValuacion} requiere compras valorizadas en unidades`;
  if (!v.presentacion) return 'venta sin producto identificado';
  if (v.presentacion === 'GIFT_CARD') return 'tarjeta de regalo (anticipo de cliente, no es mercadería)';
  if (v.cantidad === null) return 'cantidad no registrada';
  if (v.costo_unitario === null) {
    if (d.costos.has(v.presentacion)) return `costo vacío para ${v.presentacion}`;
    if (/^PERFUME_\d+$/.test(v.presentacion) && ![10, 50, 100].includes(Number(v.presentacion.split('_')[1]))) return `tamaño no estándar (${v.presentacion.split('_')[1]} ml)`;
    return `presentación sin costo en la tabla (${v.presentacion})`;
  }
  return null;
}

export function agregarVentas(rows: Venta[], d: Datos): AggVentas {
  const a: AggVentas = {
    lineas: rows.length, ventas_netas: 0, devoluciones: 0, unidades: 0, obsequios: 0, tickets: 0, ventas_lista: 0, descuento: 0,
    lineas_con_lista: 0, costo: 0, ventas_costeadas: 0, unidades_costeadas: 0,
    sin_costo: { lineas: 0, unidades: 0, ventas: 0, motivos: {} }, por_medio: {},
  };
  const tickets = new Set<string>();
  for (const v of rows) {
    a.ventas_netas += v.total;
    if (v.es_devolucion) a.devoluciones += v.total;
    if (v.ticket) tickets.add(`${v.est}|${v.ticket}`);
    const medio = v.tipo_pago ?? 'SIN MEDIO';
    a.por_medio[medio] = (a.por_medio[medio] || 0) + v.total;
    const q = v.cantidad ?? 0;
    if (v.es_obsequio) a.obsequios += q;
    else if (v.categoria !== 'Accesorio') a.unidades += q;
    if (!v.es_obsequio && v.precio_lista !== null && v.cantidad !== null) {
      a.ventas_lista += q * v.precio_lista;
      a.descuento += Math.max(0, q * v.precio_lista - v.total);
      a.lineas_con_lista++;
    }
    const motivo = motivoSinCosto(v, d);
    if (motivo === null) {
      a.costo += q * v.costo_unitario!;
      a.ventas_costeadas += v.total;
      a.unidades_costeadas += q;
    } else if (v.total !== 0 || q !== 0) {
      a.sin_costo.lineas++;
      a.sin_costo.unidades += q;
      a.sin_costo.ventas += v.total;
      a.sin_costo.motivos[motivo] = (a.sin_costo.motivos[motivo] || 0) + 1;
    }
  }
  a.tickets = tickets.size;
  return a;
}

function textoSinCosto(a: AggVentas): string {
  const mot = Object.entries(a.sin_costo.motivos).map(([k, n]) => `${k}: ${n}`).join('; ');
  return `${a.sin_costo.lineas} línea(s) sin costo (${redondear(a.sin_costo.unidades)} u., Bs ${redondear(a.sin_costo.ventas)} de venta) — ${mot}. La utilidad bruta está sobrestimada en el costo no registrado de esas líneas.`;
}

// ---------- Gastos operativos por establecimiento y mes ----------
export type AggGastos = { total: V; fuente: string | null; por_categoria: Record<string, number>; lineas: Egreso[]; usd_sin_tc: number };

export function egresosVigentes(d: Datos): Egreso[] {
  return d.egresos.filter((e) => e.estado === 'valido' || e.estado === 'observado');
}

export function hayRendicion(d: Datos, est: string, periodo: string): boolean {
  return d.egresos.some((e) => e.est === est && e.periodo === periodo && e.origen !== 'inversion');
}

export function gastosOperativos(d: Datos, est: string, periodo: string): AggGastos {
  const todos = egresosVigentes(d).filter((e) => e.est === est && e.periodo === periodo && e.origen !== 'inversion');
  const detalle = todos.filter((e) => e.nivel === 'detalle');
  const usar = detalle.length ? detalle : todos.filter((e) => e.nivel === 'resumen');
  const fuente = detalle.length ? 'detalle' : usar.length ? 'resumen' : null;
  const op = usar.filter((e) => e.clase === 'gasto_operativo');
  const usd = op.filter((e) => e.monto_bob === null);
  const por: Record<string, number> = {};
  for (const e of op) if (e.monto_bob !== null) por[e.categoria] = (por[e.categoria] || 0) + e.monto_bob;
  const suma = op.reduce((s, e) => s + (e.monto_bob ?? 0), 0);
  let total: V;
  if (!hayRendicion(d, est, periodo)) total = nd(`No hay rendición de gastos de ${est} para ${nombrePeriodo(periodo)}.`);
  else if (usd.length) total = parcial(suma, `${usd.length} gasto(s) en USD sin tipo de cambio registrado.`);
  else if (fuente === 'resumen') total = { ...ok(suma), m: 'Tomado del resumen mensual de gastos (sin detalle de comprobantes).' };
  else total = ok(suma);
  return { total, fuente, por_categoria: por, lineas: op, usd_sin_tc: usd.reduce((s, e) => s + e.monto, 0) };
}

function sumaClase(d: Datos, est: string, periodo: string, clases: string[], incluirInversion: boolean): V {
  if (!hayRendicion(d, est, periodo) && !incluirInversion) return nd(`No hay rendición de egresos de ${est} para ${nombrePeriodo(periodo)}.`);
  const todos = egresosVigentes(d).filter((e) => e.est === est && e.periodo === periodo && (incluirInversion || e.origen !== 'inversion'));
  const detalle = todos.filter((e) => e.nivel === 'detalle');
  const usar = (detalle.length ? detalle : todos.filter((e) => e.nivel === 'resumen')).filter((e) => clases.includes(e.clase));
  const usd = usar.filter((e) => e.monto_bob === null);
  const s = usar.reduce((t, e) => t + (e.monto_bob ?? 0), 0);
  return usd.length ? parcial(s, `${usd.length} egreso(s) en USD sin tipo de cambio.`) : ok(s);
}

// ---------- Cobertura del periodo ----------
export function periodosOperacion(d: Datos, est: string): string[] {
  const ps = [...new Set(d.ventas.filter((v) => v.est === est).map((v) => v.periodo))].sort();
  if (!ps.length) return [];
  return d.periodos.filter((p) => p >= ps[0]);
}

export function cobertura(d: Datos, est: string, periodo: string) {
  const fechas = d.ventas.filter((v) => v.est === est && v.periodo === periodo && v.fecha).map((v) => v.fecha!).sort();
  if (!fechas.length) return { primer_dia: null, ultimo_dia: null, dias_con_ventas: 0, parcial: true, motivo: 'Sin ventas registradas en el periodo.' };
  const dias = new Set(fechas).size;
  const [y, m] = periodo.split('-').map(Number);
  const diasMes = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const primero = Number(fechas[0].slice(8, 10));
  const ultimo = Number(fechas[fechas.length - 1].slice(8, 10));
  const esParcial = primero > 4 || ultimo < diasMes - 3;
  return {
    primer_dia: fechas[0], ultimo_dia: fechas[fechas.length - 1], dias_con_ventas: dias, parcial: esParcial,
    motivo: esParcial ? `Registro parcial: ventas del ${primero} al ${ultimo} de ${NOMBRE_MES[m]}.` : null,
  };
}

// ---------- Inventario ----------
export type InvProducto = {
  producto_id: number | null; producto: string; inicial: number | null; compras: number; t_in: number; t_out: number; vendidas: number;
  devoluciones: number; bajas: number; disponible: number | null; teorico: number | null; fisico: number | null; diferencia: number | null;
  costo_unitario: number | null;
};

export function inventarioPeriodo(d: Datos, est: string, periodo: string, f: Filtro = {}): { hay: boolean; productos: InvProducto[]; faltantes: string[] } {
  const movs = d.movimientos.filter((m) => m.est === est && (!f.producto_id || m.producto_id === f.producto_id));
  const delPer = movs.filter((m) => m.periodo === periodo);
  if (!movs.length) return { hay: false, productos: [], faltantes: [`Inventario inicial, compras en unidades e inventario físico de ${est} (${nombrePeriodo(periodo)})`] };
  const claves = new Set(movs.map((m) => `${m.producto_id}|${m.producto}`));
  const res: InvProducto[] = [];
  const faltantes: string[] = [];
  const anteriores = [...new Set(movs.map((m) => m.periodo))].filter((p) => p < periodo).sort();
  for (const k of claves) {
    const [pidS, nombre] = k.split('|');
    const pid = pidS === 'null' ? null : Number(pidS);
    const mp = delPer.filter((m) => `${m.producto_id}|${m.producto}` === k);
    const s = (t: string[]) => mp.filter((m) => t.includes(m.tipo)).reduce((a, m) => a + m.cantidad, 0);
    let inicial: number | null = mp.some((m) => m.tipo === 'INVENTARIO_INICIAL') ? s(['INVENTARIO_INICIAL']) : null;
    if (inicial === null && anteriores.length) {
      const ult = anteriores[anteriores.length - 1];
      const fis = movs.filter((m) => `${m.producto_id}|${m.producto}` === k && m.periodo === ult && m.tipo === 'INVENTARIO_FISICO');
      if (fis.length) inicial = fis.reduce((a, m) => a + m.cantidad, 0);
    }
    const vendidas = d.ventas.filter((v) => v.est === est && v.periodo === periodo && v.producto_id === pid && !v.es_obsequio)
      .reduce((a, v) => a + (v.cantidad ?? 0), 0);
    const compras = s(['COMPRA']), t_in = s(['TRANSFERENCIA_ENTRADA']), t_out = s(['TRANSFERENCIA_SALIDA']);
    const devol = s(['DEVOLUCION']), bajas = s(['BAJA', 'DANADO', 'PERDIDA']), ajustes = s(['AJUSTE']);
    const fisico = mp.some((m) => m.tipo === 'INVENTARIO_FISICO') ? s(['INVENTARIO_FISICO']) : null;
    const disponible = inicial === null ? null : inicial + compras + t_in - t_out;
    const teorico = disponible === null ? null : disponible - vendidas - devol - bajas + ajustes;
    if (inicial === null) faltantes.push(`Inventario inicial de "${nombre}" en ${est} (${nombrePeriodo(periodo)})`);
    if (fisico === null) faltantes.push(`Inventario físico de "${nombre}" en ${est} al cierre de ${nombrePeriodo(periodo)}`);
    const costo = mp.find((m) => m.costo_unitario !== null)?.costo_unitario ?? null;
    res.push({
      producto_id: pid, producto: nombre, inicial, compras, t_in, t_out, vendidas, devoluciones: devol, bajas, disponible, teorico, fisico,
      diferencia: fisico !== null && teorico !== null ? fisico - teorico : null, costo_unitario: costo,
    });
  }
  return { hay: true, productos: res, faltantes };
}

// ---------- Resumen mensual por establecimiento ----------
export type ResumenMes = {
  periodo: string; nombre: string; est: string; operando: boolean; cobertura: ReturnType<typeof cobertura> | null;
  ventas_netas: V; ventas_lista: V; descuento_implicito: V; devoluciones: V; unidades: V; obsequios: V; tickets: V; ticket_promedio: V;
  precio_promedio: V; costo_ventas: V; cobertura_costeo: V; utilidad_bruta: V; margen_bruto: V; gastos_operativos: V; gastos_fuente: string | null;
  gastos_categoria: Record<string, number>; utilidad_operativa: V; margen_operativo: V; compras_pagadas: V; inversion_pagada: V;
  flujo_neto: V; fondo_caja: V; bancos: V; caja_bancos: V; cxc: V; cxp: V; prestamos: V;
  inv_inicial: V; inv_compras: V; inv_t_in: V; inv_t_out: V; inv_final_teorico: V; inv_fisico: V; inv_diferencia: V;
  por_medio: Record<string, number>; faltantes: string[]; notas: string[];
};

function saldoPeriodo(d: Datos, est: string, periodo: string, concepto: string): V {
  const s = d.saldos.filter((x) => x.est === est && x.periodo === periodo && x.concepto === concepto);
  if (!s.length) return nd(`Falta el saldo de ${concepto} de ${est} al cierre de ${nombrePeriodo(periodo)}.`);
  // si hay varios registros del mismo concepto y periodo (p. ej. varias cuentas bancarias) se suman; si tienen fecha, se toma la última fecha
  const fechas = s.filter((x) => x.fecha).map((x) => x.fecha!).sort();
  const usar = fechas.length ? s.filter((x) => x.fecha === fechas[fechas.length - 1] || !x.fecha) : s;
  return ok(usar.reduce((a, x) => a + x.monto, 0));
}

export function resumenMes(d: Datos, est: string, periodo: string, f: Filtro = {}): ResumenMes {
  const operando = periodosOperacion(d, est).includes(periodo);
  const faltantes: string[] = [];
  const notas: string[] = [];
  const rows = d.ventas.filter((v) => v.est === est && v.periodo === periodo).filter(filtroProducto(f));
  const a = agregarVentas(rows, d);
  const cob = operando ? cobertura(d, est, periodo) : null;
  if (cob?.parcial && cob.motivo) notas.push(cob.motivo);
  const base = { periodo, nombre: nombrePeriodo(periodo), est, operando, cobertura: cob };
  if (!operando) {
    const s = sinOp();
    return {
      ...base, ventas_netas: s, ventas_lista: s, descuento_implicito: s, devoluciones: s, unidades: s, obsequios: s, tickets: s, ticket_promedio: s,
      precio_promedio: s, costo_ventas: s, cobertura_costeo: s, utilidad_bruta: s, margen_bruto: s, gastos_operativos: s, gastos_fuente: null,
      gastos_categoria: {}, utilidad_operativa: s, margen_operativo: s, compras_pagadas: s, inversion_pagada: sumaClase(d, est, periodo, ['inversion_activo', 'preoperativo'], true),
      flujo_neto: s, fondo_caja: s, bancos: s, caja_bancos: s, cxc: s, cxp: s, prestamos: s, inv_inicial: s, inv_compras: s, inv_t_in: s, inv_t_out: s,
      inv_final_teorico: s, inv_fisico: s, inv_diferencia: s, por_medio: {}, faltantes, notas,
    };
  }
  const ventas = ok(a.ventas_netas);
  const unidades = ok(a.unidades);
  // Costo
  let costo: V, ub: V, mb: V, cobCosteo: V;
  if (!d.metodoValuacion) {
    costo = nd('No se ha definido el método de valuación del costo (cargue la tabla de costos o indíquelo en Configuración).');
    faltantes.push('Método de valuación del costo de ventas / tabla de costos por presentación');
    ub = nd('Requiere el costo de ventas.'); mb = nd('Requiere el costo de ventas.'); cobCosteo = nd('Sin método de costeo.');
  } else if (a.lineas && a.ventas_costeadas === 0 && a.costo === 0) {
    costo = nd(textoSinCosto(a)); ub = nd('Requiere el costo de ventas.'); mb = nd('Requiere el costo de ventas.'); cobCosteo = ok(0);
  } else {
    const pct = a.ventas_netas ? (a.ventas_costeadas / a.ventas_netas) * 100 : 100;
    cobCosteo = ok(pct);
    if (a.sin_costo.lineas) {
      costo = parcial(a.costo, textoSinCosto(a));
      ub = parcial(a.ventas_netas - a.costo, textoSinCosto(a));
      mb = a.ventas_netas ? parcial(((a.ventas_netas - a.costo) / a.ventas_netas) * 100, 'Calculado con costo parcial.') : nd('Sin ventas.');
    } else {
      costo = ok(a.costo);
      ub = ok(a.ventas_netas - a.costo);
      mb = a.ventas_netas ? ok(((a.ventas_netas - a.costo) / a.ventas_netas) * 100) : nd('Sin ventas.');
    }
  }
  // Gastos y utilidad operativa (no aplican con filtro de producto)
  let gastos: V, uo: V, mo: V, fuente: string | null = null, gcat: Record<string, number> = {};
  if (hayFiltroProducto(f)) {
    gastos = nd('Los gastos operativos no se asignan a productos, marcas o categorías.');
    uo = nd('Con filtro de producto solo se calcula hasta la utilidad bruta.'); mo = uo;
  } else {
    const g = gastosOperativos(d, est, periodo);
    gastos = g.total; fuente = g.fuente; gcat = g.por_categoria;
    if (g.total.e === 'nd') faltantes.push(`Rendición de gastos de ${est} de ${nombrePeriodo(periodo)}`);
    if (ub.v !== null && gastos.v !== null) {
      const est2: Estado = ub.e === 'parcial' || gastos.e === 'parcial' ? 'parcial' : 'ok';
      uo = { v: redondear(ub.v - gastos.v), e: est2, m: est2 === 'parcial' ? [ub.m, gastos.m].filter(Boolean).join(' ') : gastos.m };
      mo = a.ventas_netas ? { v: redondear(((ub.v - gastos.v) / a.ventas_netas) * 100), e: est2 } : nd('Sin ventas.');
    } else {
      uo = nd(ub.v === null ? 'Requiere la utilidad bruta.' : `Requiere los gastos operativos: ${gastos.m}`);
      mo = uo;
    }
  }
  const compras = hayFiltroProducto(f) ? nd('No aplica con filtro de producto.') : sumaClase(d, est, periodo, ['compra_mercaderia'], false);
  const inversion = hayFiltroProducto(f) ? nd('No aplica con filtro de producto.') : sumaClase(d, est, periodo, ['inversion_activo', 'preoperativo'], true);
  const inversionRendida = hayFiltroProducto(f) ? inversion : sumaClase(d, est, periodo, ['inversion_activo', 'preoperativo'], false);
  let flujo: V;
  if (hayFiltroProducto(f)) flujo = nd('No aplica con filtro de producto.');
  else if (gastos.v === null || compras.v === null) flujo = nd('Requiere la rendición completa de egresos del mes.');
  else {
    const e2: Estado = [gastos, compras, inversionRendida].some((x) => x.e === 'parcial') ? 'parcial' : 'ok';
    flujo = { v: redondear(a.ventas_netas - gastos.v - compras.v - (inversionRendida.v ?? 0)), e: e2, m: 'Aproximación de caja: ventas del mes menos gastos, pagos de mercadería e inversiones pagadas con fondos de la operación (no incluye la inversión inicial financiada por los socios, saldos iniciales ni cobros/pagos diferidos).' };
  }
  // Caja
  const fondos = d.control.filter((c) => c.est === est && c.periodo === periodo && c.concepto === 'fondo_caja' && c.fecha)
    .sort((x, y) => (x.fecha! + String(x.fila).padStart(6, '0')).localeCompare(y.fecha! + String(y.fila).padStart(6, '0')));
  const fondo: V = fondos.length ? { ...ok(fondos[fondos.length - 1].monto), m: `Fondo de caja del ${fondos[fondos.length - 1].fecha} (efectivo en tienda según cierre diario).` }
    : nd(`No hay "FONDO DE CAJA" registrado para ${est} en ${nombrePeriodo(periodo)}.`);
  const bancos = saldoPeriodo(d, est, periodo, 'BANCOS');
  if (bancos.e === 'nd') faltantes.push(`Saldo de bancos de ${est} al cierre de ${nombrePeriodo(periodo)}`);
  const cajaBancos: V = fondo.v !== null && bancos.v !== null ? ok(fondo.v + bancos.v)
    : fondo.v !== null ? parcial(fondo.v, 'Solo incluye el fondo de caja en efectivo; falta el saldo de bancos (los cobros por QR se depositan en banco).')
      : nd('Faltan el fondo de caja y el saldo de bancos.');
  const cxc = saldoPeriodo(d, est, periodo, 'CXC');
  const cxp = saldoPeriodo(d, est, periodo, 'CXP');
  const prest = saldoPeriodo(d, est, periodo, 'PRESTAMO');
  // Inventario
  const inv = inventarioPeriodo(d, est, periodo, f);
  let invI: V, invC: V, invTi: V, invTo: V, invT: V, invF: V, invD: V;
  if (!inv.hay) {
    const m = 'No se han proporcionado inventarios ni movimientos en unidades (compras, transferencias, conteos físicos).';
    invI = nd(m); invC = nd(m); invTi = nd(m); invTo = nd(m); invT = nd(m); invF = nd(m); invD = nd(m);
    faltantes.push(`Inventario inicial, compras en unidades e inventario físico de ${est} (${nombrePeriodo(periodo)})`);
  } else {
    const sumV = (k: keyof InvProducto): V => {
      const vals = inv.productos.map((p) => p[k] as number | null);
      if (vals.some((x) => x === null)) {
        const s = vals.reduce((t: number, x) => t + (x ?? 0), 0);
        return vals.every((x) => x === null) ? nd('Dato no disponible para ningún producto.') : parcial(s, `Dato faltante para ${vals.filter((x) => x === null).length} producto(s).`);
      }
      return ok(vals.reduce((t: number, x) => t + (x as number), 0));
    };
    invI = sumV('inicial'); invC = sumV('compras'); invTi = sumV('t_in'); invTo = sumV('t_out'); invT = sumV('teorico'); invF = sumV('fisico'); invD = sumV('diferencia');
    faltantes.push(...inv.faltantes.slice(0, 20));
  }
  return {
    ...base, ventas_netas: ventas, ventas_lista: a.lineas_con_lista ? ok(a.ventas_lista) : nd('Sin precios de lista.'),
    descuento_implicito: a.lineas_con_lista ? { ...ok(a.descuento), m: 'Diferencia contra el precio público de la tabla de costos (el archivo no indica vigencia de precios).' } : nd('Sin precios de lista.'),
    devoluciones: ok(a.devoluciones), unidades, obsequios: ok(a.obsequios), tickets: ok(a.tickets),
    ticket_promedio: a.tickets ? ok(a.ventas_netas / a.tickets) : nd('Sin tickets identificados.'),
    precio_promedio: a.unidades ? ok(a.ventas_netas / a.unidades) : nd('Sin unidades.'),
    costo_ventas: costo, cobertura_costeo: cobCosteo, utilidad_bruta: ub, margen_bruto: mb, gastos_operativos: gastos, gastos_fuente: fuente,
    gastos_categoria: gcat, utilidad_operativa: uo, margen_operativo: mo, compras_pagadas: compras, inversion_pagada: inversion, flujo_neto: flujo,
    fondo_caja: fondo, bancos, caja_bancos: cajaBancos, cxc, cxp, prestamos: prest,
    inv_inicial: invI, inv_compras: invC, inv_t_in: invTi, inv_t_out: invTo, inv_final_teorico: invT, inv_fisico: invF, inv_diferencia: invD,
    por_medio: a.por_medio, faltantes: [...new Set(faltantes)], notas,
  };
}

// Suma de establecimientos para el TOTAL EMPRESA. Las transferencias internas no generan ventas y en el
// inventario consolidado se anulan (salida en origen = entrada en destino), por lo que no se duplican.
const CAMPOS_SUMA = ['ventas_netas', 'ventas_lista', 'descuento_implicito', 'devoluciones', 'unidades', 'obsequios', 'tickets', 'costo_ventas',
  'utilidad_bruta', 'gastos_operativos', 'utilidad_operativa', 'compras_pagadas', 'inversion_pagada', 'flujo_neto', 'fondo_caja', 'bancos',
  'caja_bancos', 'cxc', 'cxp', 'prestamos', 'inv_inicial', 'inv_compras', 'inv_final_teorico', 'inv_fisico', 'inv_diferencia'] as const;

export function consolidar(partes: ResumenMes[], periodo: string): ResumenMes {
  const activas = partes.filter((p) => p.operando);
  const r: any = { periodo, nombre: nombrePeriodo(periodo), est: 'TOTAL', operando: activas.length > 0, cobertura: null, gastos_fuente: null, faltantes: [], notas: [] };
  if (!activas.length) {
    for (const k of Object.keys(partes[0])) if (!(k in r)) r[k] = sinOp();
    r.gastos_categoria = {}; r.por_medio = {};
    return r;
  }
  for (const k of CAMPOS_SUMA) {
    const vals = activas.map((p) => (p as any)[k] as V);
    if (vals.some((x) => x.e === 'nd')) {
      const faltan = activas.filter((p) => ((p as any)[k] as V).e === 'nd').map((p) => p.est);
      r[k] = nd(`Falta el dato en: ${faltan.join(', ')}. ${vals.find((x) => x.e === 'nd')?.m ?? ''}`.trim());
    } else {
      const s = vals.reduce((t, x) => t + (x.v ?? 0), 0);
      r[k] = vals.some((x) => x.e === 'parcial') ? parcial(s, vals.filter((x) => x.e === 'parcial').map((x) => x.m).join(' ')) : ok(s);
    }
  }
  // Transferencias: en el consolidado se anulan
  r.inv_t_in = { v: 0, e: 'ok', m: 'Las transferencias internas se eliminan en el consolidado.' };
  r.inv_t_out = r.inv_t_in;
  const vn = r.ventas_netas as V, ub = r.utilidad_bruta as V, uo = r.utilidad_operativa as V, un = r.unidades as V;
  r.margen_bruto = ub.v !== null && vn.v ? { v: redondear((ub.v / vn.v) * 100), e: ub.e } : nd(ub.m ?? 'Sin datos.');
  r.margen_operativo = uo.v !== null && vn.v ? { v: redondear((uo.v / vn.v) * 100), e: uo.e } : nd(uo.m ?? 'Sin datos.');
  r.precio_promedio = vn.v !== null && un.v ? ok(vn.v / un.v) : nd('Sin unidades.');
  const tk = r.tickets as V;
  r.ticket_promedio = vn.v !== null && tk.v ? ok(vn.v / tk.v) : nd('Sin tickets.');
  const costeadas = activas.reduce((t, p) => t + ((p.cobertura_costeo.v ?? 0) / 100) * (p.ventas_netas.v ?? 0), 0);
  r.cobertura_costeo = vn.v ? ok((costeadas / vn.v) * 100) : nd('Sin ventas.');
  r.gastos_categoria = {};
  r.por_medio = {};
  for (const p of activas) {
    for (const [k, v] of Object.entries(p.gastos_categoria)) r.gastos_categoria[k] = (r.gastos_categoria[k] || 0) + v;
    for (const [k, v] of Object.entries(p.por_medio)) r.por_medio[k] = (r.por_medio[k] || 0) + v;
  }
  r.gastos_fuente = [...new Set(activas.map((p) => p.gastos_fuente).filter(Boolean))].join(' + ') || null;
  r.faltantes = [...new Set(activas.flatMap((p) => p.faltantes))];
  r.notas = activas.flatMap((p) => p.notas.map((n) => `${p.est}: ${n}`));
  r.cobertura = { parcial: activas.some((p) => p.cobertura?.parcial) } as any;
  return r as ResumenMes;
}

export function tablaMensual(d: Datos, f: Filtro): { periodo: string; nombre: string; CBB?: ResumenMes; LPZ?: ResumenMes; TOTAL: ResumenMes; [k: string]: any }[] {
  const ests = d.establecimientos.map((e) => e.id).filter((id) => !f.est || f.est === 'TOTAL' || f.est === id);
  return periodosFiltro(d, f).map((p) => {
    const partes = ests.map((e) => resumenMes(d, e, p, f));
    const fila: any = { periodo: p, nombre: nombrePeriodo(p) };
    for (const x of partes) fila[x.est] = x;
    fila.TOTAL = consolidar(partes, p);
    return fila;
  });
}

// ---------- Comparación entre meses ----------
const METRICAS_COMP = ['ventas_netas', 'unidades', 'utilidad_bruta', 'margen_bruto', 'gastos_operativos', 'utilidad_operativa', 'margen_operativo', 'inv_final_teorico', 'flujo_neto'] as const;

export function comparacionMeses(d: Datos, f: Filtro, est = 'TOTAL') {
  const tabla = tablaMensual(d, { ...f, est: est === 'TOTAL' ? undefined : est });
  const filas = tabla.map((t) => t[est] as ResumenMes).filter((r) => r && r.operando);
  const res: any = { est, filas: [], resumen: {} };
  for (const m of METRICAS_COMP) {
    const serie = filas.map((r) => ({ periodo: r.periodo, v: (r as any)[m] as V, parcial: !!r.cobertura?.parcial }));
    const completos = serie.filter((s) => s.v.v !== null && !s.parcial);
    const valores = completos.map((s) => s.v.v as number);
    const prom = valores.length ? valores.reduce((a, b) => a + b, 0) / valores.length : null;
    const mejor = completos.length ? completos.reduce((a, b) => ((b.v.v as number) > (a.v.v as number) ? b : a)) : null;
    const peor = completos.length ? completos.reduce((a, b) => ((b.v.v as number) < (a.v.v as number) ? b : a)) : null;
    res.resumen[m] = {
      promedio: prom === null ? null : redondear(prom), mejor: mejor ? { periodo: mejor.periodo, v: mejor.v.v } : null, peor: peor ? { periodo: peor.periodo, v: peor.v.v } : null,
      meses_considerados: completos.length, excluidos: serie.filter((s) => s.parcial || s.v.v === null).map((s) => s.periodo),
    };
  }
  let acum: Record<string, number[]> = {};
  filas.forEach((r, i) => {
    const prev = i > 0 ? filas[i - 1] : null;
    const fila: any = { periodo: r.periodo, nombre: r.nombre, parcial: !!r.cobertura?.parcial, nota: r.cobertura?.motivo ?? null };
    for (const m of METRICAS_COMP) {
      const v = (r as any)[m] as V;
      const pv = prev ? ((prev as any)[m] as V) : null;
      const esPct = m.startsWith('margen');
      const varAbs = v.v !== null && pv?.v !== null && pv?.v !== undefined ? redondear(v.v - pv.v) : null;
      const varPct = !esPct && varAbs !== null && pv?.v ? redondear((varAbs / Math.abs(pv.v)) * 100) : null;
      const previos = acum[m] || [];
      const promPrev = previos.length ? previos.reduce((a, b) => a + b, 0) / previos.length : null;
      fila[m] = {
        ...v, var_abs: varAbs, var_pct: varPct,
        vs_promedio: v.v !== null && promPrev !== null ? redondear(v.v - promPrev) : null,
        vs_mejor: v.v !== null && res.resumen[m].mejor ? redondear(v.v - res.resumen[m].mejor.v) : null,
        vs_peor: v.v !== null && res.resumen[m].peor ? redondear(v.v - res.resumen[m].peor.v) : null,
      };
      if (v.v !== null && !r.cobertura?.parcial) acum[m] = [...previos, v.v];
    }
    res.filas.push(fila);
  });
  acum = {};
  return res;
}

// ---------- Ventas por dimensión y productos ----------
export type FilaProducto = {
  clave: string; producto_id: number | null; producto: string; marca: string; categoria: string; unidades: number; ventas: number; costo: number;
  utilidad: number | null; margen: number | null; costo_completo: boolean; participacion: number; meses_con_venta: number; velocidad: number;
  ventas_ult: number; ventas_ant: number; crecimiento: number | null; precio_promedio: number | null; descuento: number;
};

export function ventasFiltradas(d: Datos, f: Filtro): Venta[] {
  const ps = new Set(periodosFiltro(d, f));
  return d.ventas.filter((v) => ps.has(v.periodo) && (!f.est || f.est === 'TOTAL' || v.est === f.est)).filter(filtroProducto(f));
}

export function porProducto(d: Datos, f: Filtro): FilaProducto[] {
  const rows = ventasFiltradas(d, f).filter((v) => v.categoria !== 'Accesorio');
  const ps = periodosFiltro(d, f);
  const ult = ps[ps.length - 1], ant = ps[ps.length - 2];
  const total = rows.reduce((s, v) => s + v.total, 0);
  const g = new Map<string, Venta[]>();
  for (const v of rows) {
    const k = v.producto_id ? String(v.producto_id) : `txt:${v.producto}`;
    (g.get(k) || g.set(k, []).get(k)!).push(v);
  }
  const res: FilaProducto[] = [];
  for (const [k, vs] of g) {
    const a = agregarVentas(vs, d);
    const meses = new Set(vs.map((v) => v.periodo)).size;
    const vu = vs.filter((v) => v.periodo === ult).reduce((s, v) => s + v.total, 0);
    const va = vs.filter((v) => v.periodo === ant).reduce((s, v) => s + v.total, 0);
    const completo = a.sin_costo.lineas === 0;
    res.push({
      clave: k, producto_id: vs[0].producto_id, producto: vs[0].producto, marca: vs[0].marca, categoria: vs[0].categoria,
      unidades: a.unidades, ventas: redondear(a.ventas_netas), costo: redondear(a.costo),
      // si alguna línea no tiene costo, la utilidad y el margen se calculan SOLO con las ventas costeadas (marcado como parcial)
      utilidad: a.ventas_costeadas ? redondear(a.ventas_costeadas - a.costo) : null,
      margen: a.ventas_costeadas ? redondear(((a.ventas_costeadas - a.costo) / a.ventas_costeadas) * 100) : null,
      costo_completo: completo, participacion: total ? redondear((a.ventas_netas / total) * 100, 3) : 0, meses_con_venta: meses,
      velocidad: ps.length ? redondear(a.unidades / ps.length) : 0, ventas_ult: redondear(vu), ventas_ant: redondear(va),
      crecimiento: ant && va ? redondear(((vu - va) / va) * 100) : null, precio_promedio: a.unidades ? redondear(a.ventas_netas / a.unidades) : null,
      descuento: redondear(a.descuento),
    });
  }
  return res.sort((x, y) => y.ventas - x.ventas);
}

export function porDimension(d: Datos, f: Filtro, dim: 'marca' | 'categoria' | 'presentacion' | 'tipo_pago' | 'est' | 'periodo') {
  const rows = ventasFiltradas(d, f);
  const g = new Map<string, Venta[]>();
  for (const v of rows) {
    const k = String((v as any)[dim] ?? 'Sin dato');
    (g.get(k) || g.set(k, []).get(k)!).push(v);
  }
  const total = rows.reduce((s, v) => s + v.total, 0);
  return [...g.entries()].map(([k, vs]) => {
    const a = agregarVentas(vs, d);
    const completo = a.sin_costo.lineas === 0;
    return {
      clave: k, ventas: redondear(a.ventas_netas), unidades: a.unidades, participacion: total ? redondear((a.ventas_netas / total) * 100) : 0,
      costo: redondear(a.costo), utilidad: completo ? redondear(a.ventas_netas - a.costo) : null,
      margen: completo && a.ventas_netas ? redondear(((a.ventas_netas - a.costo) / a.ventas_netas) * 100) : null,
      margen_parcial: !completo && a.ventas_costeadas ? redondear(((a.ventas_costeadas - a.costo) / a.ventas_costeadas) * 100) : null,
      lineas_sin_costo: a.sin_costo.lineas,
    };
  }).sort((x, y) => y.ventas - x.ventas);
}

export function productosSinVentas(d: Datos, f: Filtro) {
  const vendidos = new Set(ventasFiltradas(d, { ...f, producto_id: undefined }).map((v) => v.producto_id));
  return d.productos.filter((p) => p.origen === 'catalogo' && !vendidos.has(p.id)).map((p) => ({ id: p.id, producto: p.nombre, marca: p.marca }));
}

export const MIN_UNIDADES_MARGEN = 5;

export const CRITERIOS_RANKING: Record<string, { campo: keyof FilaProducto; titulo: string; asc?: boolean; requiere?: string }> = {
  unidades: { campo: 'unidades', titulo: 'Unidades vendidas' },
  ventas: { campo: 'ventas', titulo: 'Ventas netas' },
  utilidad: { campo: 'utilidad', titulo: 'Utilidad bruta', requiere: 'costo' },
  margen: { campo: 'margen', titulo: 'Margen bruto %', requiere: 'costo' },
  rotacion: { campo: 'velocidad', titulo: 'Velocidad de venta (unidades/mes)' },
  crecimiento: { campo: 'crecimiento', titulo: 'Crecimiento vs mes anterior %', requiere: 'dos_meses' },
  caida: { campo: 'crecimiento', titulo: 'Caída de ventas vs mes anterior %', asc: true, requiere: 'dos_meses' },
};

export function ranking(d: Datos, f: Filtro, criterio: string, n = 15) {
  const c = CRITERIOS_RANKING[criterio];
  if (!c) throw new Error('Criterio de ranking no válido');
  const ps = periodosFiltro(d, f);
  if (c.requiere === 'dos_meses' && ps.length < 2) return { criterio, titulo: c.titulo, disponible: false, motivo: 'Se necesitan al menos dos meses en el filtro.', filas: [] };
  if (c.requiere === 'costo' && !d.metodoValuacion) return { criterio, titulo: c.titulo, disponible: false, motivo: 'No hay método de costeo / tabla de costos.', filas: [] };
  let filas = porProducto(d, f).filter((p) => p[c.campo] !== null);
  if (criterio === 'caida') filas = filas.filter((p) => (p.crecimiento ?? 0) < 0);
  if (criterio === 'crecimiento') filas = filas.filter((p) => (p.crecimiento ?? 0) > 0);
  // el margen de un producto con 1 o 2 unidades no es representativo
  if (criterio === 'margen') filas = filas.filter((p) => p.unidades >= MIN_UNIDADES_MARGEN);
  filas.sort((a, b) => (c.asc ? 1 : -1) * (((a[c.campo] as number) ?? 0) - ((b[c.campo] as number) ?? 0)));
  const nota = criterio === 'rotacion' ? 'Rotación real (ventas ÷ inventario promedio) requiere inventarios; se muestra la velocidad de venta como aproximación.'
    : criterio === 'margen' ? `Productos con al menos ${MIN_UNIDADES_MARGEN} unidades vendidas. "Parcial" = calculado solo con las ventas que tienen costo registrado.`
      : c.requiere === 'costo' ? '"Parcial" = calculado solo con las ventas que tienen costo registrado.' : null;
  return { criterio, titulo: c.titulo, disponible: true, nota, filas: filas.slice(0, n) };
}

// ---------- Gastos ----------
export function analisisGastos(d: Datos, f: Filtro) {
  const ps = periodosFiltro(d, f);
  const ests = d.establecimientos.map((e) => e.id).filter((e) => !f.est || f.est === 'TOTAL' || f.est === e);
  const matriz: Record<string, Record<string, Record<string, number>>> = {}; // periodo -> est -> categoria -> monto
  const lineas: Egreso[] = [];
  const faltantes: string[] = [];
  for (const p of ps) {
    matriz[p] = {};
    for (const e of ests) {
      if (!periodosOperacion(d, e).includes(p) && !hayRendicion(d, e, p)) continue;
      const g = gastosOperativos(d, e, p);
      if (g.total.e === 'nd') { faltantes.push(`${e} ${nombrePeriodo(p)}`); continue; }
      matriz[p][e] = g.por_categoria;
      lineas.push(...g.lineas);
    }
  }
  const categorias = [...new Set(lineas.map((l) => l.categoria))].sort();
  const porCategoria = categorias.map((c) => {
    const serie = ps.map((p) => ({ periodo: p, v: redondear(Object.values(matriz[p] || {}).reduce((s, m) => s + (m[c] || 0), 0)) }));
    const tot = serie.reduce((s, x) => s + x.v, 0);
    return { categoria: c, total: redondear(tot), serie };
  }).sort((a, b) => b.total - a.total);
  const total = porCategoria.reduce((s, c) => s + c.total, 0);
  return {
    periodos: ps, establecimientos: ests, matriz, faltantes,
    por_categoria: porCategoria.map((c) => ({ ...c, participacion: total ? redondear((c.total / total) * 100) : 0 })),
    total: redondear(total),
    mayores: [...lineas].sort((a, b) => (b.monto_bob ?? 0) - (a.monto_bob ?? 0)).slice(0, 15),
  };
}
