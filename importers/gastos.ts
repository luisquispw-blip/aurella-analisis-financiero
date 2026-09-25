// Rendiciones de gastos (con/sin factura), hojas antiguas con participación de socios y hojas de INVERSIÓN.
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config/app.config.ts';
import type { HojaLeida } from './lector.ts';
import { buscarEncabezado } from './lector.ts';
import type { ContextoLibro, EgresoNuevo, ResultadoHoja } from './tipos.ts';
import { resultadoVacio } from './tipos.ts';
import {
  establecimientoDeTexto, mapearColumnas, norm, parseFecha, parseNumero, periodoDeTexto, periodoStr, redondear,
  serialExcelAFecha, vacio, NOMBRE_MES, anioDeTexto,
} from './utilidades.ts';

const SIN = JSON.parse(fs.readFileSync(path.join(config.root, 'config', 'sinonimos_columnas.json'), 'utf8'));
const REQ = [['FECHA'], ['DESCRIPCION', 'DETALLE', 'CONCEPTO'], ['TOTAL PAGADO', 'IMPORTE', 'MONTO']];

export function detectarGastos(h: HojaLeida): number {
  const enc = buscarEncabezado(h, REQ, 15);
  if (enc === null) return 0;
  const celdas = h.filas[enc].map(norm);
  const tieneTodo = REQ.every((g) => g.some((s) => celdas.some((c) => c.includes(s))));
  // un registro de ventas también tiene "TOTAL"; exigimos ausencia de "CANTIDAD"
  if (celdas.some((c) => c.includes('CANTIDAD'))) return 0.1;
  return tieneTodo ? 0.9 : 0.5;
}

export function esHojaInversion(h: HojaLeida): boolean {
  const t = norm(h.nombre) + ' ' + h.filas.slice(0, 5).flat().map(norm).join(' ');
  return norm(h.nombre).includes('INVERSION') || /TOTAL INVERSION/.test(t);
}

type Candidato = { mes: number; anio: number | null; fuente: string };

function textoTitulos(h: HojaLeida, hasta: number): string[] {
  return h.filas.slice(0, hasta).flat().filter((v) => typeof v === 'string').map((v) => String(v));
}

export function importarGastos(h: HojaLeida, ctx: ContextoLibro): ResultadoHoja {
  const inversion = esHojaInversion(h);
  const r = resultadoVacio(inversion ? 'inversion' : 'gastos', detectarGastos(h));
  const M = r.mensajes;
  const filaX = (i: number) => i + h.filaInicial;
  const enc = buscarEncabezado(h, REQ, 15);
  if (enc === null) {
    M.push({ nivel: 'error', texto: 'No se encontró la fila de encabezados (FECHA, DESCRIPCIÓN/DETALLE, IMPORTE/TOTAL PAGADO).' });
    return r;
  }
  r.fila_encabezado = filaX(enc);
  const mapeo = mapearColumnas(h.filas[enc], SIN.gastos);
  // En hojas con columnas de participación hay varios "TOTAL"/"IMPORTE": el primero a la izquierda es el importe.
  r.mapeo = mapeo;
  if (!('monto' in mapeo) || !('descripcion' in mapeo)) {
    M.push({ nivel: 'error', texto: 'Faltan las columnas de descripción o importe.' });
    return r;
  }
  const titulos = textoTitulos(h, enc);

  // --- Establecimiento: nombre de hoja > títulos > nombre de archivo
  const estHoja = establecimientoDeTexto(h.nombre);
  const estTitulo = titulos.map(establecimientoDeTexto).find(Boolean) ?? null;
  const est = estHoja || estTitulo || ctx.estArchivo;
  if (!est) {
    M.push({ nivel: 'error', texto: `No se pudo determinar el establecimiento de la hoja "${h.nombre}".` });
    return r;
  }
  if (estTitulo && ctx.estArchivo && estTitulo !== ctx.estArchivo && !estHoja) {
    M.push({ nivel: 'info', texto: `El título indica ${estTitulo} aunque el archivo corresponde a ${ctx.estArchivo}; se usa ${estTitulo}.` });
  }
  r.establecimiento = est;

  // --- Variante con/sin factura
  const tn = norm(h.nombre) + ' ' + titulos.map(norm).join(' ');
  const conFactura = /\bCF\b|CON FACTURA/.test(tn) ? 1 : /\bSF\b|SIN FACT/.test(tn) ? 0 : null;
  r.variante = inversion ? 'INVERSION' : conFactura === 1 ? 'CF' : conFactura === 0 ? 'SF' : 'GENERAL';

  // --- Periodo (no aplica a inversión, que abarca varios meses)
  let anio = ctx.anioArchivo;
  let mes: number | null = null;
  if (!inversion) {
    const cands: Candidato[] = [];
    const ph = periodoDeTexto(h.nombre);
    if (ph) cands.push({ ...ph, fuente: 'nombre de la hoja' });
    for (const t of titulos) {
      const p = periodoDeTexto(t);
      if (p && /RENDICION|PERIODO|DEL \d|AL \d/.test(norm(t))) { cands.push({ ...p, fuente: `título "${t.trim()}"` }); break; }
    }
    // Fechas escritas como texto dd/mm/aaaa son inequívocas: sirven de árbitro
    const votos = new Map<number, number>();
    for (let i = enc + 1; i < h.filas.length; i++) {
      const v = h.filas[i][mapeo.fecha ?? 0];
      if (typeof v === 'string') {
        const pf = parseFecha(v);
        if (pf.fecha) votos.set(Number(pf.fecha.slice(5, 7)), (votos.get(Number(pf.fecha.slice(5, 7))) || 0) + 1);
      }
    }
    const mesVotado = [...votos.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
    const distintos = [...new Set(cands.map((c) => c.mes))];
    if (distintos.length > 1) {
      const elegido = cands.find((c) => c.mes === mesVotado) ?? cands[0];
      mes = elegido.mes;
      M.push({ nivel: 'advertencia', texto: `Periodo contradictorio: ${cands.map((c) => `${c.fuente} → ${NOMBRE_MES[c.mes]}`).join('; ')}. Se usa ${NOMBRE_MES[mes]} (${elegido.fuente}${mesVotado === mes ? ', confirmado por las fechas de los registros' : ''}).` });
    } else if (distintos.length === 1) {
      mes = distintos[0];
    } else if (mesVotado) {
      mes = mesVotado;
      M.push({ nivel: 'info', texto: `Periodo tomado de las fechas de los registros (${NOMBRE_MES[mes]}).` });
    }
    anio = cands.find((c) => c.anio)?.anio ?? anio ?? titulos.map(anioDeTexto).find(Boolean) ?? null;
    if (!mes || !anio) {
      M.push({ nivel: 'error', texto: `No se pudo determinar el periodo de la rendición "${h.nombre}". Indique el mes y año.` });
      return r;
    }
    r.periodo = periodoStr(anio, mes);
  }

  // --- Socios y participación (hojas con columnas COMAUREC / GA / JA)
  const idxPart = h.filas.slice(0, enc).findIndex((f) => f.some((v) => norm(v) === 'PARTICIPACION'));
  const colsSocio: { col: number; codigo: string; part: number }[] = [];
  if (idxPart >= 0) {
    const filaPct = h.filas[idxPart + 1] || [];
    const encab = h.filas[enc];
    for (let c = 0; c < encab.length; c++) {
      const pct = typeof filaPct[c] === 'number' ? (filaPct[c] as number) : null;
      if (pct !== null && pct > 0 && pct <= 1 && !vacio(encab[c])) {
        colsSocio.push({ col: c, codigo: String(encab[c]).trim(), part: pct });
      }
    }
    const suma = colsSocio.reduce((s, x) => s + x.part, 0);
    if (colsSocio.length) {
      r.socios = colsSocio.map((s) => ({ codigo: s.codigo, participacion: s.part }));
      if (Math.abs(suma - 1) > 0.001) M.push({ nivel: 'advertencia', texto: `La participación de socios suma ${redondear(suma * 100)}% (debería ser 100%).` });
    }
  }

  // Declaraciones al inicio de la hoja (TOTAL INVERSION, abonos): se registran como control, no como movimientos
  for (let i = 0; i < enc; i++) {
    const f = h.filas[i];
    for (let c = 0; c < f.length; c++) {
      const t = norm(f[c]);
      if (t === 'TOTAL INVERSION') {
        const v = f.slice(c + 1).find((x) => typeof x === 'number') as number | undefined;
        if (v !== undefined) r.control.push({ fila: filaX(i), establecimiento_id: est, fecha: null, periodo: 'GLOBAL', concepto: 'total_inversion_declarado', monto: v, nota: null });
      }
      if (t.startsWith('ABONO') && typeof h.filas[i + 1]?.[c] === 'number') {
        M.push({ nivel: 'info', fila: filaX(i), texto: `Se detectó "${String(f[c]).trim()}" = ${h.filas[i + 1][c]}. No se registra automáticamente como aporte de capital porque la hoja no indica fecha ni la cuenta de destino; confírmelo en "Datos faltantes" si corresponde.` });
      }
    }
  }

  // --- Filas
  type Pendiente = { e: EgresoNuevo; serial: number | null };
  const grupo: Pendiente[] = []; // filas desde el último subtotal
  const todos: Pendiente[] = [];
  let cierraGrupo = false;
  const cF = mapeo.fecha ?? 0;
  for (let i = enc + 1; i < h.filas.length; i++) {
    const f = h.filas[i];
    if (!f.some((v) => !vacio(v))) continue;
    const fila = filaX(i);
    const vf = f[cF];
    const desc = vacio(f[mapeo.descripcion]) ? '' : String(f[mapeo.descripcion]).replace(/\s+/g, ' ').trim();
    const nd = norm(desc);
    const nf = norm(vf);
    const monto = parseNumero(f[mapeo.monto]);
    const doc = 'documento' in mapeo && !vacio(f[mapeo.documento]) ? String(f[mapeo.documento]).trim() : null;

    // Subtotales / totales / flujo
    const etiquetaTotal = nf.startsWith('TOTAL') || nd.startsWith('TOTAL') || nd.startsWith('FLUJO') || nf.startsWith('FLUJO') || nd === 'SALDO';
    if (etiquetaTotal) {
      const sumaGrupo = redondear(grupo.reduce((s, p) => s + p.e.monto, 0));
      const esSubtotal = monto.valor === null || Math.abs(sumaGrupo - (monto.valor ?? 0)) <= 0.5;
      const esDolares = /\$|DOLAR|USD/.test(nf + ' ' + nd);
      if (esDolares) {
        for (const p of grupo) { p.e.moneda = 'USD'; p.e.nota = [p.e.nota, 'monto en dólares (según subtotal "' + [nf, nd].filter(Boolean).join(' ') + '")'].filter(Boolean).join('; '); }
        M.push({ nivel: 'advertencia', fila, texto: `${grupo.length} egreso(s) por USD ${sumaGrupo} están expresados en dólares. No se suman a los montos en bolivianos hasta que se registre el tipo de cambio (Configuración).` });
      }
      if (!esSubtotal && doc && desc && !/^GASTOS AURELLA/.test(nd) && !esDolares) {
        // Fila de detalle cuya celda de fecha contiene un rótulo "TOTAL ..." (tiene comprobante propio)
        M.push({ nivel: 'info', fila, texto: `"${desc}" (Bs ${monto.valor}, comprobante ${doc}) tiene un rótulo de total en la columna fecha pero no suma filas anteriores: se registra como egreso individual.` });
        grupo.length = 0;
        cierraGrupo = true;
      } else {
        if (monto.valor !== null) {
          const conc = /INGRESO/.test(nd + nf) ? 'total_ingresos_declarado' : /FLUJO/.test(nd + nf) ? 'flujo_declarado' : 'subtotal_declarado';
          r.control.push({ fila, establecimiento_id: est, fecha: null, periodo: r.periodo ?? 'GLOBAL', concepto: conc, monto: monto.valor, nota: [nf, nd].filter(Boolean).join(' ') });
          if (conc === 'subtotal_declarado' && !esSubtotal && grupo.length) {
            M.push({ nivel: 'advertencia', fila, texto: `Subtotal declarado "${[String(vf ?? '').trim(), desc].filter(Boolean).join(' ')}" = ${monto.valor} ≠ suma de las ${grupo.length} filas anteriores (${sumaGrupo}). Se usa el detalle.` });
          }
        }
        grupo.length = 0;
        continue;
      }
    }

    if (monto.valor === null) {
      if (desc) M.push({ nivel: 'info', fila, texto: `Concepto "${desc}" sin importe${doc ? ` (${doc})` : ''}: no se registra.` });
      continue;
    }
    if (monto.valor === 0) continue;
    if (!desc && vacio(vf) && !doc) {
      M.push({ nivel: 'info', fila, texto: `Valor suelto ${monto.valor} sin fecha ni descripción: no se interpreta.` });
      continue;
    }

    // Fecha
    let fecha: string | null = null;
    const notasF: string[] = [];
    let serial: number | null = null;
    if (!vacio(vf)) {
      if (typeof vf === 'number') serial = vf;
      // un rótulo "TOTAL A 13/02/2026" puede contener la fecha
      const valorFecha = typeof vf === 'string' && /^TOTAL/.test(nf) && /\d{1,2}\/\d{1,2}\/\d{2,4}/.test(vf) ? vf.match(/\d{1,2}\/\d{1,2}\/\d{2,4}/)![0] : vf;
      let pf = parseFecha(valorFecha, inversion ? {} : { anio, mes });
      if (inversion && !pf.fecha && /sin año/.test(pf.nota ?? '')) pf = parseFecha(valorFecha, { anio: ctx.anioArchivo });
      if (valorFecha !== vf && pf.fecha) notasF.push(`fecha tomada del rótulo "${String(vf).trim()}"`);
      fecha = pf.fecha;
      if (pf.nota) notasF.push(pf.nota);
      if (!fecha) M.push({ nivel: 'advertencia', fila, texto: `"${desc}": ${pf.nota ?? 'fecha no válida'} (valor: ${String(vf)}).` });
    }
    const notas: string[] = [];
    if (monto.nota) notas.push(monto.nota);
    let estado: 'valido' | 'observado' = 'valido';
    if (monto.valor < 0) {
      estado = 'observado';
      M.push({ nivel: 'advertencia', fila, texto: `"${desc}": importe negativo (${monto.valor}); puede ser una devolución o un error de digitación.` });
    }
    if (!desc) {
      estado = 'observado';
      notas.push('egreso sin descripción');
      M.push({ nivel: 'advertencia', fila, texto: `Egreso de Bs ${monto.valor} sin descripción${doc ? ` (comprobante ${doc})` : ''}: se clasifica como "Otros".` });
    }
    // Reasignación de establecimiento por descripción (p. ej. "Alquiler LA PAZ" dentro del archivo de Cochabamba)
    let estFila = est;
    const estDesc = establecimientoDeTexto(desc);
    if (estDesc && estDesc !== est) {
      estFila = estDesc;
      notas.push(`asignado a ${estDesc} por la descripción (registrado en archivo de ${est})`);
    }
    const partic: Record<string, number> = {};
    for (const s of colsSocio) {
      const v = parseNumero(f[s.col]).valor;
      if (v !== null) partic[s.codigo] = v;
    }
    const e: EgresoNuevo = {
      fila, establecimiento_id: estFila, establecimiento_archivo: est, fecha, fecha_texto: vacio(vf) ? null : String(vf),
      fecha_nota: notasF.join('; ') || null, periodo: r.periodo, descripcion: desc || '(sin descripción)',
      proveedor: 'proveedor' in mapeo && !vacio(f[mapeo.proveedor]) ? String(f[mapeo.proveedor]).trim() : null,
      documento: doc, monto: monto.valor, moneda: 'BOB', con_factura: conFactura, nivel: 'detalle',
      origen: inversion ? 'inversion' : 'gastos', participaciones: Object.keys(partic).length ? JSON.stringify(partic) : null,
      estado, nota: notas.join('; ') || null,
    };
    // Observaciones de la columna SALDO/nota ("5 DIAS", "(PAGO POR COBRAR A SCZ)")
    if ('observacion' in mapeo && !vacio(f[mapeo.observacion]) && typeof f[mapeo.observacion] === 'string') {
      e.nota = [e.nota, String(f[mapeo.observacion]).trim()].filter(Boolean).join('; ');
    }
    const p = { e, serial };
    if (!cierraGrupo) grupo.push(p);
    cierraGrupo = false;
    todos.push(p);
  }

  // Inversión: fechas numéricas ambiguas (día ≤ 12) se ordenan según la secuencia de fechas escritas como texto
  if (inversion) {
    let ref: string | null = null;
    for (const p of todos) {
      if (p.serial !== null) {
        const { y, m, d } = serialExcelAFecha(p.serial);
        if (d <= 12 && m !== d) {
          const directa = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
          const invertida = `${y}-${String(d).padStart(2, '0')}-${String(m).padStart(2, '0')}`;
          if (ref) {
            const dist = (a: string) => Math.abs(Date.parse(a) - Date.parse(ref!));
            if (dist(invertida) < dist(directa)) {
              p.e.fecha = invertida;
              p.e.fecha_nota = [p.e.fecha_nota, 'día y mes invertidos por Excel; corregido según la secuencia de fechas de la hoja'].filter(Boolean).join('; ');
            }
          }
        }
      }
      // Fechas que rompen la secuencia (> 60 días respecto de la fila anterior): se conservan pero el periodo sigue la secuencia
      if (p.e.fecha && ref && Math.abs(Date.parse(p.e.fecha) - Date.parse(ref)) > 60 * 86400_000) {
        p.e.fecha_nota = [p.e.fecha_nota, `fecha ${p.e.fecha} fuera de la secuencia de la hoja; periodo asignado según la fila anterior`].filter(Boolean).join('; ');
        M.push({ nivel: 'advertencia', fila: p.e.fila, texto: `"${p.e.descripcion}": fecha ${p.e.fecha} fuera de la secuencia (fila anterior ${ref}). Se asigna al periodo ${ref.slice(0, 7)}.` });
        p.e.periodo = ref.slice(0, 7);
        continue;
      }
      if (p.e.fecha) ref = p.e.fecha;
      // Periodo: fecha propia o la de la fila anterior
      if (p.e.fecha) p.e.periodo = p.e.fecha.slice(0, 7);
    }
    let prev: string | null = null;
    for (const p of todos) {
      if (!p.e.periodo && prev) {
        p.e.periodo = prev;
        p.e.fecha_nota = [p.e.fecha_nota, 'sin fecha: se asigna al periodo de la fila anterior'].filter(Boolean).join('; ');
      }
      if (p.e.periodo) prev = p.e.periodo;
      if (!p.e.periodo) {
        p.e.estado = 'observado';
        M.push({ nivel: 'advertencia', fila: p.e.fila, texto: `"${p.e.descripcion}": sin fecha ni referencia de periodo.` });
      }
    }
    const pers = [...new Set(todos.map((p) => p.e.periodo).filter(Boolean))].sort();
    r.periodo = pers.length ? `${pers[0]}..${pers[pers.length - 1]}` : null;
    const totalBob = redondear(todos.filter((p) => p.e.moneda === 'BOB').reduce((s, p) => s + p.e.monto, 0));
    for (const c of r.control.filter((c) => c.concepto === 'total_inversion_declarado')) {
      const dif = redondear(c.monto - totalBob);
      M.push({
        nivel: Math.abs(dif) > 1 ? 'advertencia' : 'info', fila: c.fila,
        texto: Math.abs(dif) > 1
          ? `TOTAL INVERSION declarado Bs ${c.monto} ≠ suma del detalle en bolivianos Bs ${totalBob} (diferencia ${dif}).`
          : `TOTAL INVERSION declarado coincide con el detalle (Bs ${totalBob}).`,
      });
    }
  }
  r.egresos = todos.map((p) => p.e);
  if (!r.egresos.length) M.push({ nivel: 'advertencia', texto: 'La hoja no contiene egresos con importe.' });
  return r;
}
