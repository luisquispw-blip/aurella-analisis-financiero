// Situación financiera (Activo = Pasivo + Patrimonio) y liquidez con los datos disponibles.
import type { Datos } from './datos.ts';
import type { V } from './motor.ts';
import { egresosVigentes, nd, nombrePeriodo, ok, resumenMes, consolidar, periodosOperacion } from './motor.ts';
import { redondear } from '../importers/utilidades.ts';

type Linea = { cuenta: string; valor: V; fuente: string };

function saldo(d: Datos, ests: string[], periodo: string, concepto: string, etiqueta: string): V {
  const vals: number[] = [];
  const faltan: string[] = [];
  for (const e of ests) {
    const s = d.saldos.filter((x) => x.est === e && x.periodo === periodo && x.concepto === concepto);
    if (!s.length) faltan.push(e);
    else vals.push(s.reduce((a, x) => a + x.monto, 0));
  }
  if (faltan.length) return nd(`Falta ${etiqueta} de ${faltan.join(', ')} al cierre de ${nombrePeriodo(periodo)}.`);
  return ok(vals.reduce((a, b) => a + b, 0));
}

function acumuladoEgresos(d: Datos, ests: string[], periodo: string, clases: string[]): { v: V; usd: number } {
  const filas = egresosVigentes(d).filter((e) => ests.includes(e.est) && e.periodo && e.periodo <= periodo && clases.includes(e.clase));
  const usd = filas.filter((e) => e.monto_bob === null);
  const s = filas.reduce((a, e) => a + (e.monto_bob ?? 0), 0);
  return { v: usd.length ? { v: redondear(s), e: 'parcial', m: `${usd.length} partida(s) en USD sin tipo de cambio (USD ${redondear(usd.reduce((a, e) => a + e.monto, 0))}).` } : ok(s), usd: usd.length };
}

export function situacionFinanciera(d: Datos, periodo: string, est: string) {
  const ests = est === 'TOTAL' ? d.establecimientos.map((e) => e.id).filter((e) => periodosOperacion(d, e).length || d.egresos.some((x) => x.est === e)) : [est];
  const operan = ests.filter((e) => periodosOperacion(d, e).includes(periodo));
  const res = operan.map((e) => resumenMes(d, e, periodo));
  const mes = est === 'TOTAL' ? consolidar(res, periodo) : res[0];
  const caja: V = mes ? mes.fondo_caja : nd('Sin operaciones en el periodo.');
  const bancos = saldo(d, ests, periodo, 'BANCOS', 'el saldo de bancos');
  const cxc = saldo(d, ests, periodo, 'CXC', 'el saldo de cuentas por cobrar');
  let inventario = saldo(d, ests, periodo, 'INVENTARIO_VALORIZADO', 'el inventario valorizado');
  if (inventario.e === 'nd' && mes && mes.inv_fisico.v !== null) {
    inventario = { v: null, e: 'nd', m: 'Hay conteo físico en unidades pero falta su valorización.' };
  }
  const activoFijo = acumuladoEgresos(d, ests, periodo, ['inversion_activo']).v;
  const preop = acumuladoEgresos(d, ests, periodo, ['preoperativo']).v;
  const otrosA = saldo(d, ests, periodo, 'OTRO_ACTIVO', 'otros activos');
  const cxp = saldo(d, ests, periodo, 'CXP', 'el saldo de cuentas por pagar');
  const prest = saldo(d, ests, periodo, 'PRESTAMO', 'el saldo de préstamos');
  const otrosP = saldo(d, ests, periodo, 'OTRO_PASIVO', 'otros pasivos');
  const capital = saldo(d, ests, periodo, 'CAPITAL', 'el capital social');
  const aporteManual = saldo(d, ests, periodo, 'APORTE', 'aportes adicionales');
  const retiros = saldo(d, ests, periodo, 'RETIRO', 'retiros de socios');
  // Aportes de socios = inversión registrada en las hojas INVERSION (financiada por los socios)
  const inv = egresosVigentes(d).filter((e) => ests.includes(e.est) && e.origen === 'inversion' && e.periodo && e.periodo <= periodo);
  const invUsd = inv.filter((e) => e.monto_bob === null);
  const aportesInv: V = invUsd.length
    ? { v: redondear(inv.reduce((a, e) => a + (e.monto_bob ?? 0), 0)), e: 'parcial', m: `Excluye USD ${redondear(invUsd.reduce((a, e) => a + e.monto, 0))} sin tipo de cambio.` }
    : ok(inv.reduce((a, e) => a + (e.monto_bob ?? 0), 0));
  const porSocio = d.socios.map((s) => ({ socio: s.codigo, participacion: s.participacion, monto: aportesInv.v === null ? null : redondear(aportesInv.v * s.participacion) }));
  // Resultados acumulados = Σ utilidad operativa de los meses hasta el corte
  const meses = d.periodos.filter((p) => p <= periodo);
  let resAcum: V = ok(0);
  const sinDato: string[] = [];
  let suma = 0, parcialR = false;
  for (const p of meses) {
    const partes = ests.filter((e) => periodosOperacion(d, e).includes(p)).map((e) => resumenMes(d, e, p));
    if (!partes.length) continue;
    const c = est === 'TOTAL' ? consolidar(partes, p) : partes[0];
    if (c.utilidad_operativa.v === null) sinDato.push(nombrePeriodo(p));
    else { suma += c.utilidad_operativa.v; if (c.utilidad_operativa.e === 'parcial') parcialR = true; }
  }
  if (sinDato.length) resAcum = nd(`No se puede acumular: falta la utilidad operativa de ${sinDato.join(', ')}.`);
  else resAcum = parcialR ? { v: redondear(suma), e: 'parcial', m: 'Incluye meses con costo de ventas parcial.' } : ok(suma);

  const activos: Linea[] = [
    { cuenta: 'Caja (fondo de caja en tienda)', valor: caja, fuente: 'Cierres diarios de caja (registro de ventas)' },
    { cuenta: 'Bancos', valor: bancos, fuente: 'Saldos bancarios (no proporcionados en los archivos actuales)' },
    { cuenta: 'Cuentas por cobrar', valor: cxc, fuente: 'Saldos de clientes' },
    { cuenta: 'Inventario de mercadería', valor: inventario, fuente: 'Inventario físico valorizado' },
    { cuenta: 'Activo fijo, garantías y remodelaciones (al costo, sin depreciación)', valor: activoFijo, fuente: 'Egresos clasificados como inversión' },
    { cuenta: 'Gastos preoperativos (financiados con la inversión inicial)', valor: preop, fuente: 'Hojas INVERSION' },
    { cuenta: 'Otros activos', valor: otrosA, fuente: 'Saldos' },
  ];
  const pasivos: Linea[] = [
    { cuenta: 'Cuentas por pagar', valor: cxp, fuente: 'Saldos de proveedores' },
    { cuenta: 'Préstamos', valor: prest, fuente: 'Saldos de préstamos' },
    { cuenta: 'Otros pasivos', valor: otrosP, fuente: 'Saldos' },
  ];
  const patrimonio: Linea[] = [
    { cuenta: 'Capital social', valor: capital, fuente: 'Saldos / escritura de constitución' },
    { cuenta: 'Aportes de socios — inversión inicial (hojas INVERSION)', valor: aportesInv, fuente: 'Hojas INVERSION CBBA / INVERSION LA PAZ' },
    { cuenta: 'Aportes adicionales', valor: aporteManual, fuente: 'Saldos' },
    { cuenta: 'Resultados acumulados (utilidad operativa)', valor: resAcum, fuente: 'Motor financiero' },
    { cuenta: 'Retiros de socios (−)', valor: retiros.v === null ? retiros : ok(-Math.abs(retiros.v)), fuente: 'Saldos' },
  ];
  // Cuentas que pueden no existir (otros activos/pasivos, aportes adicionales, retiros) no bloquean la validación
  const opcionales = new Set(['Otros activos', 'Otros pasivos', 'Aportes adicionales', 'Retiros de socios (−)']);
  const obligatorias = [...activos, ...pasivos, ...patrimonio].filter((l) => !opcionales.has(l.cuenta));
  const faltantes = obligatorias.filter((l) => l.valor.v === null);
  const sum = (ls: Linea[]) => redondear(ls.reduce((a, l) => a + (l.valor.v ?? 0), 0));
  const tA = sum(activos), tP = sum(pasivos), tPt = sum(patrimonio);
  const verificable = faltantes.length === 0;
  return {
    periodo, nombre: nombrePeriodo(periodo), est, activos, pasivos, patrimonio,
    total_activo: tA, total_pasivo: tP, total_patrimonio: tPt,
    verificable, diferencia: verificable ? redondear(tA - tP - tPt) : null,
    faltantes: faltantes.map((l) => ({ cuenta: l.cuenta, motivo: l.valor.m })),
    aportes_por_socio: porSocio,
    nota: verificable ? null
      : `No se puede validar Activo = Pasivo + Patrimonio: faltan ${faltantes.map((l) => l.cuenta).join(', ')}. Los totales mostrados solo suman las cuentas disponibles y NO constituyen un balance.`,
  };
}

export function liquidez(d: Datos, periodo: string, est: string) {
  const sf = situacionFinanciera(d, periodo, est);
  const get = (ls: { cuenta: string; valor: V }[], pref: string) => ls.find((l) => l.cuenta.startsWith(pref))!.valor;
  const caja = get(sf.activos, 'Caja'), bancos = get(sf.activos, 'Bancos'), cxc = get(sf.activos, 'Cuentas por cobrar'), inv = get(sf.activos, 'Inventario');
  const cxp = get(sf.pasivos, 'Cuentas por pagar'), prest = get(sf.pasivos, 'Préstamos');
  const ind = (nombre: string, formula: string, partes: V[], calc: () => number): { nombre: string; formula: string; valor: V } => {
    const falt = partes.filter((p) => p.v === null);
    if (falt.length) return { nombre, formula, valor: nd(falt.map((p) => p.m).join(' ')) };
    return { nombre, formula, valor: ok(calc()) };
  };
  const ests = est === 'TOTAL' ? d.establecimientos.map((e) => e.id) : [est];
  const partes = ests.filter((e) => periodosOperacion(d, e).includes(periodo)).map((e) => resumenMes(d, e, periodo));
  const mes = partes.length ? (est === 'TOTAL' ? consolidar(partes, periodo) : partes[0]) : null;
  const gastoDia = mes?.gastos_operativos.v != null ? mes.gastos_operativos.v / 30 : null;
  const pasivoCorto = cxp.v !== null && prest.v !== null ? cxp.v + prest.v : null;
  const indicadores = [
    ind('Razón corriente', '(Caja + Bancos + CxC + Inventario) ÷ (CxP + Préstamos)', [caja, bancos, cxc, inv, cxp, prest],
      () => (caja.v! + bancos.v! + cxc.v! + inv.v!) / (pasivoCorto || NaN)),
    ind('Prueba ácida', '(Caja + Bancos + CxC) ÷ (CxP + Préstamos)', [caja, bancos, cxc, cxp, prest], () => (caja.v! + bancos.v! + cxc.v!) / (pasivoCorto || NaN)),
    ind('Capital de trabajo (Bs)', '(Caja + Bancos + CxC + Inventario) − (CxP + Préstamos)', [caja, bancos, cxc, inv, cxp, prest],
      () => caja.v! + bancos.v! + cxc.v! + inv.v! - pasivoCorto!),
    ind('Días de caja disponibles', '(Caja + Bancos) ÷ (Gastos operativos del mes ÷ 30)', [caja, bancos, mes?.gastos_operativos ?? nd('Sin gastos.')],
      () => (caja.v! + bancos.v!) / (gastoDia || NaN)),
    ind('Dependencia de financiamiento', 'Préstamos ÷ (CxP + Préstamos) × 100', [cxp, prest], () => (pasivoCorto ? (prest.v! / pasivoCorto) * 100 : 0)),
  ].map((i) => (i.valor.v !== null && !Number.isFinite(i.valor.v) ? { ...i, valor: nd('División por cero: el denominador es 0.') } : i));
  // Evolución observable: fondo de caja y cobros por medio de pago
  const serie = d.periodos.filter((p) => p <= periodo).map((p) => {
    const ps = ests.filter((e) => periodosOperacion(d, e).includes(p)).map((e) => resumenMes(d, e, p));
    if (!ps.length) return null;
    const c = est === 'TOTAL' ? consolidar(ps, p) : ps[0];
    return { periodo: p, fondo_caja: c.fondo_caja.v, flujo_neto: c.flujo_neto.v, flujo_estado: c.flujo_neto.e, por_medio: c.por_medio, ventas: c.ventas_netas.v };
  }).filter(Boolean);
  return { periodo, est, indicadores, serie, faltantes: sf.faltantes };
}
