// Trazabilidad: "¿De dónde sale este valor?" -> fórmula, componentes y registros de origen (archivo, hoja, fila).
import type { Datos } from './datos.ts';
import type { Filtro } from './motor.ts';
import { FORMULAS, egresosVigentes, gastosOperativos, motivoSinCosto, nombrePeriodo, periodosFiltro, resumenMes, consolidar, periodosOperacion } from './motor.ts';
import { redondear } from '../importers/utilidades.ts';

export type FilaTraza = { archivo: string; hoja: string; fila: number | null; periodo: string | null; est: string; fecha: string | null; producto: string | null; detalle: string; valor: number | null };

const LIMITE = 400;

export function traza(d: Datos, metrica: string, f: Filtro & { periodo?: string }) {
  const periodos = f.periodo ? [f.periodo] : periodosFiltro(d, f);
  const ests = !f.est || f.est === 'TOTAL' ? d.establecimientos.map((e) => e.id) : [f.est];
  const enAlcance = (est: string, p: string | null) => ests.includes(est) && !!p && periodos.includes(p);
  let filas: FilaTraza[] = [];
  const componentes: { nombre: string; valor: number | null; nota?: string }[] = [];
  const ventas = () => d.ventas.filter((v) => enAlcance(v.est, v.periodo) && (!f.producto_id || v.producto_id === f.producto_id)
    && (!f.marca || v.marca === f.marca) && (!f.categoria || v.categoria === f.categoria));
  const filaVenta = (v: (typeof d.ventas)[number], valor: number | null, det?: string): FilaTraza => ({
    archivo: v.archivo, hoja: v.hoja, fila: v.fila, periodo: v.periodo, est: v.est, fecha: v.fecha, producto: v.producto,
    detalle: det ?? `${v.cantidad ?? '—'} × Bs ${v.precio ?? '—'} (${v.presentacion ?? 'sin presentación'})${v.nota ? ' · ' + v.nota : ''}`, valor,
  });
  switch (metrica) {
    case 'ventas_netas': case 'unidades': case 'descuento_implicito': {
      const vs = ventas();
      filas = vs.map((v) => filaVenta(v, metrica === 'unidades' ? (v.es_obsequio ? 0 : v.cantidad) : metrica === 'descuento_implicito'
        ? (v.precio_lista !== null && v.cantidad !== null && !v.es_obsequio ? redondear(Math.max(0, v.cantidad * v.precio_lista - v.total)) : null) : v.total));
      break;
    }
    case 'costo_ventas': case 'utilidad_bruta': {
      const vs = ventas();
      for (const v of vs) {
        const m = motivoSinCosto(v, d);
        const costo = m ? null : redondear((v.cantidad ?? 0) * v.costo_unitario!);
        filas.push(filaVenta(v, metrica === 'costo_ventas' ? costo : costo === null ? null : redondear(v.total - costo),
          m ? `SIN COSTO: ${m}` : `${v.cantidad} u. × costo ${v.costo_unitario} (${v.presentacion}) = ${costo}; venta ${v.total}`));
      }
      for (const c of d.costos.values()) componentes.push({ nombre: `Costo ${c.articulo} (${c.archivo} / ${c.hoja} fila ${c.fila})`, valor: c.costo });
      break;
    }
    case 'gastos_operativos': case 'utilidad_operativa': {
      for (const e of ests) for (const p of periodos) {
        const g = gastosOperativos(d, e, p);
        if (g.total.e === 'nd') componentes.push({ nombre: `${e} ${nombrePeriodo(p)}`, valor: null, nota: g.total.m });
        else componentes.push({ nombre: `${e} ${nombrePeriodo(p)} (fuente: ${g.fuente})`, valor: g.total.v });
        filas.push(...g.lineas.map((x) => ({ archivo: x.archivo, hoja: x.hoja, fila: x.fila, periodo: x.periodo, est: x.est, fecha: x.fecha, producto: null,
          detalle: `${x.descripcion} · ${x.categoria}${x.documento ? ' · doc ' + x.documento : ''}${x.nota ? ' · ' + x.nota : ''}`, valor: x.monto_bob })));
      }
      break;
    }
    case 'compras_pagadas': case 'inversion_pagada': {
      const clases = metrica === 'compras_pagadas' ? ['compra_mercaderia'] : ['inversion_activo', 'preoperativo'];
      filas = egresosVigentes(d).filter((e) => enAlcance(e.est, e.periodo) && clases.includes(e.clase)).map((x) => ({
        archivo: x.archivo, hoja: x.hoja, fila: x.fila, periodo: x.periodo, est: x.est, fecha: x.fecha, producto: null,
        detalle: `${x.descripcion} · ${x.clase}${x.moneda !== 'BOB' ? ' · ' + x.moneda : ''}`, valor: x.monto_bob,
      }));
      break;
    }
    case 'fondo_caja': {
      filas = d.control.filter((c) => c.concepto === 'fondo_caja' && enAlcance(c.est, c.periodo)).map((c) => ({
        archivo: c.archivo, hoja: c.hoja, fila: c.fila, periodo: c.periodo, est: c.est, fecha: c.fecha, producto: null, detalle: `FONDO DE CAJA${c.nota ? ' · ' + c.nota : ''}`, valor: c.monto,
      }));
      break;
    }
    default: throw new Error(`No hay trazabilidad definida para "${metrica}"`);
  }
  // Valor oficial calculado por el motor para el mismo alcance
  let valor: number | null = null, estado = 'ok', motivo: string | undefined;
  if (!f.producto_id && !f.marca && !f.categoria || ['ventas_netas', 'unidades', 'costo_ventas', 'utilidad_bruta', 'descuento_implicito'].includes(metrica)) {
    let suma = 0, hayNull = false;
    for (const p of periodos) {
      const partes = ests.filter((e) => periodosOperacion(d, e).includes(p)).map((e) => resumenMes(d, e, p, f));
      if (!partes.length) continue;
      const r: any = ests.length > 1 ? consolidar(partes, p) : partes[0];
      const v = r[metrica];
      if (!v || v.v === null) { hayNull = true; motivo = v?.m; continue; }
      suma += v.v;
      if (v.e === 'parcial') { estado = 'parcial'; motivo = v.m; }
    }
    valor = hayNull ? null : redondear(suma);
    if (hayNull) estado = 'nd';
  }
  const total = filas.length;
  return {
    metrica, formula: FORMULAS[metrica] ?? metrica, alcance: { periodos, establecimientos: ests, producto_id: f.producto_id ?? null },
    valor, estado, motivo, componentes, total_filas: total, suma_filas: redondear(filas.reduce((a, x) => a + (x.valor ?? 0), 0)),
    filas: filas.slice(0, LIMITE), truncado: total > LIMITE,
  };
}
