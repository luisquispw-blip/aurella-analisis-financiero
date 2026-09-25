// Registro diario de ventas: hojas por mes con bloques por día
//   [encabezado de día] -> [líneas de venta; col A = n° de ticket, vacío = mismo ticket] -> [bloque de cierre de caja]
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config/app.config.ts';
import type { HojaLeida } from './lector.ts';
import { buscarEncabezado } from './lector.ts';
import type { ContextoLibro, ResultadoHoja } from './tipos.ts';
import { resultadoVacio } from './tipos.ts';
import {
  anioDeTexto, esTextoFecha, mapearColumnas, norm, parseFecha, parseNumero, periodoDeTexto, periodoStr,
  establecimientoDeTexto, redondear, vacio, NOMBRE_MES,
} from './utilidades.ts';

const SIN = JSON.parse(fs.readFileSync(path.join(config.root, 'config', 'sinonimos_columnas.json'), 'utf8'));
export const SINONIMOS_VENTAS: Record<string, string[]> = SIN.ventas;

const MEDIOS: Record<string, string> = {
  EFECTIVO: 'EFECTIVO', CASH: 'EFECTIVO', QR: 'QR', DELIVERY: 'DELIVERY', TARJETA: 'TARJETA', POS: 'TARJETA',
  TRANSFERENCIA: 'TRANSFERENCIA', DEPOSITO: 'TRANSFERENCIA',
};
export function normalizarMedioPago(v: unknown): string | null {
  const t = norm(v);
  if (!t) return null;
  for (const [k, m] of Object.entries(MEDIOS)) if (t.includes(k)) return m;
  return t;
}

const ETIQUETAS_CIERRE = ['TIPO PAGO', 'CAJA', 'CIERRE CAJA', 'CIERRE DE CAJA', 'TOTAL DIA', 'TOTAL DEL DIA', 'FONDO DE CAJA', 'FONDO CAJA', 'TOTAL'];

const RE_ROTULO = /^(TOTAL|VENTAS|NETO|GASTOS|INGRESOS|FLUJO|SALDO)\b/;

function esEtiquetaCierre(t: string): boolean {
  return ETIQUETAS_CIERRE.includes(t) || t.startsWith('TOTAL') || t.startsWith('FONDO') || t.startsWith('CIERRE');
}

// Puntaje de "registro de ventas": filas con patrón [ticket?, texto, cant, precio, total, tamaño]
export function detectarRegistroVentas(h: HojaLeida): number {
  let patron = 0, dias = 0;
  for (const f of h.filas.slice(0, 400)) {
    if (typeof f[1] === 'string' && typeof f[2] === 'number' && (typeof f[3] === 'number' || typeof f[4] === 'number')) patron++;
    if (esTextoFecha(f[0]) && f.slice(1, 6).every(vacio)) dias++;
  }
  const enc = buscarEncabezado(h, [['PRODUCTO'], ['CANTIDAD'], ['PRECIO', 'TOTAL VENTA']]);
  let s = 0;
  if (enc !== null) s += 0.5;
  if (patron >= 5 || (patron >= 1 && dias >= 1)) s += 0.3;
  if (dias >= 1) s += 0.2;
  return Math.min(s, 1);
}

export function importarRegistroVentas(h: HojaLeida, ctx: ContextoLibro): ResultadoHoja {
  const r = resultadoVacio('ventas_registro', detectarRegistroVentas(h));
  const M = r.mensajes;
  const filaX = (i: number) => i + h.filaInicial;

  // --- Establecimiento
  const est = establecimientoDeTexto(h.nombre) || ctx.estArchivo;
  if (!est) {
    M.push({ nivel: 'error', texto: `No se pudo determinar el establecimiento de la hoja "${h.nombre}". Indique si corresponde a Cochabamba o La Paz (o incluya la ciudad en el nombre del archivo).` });
    return r;
  }
  r.establecimiento = est;

  // --- Encabezados (o heredados de una hoja hermana del mismo libro)
  let enc = buscarEncabezado(h, [['PRODUCTO'], ['CANTIDAD'], ['PRECIO', 'TOTAL VENTA'], ['TIPO DE PAGO', 'TAMANO']]);
  let mapeo: Record<string, number>;
  if (enc !== null) {
    mapeo = mapearColumnas(h.filas[enc], SINONIMOS_VENTAS);
  } else if (ctx.mapeosVentas.length) {
    mapeo = ctx.mapeosVentas[0];
    M.push({ nivel: 'advertencia', texto: 'La hoja no tiene fila de encabezados; se aplicó la estructura de columnas de otra hoja del mismo archivo y se verificó con el patrón de las filas.' });
  } else {
    mapeo = { producto: 1, cantidad: 2, precio: 3, total: 4, tamano: 5, tipo_pago: 7 };
    M.push({ nivel: 'advertencia', texto: 'Sin fila de encabezados: se infirió la estructura por el patrón de las filas (producto, cantidad, precio, total, tamaño, pago).' });
  }
  r.fila_encabezado = enc === null ? null : filaX(enc);
  r.mapeo = mapeo;
  const faltan = ['producto', 'cantidad', 'total'].filter((c) => !(c in mapeo) && !(c === 'total' && 'precio' in mapeo));
  if (faltan.length) {
    M.push({ nivel: 'error', texto: `Faltan columnas necesarias: ${faltan.join(', ')}.` });
    return r;
  }
  const col = (f: unknown[], k: string) => (k in mapeo ? f[mapeo[k]] : null);

  // --- Periodo: nombre de hoja > encabezados de día; año: hoja > archivo > fechas con año
  const perHoja = periodoDeTexto(h.nombre);
  let anio = perHoja?.anio ?? ctx.anioArchivo;
  let mes = perHoja?.mes ?? null;
  if (!anio || !mes) {
    for (const f of h.filas) {
      if (typeof f[0] !== 'string') continue;
      const y = anioDeTexto(f[0]);
      const p = periodoDeTexto(f[0]);
      if (!anio && y) anio = y;
      if (!mes && p && esTextoFecha(f[0])) mes = p.mes;
      if (anio && mes) break;
    }
  }
  if (!mes || !anio) {
    M.push({ nivel: 'error', texto: `No se pudo determinar el periodo (mes/año) de la hoja "${h.nombre}". Indique el mes y año de estas ventas.` });
    return r;
  }
  const periodo = periodoStr(anio, mes);
  r.periodo = periodo;

  // Total del mes declarado en el encabezado (p. ej. "TOTAL | 77992" a la derecha de los encabezados)
  if (enc !== null) {
    const fe = h.filas[enc];
    for (let c = 0; c < fe.length - 1; c++) {
      const t = norm(fe[c]);
      if (t.startsWith('TOTAL') && !Object.values(mapeo).includes(c) && typeof fe[c + 1] === 'number') {
        r.control.push({ fila: filaX(enc), establecimiento_id: est, fecha: null, periodo, concepto: 'total_mes_declarado', monto: fe[c + 1] as number, nota: `Celda ${String(fe[c])} del encabezado` });
      }
    }
  }

  let fecha: string | null = null;
  let ticket: string | null = null;
  let enCierre = false;
  let enGastos = false;
  const sumaDiaMedio = new Map<string, Map<string, number>>();
  const diasVistos = new Map<string, number>();
  const sumaDia = new Map<string, number>();
  const declaradoDia = new Map<string, { monto: number; fila: number }>();
  const inicio = enc === null ? 0 : enc + 1;

  for (let i = inicio; i < h.filas.length; i++) {
    const f = h.filas[i];
    if (!f.some((v) => !vacio(v))) continue;
    const c0 = f[0];
    const t0 = norm(c0);
    const fila = filaX(i);

    // Conceptos de un bloque "GASTOS <MES>" dentro de la hoja de ventas: solo control
    if (enGastos && !(typeof c0 === 'string' && parseFecha(c0, { anio, mes }).fecha) && !/^TOTAL/.test(t0)) {
      const v = f.map((x) => (typeof x === 'number' ? x : null)).find((x) => x !== null);
      if (v !== undefined && v !== null) r.control.push({ fila, establecimiento_id: est, fecha: null, periodo, concepto: 'gasto_declarado_en_hoja_ventas', monto: v, nota: String(c0 ?? '') });
      continue;
    }

    // Encabezado de día
    if (typeof c0 === 'string' && vacio(col(f, 'cantidad')) && vacio(col(f, 'precio')) && !esEtiquetaCierre(t0)) {
      const pf = parseFecha(c0, { anio, mes });
      if (pf.fecha) {
        fecha = pf.fecha;
        ticket = null;
        enCierre = false;
        enGastos = false;
        if (pf.nota && !pf.nota.startsWith('año tomado')) M.push({ nivel: 'advertencia', fila, texto: `Encabezado de día "${String(c0).trim()}": ${pf.nota}.` });
        if (diasVistos.has(fecha)) M.push({ nivel: 'advertencia', fila, texto: `La fecha ${fecha} aparece dos veces en la hoja (también en la fila ${diasVistos.get(fecha)}). Verifique que no sea un día duplicado.` });
        else diasVistos.set(fecha, fila);
        continue;
      }
      if (!esEtiquetaCierre(t0) && vacio(col(f, 'producto')) && !RE_ROTULO.test(t0)) {
        M.push({ nivel: 'advertencia', fila, texto: `Texto no reconocido en columna A: "${String(c0).trim()}" (${pf.nota ?? 'no es fecha'}). Fila ignorada.` });
        continue;
      }
    }

    // Filas de resumen con rótulo en cualquier columna ("VENTAS FEBRERO", "TOTAL DELIVERIES", "GASTOS FEBRERO"...)
    const rotulo = f.slice(0, 5).map(norm).find((t) => RE_ROTULO.test(t));
    const cierreDiario = typeof c0 === 'string' && esEtiquetaCierre(t0) && !/DELIVER|GASTOS|INGRESO|VENTAS|NETO/.test(t0) && !periodoDeTexto(t0);
    if (rotulo && !cierreDiario && typeof parseNumero(col(f, 'cantidad')).valor !== 'number' && !(typeof c0 === 'number')) {
      const nums = f.map((v) => (typeof v === 'number' ? v : null)).filter((v) => v !== null) as number[];
      if (/^GASTOS/.test(rotulo) && !nums.length) {
        enGastos = true;
        M.push({ nivel: 'advertencia', fila, texto: `La hoja de ventas contiene un bloque "${rotulo}". Sus conceptos no se importan como gastos desde aquí (los gastos se toman de las rendiciones y resúmenes de gastos); se conservan como control.` });
        continue;
      }
      const concepto = /DELIVER/.test(rotulo) ? 'total_deliveries_declarado' : /GASTOS/.test(rotulo) ? 'total_gastos_declarado'
        : /NETO|FLUJO|SALDO/.test(rotulo) ? 'neto_declarado' : 'total_mes_declarado';
      if (nums.length) r.control.push({ fila, establecimiento_id: est, fecha: null, periodo, concepto, monto: nums[0], nota: f.filter((v) => v !== null).join(' | ') });
      enCierre = true;
      if (/^TOTAL GASTOS/.test(rotulo)) enGastos = false;
      continue;
    }
    // Bloque de cierre de caja
    const t1 = norm(f[1]);
    const esMedioSuelto = !!MEDIOS[t1] && vacio(col(f, 'cantidad')) && parseNumero(col(f, 'precio')).valor !== null
      && (vacio(c0) || (typeof c0 === 'string' && !esTextoFecha(c0)));
    if (esMedioSuelto && !vacio(c0) && !esEtiquetaCierre(t0)) {
      M.push({ nivel: 'advertencia', fila, texto: `Rótulo "${String(c0).trim()}" en una fila de cobro por ${t1}; se interpreta como desglose de TIPO DE PAGO.` });
    }
    if ((typeof c0 === 'string' && esEtiquetaCierre(t0)) || esMedioSuelto) {
      if (!enCierre && t0 && t0 !== 'TIPO PAGO' && !t0.startsWith('FONDO') && !t0.startsWith('CIERRE') && t0 !== 'CAJA' && !t0.startsWith('TOTAL')) {
        M.push({ nivel: 'info', fila, texto: `Etiqueta de cierre "${t0}" no reconocida.` });
      }
      enCierre = true;
      const valor = [col(f, 'precio'), f[3], col(f, 'total'), f[2], f[4]].map((v) => parseNumero(v).valor).find((v) => v !== null && v !== undefined) ?? null;
      let concepto: string;
      const nota = f.slice(4).filter((v) => typeof v === 'string').join(' ').trim() || null;
      if (esMedioSuelto || (t0 === 'TIPO PAGO' && MEDIOS[t1])) concepto = `cobro_${(normalizarMedioPago(f[1]) || 'OTRO').toLowerCase()}`;
      else if (t0 === 'CAJA') concepto = 'caja';
      else if (t0.startsWith('CIERRE')) concepto = 'cierre_caja';
      else if (t0.startsWith('FONDO')) concepto = 'fondo_caja';
      else if (t0 === 'TOTAL DIA' || t0 === 'TOTAL DEL DIA' || (t0 === 'TOTAL' && fecha)) concepto = 'total_dia';
      else if (t0.startsWith('TOTAL') && (periodoDeTexto(t0) || t0.includes('INGRESO'))) concepto = 'total_mes_declarado';
      else concepto = 'otro_' + t0.toLowerCase().replace(/[^a-z]+/g, '_');
      if (valor !== null) {
        r.control.push({ fila, establecimiento_id: est, fecha: concepto === 'total_mes_declarado' ? null : fecha, periodo, concepto, monto: valor, nota });
        if (concepto === 'total_dia' && fecha) declaradoDia.set(fecha, { monto: valor, fila });
      }
      continue;
    }
    if (enCierre && vacio(col(f, 'producto')) && vacio(col(f, 'cantidad'))) {
      // Totales sueltos al pie de la hoja (sin etiqueta) u otros valores del bloque de cierre
      const nums = f.map((v) => parseNumero(v).valor).filter((v) => v !== null);
      if (nums.length) M.push({ nivel: 'info', fila, texto: `Valor(es) sin etiqueta en el bloque de cierre (${nums.join(', ')}). No se interpretan.` });
      continue;
    }

    // Línea de venta
    const prod = vacio(col(f, 'producto')) ? null : String(col(f, 'producto')).replace(/\s+/g, ' ').trim();
    const cant = parseNumero(col(f, 'cantidad'));
    const prec = parseNumero(col(f, 'precio'));
    const tot = parseNumero(col(f, 'total'));
    if (!prod && !cant.valor && !prec.valor && !tot.valor) continue; // residuos de fórmulas ("0", "-")
    if (!prod && tot.valor === null) {
      M.push({ nivel: 'info', fila, texto: `Valores sin producto ni total (${f.filter((v) => v !== null).join(' | ')}): no se interpretan como venta.` });
      continue;
    }
    if (enCierre) {
      // una venta después del bloque de cierre sin nuevo encabezado de día
      M.push({ nivel: 'advertencia', fila, texto: `Venta registrada después del cierre de caja del ${fecha ?? 'día'} sin nuevo encabezado de fecha; se asigna al mismo día.` });
      enCierre = false;
    }
    const notas: string[] = [];
    for (const n of [cant.nota, prec.nota, tot.nota]) if (n) notas.push(n);
    let estado: 'valido' | 'observado' = 'valido';

    if (typeof c0 === 'number' && Number.isInteger(c0) && c0 > 0 && c0 < 10000) ticket = `${fecha ?? periodo}#${c0}`;
    else if (!vacio(c0) && typeof c0 !== 'number') notas.push(`columna A con texto "${String(c0).trim()}"`);

    let total = tot.valor;
    let precio = prec.valor;
    const cantidad = cant.valor;
    if (total === null && cantidad !== null && precio !== null) {
      total = redondear(cantidad * precio);
      notas.push('total calculado como cantidad × precio (celda de total vacía)');
    }
    if (precio === null && total && cantidad) {
      precio = redondear(total / cantidad, 4);
      notas.push('precio unitario derivado de total ÷ cantidad');
    }
    if (total !== null && cantidad !== null && precio !== null && Math.abs(total - cantidad * precio) > 0.01) {
      notas.push(`total (${total}) ≠ cantidad × precio (${redondear(cantidad * precio)}); se respeta el total registrado`);
      estado = 'observado';
      M.push({ nivel: 'advertencia', fila, texto: `${prod ?? 'Venta'}: total ${total} no coincide con cantidad × precio = ${redondear(cantidad * precio)}.` });
    }
    total = total ?? 0;
    const esObsequio = total === 0 && (precio === null || precio === 0) ? 1 : 0;
    const esDevolucion = (total < 0 || (cantidad ?? 0) < 0) ? 1 : 0;
    if (!prod && total !== 0) {
      estado = 'observado';
      notas.push('venta sin producto identificado');
      M.push({ nivel: 'advertencia', fila, texto: `Venta de Bs ${total} sin nombre de producto: se incluye en ventas netas pero no puede costearse.` });
    }
    if (cantidad === null && prod) {
      notas.push('cantidad vacía');
      if (!esObsequio) { estado = 'observado'; M.push({ nivel: 'advertencia', fila, texto: `${prod}: cantidad vacía; no se cuentan unidades ni costo de esta línea.` }); }
    }
    if (esDevolucion) M.push({ nivel: 'advertencia', fila, texto: `${prod ?? 'Línea'}: valor negativo, tratado como devolución.` });
    if (!fecha) {
      estado = 'observado';
      notas.push('venta sin encabezado de fecha');
      M.push({ nivel: 'advertencia', fila, texto: 'Venta antes del primer encabezado de día: se asigna al periodo de la hoja sin fecha.' });
    }
    let tam = parseNumero(col(f, 'tamano')).valor;
    if (tam === null && prod) {
      const m = norm(prod).match(/(\d{1,3})\s*ML\b/);
      if (m) { tam = Number(m[1]); notas.push('tamaño tomado del nombre del producto'); }
    }
    r.ventas.push({
      fila, establecimiento_id: est, fecha, periodo, ticket, producto_texto: prod, tamano_ml: tam, cantidad,
      precio_unitario: precio, total, tipo_pago: normalizarMedioPago(col(f, 'tipo_pago')),
      observaciones: vacio(col(f, 'observaciones')) ? null : String(col(f, 'observaciones')).trim(),
      es_obsequio: esObsequio, es_devolucion: esDevolucion, estado, nota: notas.join('; ') || null,
    });
    if (fecha) {
      sumaDia.set(fecha, (sumaDia.get(fecha) || 0) + total);
      const md = sumaDiaMedio.get(fecha) || sumaDiaMedio.set(fecha, new Map()).get(fecha)!;
      const medio = normalizarMedioPago(col(f, 'tipo_pago')) || 'SIN MEDIO';
      md.set(medio, (md.get(medio) || 0) + total);
    }
  }

  // --- Conciliaciones internas del propio registro del propietario
  for (const [dia, dec] of declaradoDia) {
    const calc = redondear(sumaDia.get(dia) || 0);
    if (Math.abs(calc - dec.monto) > 0.5) {
      const dif = redondear(calc - dec.monto);
      const medios = sumaDiaMedio.get(dia) || new Map();
      const explica = [...medios.entries()].find(([, v]) => Math.abs(redondear(v) - dif) <= 0.5);
      if (explica) {
        M.push({ nivel: 'info', fila: dec.fila, texto: `Día ${dia}: el total declarado (Bs ${dec.monto}) no incluye las ventas por ${explica[0]} (Bs ${redondear(explica[1])}); el detalle sí las incluye.` });
        continue;
      }
      M.push({ nivel: 'advertencia', fila: dec.fila, texto: `Día ${dia}: total declarado Bs ${dec.monto} ≠ suma de líneas de venta Bs ${calc} (diferencia ${redondear(dec.monto - calc)}).` });
    }
  }
  const totalHoja = redondear(r.ventas.reduce((s, v) => s + v.total, 0));
  for (const c of r.control.filter((c) => c.concepto === 'total_mes_declarado')) {
    const dif = redondear(c.monto - totalHoja);
    M.push({
      nivel: Math.abs(dif) > 1 ? 'advertencia' : 'info', fila: c.fila,
      texto: Math.abs(dif) > 1
        ? `Total del mes declarado Bs ${c.monto} ≠ suma de ventas registradas Bs ${totalHoja} (diferencia ${dif}). El sistema usa el detalle línea por línea.`
        : `Total del mes declarado (Bs ${c.monto}) coincide con la suma del detalle.`,
    });
  }
  if (mes && diasVistos.size) {
    const fuera = [...diasVistos.keys()].filter((d) => Number(d.slice(5, 7)) !== mes);
    if (fuera.length) M.push({ nivel: 'advertencia', texto: `Hay ${fuera.length} día(s) de otro mes dentro de la hoja ${NOMBRE_MES[mes]}: ${fuera.join(', ')}. Se asignan al periodo de la hoja.` });
  }
  if (!r.ventas.length) M.push({ nivel: 'advertencia', texto: 'La hoja no contiene líneas de venta.' });
  return r;
}
