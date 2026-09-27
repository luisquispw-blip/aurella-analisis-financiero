// Motor local del agente (sin conexión a un modelo de lenguaje): interpreta la pregunta con reglas y responde
// con la estructura DATO / INTERPRETACIÓN / VARIACIÓN / ALERTA / RECOMENDACIÓN usando solo datos procesados.
import type { Db } from '../database/db.ts';
import type { Datos } from '../analytics/datos.ts';
import type { ResumenMes, V } from '../analytics/motor.ts';
import { comparacionMeses, nombrePeriodo, porDimension, ranking, analisisGastos } from '../analytics/motor.ts';
import { situacionFinanciera } from '../analytics/financiero.ts';
import { calcularAlertas } from '../analytics/alertas.ts';
import { datosFaltantes } from '../analytics/calidad.ts';
import { traza } from '../analytics/traza.ts';
import { mesDe, ejecutarHerramienta } from './herramientas.ts';
import { mesDePalabra, norm } from '../importers/utilidades.ts';
import { detectarIntencion } from './intencion.ts';

const bs = (n: number | null | undefined) => (n === null || n === undefined ? '—' : `Bs ${n.toLocaleString('es-BO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
const pc = (n: number | null | undefined) => (n === null || n === undefined ? '—' : `${n.toLocaleString('es-BO', { maximumFractionDigits: 2 })}%`);
const val = (x: V, fmt = bs) => (x.v === null ? `no disponible (${x.m ?? 'sin dato'})` : `${fmt(x.v)}${x.e === 'parcial' ? ' (parcial)' : ''}`);

const MESES_EXACTOS: Record<string, number> = {
  ENERO: 1, FEBRERO: 2, MARZO: 3, ABRIL: 4, MAYO: 5, JUNIO: 6, JULIO: 7, AGOSTO: 8, SEPTIEMBRE: 9, SETIEMBRE: 9, OCTUBRE: 10, NOVIEMBRE: 11, DICIEMBRE: 12,
};

type Contexto = { periodo: string | null; est: 'CBB' | 'LPZ' | 'TOTAL'; explicitoEst: boolean };

export function contexto(q: string, d: Datos): Contexto {
  const t = norm(q);
  let est: Contexto['est'] = 'TOTAL';
  let explicitoEst = false;
  const cbb = /COCHABAMBA|CBBA|\bCBB\b|CASA MATRIZ/.test(t), lpz = /LA PAZ|\bLPZ\b|SUCURSAL/.test(t);
  if (cbb && !lpz) { est = 'CBB'; explicitoEst = true; }
  if (lpz && !cbb) { est = 'LPZ'; explicitoEst = true; }
  let periodo: string | null = null;
  const anio = t.match(/\b(20\d{2})\b/)?.[1];
  for (const w of t.split(/[^A-Z]+/)) {
    // solo nombres de mes completos (o con errores leves en palabras largas): evita confundir "MARCA" con "MARCH"
    const m = MESES_EXACTOS[w] ?? (w.length >= 7 ? mesDePalabra(w) : null);
    if (m) {
      const cands = d.periodos.filter((p) => Number(p.slice(5)) === m && (!anio || p.startsWith(anio)));
      periodo = cands.at(-1) ?? null;
      break;
    }
  }
  if (!periodo && /ULTIMO MES|ESTE MES|MES ACTUAL|ULTIMO PERIODO/.test(t)) periodo = ultimoCompleto(d);
  return { periodo, est, explicitoEst };
}

export function ultimoCompleto(d: Datos): string | null {
  for (let i = d.periodos.length - 1; i >= 0; i--) {
    const r = mesDe(d, d.periodos[i], 'TOTAL');
    if (r && r.operando && !r.cobertura?.parcial && r.gastos_operativos.v !== null) return d.periodos[i];
  }
  return d.periodos.at(-1) ?? null;
}

export function anterior(d: Datos, p: string) { const i = d.periodos.indexOf(p); return i > 0 ? d.periodos[i - 1] : null; }

function variacion(act: V, prev: V | undefined, nombrePrev: string): string {
  if (!prev || act.v === null || prev.v === null) return `Sin comparación disponible con ${nombrePrev}.`;
  const dif = act.v - prev.v;
  const p = prev.v ? (dif / Math.abs(prev.v)) * 100 : null;
  return `${dif >= 0 ? 'Aumento' : 'Disminución'} de ${bs(Math.abs(dif))}${p !== null ? ` (${pc(Math.abs(p))})` : ''} respecto a ${nombrePrev} (${bs(prev.v)}).`;
}

function seccion(t: string, c: string) { return `**${t}:** ${c}`; }

function alertasDe(db: Db, d: Datos, periodo: string | null, est: string) {
  return calcularAlertas(db, d).filter((a) => (!periodo || a.periodo === periodo) && (est === 'TOTAL' || a.est === est) && a.severidad !== 'positiva').slice(0, 3);
}

function respuestaMes(db: Db, d: Datos, periodo: string, est: string, foco: 'ventas' | 'completo'): string {
  const r = mesDe(d, periodo, est) as ResumenMes;
  const pa = anterior(d, periodo);
  const rp = pa ? (mesDe(d, pa, est) as ResumenMes) : null;
  const nomEst = est === 'TOTAL' ? 'la empresa (Cochabamba + La Paz)' : est === 'CBB' ? 'Cochabamba' : 'La Paz';
  if (!r.operando) return `${nomEst} no registra operaciones en ${nombrePeriodo(periodo)}.`;
  const partes: string[] = [];
  if (foco === 'ventas') {
    partes.push(seccion('DATO', `Ventas netas de ${nomEst} en ${r.nombre}: ${val(r.ventas_netas)} · ${r.unidades.v ?? '—'} unidades · ${r.tickets.v ?? '—'} tickets (ticket promedio ${val(r.ticket_promedio)}).`));
    const medios = Object.entries(r.por_medio).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${bs(v)}`).join(', ');
    partes.push(seccion('INTERPRETACIÓN', `Cobros por medio de pago: ${medios || 'sin detalle'}.${r.cobertura?.parcial ? ` Atención: ${(r.cobertura as any).motivo}` : ''}`));
    partes.push(seccion('VARIACIÓN', rp && rp.operando ? variacion(r.ventas_netas, rp.ventas_netas, rp.nombre) : 'No hay mes anterior con operaciones para comparar.'));
  } else {
    partes.push(seccion('DATO', [
      `Ventas netas ${val(r.ventas_netas)}`, `costo de ventas ${val(r.costo_ventas)}`, `utilidad bruta ${val(r.utilidad_bruta)} (margen ${val(r.margen_bruto, pc)})`,
      `gastos operativos ${val(r.gastos_operativos)}`, `utilidad operativa ${val(r.utilidad_operativa)} (margen ${val(r.margen_operativo, pc)})`,
      `pagos de mercadería ${val(r.compras_pagadas)}`, `fondo de caja al cierre ${val(r.fondo_caja)}`,
    ].join('; ') + '.'));
    const cats = Object.entries(r.gastos_categoria).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k, v]) => `${k} ${bs(v)}`).join(', ');
    partes.push(seccion('INTERPRETACIÓN', `${cats ? `Los gastos se concentran en ${cats}. ` : ''}${r.cobertura?.parcial ? `${(r.cobertura as any).motivo} ` : ''}${r.costo_ventas.e === 'parcial' ? 'El costo de ventas es parcial: hay líneas sin costo registrado (ver Datos faltantes).' : ''}`.trim() || 'Sin observaciones adicionales.'));
    partes.push(seccion('VARIACIÓN', rp && rp.operando ? `Ventas: ${variacion(r.ventas_netas, rp.ventas_netas, rp.nombre)} Utilidad operativa: ${variacion(r.utilidad_operativa, rp.utilidad_operativa, rp.nombre)}` : 'No hay mes anterior para comparar.'));
  }
  const al = alertasDe(db, d, periodo, est);
  partes.push(seccion('ALERTA', al.length ? al.map((a) => a.mensaje).join(' ') : 'Sin alertas para este periodo.'));
  const rec = al.find((a) => a.recomendacion)?.recomendacion;
  if (rec) partes.push(seccion('RECOMENDACIÓN', rec));
  if (r.faltantes.length) partes.push(`_Datos faltantes que limitan el análisis: ${r.faltantes.slice(0, 3).join('; ')}._`);
  return partes.join('\n\n');
}

// Productos: ranking según lo que se pregunta (utilidad, margen, ventas, unidades o peores)
function respuestaProductos(d: Datos, it: string, c: Contexto): string {
  const f = { est: c.est === 'TOTAL' ? undefined : c.est, desde: c.periodo ?? undefined, hasta: c.periodo ?? undefined };
  const alcance = `${c.periodo ? nombrePeriodo(c.periodo) : 'todo el periodo cargado'}${c.est !== 'TOTAL' ? `, ${c.est === 'CBB' ? 'Cochabamba' : 'La Paz'}` : ', total empresa'}`;
  const criterio = it === 'producto_margen' ? 'margen' : it === 'producto_ventas' ? 'ventas' : it === 'producto_unidades' ? 'unidades' : it === 'producto_peor' ? 'caida' : 'utilidad';
  const r = ranking(d, f, criterio, 10);
  if (!r.disponible) return `No se puede elaborar el ranking de ${r.titulo.toLowerCase()}: ${r.motivo}`;
  if (!r.filas.length) return `No hay productos que cumplan el criterio "${r.titulo}" en ${alcance}.`;
  const tot = r.filas.reduce((a, p) => a + (p.utilidad ?? 0), 0);
  const lineas = r.filas.map((p, i) => `${i + 1}. **${p.producto}** (${p.marca}) — utilidad bruta ${bs(p.utilidad)}${p.costo_completo ? '' : ' (parcial)'} · margen ${pc(p.margen)} · ventas ${bs(p.ventas)} (${pc(p.participacion)} de las ventas) · ${p.unidades} u.${criterio === 'caida' ? ` · variación ${pc(p.crecimiento)}` : ''}`).join('\n');
  const primero = r.filas[0];
  return [
    `**DATO:** ${r.titulo} — ${alcance}:`, lineas,
    `**INTERPRETACIÓN:** ${criterio === 'caida' ? 'Estos productos tuvieron la mayor caída de ventas frente al mes anterior.' : `**${primero.producto}** encabeza el ranking con ${criterio === 'margen' ? pc(primero.margen) + ' de margen' : criterio === 'utilidad' ? bs(primero.utilidad) + ' de utilidad bruta' : criterio === 'unidades' ? primero.unidades + ' unidades' : bs(primero.ventas) + ' de ventas'}. Los 10 primeros suman ${bs(tot)} de utilidad bruta.`} ${r.nota ?? ''} Utilidad bruta = ventas netas − costo de ventas (costo estándar del proveedor por presentación).`,
    criterio === 'caida' ? '**RECOMENDACIÓN:** Revisar precios, exhibición y disponibilidad de estos productos antes de reponerlos.' : '**RECOMENDACIÓN:** Priorizar la exhibición y reposición de los primeros productos del ranking, confirmando su disponibilidad en inventario.',
  ].join('\n\n');
}

export function responderLocal(db: Db, d: Datos, pregunta: string): string {
  if (!d.periodos.length) return 'Todavía no hay información procesada. Cargue los archivos de la empresa en el Centro de carga.';
  const t = norm(pregunta);
  const c = contexto(pregunta, d);
  const periodo = c.periodo ?? ultimoCompleto(d)!;
  const it = detectarIntencion(pregunta);
  if (it.startsWith('producto_')) return respuestaProductos(d, it, c);
  if (it === 'marca') {
    const m = porDimension(d, { est: c.est === 'TOTAL' ? undefined : c.est, desde: c.periodo ?? undefined, hasta: c.periodo ?? undefined }, 'marca').slice(0, 10);
    return [`**DATO:** Marcas con mayores ventas — ${c.periodo ? nombrePeriodo(c.periodo) : 'todo el periodo cargado'}${c.est !== 'TOTAL' ? `, ${c.est}` : ''}:`,
      m.map((x, i) => `${i + 1}. **${x.clave}** — ventas ${bs(x.ventas)} (${pc(x.participacion)}) · ${x.unidades} u. · margen ${x.margen !== null ? pc(x.margen) : x.margen_parcial !== null ? pc(x.margen_parcial) + ' (parcial)' : 'N/D'}`).join('\n'),
      '**INTERPRETACIÓN:** "Sin marca registrada" agrupa los productos que no figuran en el catálogo (hoja Inventario); puede asignarlos en Productos.'].join('\n\n');
  }

  if (it === 'faltantes') {
    const f = datosFaltantes(d);
    return `**DATO:** Hay ${f.length} dato(s) pendientes.\n\n${f.slice(0, 10).map((x, i) => `${i + 1}. **${x.dato}** — afecta: ${x.afecta} _${x.como}_`).join('\n')}`;
  }
  if (it === 'traza') {
    const metrica = /GASTO/.test(t) ? 'gastos_operativos' : /COSTO/.test(t) ? 'costo_ventas' : /UTILIDAD BRUTA/.test(t) ? 'utilidad_bruta' : /CAJA/.test(t) ? 'fondo_caja' : 'ventas_netas';
    const tr = traza(d, metrica, { periodo, est: c.est });
    return `**DATO:** ${tr.formula}\n\nValor para ${c.est} ${nombrePeriodo(periodo)}: ${tr.valor === null ? `no disponible (${tr.motivo})` : bs(tr.valor)} — calculado a partir de ${tr.total_filas} registro(s).\n\n**ORIGEN (primeros registros):**\n${tr.filas.slice(0, 8).map((f) => `- ${f.archivo} › ${f.hoja} › fila ${f.fila}: ${f.producto ?? ''} ${f.detalle} = ${bs(f.valor)}`).join('\n')}\n\nPuede ver el detalle completo con el botón "¿De dónde sale?" de cada indicador.`;
  }
  if (it === 'comparar_est') {
    const a = mesDe(d, periodo, 'CBB') as ResumenMes, b = mesDe(d, periodo, 'LPZ') as ResumenMes;
    const acum = porDimension(d, {}, 'est');
    const lider = acum[0];
    return [
      seccion('DATO', `${nombrePeriodo(periodo)} — Cochabamba: ventas ${val(a.ventas_netas)}, utilidad operativa ${val(a.utilidad_operativa)} (margen ${val(a.margen_operativo, pc)}). La Paz: ventas ${val(b.ventas_netas)}, utilidad operativa ${val(b.utilidad_operativa)} (margen ${val(b.margen_operativo, pc)}).`),
      seccion('INTERPRETACIÓN', `En todo el histórico cargado, ${lider.clave === 'CBB' ? 'Cochabamba' : 'La Paz'} concentra ${pc(lider.participacion)} de las ventas (${bs(lider.ventas)}). La Paz abrió el 25 de abril de 2026, por lo que tiene menos meses de operación.`),
      seccion('VARIACIÓN', `Diferencia de ventas en ${nombrePeriodo(periodo)}: ${a.ventas_netas.v !== null && b.ventas_netas.v !== null ? bs(a.ventas_netas.v - b.ventas_netas.v) + ' a favor de ' + (a.ventas_netas.v >= b.ventas_netas.v ? 'Cochabamba' : 'La Paz') : 'no disponible'}.`),
      'Vea la pantalla "Cochabamba vs La Paz" para el comparativo completo.',
    ].join('\n\n');
  }
  if (it === 'por_que') {
    const pa = anterior(d, periodo);
    if (!pa) return 'No hay un mes anterior para explicar la variación.';
    const r = mesDe(d, periodo, c.est) as ResumenMes, p = mesDe(d, pa, c.est) as ResumenMes;
    if (r.utilidad_operativa.v === null || p.utilidad_operativa.v === null) return `No se puede explicar la variación de la utilidad operativa entre ${nombrePeriodo(pa)} y ${nombrePeriodo(periodo)}: ${r.utilidad_operativa.m ?? p.utilidad_operativa.m}`;
    const dV = (r.ventas_netas.v ?? 0) - (p.ventas_netas.v ?? 0), dC = (r.costo_ventas.v ?? 0) - (p.costo_ventas.v ?? 0), dG = (r.gastos_operativos.v ?? 0) - (p.gastos_operativos.v ?? 0);
    const cats = Object.keys({ ...r.gastos_categoria, ...p.gastos_categoria }).map((k) => [k, (r.gastos_categoria[k] ?? 0) - (p.gastos_categoria[k] ?? 0)] as const).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1])).slice(0, 3);
    return [
      seccion('DATO', `Utilidad operativa ${c.est}: ${bs(p.utilidad_operativa.v)} en ${p.nombre} → ${bs(r.utilidad_operativa.v)} en ${r.nombre} (${bs(r.utilidad_operativa.v - p.utilidad_operativa.v)}).`),
      seccion('INTERPRETACIÓN', `Descomposición: ventas netas ${dV >= 0 ? '+' : ''}${bs(dV)}; costo de ventas ${dC >= 0 ? '+' : ''}${bs(dC)} (resta); gastos operativos ${dG >= 0 ? '+' : ''}${bs(dG)} (resta). Los datos sugieren que el mayor efecto proviene de ${Math.abs(dV - dC) > Math.abs(dG) ? 'la variación de la utilidad bruta (ventas menos costo)' : 'la variación de los gastos operativos'}. Categorías de gasto con mayor cambio: ${cats.map(([k, v]) => `${k} ${v >= 0 ? '+' : ''}${bs(v)}`).join(', ')}.`),
      seccion('ALERTA', r.cobertura?.parcial || p.cobertura?.parcial ? 'Uno de los meses tiene registro parcial de ventas; la comparación puede no ser homogénea.' : 'Sin observaciones de cobertura.'),
      'No se afirman causas externas: la explicación se limita a los componentes registrados.',
    ].join('\n\n');
  }
  if (it === 'rotacion') {
    const r = ranking(d, { est: c.est === 'TOTAL' ? undefined : c.est }, 'rotacion', 400);
    const lentos = [...r.filas].reverse().slice(0, 10);
    return `**DATO:** Productos con menor velocidad de venta (unidades por mes):\n\n${lentos.map((p) => `- ${p.producto} — ${p.velocidad} u./mes (${p.unidades} u. en total)`).join('\n')}\n\n**INTERPRETACIÓN:** ${r.nota}\n\n**RECOMENDACIÓN:** Reducir compras de estos productos una vez confirmado el stock disponible (el inventario aún no fue proporcionado).`;
  }
  if (it === 'inventario') {
    const out = ['CBB', 'LPZ'].filter((e) => c.est === 'TOTAL' || c.est === e).map((e) => ejecutarHerramienta(db, d, 'inventario', { periodo, establecimiento: e }) as any);
    if (out.every((o) => o.disponible === false || o.error)) return `**DATO:** No es posible informar el inventario: ${out.map((o) => (o.faltantes ?? [o.error]).join('; ')).join(' | ')}.\n\nLa hoja "Inventario" del registro de ventas de Cochabamba solo contiene el catálogo (nombre y marca), sin cantidades.\n\n**Por favor proporcione únicamente:** el inventario inicial y los conteos físicos mensuales por producto y tamaño (plantilla disponible en Datos faltantes).`;
    return `**DATO:** ${JSON.stringify(out).slice(0, 1500)}`;
  }
  if (it === 'liquidez') {
    const s = situacionFinanciera(d, periodo, c.est);
    const caja = s.activos[0].valor, bancos = s.activos[1].valor;
    const r = mesDe(d, periodo, c.est) as ResumenMes;
    return [
      seccion('DATO', `Fondo de caja en tienda al cierre de ${s.nombre}: ${val(caja)}. Saldo en bancos: ${val(bancos)}.`),
      seccion('INTERPRETACIÓN', `En ${s.nombre} se cobraron ${Object.entries(r.por_medio).map(([k, v]) => `${k} ${bs(v)}`).join(', ')}. Los cobros por QR se abonan en cuenta bancaria, por lo que el efectivo en tienda no representa la disponibilidad total.`),
      seccion('VARIACIÓN', `Flujo neto registrado del mes: ${val(r.flujo_neto)}.`),
      seccion('ALERTA', bancos.v === null ? 'Falta el saldo bancario: no se puede determinar el dinero disponible total. Por favor proporcione únicamente el saldo de bancos al cierre del mes.' : 'Sin alertas.'),
    ].join('\n\n');
  }
  if (it === 'gastos') {
    const g = analisisGastos(d, { est: c.est === 'TOTAL' ? undefined : c.est, desde: c.periodo ?? undefined, hasta: c.periodo ?? undefined });
    return [
      seccion('DATO', `Gastos operativos ${c.periodo ? nombrePeriodo(c.periodo) : 'de todo el periodo cargado'}: ${bs(g.total)}. Principales categorías: ${g.por_categoria.slice(0, 5).map((x) => `${x.categoria} ${bs(x.total)} (${pc(x.participacion)})`).join(', ')}.`),
      seccion('INTERPRETACIÓN', `Los gastos con mayor impacto sobre la utilidad son ${g.por_categoria.slice(0, 2).map((x) => x.categoria).join(' y ')}. Los mayores egresos individuales: ${g.mayores.slice(0, 3).map((e) => `${e.descripcion} ${bs(e.monto_bob)} (${e.est})`).join('; ')}.`),
      seccion('ALERTA', g.faltantes.length ? `Sin rendición de gastos para: ${g.faltantes.join(', ')}.` : 'Rendiciones completas en el rango.'),
      'Nota: los pagos de mercadería (perfumes, difusores, facturas de proveedor) no se cuentan como gasto operativo.',
    ].join('\n\n');
  }
  if (it === 'resumen') return respuestaMes(db, d, periodo, c.est, 'completo');
  if (it === 'ventas_mes') return respuestaMes(db, d, periodo, c.est, 'ventas');
  if (it === 'tendencia') {
    const cm = comparacionMeses(d, {}, c.est);
    const r = cm.resumen.ventas_netas;
    return `**DATO:** Mejor mes en ventas: ${r.mejor ? `${nombrePeriodo(r.mejor.periodo)} (${bs(r.mejor.v)})` : '—'}; peor mes: ${r.peor ? `${nombrePeriodo(r.peor.periodo)} (${bs(r.peor.v)})` : '—'}; promedio mensual ${bs(r.promedio)} (${r.meses_considerados} meses completos; excluidos por registro parcial: ${r.excluidos.join(', ') || 'ninguno'}).`;
  }
  void t;
  return 'No identifiqué con certeza qué indicador busca, por eso no muestro un resultado que podría no corresponder a su pregunta. Puedo responder sobre ventas, utilidad, márgenes, gastos, productos (rentabilidad, rotación, ranking), caja, inventario, comparación Cochabamba vs La Paz, alertas, datos faltantes y el origen de cualquier valor. Ejemplos: "¿Cuánto vendimos en marzo?", "Compara Cochabamba y La Paz", "Analiza el último mes", "¿Qué información falta?".';
}
