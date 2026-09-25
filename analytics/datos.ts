// Carga de los datos vigentes (solo lotes 'importada' + registros manuales) en memoria.
// Se cachea y se invalida cada vez que cambia la base (importación, reclasificación, datos manuales).
import type { Db } from '../database/db.ts';
import { clavePresentacionArticulo } from '../services/productos.ts';

export type Venta = {
  id: number; hoja_id: number; fila: number; archivo: string; hoja: string; est: string; fecha: string | null; periodo: string;
  ticket: string | null; producto_id: number | null; producto: string; marca: string; categoria: string; presentacion: string | null;
  presentacion_original: string | null; tamano_ml: number | null; cantidad: number | null; precio: number | null; total: number;
  tipo_pago: string | null; es_obsequio: boolean; es_devolucion: boolean; estado: string; nota: string | null;
  costo_unitario: number | null; precio_lista: number | null; texto: string | null;
};
export type Egreso = {
  id: number; hoja_id: number; fila: number; archivo: string; hoja: string; est: string; est_archivo: string; fecha: string | null;
  periodo: string | null; descripcion: string; documento: string | null; monto: number; monto_bob: number | null; moneda: string;
  con_factura: number | null; nivel: string; origen: string; clase: string; categoria: string; regla_id: string | null;
  manual: boolean; estado: string; duplicado_de: number | null; nota: string | null; fecha_nota: string | null; participaciones: Record<string, number> | null;
};
export type Control = { hoja_id: number; fila: number; archivo: string; hoja: string; est: string; fecha: string | null; periodo: string; concepto: string; monto: number; nota: string | null };
export type Movimiento = { id: number; hoja_id: number | null; fila: number | null; archivo: string; hoja: string; est: string; fecha: string | null; periodo: string; producto_id: number | null; producto: string; tipo: string; cantidad: number; costo_unitario: number | null; contraparte: string | null; referencia: string | null; origen: string };
export type Saldo = { id: number; hoja_id: number | null; fila: number | null; archivo: string; hoja: string; est: string; fecha: string | null; periodo: string; concepto: string; monto: number; tercero: string | null; origen: string; usuario: string | null; nota: string | null };
export type Costo = { clave: string; articulo: string; costo: number | null; pvp: number | null; hoja_id: number; fila: number; archivo: string; hoja: string };

export type Datos = {
  version: number;
  ventas: Venta[];
  egresos: Egreso[];
  control: Control[];
  movimientos: Movimiento[];
  saldos: Saldo[];
  costos: Map<string, Costo>;
  productos: { id: number; nombre: string; marca: string | null; categoria: string | null; origen: string }[];
  periodos: string[];
  establecimientos: { id: string; nombre: string }[];
  socios: { codigo: string; participacion: number }[];
  tipoCambio: number | null;
  metodoValuacion: string | null;
  correccionTamanos: Record<string, number>;
};

// ---- Corrección de presentación por precio (solo si el usuario la confirma) ----
// Presentaciones ambiguas: tamaños no estándar (11 ml, 101 ml...), perfumes sin tamaño y difusores sin tipo.
export function presentacionAmbigua(p: string): boolean {
  if (p === 'PERFUME_SIN_TAMANO' || p === 'DIFUSOR_SIN_TIPO') return true;
  const m = p.match(/^PERFUME_(\d+)$/);
  return !!m && ![10, 50, 100].includes(Number(m[1]));
}

// precio -> distribución de presentaciones estándar observadas a ese precio (evidencia de los propios datos)
export function mapaPrecioPresentacion(ventas: { presentacion: string | null; precio_unitario: number | null }[], costos: Map<string, Costo>) {
  const m = new Map<number, Map<string, number>>();
  for (const v of ventas) {
    if (!v.presentacion || v.precio_unitario === null || !v.precio_unitario || presentacionAmbigua(v.presentacion) || !costos.has(v.presentacion)) continue;
    const d = m.get(v.precio_unitario) || m.set(v.precio_unitario, new Map()).get(v.precio_unitario)!;
    d.set(v.presentacion, (d.get(v.presentacion) || 0) + 1);
  }
  // precios públicos de la tabla de costos como evidencia adicional
  for (const c of costos.values()) {
    if (c.pvp) {
      const d = m.get(c.pvp) || m.set(c.pvp, new Map()).get(c.pvp)!;
      d.set(c.clave, (d.get(c.clave) || 0) + 1);
    }
  }
  return m;
}

export function sugerirPresentacion(original: string, precio: number | null, mapa: Map<number, Map<string, number>>): { presentacion: string; confianza: number; casos: number } | null {
  if (precio === null || !precio) return null;
  const d = mapa.get(precio);
  if (!d) return null;
  const cat = original.startsWith('DIFUSOR') ? /DIFUSER$/ : /^PERFUME_/;
  const cands = [...d.entries()].filter(([k]) => cat.test(k)).sort((a, b) => b[1] - a[1]);
  if (!cands.length) return null;
  const total = cands.reduce((s, [, n]) => s + n, 0);
  const confianza = cands[0][1] / total;
  return confianza >= 0.8 && total >= 3 ? { presentacion: cands[0][0], confianza: Math.round(confianza * 100), casos: total } : null;
}

let version = 1;
let cache: Datos | null = null;
let cacheDb: Db | null = null;
export function invalidar() { version++; cache = null; }
export function versionDatos() { return version; }

export function cargar(db: Db): Datos {
  if (cache && cache.version === version && cacheDb === db) return cache;
  cacheDb = db;
  const tipoCambio = Number(db.parametro('tipo_cambio_usd')) || null;
  let correccionTamanos: Record<string, number> = {};
  try { correccionTamanos = JSON.parse(db.parametro('correccion_tamanos') || '{}'); } catch { /* parámetro inválido: se ignora */ }

  const costos = new Map<string, Costo>();
  // Los costos registrados manualmente (hoja_id NULL) se aplican después y prevalecen sobre la tabla importada
  for (const c of db.all<any>(`SELECT c.*, h.nombre hoja, a.nombre archivo FROM costo_referencia c LEFT JOIN hoja h ON h.id = c.hoja_id
      LEFT JOIN archivo a ON a.id = h.archivo_id WHERE c.hoja_id IS NULL OR h.estado = 'importada' ORDER BY (c.hoja_id IS NULL), c.id`)) {
    const previo = costos.get(c.clave_presentacion);
    costos.set(c.clave_presentacion, {
      clave: c.clave_presentacion, articulo: c.articulo, costo: c.costo_unitario, pvp: c.precio_publico ?? previo?.pvp ?? null, hoja_id: c.hoja_id,
      fila: c.fila, archivo: c.archivo ?? 'Registro manual', hoja: c.hoja ?? 'Datos faltantes',
    });
  }

  const crudas = db.all<any>(`SELECT v.*, h.nombre hoja, a.nombre archivo, p.nombre pnombre, p.marca pmarca
      FROM venta v JOIN hoja h ON h.id = v.hoja_id JOIN archivo a ON a.id = h.archivo_id LEFT JOIN producto p ON p.id = v.producto_id
      WHERE h.estado = 'importada' AND v.estado <> 'excluido'`);
  const mapaPrecio = mapaPrecioPresentacion(crudas, costos);
  const corregirPorPrecio = db.parametro('correccion_presentacion_por_precio') === '1';
  const ventas: Venta[] = crudas.map((v) => {
    let pres = v.presentacion as string | null;
    const original = pres;
    const tam = v.tamano_ml as number | null;
    let nota = v.nota as string | null;
    if (tam !== null && correccionTamanos[String(tam)] !== undefined && v.producto_texto) {
      pres = clavePresentacionArticulo(v.producto_texto, correccionTamanos[String(tam)]).clave;
    } else if (corregirPorPrecio && pres && presentacionAmbigua(pres)) {
      const s = sugerirPresentacion(pres, v.precio_unitario, mapaPrecio);
      if (s) { pres = s.presentacion; nota = [nota, `presentación ${original} corregida a ${pres} por el precio cobrado (corrección confirmada por el usuario)`].filter(Boolean).join('; '); }
    }
    const c = pres ? costos.get(pres) : undefined;
    return {
      id: v.id, hoja_id: v.hoja_id, fila: v.fila, archivo: v.archivo, hoja: v.hoja, est: v.establecimiento_id, fecha: v.fecha, periodo: v.periodo,
      ticket: v.ticket, producto_id: v.producto_id, producto: v.pnombre ?? (v.producto_texto ? v.producto_texto : '(sin producto)'),
      marca: v.pmarca ?? 'Sin marca registrada', categoria: v.categoria ?? 'No identificado', presentacion: pres, presentacion_original: original,
      tamano_ml: tam, cantidad: v.cantidad, precio: v.precio_unitario, total: v.total, tipo_pago: v.tipo_pago,
      es_obsequio: !!v.es_obsequio, es_devolucion: !!v.es_devolucion, estado: v.estado, nota,
      costo_unitario: c?.costo ?? null, precio_lista: c?.pvp ?? null, texto: v.producto_texto,
    };
  });

  const egresos: Egreso[] = db.all<any>(`SELECT e.*, h.nombre hoja, a.nombre archivo FROM egreso e JOIN hoja h ON h.id = e.hoja_id
      JOIN archivo a ON a.id = h.archivo_id WHERE h.estado = 'importada'`).map((e) => ({
    id: e.id, hoja_id: e.hoja_id, fila: e.fila, archivo: e.archivo, hoja: e.hoja, est: e.establecimiento_id, est_archivo: e.establecimiento_archivo,
    fecha: e.fecha, periodo: e.periodo, descripcion: e.descripcion, documento: e.documento, monto: e.monto,
    monto_bob: e.moneda === 'BOB' ? e.monto : tipoCambio ? e.monto * tipoCambio : null, moneda: e.moneda, con_factura: e.con_factura,
    nivel: e.nivel, origen: e.origen, clase: e.clase, categoria: e.categoria, regla_id: e.regla_id, manual: !!e.clasificacion_manual,
    estado: e.estado, duplicado_de: e.duplicado_de, nota: e.nota, fecha_nota: e.fecha_nota,
    participaciones: e.participaciones ? JSON.parse(e.participaciones) : null,
  }));

  const control: Control[] = db.all<any>(`SELECT c.*, h.nombre hoja, a.nombre archivo FROM control_caja c JOIN hoja h ON h.id = c.hoja_id
      JOIN archivo a ON a.id = h.archivo_id WHERE h.estado = 'importada'`).map((c) => ({
    hoja_id: c.hoja_id, fila: c.fila, archivo: c.archivo, hoja: c.hoja, est: c.establecimiento_id, fecha: c.fecha, periodo: c.periodo, concepto: c.concepto, monto: c.monto, nota: c.nota,
  }));

  const movimientos: Movimiento[] = db.all<any>(`SELECT m.*, h.nombre hoja, a.nombre archivo, p.nombre pnombre FROM inventario_mov m
      LEFT JOIN hoja h ON h.id = m.hoja_id LEFT JOIN archivo a ON a.id = h.archivo_id LEFT JOIN producto p ON p.id = m.producto_id
      WHERE (m.hoja_id IS NULL OR h.estado = 'importada') AND m.estado <> 'excluido'`).map((m) => ({
    id: m.id, hoja_id: m.hoja_id, fila: m.fila, archivo: m.archivo ?? 'Registro manual', hoja: m.hoja ?? (m.usuario ? `usuario ${m.usuario}` : '-'),
    est: m.establecimiento_id, fecha: m.fecha, periodo: m.periodo, producto_id: m.producto_id, producto: m.pnombre ?? m.producto_texto ?? '(sin producto)',
    tipo: m.tipo, cantidad: m.cantidad, costo_unitario: m.costo_unitario, contraparte: m.contraparte_id, referencia: m.referencia, origen: m.origen,
  }));

  const saldos: Saldo[] = db.all<any>(`SELECT s.*, h.nombre hoja, a.nombre archivo FROM saldo s LEFT JOIN hoja h ON h.id = s.hoja_id
      LEFT JOIN archivo a ON a.id = h.archivo_id WHERE (s.hoja_id IS NULL OR h.estado = 'importada') AND s.estado <> 'excluido'`).map((s) => ({
    id: s.id, hoja_id: s.hoja_id, fila: s.fila, archivo: s.archivo ?? 'Registro manual', hoja: s.hoja ?? (s.usuario ? `usuario ${s.usuario}` : '-'),
    est: s.establecimiento_id, fecha: s.fecha, periodo: s.periodo, concepto: s.concepto, monto: s.monto, tercero: s.tercero, origen: s.origen, usuario: s.usuario, nota: s.nota,
  }));

  const periodos = [...new Set([...ventas.map((v) => v.periodo), ...egresos.filter((e) => e.origen !== 'inversion').map((e) => e.periodo!).filter(Boolean),
    ...movimientos.map((m) => m.periodo), ...saldos.map((s) => s.periodo)])].sort();

  cache = {
    version, ventas, egresos, control, movimientos, saldos, costos,
    productos: db.all<any>('SELECT id, nombre, marca, categoria, origen FROM producto ORDER BY nombre'),
    periodos,
    establecimientos: db.all<any>('SELECT id, nombre FROM establecimiento ORDER BY tipo, id'),
    socios: db.all<any>('SELECT codigo, participacion FROM socio ORDER BY participacion DESC'),
    tipoCambio, metodoValuacion: db.parametro('metodo_valuacion'), correccionTamanos,
  };
  return cache;
}
