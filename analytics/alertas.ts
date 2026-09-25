// Centro de alertas: todas las reglas y umbrales vienen de la tabla regla_alerta (editable por el usuario).
import type { Db } from '../database/db.ts';
import type { Datos } from './datos.ts';
import type { Filtro, ResumenMes } from './motor.ts';
import { analisisGastos, egresosVigentes, inventarioPeriodo, nombrePeriodo, porProducto, tablaMensual, periodosFiltro } from './motor.ts';
import { situacionFinanciera } from './financiero.ts';
import { redondear } from '../importers/utilidades.ts';

export type Alerta = {
  codigo: string; severidad: 'critica' | 'advertencia' | 'positiva' | 'datos'; titulo: string; mensaje: string;
  periodo: string | null; est: string | null; valor: number | null; umbral: number | null; recomendacion: string | null;
};
type Regla = { codigo: string; nombre: string; severidad: string; parametro: string; valor: number; activo: number };

const fmt = (n: number) => n.toLocaleString('es-BO', { maximumFractionDigits: 2 });

export function calcularAlertas(db: Db, d: Datos, f: Filtro = {}): Alerta[] {
  const reglas = new Map(db.all<Regla>('SELECT * FROM regla_alerta').map((r) => [r.codigo, r]));
  const R = (c: string) => { const r = reglas.get(c); return r && r.activo ? r : null; };
  const out: Alerta[] = [];
  const push = (r: Regla, a: Omit<Alerta, 'codigo' | 'severidad' | 'titulo' | 'umbral'> & { titulo?: string }) =>
    out.push({ codigo: r.codigo, severidad: r.severidad as Alerta['severidad'], titulo: a.titulo ?? r.nombre, umbral: r.valor, ...a });

  const tabla = tablaMensual(d, { ...f, est: undefined });
  const ests = [...d.establecimientos.map((e) => e.id), 'TOTAL'].filter((e) => !f.est || f.est === e);
  for (const est of ests) {
    const serie = tabla.map((t) => t[est] as ResumenMes | undefined).filter((r): r is ResumenMes => !!r && r.operando);
    serie.forEach((r, i) => {
      const prev = i > 0 ? serie[i - 1] : null;
      const comparable = prev && !r.cobertura?.parcial && !prev.cobertura?.parcial;
      const vn = r.ventas_netas.v, pvn = prev?.ventas_netas.v ?? null;
      if (comparable && vn !== null && pvn) {
        const varPct = ((vn - pvn) / pvn) * 100;
        const rc = R('CAIDA_VENTAS'), ra = R('AUMENTO_VENTAS');
        if (rc && varPct <= -rc.valor) push(rc, { periodo: r.periodo, est, valor: redondear(varPct), mensaje: `Las ventas netas de ${est} en ${r.nombre} cayeron ${fmt(Math.abs(varPct))}% respecto a ${prev!.nombre} (Bs ${fmt(pvn)} → Bs ${fmt(vn)}).`, recomendacion: 'Revise en Ventas qué productos y categorías explican la caída antes de ajustar compras.' });
        if (ra && varPct >= ra.valor) push(ra, { periodo: r.periodo, est, valor: redondear(varPct), mensaje: `Las ventas netas de ${est} en ${r.nombre} crecieron ${fmt(varPct)}% respecto a ${prev!.nombre}.`, recomendacion: null });
        const u = r.unidades.v, pu = prev!.unidades.v;
        const rr = R('MAYOR_ROTACION');
        if (rr && u !== null && pu && ((u - pu) / pu) * 100 >= rr.valor) push(rr, { periodo: r.periodo, est, valor: redondear(((u - pu) / pu) * 100), mensaje: `Las unidades vendidas de ${est} subieron de ${fmt(pu)} a ${fmt(u)} en ${r.nombre}.`, recomendacion: null });
      }
      const rm = R('MARGEN_REDUCIDO');
      if (rm && r.margen_bruto.v !== null && r.margen_bruto.v < rm.valor) push(rm, { periodo: r.periodo, est, valor: r.margen_bruto.v, mensaje: `Margen bruto de ${est} en ${r.nombre}: ${fmt(r.margen_bruto.v)}% (mínimo configurado ${rm.valor}%).`, recomendacion: 'Revise los productos con menor margen en Rentabilidad y el nivel de descuentos.' });
      const rg = R('GASTOS_ELEVADOS');
      if (rg && vn && r.gastos_operativos.v !== null) {
        const pct = (r.gastos_operativos.v / vn) * 100;
        if (pct > rg.valor) push(rg, { periodo: r.periodo, est, valor: redondear(pct), mensaje: `Los gastos operativos de ${est} en ${r.nombre} representan ${fmt(pct)}% de las ventas netas (umbral ${rg.valor}%).${r.cobertura?.parcial ? ' Mes con registro parcial de ventas.' : ''}`, recomendacion: 'Revise en Gastos las categorías de mayor peso de ese mes.' });
      }
      const rl = R('LIQUIDEZ_INSUFICIENTE');
      if (rl && r.flujo_neto.v !== null && r.flujo_neto.v < rl.valor) push(rl, { periodo: r.periodo, est, valor: r.flujo_neto.v, mensaje: `Flujo neto registrado de ${est} en ${r.nombre}: Bs ${fmt(r.flujo_neto.v)} (ventas menos gastos, pagos de mercadería e inversiones del mes).`, recomendacion: 'Los datos sugieren que los egresos del mes superaron los ingresos por ventas; verifique el saldo bancario y la programación de pagos a proveedores.' });
      const rd = R('DESCUENTO_ELEVADO');
      if (rd && r.ventas_lista.v && r.descuento_implicito.v !== null) {
        const pct = (r.descuento_implicito.v / r.ventas_lista.v) * 100;
        if (pct > rd.valor) push(rd, { periodo: r.periodo, est, valor: redondear(pct), mensaje: `El descuento implícito de ${est} en ${r.nombre} fue ${fmt(pct)}% del valor a precio público (Bs ${fmt(r.descuento_implicito.v)}).`, recomendacion: 'Evalúe la política de precios promocionales frente al margen obtenido.' });
      }
      if (prev && comparable) {
        const rmo = R('MEJORA_MARGEN');
        if (rmo && r.margen_operativo.v !== null && prev.margen_operativo.v !== null && r.margen_operativo.v - prev.margen_operativo.v >= rmo.valor)
          push(rmo, { periodo: r.periodo, est, valor: redondear(r.margen_operativo.v - prev.margen_operativo.v), mensaje: `El margen operativo de ${est} subió de ${fmt(prev.margen_operativo.v)}% a ${fmt(r.margen_operativo.v)}% en ${r.nombre}.`, recomendacion: null });
        const rrg = R('REDUCCION_GASTOS');
        if (rrg && r.gastos_operativos.v !== null && prev.gastos_operativos.v && ((prev.gastos_operativos.v - r.gastos_operativos.v) / prev.gastos_operativos.v) * 100 >= rrg.valor)
          push(rrg, { periodo: r.periodo, est, valor: redondear(((prev.gastos_operativos.v - r.gastos_operativos.v) / prev.gastos_operativos.v) * 100), mensaje: `Los gastos operativos de ${est} bajaron de Bs ${fmt(prev.gastos_operativos.v)} a Bs ${fmt(r.gastos_operativos.v)} en ${r.nombre}.`, recomendacion: null });
        const rco = R('COSTO_CRECIENTE');
        if (rco && r.costo_ventas.v !== null && prev.costo_ventas.v !== null && vn && pvn) {
          const dpp = (r.costo_ventas.v / vn) * 100 - (prev.costo_ventas.v / pvn) * 100;
          if (dpp >= rco.valor) push(rco, { periodo: r.periodo, est, valor: redondear(dpp), mensaje: `El costo de ventas de ${est} pasó a representar ${fmt(dpp)} puntos porcentuales más de las ventas en ${r.nombre}.`, recomendacion: 'Revise precios de venta y la mezcla de presentaciones vendidas.' });
        }
      }
      // Inventario
      if (est !== 'TOTAL') {
        const inv = inventarioPeriodo(d, est, r.periodo);
        const rn = R('INVENTARIO_NEGATIVO'), rdi = R('DIFERENCIA_INVENTARIO'), rso = R('SOBRE_STOCK'), rag = R('RIESGO_AGOTAMIENTO');
        for (const p of inv.productos) {
          if (rn && p.teorico !== null && p.teorico < rn.valor) push(rn, { periodo: r.periodo, est, valor: p.teorico, mensaje: `Inventario teórico negativo de "${p.producto}" en ${est} (${r.nombre}): ${p.teorico} u. Hay ventas o salidas sin entradas registradas.`, recomendacion: 'Verifique compras y transferencias no registradas de ese producto.' });
          if (rdi && p.diferencia !== null && p.teorico) {
            const pct = Math.abs(p.diferencia / p.teorico) * 100;
            if (pct >= rdi.valor && p.diferencia !== 0) push(rdi, { periodo: r.periodo, est, valor: p.diferencia, mensaje: `Diferencia de inventario de "${p.producto}" en ${est} (${r.nombre}): físico ${p.fisico} vs teórico ${p.teorico} (${p.diferencia > 0 ? '+' : ''}${p.diferencia} u.).`, recomendacion: 'Controle las diferencias con un nuevo conteo y revise bajas/pérdidas no registradas.' });
          }
          const vel = p.vendidas || null;
          if (p.fisico !== null && vel) {
            const cob = p.fisico / vel;
            if (rso && cob > rso.valor) push(rso, { periodo: r.periodo, est, valor: redondear(cob), mensaje: `"${p.producto}" en ${est}: ${p.fisico} u. en stock cubren ${fmt(cob)} meses de venta.`, recomendacion: 'Reduzca compras de este producto hasta normalizar la cobertura.' });
            if (rag && cob < rag.valor) push(rag, { periodo: r.periodo, est, valor: redondear(cob), mensaje: `"${p.producto}" en ${est}: el stock (${p.fisico} u.) cubre solo ${fmt(cob)} meses de venta.`, recomendacion: 'Evalúe reponer este producto.' });
          }
        }
      }
    });
  }
  // Transferencias sin contraparte
  const rt = R('TRANSFERENCIA_SIN_CONTRAPARTE');
  if (rt) {
    const salidas = d.movimientos.filter((m) => m.tipo === 'TRANSFERENCIA_SALIDA');
    for (const s of salidas) {
      const entrada = d.movimientos.find((m) => m.tipo === 'TRANSFERENCIA_ENTRADA' && m.est === s.contraparte && m.producto_id === s.producto_id && m.periodo === s.periodo && Math.abs(m.cantidad - s.cantidad) <= rt.valor);
      if (!entrada) push(rt, { periodo: s.periodo, est: s.est, valor: s.cantidad, mensaje: `Transferencia de ${s.cantidad} u. de "${s.producto}" de ${s.est} a ${s.contraparte ?? '(destino no identificado)'} en ${nombrePeriodo(s.periodo)} sin entrada correspondiente en el destino.`, recomendacion: 'Registre la recepción en el establecimiento destino o corrija la salida.' });
    }
    for (const e of d.movimientos.filter((m) => m.tipo === 'TRANSFERENCIA_ENTRADA')) {
      const salida = d.movimientos.find((m) => m.tipo === 'TRANSFERENCIA_SALIDA' && m.est === e.contraparte && m.producto_id === e.producto_id && m.periodo === e.periodo && Math.abs(m.cantidad - e.cantidad) <= rt.valor);
      if (!salida) push(rt, { periodo: e.periodo, est: e.est, valor: e.cantidad, mensaje: `Entrada por transferencia de ${e.cantidad} u. de "${e.producto}" en ${e.est} sin salida correspondiente en ${e.contraparte ?? 'el origen'}.`, recomendacion: 'Registre la salida en el establecimiento de origen.' });
    }
  }
  // Gastos extraordinarios y crecientes
  const rx = R('GASTO_EXTRAORDINARIO');
  const ps = new Set(periodosFiltro(d, f));
  if (rx) for (const e of egresosVigentes(d).filter((e) => e.clase === 'gasto_operativo' && e.periodo && ps.has(e.periodo) && (e.monto_bob ?? 0) >= rx.valor && (!f.est || f.est === 'TOTAL' || f.est === e.est))) {
    push(rx, { periodo: e.periodo, est: e.est, valor: e.monto_bob, mensaje: `Gasto de Bs ${fmt(e.monto_bob!)} en ${e.est}: "${e.descripcion}" (${e.categoria}, ${e.hoja} fila ${e.fila}).`, recomendacion: null });
  }
  const rgc = R('GASTO_CRECIENTE');
  if (rgc) {
    const g = analisisGastos(d, f);
    for (const c of g.por_categoria) {
      for (let i = 1; i < c.serie.length; i++) {
        const a = c.serie[i - 1].v, b = c.serie[i].v;
        if (a > 0 && ((b - a) / a) * 100 >= rgc.valor) push(rgc, { periodo: c.serie[i].periodo, est: f.est ?? 'TOTAL', valor: redondear(((b - a) / a) * 100), mensaje: `Gasto en ${c.categoria} subió ${fmt(((b - a) / a) * 100)}% en ${nombrePeriodo(c.serie[i].periodo)} (Bs ${fmt(a)} → Bs ${fmt(b)}).`, recomendacion: `Revise el detalle de ${c.categoria} de ese mes en Gastos.` });
      }
    }
  }
  // Baja rotación (velocidad de venta)
  const rb = R('BAJA_ROTACION');
  if (rb) {
    const lentos = porProducto(d, f).filter((p) => p.velocidad < rb.valor && p.categoria === 'Perfume');
    if (lentos.length) push(rb, { periodo: null, est: f.est ?? 'TOTAL', valor: lentos.length, titulo: 'Productos con baja rotación', mensaje: `${lentos.length} producto(s) venden menos de ${rb.valor} u./mes en el periodo analizado (p. ej. ${lentos.slice(-5).map((p) => p.producto).join(', ')}).`, recomendacion: 'Reduzca compras de productos con baja rotación (confirme con el inventario disponible).' });
  }
  // Balance
  const rbal = R('BALANCE_DESCUADRE');
  const ult = periodosFiltro(d, f).at(-1);
  if (rbal && ult) {
    // se valida cada establecimiento y el total, en cada periodo con saldos registrados
    const conSaldos = [...new Set(d.saldos.map((s) => s.periodo))].filter((p) => ps.has(p));
    for (const p of conSaldos.length ? conSaldos : [ult]) for (const e of ests) {
      const sf = situacionFinanciera(d, p, e);
      if (sf.verificable && Math.abs(sf.diferencia ?? 0) > rbal.valor) push(rbal, { periodo: p, est: e, valor: sf.diferencia, mensaje: `${e} al cierre de ${sf.nombre}: Activo (Bs ${fmt(sf.total_activo)}) ≠ Pasivo + Patrimonio (Bs ${fmt(sf.total_pasivo + sf.total_patrimonio)}); diferencia Bs ${fmt(sf.diferencia!)}.`, recomendacion: 'Revise saldos de bancos, inventario valorizado, cuentas por pagar y resultados acumulados; no se generan ajustes automáticos.' });
    }
  }
  // Alertas de calidad de datos
  const pend = db.get<{ n: number }>(`SELECT COUNT(*) n FROM hoja WHERE estado = 'pendiente_confirmacion'`)!.n;
  if (pend) out.push({ codigo: 'DATOS_PENDIENTES', severidad: 'datos', titulo: 'Cargas pendientes de confirmación', mensaje: `${pend} hoja(s) con información que reemplazaría datos ya cargados esperan su confirmación.`, periodo: null, est: null, valor: pend, umbral: null, recomendacion: 'Revise el Centro de carga.' });
  const err = db.get<{ n: number }>(`SELECT COUNT(*) n FROM hoja WHERE estado = 'error'`)!.n;
  if (err) out.push({ codigo: 'DATOS_ERROR', severidad: 'datos', titulo: 'Hojas no procesadas', mensaje: `${err} hoja(s) no pudieron procesarse.`, periodo: null, est: null, valor: err, umbral: null, recomendacion: 'Revise el Centro de carga.' });
  const orden = { critica: 0, advertencia: 1, datos: 2, positiva: 3 };
  return out.sort((a, b) => orden[a.severidad] - orden[b.severidad] || String(b.periodo).localeCompare(String(a.periodo)));
}

export function guardarHistorialAlertas(db: Db, alertas: Alerta[]) {
  db.tx(() => {
    const ins = db.raw.prepare('INSERT INTO alerta_historial (codigo, severidad, periodo, establecimiento_id, mensaje) VALUES (?, ?, ?, ?, ?)');
    for (const a of alertas) ins.run(a.codigo, a.severidad, a.periodo, a.est, a.mensaje);
  });
}
