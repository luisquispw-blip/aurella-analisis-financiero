// Importadores de: resumen mensual de gastos, tabla de costos, catálogo de productos,
// y tablas genéricas (ventas por fila, movimientos de inventario, saldos financieros).
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config/app.config.ts';
import type { HojaLeida } from './lector.ts';
import { buscarEncabezado } from './lector.ts';
import type { ContextoLibro, ResultadoHoja } from './tipos.ts';
import { resultadoVacio } from './tipos.ts';
import {
  establecimientoDeTexto, mapearColumnas, mesDePalabra, norm, parseFecha, parseNumero, periodoStr, redondear, vacio,
  NOMBRE_MES,
} from './utilidades.ts';
import { clavePresentacionArticulo } from '../services/productos.ts';
import { normalizarMedioPago } from './ventas_registro.ts';

const SIN = JSON.parse(fs.readFileSync(path.join(config.root, 'config', 'sinonimos_columnas.json'), 'utf8'));
const filaX = (h: HojaLeida, i: number) => i + h.filaInicial;

// ---------------- Resumen de gastos (conceptos × meses) ----------------
function columnasMes(f: unknown[]): { col: number; mes: number }[] {
  const res: { col: number; mes: number }[] = [];
  f.forEach((v, c) => {
    if (typeof v !== 'string') return;
    const t = norm(v);
    if (t.split(' ').length > 2) return;
    const m = mesDePalabra(t);
    if (m) res.push({ col: c, mes: m });
  });
  return res;
}

export function detectarResumenGastos(h: HojaLeida): number {
  for (let i = 0; i < Math.min(6, h.filas.length); i++) {
    if (columnasMes(h.filas[i]).length >= 2) {
      const tieneTotal = h.filas.some((f) => /TOTAL GASTOS|FLUJO/.test(norm(f[0])));
      return tieneTotal ? 0.85 : 0.5;
    }
  }
  return 0;
}

export function importarResumenGastos(h: HojaLeida, ctx: ContextoLibro): ResultadoHoja {
  const r = resultadoVacio('resumen_gastos', detectarResumenGastos(h));
  const M = r.mensajes;
  const est = establecimientoDeTexto(h.nombre) || ctx.estArchivo;
  if (!est) { M.push({ nivel: 'error', texto: 'No se pudo determinar el establecimiento del resumen.' }); return r; }
  r.establecimiento = est;
  const anio = ctx.anioArchivo;
  if (!anio) { M.push({ nivel: 'error', texto: 'No se pudo determinar el año del resumen (incluya el año en el nombre del archivo).' }); return r; }
  let enc = -1, cols: { col: number; mes: number }[] = [];
  for (let i = 0; i < Math.min(6, h.filas.length); i++) {
    const c = columnasMes(h.filas[i]);
    if (c.length >= 2) { enc = i; cols = c; break; }
  }
  r.fila_encabezado = filaX(h, enc);
  const colsMes = new Set(cols.map((c) => c.col));
  const ignoradas = new Map<number, number>();
  for (let i = enc + 1; i < h.filas.length; i++) {
    const f = h.filas[i];
    const concepto = vacio(f[0]) ? '' : String(f[0]).trim();
    const t = norm(concepto);
    if (!concepto) continue;
    if (/^TOTAL|INGRESO|FLUJO|SALDO/.test(t)) {
      for (const { col, mes } of cols) {
        const v = parseNumero(f[col]).valor;
        if (v !== null) r.control.push({ fila: filaX(h, i), establecimiento_id: est, fecha: null, periodo: periodoStr(anio, mes), concepto: /INGRESO/.test(t) ? 'total_ingresos_declarado' : /FLUJO/.test(t) ? 'flujo_declarado' : 'total_gastos_declarado', monto: v, nota: concepto });
      }
      continue;
    }
    for (const { col, mes } of cols) {
      const v = parseNumero(f[col]).valor;
      if (v === null || v === 0) continue;
      r.egresos.push({
        fila: filaX(h, i), establecimiento_id: est, establecimiento_archivo: est, fecha: null, fecha_texto: null, fecha_nota: null,
        periodo: periodoStr(anio, mes), descripcion: concepto, proveedor: null, documento: null, monto: v, moneda: 'BOB',
        con_factura: null, nivel: 'resumen', origen: 'resumen', participaciones: null, estado: 'valido',
        nota: 'importe mensual resumido (sin detalle de comprobantes)',
      });
    }
    f.forEach((v, c) => { if (c > 0 && !colsMes.has(c) && typeof v === 'number') ignoradas.set(c, (ignoradas.get(c) || 0) + 1); });
  }
  if (ignoradas.size) {
    M.push({ nivel: 'advertencia', texto: `Columnas sin encabezado de mes con valores (${[...ignoradas.keys()].map((c) => String.fromCharCode(65 + c)).join(', ')}): no se interpretan porque no se sabe a qué periodo corresponden.` });
  }
  const pers = [...new Set(r.egresos.map((e) => e.periodo))].sort();
  r.periodo = pers.join(',');
  M.push({ nivel: 'info', texto: `Resumen de ${pers.map((p) => NOMBRE_MES[Number(p!.slice(5))]).join(', ')}. Se usa solo para los meses que no tengan rendición detallada de gastos.` });
  return r;
}

// ---------------- Tabla de costos ----------------
export function detectarCostos(h: HojaLeida): number {
  const enc = buscarEncabezado(h, [['ARTICULO', 'PRODUCTO', 'PRESENTACION'], ['COSTO']], 10);
  if (enc === null) return 0;
  const n = h.filas.slice(enc + 1).filter((f) => typeof f[1] === 'number' || typeof f[2] === 'number').length;
  return h.filas.length < 200 && n >= 1 && !h.filas[enc].map(norm).some((c) => c.includes('FECHA') || c.includes('CANTIDAD')) ? 0.9 : 0.3;
}

export function importarCostos(h: HojaLeida): ResultadoHoja {
  const r = resultadoVacio('costos', detectarCostos(h));
  const enc = buscarEncabezado(h, [['ARTICULO', 'PRODUCTO', 'PRESENTACION'], ['COSTO']], 10)!;
  r.fila_encabezado = filaX(h, enc);
  const m = mapearColumnas(h.filas[enc], SIN.costos);
  r.mapeo = m;
  r.variante = 'GLOBAL';
  r.periodo = 'GLOBAL';
  for (let i = enc + 1; i < h.filas.length; i++) {
    const f = h.filas[i];
    if (vacio(f[m.articulo])) continue;
    const articulo = String(f[m.articulo]).trim();
    const costo = parseNumero(f[m.costo]).valor;
    const pvp = 'precio_publico' in m ? parseNumero(f[m.precio_publico]).valor : null;
    const pres = clavePresentacionArticulo(articulo);
    if (costo === null) r.mensajes.push({ nivel: 'advertencia', fila: filaX(h, i), texto: `"${articulo}" sin costo unitario.` });
    r.costos.push({ fila: filaX(h, i), clave_presentacion: pres.clave, articulo, categoria: pres.categoria, tamano_ml: pres.tamano, costo_unitario: costo, precio_publico: pvp });
  }
  r.mensajes.push({ nivel: 'info', texto: `Tabla de ${r.costos.length} presentaciones. Método de costeo aplicado: costo estándar del proveedor por presentación (costo de ventas = unidades vendidas × costo unitario de su presentación).` });
  return r;
}

// ---------------- Catálogo de productos ----------------
export function detectarCatalogo(h: HojaLeida): number {
  const enc = buscarEncabezado(h, [['NOMBRE', 'PRODUCTO', 'PERFUME'], ['CASA', 'MARCA']], 10);
  if (enc === null) return 0;
  const cuerpo = h.filas.slice(enc + 1).filter((f) => !vacio(f[0]));
  const numericas = cuerpo.filter((f) => f.some((v) => typeof v === 'number')).length;
  return cuerpo.length >= 3 && numericas / Math.max(cuerpo.length, 1) < 0.1 ? 0.8 : 0.2;
}

export function importarCatalogo(h: HojaLeida): ResultadoHoja {
  const r = resultadoVacio('catalogo', detectarCatalogo(h));
  const enc = buscarEncabezado(h, [['NOMBRE', 'PRODUCTO', 'PERFUME'], ['CASA', 'MARCA']], 10)!;
  r.fila_encabezado = filaX(h, enc);
  const m = mapearColumnas(h.filas[enc], SIN.catalogo);
  r.mapeo = m;
  r.periodo = 'GLOBAL';
  r.variante = 'GLOBAL';
  const vistos = new Map<string, number>();
  for (let i = enc + 1; i < h.filas.length; i++) {
    const f = h.filas[i];
    if (vacio(f[m.nombre])) continue;
    const nombre = String(f[m.nombre]).replace(/\s+/g, ' ').trim();
    const k = norm(nombre);
    if (vistos.has(k)) {
      r.mensajes.push({ nivel: 'advertencia', fila: filaX(h, i), texto: `"${nombre}" repetido (fila ${vistos.get(k)}).` });
      continue;
    }
    vistos.set(k, filaX(h, i));
    r.catalogo.push({
      fila: filaX(h, i), nombre,
      marca: 'marca' in m && !vacio(f[m.marca]) ? String(f[m.marca]).replace(/\s+/g, ' ').trim() : null,
      categoria: 'categoria' in m && !vacio(f[m.categoria]) ? String(f[m.categoria]).trim() : null,
      codigo: 'codigo' in m && !vacio(f[m.codigo]) ? String(f[m.codigo]).trim() : null,
    });
  }
  if (/INVENTARIO/.test(norm(h.nombre))) {
    r.mensajes.push({ nivel: 'advertencia', texto: `La hoja "${h.nombre}" solo contiene nombres y marcas, sin cantidades ni costos: se usa como catálogo de productos. No aporta existencias de inventario.` });
  }
  return r;
}

// ---------------- Tablas genéricas por fila ----------------
const TIPOS_MOV: [RegExp, string][] = [
  [/INICIAL|APERTURA/, 'INVENTARIO_INICIAL'], [/FISICO|CONTEO|TOMA/, 'INVENTARIO_FISICO'],
  [/TRANSF.*(SALIDA|ENVIADA|ENVIO)|SALIDA.*TRANSF|ENVIADA/, 'TRANSFERENCIA_SALIDA'],
  [/TRANSF.*(ENTRADA|RECIBIDA|INGRESO)|ENTRADA.*TRANSF|RECIBIDA/, 'TRANSFERENCIA_ENTRADA'],
  [/COMPRA|INGRESO/, 'COMPRA'], [/DEVOLUCION/, 'DEVOLUCION'], [/DANAD|DANO|ROTO/, 'DANADO'],
  [/PERDID|ROBO|EXTRAVI/, 'PERDIDA'], [/BAJA/, 'BAJA'], [/AJUSTE/, 'AJUSTE'],
];
export function tipoMovimiento(v: unknown): string | null {
  const t = norm(v);
  for (const [re, tipo] of TIPOS_MOV) if (re.test(t)) return tipo;
  return null;
}
const CONCEPTOS_SALDO: [RegExp, string][] = [
  [/CAJA|EFECTIVO/, 'CAJA'], [/BANCO|CUENTA CORRIENTE|CAJA DE AHORRO/, 'BANCOS'],
  [/COBRAR|CLIENTE|CXC/, 'CXC'], [/PAGAR|PROVEEDOR|CXP/, 'CXP'], [/PRESTAMO|CREDITO|DEUDA/, 'PRESTAMO'],
  [/CAPITAL SOCIAL|^CAPITAL/, 'CAPITAL'], [/APORTE/, 'APORTE'], [/RETIRO/, 'RETIRO'],
  [/INVENTARIO/, 'INVENTARIO_VALORIZADO'], [/ACTIVO/, 'OTRO_ACTIVO'], [/PASIVO/, 'OTRO_PASIVO'],
];
export function conceptoSaldo(v: unknown): string | null {
  const t = norm(v);
  for (const [re, c] of CONCEPTOS_SALDO) if (re.test(t)) return c;
  return null;
}

export function detectarTabla(h: HojaLeida): { tipo: 'ventas_tabla' | 'inventario' | 'saldos'; puntaje: number } | null {
  const opciones: { tipo: 'ventas_tabla' | 'inventario' | 'saldos'; req: string[][] }[] = [
    { tipo: 'ventas_tabla', req: [['FECHA'], ['PRODUCTO', 'ARTICULO'], ['CANTIDAD', 'UNIDADES'], ['TOTAL', 'PRECIO', 'IMPORTE']] },
    { tipo: 'inventario', req: [['PRODUCTO', 'ARTICULO'], ['TIPO', 'MOVIMIENTO', 'STOCK', 'EXISTENCIA', 'FISICO'], ['CANTIDAD', 'UNIDADES', 'STOCK', 'EXISTENCIA']] },
    { tipo: 'saldos', req: [['CONCEPTO', 'CUENTA'], ['SALDO', 'MONTO', 'IMPORTE']] },
  ];
  let mejor: { tipo: 'ventas_tabla' | 'inventario' | 'saldos'; puntaje: number } | null = null;
  for (const o of opciones) {
    const enc = buscarEncabezado(h, o.req, 10);
    if (enc === null) continue;
    const celdas = h.filas[enc].map(norm);
    const ok = o.req.filter((g) => g.some((s) => celdas.some((c) => c.includes(s)))).length / o.req.length;
    if (o.tipo === 'inventario' && celdas.some((c) => c.includes('PRECIO'))) continue;
    if (!mejor || ok > mejor.puntaje) mejor = { tipo: o.tipo, puntaje: ok * 0.85 };
  }
  return mejor && mejor.puntaje >= 0.6 ? mejor : null;
}

export function importarTabla(h: HojaLeida, ctx: ContextoLibro, tipo: 'ventas_tabla' | 'inventario' | 'saldos'): ResultadoHoja {
  const r = resultadoVacio(tipo, 0.8);
  const M = r.mensajes;
  const req = tipo === 'ventas_tabla' ? [['FECHA'], ['PRODUCTO', 'ARTICULO'], ['CANTIDAD', 'UNIDADES']]
    : tipo === 'inventario' ? [['PRODUCTO', 'ARTICULO'], ['CANTIDAD', 'UNIDADES', 'STOCK', 'EXISTENCIA']]
      : [['CONCEPTO', 'CUENTA'], ['SALDO', 'MONTO', 'IMPORTE']];
  const enc = buscarEncabezado(h, req, 10)!;
  r.fila_encabezado = filaX(h, enc);
  const m = mapearColumnas(h.filas[enc], tipo === 'ventas_tabla' ? SIN.ventas : tipo === 'inventario' ? SIN.inventario : SIN.saldos);
  r.mapeo = m;
  const estDef = establecimientoDeTexto(h.nombre) || ctx.estArchivo;
  const periodos = new Set<string>();
  const ests = new Set<string>();
  const esFisicoHoja = /FISICO|CONTEO|STOCK|EXISTENCIA/.test(norm(h.nombre) + ' ' + h.filas[enc].map(norm).join(' '));
  for (let i = enc + 1; i < h.filas.length; i++) {
    const f = h.filas[i];
    if (!f.some((v) => !vacio(v))) continue;
    const fila = filaX(h, i);
    const est = 'establecimiento' in m && !vacio(f[m.establecimiento]) ? establecimientoDeTexto(String(f[m.establecimiento])) : estDef;
    if (!est) { M.push({ nivel: 'error', fila, texto: 'Fila sin establecimiento identificable.' }); continue; }
    let fecha: string | null = null;
    let periodo: string | null = null;
    if ('fecha' in m) {
      const pf = parseFecha(f[m.fecha], { anio: ctx.anioArchivo });
      fecha = pf.fecha;
      if (fecha) periodo = fecha.slice(0, 7);
      else if (!vacio(f[m.fecha])) {
        const txt = norm(f[m.fecha]);
        const mm = mesDePalabra(txt.split(' ')[0]);
        const yy = txt.match(/20\d{2}/)?.[0];
        if (mm && (yy || ctx.anioArchivo)) periodo = periodoStr(Number(yy ?? ctx.anioArchivo), mm);
        else if (/^\d{4}-\d{2}$/.test(String(f[m.fecha]).trim())) periodo = String(f[m.fecha]).trim();
      }
    }
    if (!periodo) { M.push({ nivel: 'error', fila, texto: 'Fila sin fecha/periodo válido: no se importa.' }); continue; }
    periodos.add(periodo);
    ests.add(est);
    if (tipo === 'ventas_tabla') {
      const prod = vacio(f[m.producto]) ? null : String(f[m.producto]).trim();
      const cant = parseNumero(f[m.cantidad]).valor;
      const prec = 'precio' in m ? parseNumero(f[m.precio]).valor : null;
      let tot = 'total' in m ? parseNumero(f[m.total]).valor : null;
      const notas: string[] = [];
      if (tot === null && cant !== null && prec !== null) { tot = redondear(cant * prec); notas.push('total calculado como cantidad × precio'); }
      if (tot === null) { M.push({ nivel: 'error', fila, texto: 'Venta sin total ni precio: no se importa.' }); continue; }
      const dev = 'devolucion' in m && !vacio(f[m.devolucion]) ? 1 : (tot < 0 || (cant ?? 0) < 0 ? 1 : 0);
      r.ventas.push({
        fila, establecimiento_id: est, fecha, periodo, ticket: 'comprobante' in m && !vacio(f[m.comprobante]) ? String(f[m.comprobante]) : null,
        producto_texto: prod, tamano_ml: 'tamano' in m ? parseNumero(f[m.tamano]).valor : null, cantidad: cant, precio_unitario: prec,
        total: tot, tipo_pago: 'tipo_pago' in m ? normalizarMedioPago(f[m.tipo_pago]) : null,
        observaciones: 'observaciones' in m && !vacio(f[m.observaciones]) ? String(f[m.observaciones]) : null,
        es_obsequio: tot === 0 ? 1 : 0, es_devolucion: dev, estado: prod ? 'valido' : 'observado', nota: notas.join('; ') || null,
      });
    } else if (tipo === 'inventario') {
      const cant = parseNumero(f[m.cantidad]).valor;
      if (cant === null || vacio(f[m.producto])) { M.push({ nivel: 'error', fila, texto: 'Movimiento sin producto o cantidad.' }); continue; }
      const t = 'tipo' in m ? tipoMovimiento(f[m.tipo]) : esFisicoHoja ? 'INVENTARIO_FISICO' : null;
      if (!t) { M.push({ nivel: 'error', fila, texto: `Tipo de movimiento no reconocido: "${String(f[m.tipo] ?? '')}".` }); continue; }
      let contraparte: string | null = null;
      if (t.startsWith('TRANSFERENCIA')) {
        const txt = String((t === 'TRANSFERENCIA_SALIDA' ? f[m.destino] : f[m.origen]) ?? '');
        contraparte = establecimientoDeTexto(txt);
        if (!contraparte) M.push({ nivel: 'advertencia', fila, texto: 'Transferencia sin establecimiento de contraparte identificable.' });
      }
      r.inventario.push({
        fila, establecimiento_id: est, fecha, periodo, producto_texto: String(f[m.producto]).trim(),
        tamano_ml: 'tamano' in m ? parseNumero(f[m.tamano]).valor : null, tipo: t, cantidad: t === 'AJUSTE' ? cant : Math.abs(cant),
        costo_unitario: 'costo' in m ? parseNumero(f[m.costo]).valor : null, contraparte_id: contraparte,
        referencia: 'referencia' in m && !vacio(f[m.referencia]) ? String(f[m.referencia]) : null, nota: null,
      });
    } else {
      const concepto = conceptoSaldo(f[m.concepto]);
      const monto = parseNumero(f[m.monto]).valor;
      if (!concepto || monto === null) { M.push({ nivel: 'error', fila, texto: `Concepto de saldo no reconocido o sin monto: "${String(f[m.concepto] ?? '')}".` }); continue; }
      r.saldos.push({ fila, establecimiento_id: est, fecha, periodo, concepto, monto, tercero: 'tercero' in m && !vacio(f[m.tercero]) ? String(f[m.tercero]) : null, nota: String(f[m.concepto]) });
    }
  }
  r.establecimiento = ests.size === 1 ? [...ests][0] : ests.size ? 'VARIOS' : estDef;
  r.periodo = [...periodos].sort().join(',');
  r.variante = 'TABLA';
  return r;
}
