// Flujo de importación: IDENTIFICAR -> PERFILAR -> CLASIFICAR -> NORMALIZAR -> CONTROL DE DUPLICADOS -> GUARDAR.
// El archivo original nunca se modifica: se guarda una copia inmutable en data/originales/<hash>.<ext>.
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config/app.config.ts';
import type { Db } from '../database/db.ts';
import { sha256 } from '../services/seguridad.ts';
import { EXTENSIONES, leerLibro, perfilar } from './lector.ts';
import type { HojaLeida } from './lector.ts';
import { analizarHoja } from './clasificador.ts';
import type { ContextoLibro, ResultadoHoja } from './tipos.ts';
import { DESCRIPCION_CLASIFICACION, totalRegistros } from './tipos.ts';
import { anioDeTexto, establecimientoDeTexto } from './utilidades.ts';
import { recalcularProductos, registrarCatalogo } from '../services/productos.ts';
import { clasificarEgresosPendientes } from '../services/clasificacion.ts';
import { detectarDuplicadosEgresos } from '../validators/duplicados.ts';
import { invalidar } from '../analytics/datos.ts';

export type ResumenHoja = {
  hoja_id: number; nombre: string; clasificacion: string; descripcion: string; establecimiento: string | null;
  periodo: string | null; estado: string; registros: number; errores: number; advertencias: number;
};
export type ResumenArchivo = {
  archivo_id: number; nombre: string; hash: string; estado: string; mensaje: string; hojas: ResumenHoja[];
};

const ORDEN_CLAS: Record<string, number> = { catalogo: 0, costos: 1 };

function contexto(nombre: string, hojas: HojaLeida[]): ContextoLibro {
  return { archivo: nombre, anioArchivo: anioDeTexto(nombre), estArchivo: establecimientoDeTexto(nombre), hojas, mapeosVentas: [] };
}

// Analiza todas las hojas; las hojas de registro de ventas con encabezado se procesan primero
// para que las hermanas sin encabezado puedan heredar la estructura de columnas.
function analizarLibro(hojas: HojaLeida[], ctx: ContextoLibro): { h: HojaLeida; r: ResultadoHoja }[] {
  const res = new Map<HojaLeida, ResultadoHoja>();
  const pendientes: HojaLeida[] = [];
  for (const h of hojas) {
    const r = analizarHoja(h, ctx);
    if (r.clasificacion === 'ventas_registro' && r.fila_encabezado === null && !ctx.mapeosVentas.length) pendientes.push(h);
    else {
      res.set(h, r);
      if (r.clasificacion === 'ventas_registro' && r.fila_encabezado !== null && r.mapeo) ctx.mapeosVentas.push(r.mapeo);
    }
  }
  for (const h of pendientes) res.set(h, analizarHoja(h, ctx));
  return hojas.map((h) => ({ h, r: res.get(h)! }));
}

function hashContenido(r: ResultadoHoja): string {
  const { ventas, egresos, costos, catalogo, inventario, saldos, control } = r;
  const limpiar = (a: any[]) => a.map(({ fila, ...x }) => x);
  return sha256(JSON.stringify([limpiar(ventas), limpiar(egresos), limpiar(costos), limpiar(catalogo), limpiar(inventario), limpiar(saldos), limpiar(control)]));
}

// Firma de cada registro (sin la fila de Excel): permite saber si una hoja nueva solo AGREGA registros a la anterior
export function firmas(r: ResultadoHoja): string[] {
  const f = (tipo: string, a: any[]) => a.map(({ fila, ...x }) => sha256(tipo + JSON.stringify(x)).slice(0, 20));
  return [...f('v', r.ventas), ...f('e', r.egresos), ...f('k', r.costos), ...f('i', r.inventario), ...f('s', r.saldos), ...f('c', r.control.filter((c) => !/declarado/.test(c.concepto)))];
}

// true si todos los registros anteriores siguen presentes (con sus repeticiones) en la versión nueva
export function esAmpliacion(anteriores: string[], nuevas: string[]): boolean {
  const cuenta = new Map<string, number>();
  for (const x of nuevas) cuenta.set(x, (cuenta.get(x) || 0) + 1);
  for (const x of anteriores) {
    const n = cuenta.get(x) || 0;
    if (!n) return false;
    cuenta.set(x, n - 1);
  }
  return true;
}

function claveDataset(r: ResultadoHoja): string {
  return [r.clasificacion, r.establecimiento ?? '?', r.periodo ?? '?', r.variante || ''].join('|');
}

export function guardarRegistros(db: Db, hojaId: number, r: ResultadoHoja) {
  const v = db.raw.prepare(`INSERT INTO venta (hoja_id, fila, establecimiento_id, fecha, periodo, ticket, producto_texto, tamano_ml, cantidad,
    precio_unitario, total, tipo_pago, observaciones, es_obsequio, es_devolucion, estado, nota) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  for (const x of r.ventas) v.run(hojaId, x.fila, x.establecimiento_id, x.fecha, x.periodo, x.ticket, x.producto_texto, x.tamano_ml, x.cantidad,
    x.precio_unitario, x.total, x.tipo_pago, x.observaciones, x.es_obsequio, x.es_devolucion, x.estado, x.nota);
  const c = db.raw.prepare(`INSERT INTO control_caja (hoja_id, fila, establecimiento_id, fecha, periodo, concepto, monto, nota) VALUES (?,?,?,?,?,?,?,?)`);
  for (const x of r.control) c.run(hojaId, x.fila, x.establecimiento_id, x.fecha, x.periodo, x.concepto, x.monto, x.nota);
  const e = db.raw.prepare(`INSERT INTO egreso (hoja_id, fila, establecimiento_id, establecimiento_archivo, fecha, fecha_texto, fecha_nota, periodo,
    descripcion, proveedor, documento, monto, moneda, con_factura, nivel, origen, participaciones, estado, nota) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  for (const x of r.egresos) e.run(hojaId, x.fila, x.establecimiento_id, x.establecimiento_archivo, x.fecha, x.fecha_texto, x.fecha_nota, x.periodo,
    x.descripcion, x.proveedor, x.documento, x.monto, x.moneda, x.con_factura, x.nivel, x.origen, x.participaciones, x.estado, x.nota);
  const k = db.raw.prepare(`INSERT INTO costo_referencia (hoja_id, fila, clave_presentacion, articulo, categoria, tamano_ml, costo_unitario, precio_publico) VALUES (?,?,?,?,?,?,?,?)`);
  for (const x of r.costos) k.run(hojaId, x.fila, x.clave_presentacion, x.articulo, x.categoria, x.tamano_ml, x.costo_unitario, x.precio_publico);
  const i = db.raw.prepare(`INSERT INTO inventario_mov (hoja_id, fila, establecimiento_id, fecha, periodo, producto_texto, tamano_ml, tipo, cantidad, costo_unitario,
    contraparte_id, referencia, nota) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  for (const x of r.inventario) i.run(hojaId, x.fila, x.establecimiento_id, x.fecha, x.periodo, x.producto_texto, x.tamano_ml, x.tipo, x.cantidad,
    x.costo_unitario, x.contraparte_id, x.referencia, x.nota);
  const s = db.raw.prepare(`INSERT INTO saldo (hoja_id, fila, establecimiento_id, fecha, periodo, concepto, monto, tercero, nota) VALUES (?,?,?,?,?,?,?,?,?)`);
  for (const x of r.saldos) s.run(hojaId, x.fila, x.establecimiento_id, x.fecha, x.periodo, x.concepto, x.monto, x.tercero, x.nota);
  if (r.catalogo.length) registrarCatalogo(db, r.catalogo);
  for (const so of r.socios) {
    db.run(`INSERT INTO socio (codigo, nombre, participacion, hoja_id) VALUES (?, ?, ?, ?)
      ON CONFLICT(codigo) DO UPDATE SET participacion = excluded.participacion, hoja_id = excluded.hoja_id`, so.codigo, so.codigo, so.participacion, hojaId);
  }
  if (r.costos.length && !db.parametro('metodo_valuacion_manual')) {
    db.setParametro('metodo_valuacion', 'COSTO_ESTANDAR_PROVEEDOR', 'sistema');
  }
}

// Recalcula todo lo derivado tras cualquier cambio de datos
export function postProceso(db: Db) {
  clasificarEgresosPendientes(db);
  detectarDuplicadosEgresos(db);
  recalcularProductos(db);
  invalidar();
}

function copiaOriginal(buf: Buffer, hash: string, ext: string): string {
  fs.mkdirSync(config.originalesDir, { recursive: true });
  const destino = path.join(config.originalesDir, `${hash}${ext}`);
  if (!fs.existsSync(destino)) fs.writeFileSync(destino, buf, { flag: 'wx' });
  return destino;
}

export function procesarArchivo(db: Db, buf: Buffer, nombre: string, usuario: string, origen: 'carga' | 'carpeta' | 'prueba'): ResumenArchivo {
  const ext = path.extname(nombre).toLowerCase();
  if (!EXTENSIONES.includes(ext)) throw new Error(`Tipo de archivo no permitido (${ext}). Solo se aceptan .xlsx, .xls y .csv.`);
  const hash = sha256(buf);
  const existe = db.get<{ id: number; nombre: string; fecha_carga: string }>('SELECT id, nombre, fecha_carga FROM archivo WHERE hash = ?', hash);
  if (existe) {
    return { archivo_id: existe.id, nombre, hash, estado: 'duplicado', hojas: [],
      mensaje: `El archivo ya fue procesado el ${existe.fecha_carga} como "${existe.nombre}". No se duplicó información.` };
  }
  let libro;
  try {
    libro = leerLibro(buf, nombre);
  } catch (e: any) {
    const id = Number(db.run(`INSERT INTO archivo (hash, nombre, extension, tamano, origen, usuario, estado, resumen) VALUES (?,?,?,?,?,?, 'error', ?)`,
      hash, nombre, ext, buf.length, origen, usuario, JSON.stringify({ error: String(e?.message || e) })).lastInsertRowid);
    db.auditar(usuario, 'importacion_error', { archivo: nombre, error: String(e?.message || e) });
    return { archivo_id: id, nombre, hash, estado: 'error', hojas: [], mensaje: `No se pudo leer el archivo: ${e?.message || e}` };
  }
  const ruta = origen === 'prueba' ? null : copiaOriginal(buf, hash, ext);
  const ctx = contexto(nombre, libro.hojas);
  const analizadas = analizarLibro(libro.hojas, ctx);
  analizadas.sort((a, b) => (ORDEN_CLAS[a.r.clasificacion] ?? 9) - (ORDEN_CLAS[b.r.clasificacion] ?? 9));

  const resumen: ResumenHoja[] = [];
  const archivoId = db.tx(() => {
    const aid = Number(db.run(`INSERT INTO archivo (hash, nombre, extension, tamano, ruta_original, origen, usuario, estado) VALUES (?,?,?,?,?,?,?, 'procesando')`,
      hash, nombre, ext, buf.length, ruta, origen, usuario).lastInsertRowid);
    for (const { h, r } of analizadas) {
      const perfil = perfilar(h, r.fila_encabezado === null ? null : r.fila_encabezado - h.filaInicial);
      const clave = claveDataset(r);
      const hc = hashContenido(r);
      const n = totalRegistros(r);
      let estado: string;
      let previa: { id: number; hash_contenido: string; firmas: string | null; archivo: string } | undefined;
      const fs2 = firmas(r);
      const errores = r.mensajes.filter((m) => m.nivel === 'error').length;
      if (r.clasificacion === 'vacia') estado = 'omitida';
      else if (r.clasificacion === 'desconocida' || (errores && !n && !r.control.length)) estado = 'error';
      else if (r.clasificacion === 'catalogo') estado = 'importada'; // el catálogo es acumulativo
      else {
        previa = db.get(`SELECT h.id, h.hash_contenido, h.firmas, a.nombre archivo FROM hoja h JOIN archivo a ON a.id = h.archivo_id
          WHERE h.clave_dataset = ? AND h.estado = 'importada' ORDER BY h.id DESC LIMIT 1`, clave);
        if (!previa) estado = 'importada';
        else if (previa.hash_contenido === hc) {
          estado = 'identica';
          r.mensajes.push({ nivel: 'info', texto: `Contenido idéntico a la hoja ya cargada desde "${previa.archivo}". No se duplicó.` });
        } else if (previa.firmas && esAmpliacion(JSON.parse(previa.firmas), fs2)) {
          // Mismo periodo ampliado (p. ej. el mes en curso con más días): se actualiza automáticamente, sin perder nada
          estado = 'importada';
          db.run(`UPDATE hoja SET estado = 'reemplazada' WHERE id = ?`, previa.id);
          r.mensajes.push({ nivel: 'info', texto: `Actualización automática: la hoja amplía la versión cargada desde "${previa.archivo}" (conserva todos sus registros y agrega nuevos). La versión anterior queda archivada.` });
          db.auditar(usuario, 'actualizacion_automatica', { hoja: h.nombre, clave, anterior: previa.id });
        } else {
          estado = 'pendiente_confirmacion';
          r.mensajes.push({ nivel: 'advertencia', texto: `Ya existe información de ${DESCRIPCION_CLASIFICACION[r.clasificacion]} para ${r.establecimiento} ${r.periodo} (archivo "${previa.archivo}") con contenido distinto. Confirme si desea REEMPLAZARLA; mientras tanto se conserva la información anterior.` });
        }
      }
      const hid = Number(db.run(`INSERT INTO hoja (archivo_id, nombre, filas, columnas, clasificacion, confianza, establecimiento_id, periodo, variante,
        clave_dataset, hash_contenido, estado, registros, reemplaza_hoja_id, perfil, mensajes, firmas) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        aid, h.nombre, perfil.filas_con_datos, perfil.columnas, r.clasificacion, r.confianza, r.establecimiento, r.periodo, r.variante,
        clave, hc, estado, estado === 'importada' ? n : 0, previa?.id ?? null, JSON.stringify(perfil), JSON.stringify(r.mensajes), JSON.stringify(fs2)).lastInsertRowid);
      if (estado === 'importada') guardarRegistros(db, hid, r);
      resumen.push({
        hoja_id: hid, nombre: h.nombre, clasificacion: r.clasificacion, descripcion: DESCRIPCION_CLASIFICACION[r.clasificacion],
        establecimiento: r.establecimiento, periodo: r.periodo, estado, registros: n,
        errores: r.mensajes.filter((m) => m.nivel === 'error').length, advertencias: r.mensajes.filter((m) => m.nivel === 'advertencia').length,
      });
    }
    return aid;
  });
  postProceso(db);
  const estado = resumen.some((h) => h.estado === 'pendiente_confirmacion') ? 'pendiente_confirmacion'
    : resumen.some((h) => h.estado === 'error') ? 'con_errores'
      : resumen.some((h) => h.advertencias > 0) ? 'con_observaciones' : 'procesado';
  const importadas = resumen.filter((h) => h.estado === 'importada');
  const mensaje = `${importadas.length} hoja(s) importadas con ${importadas.reduce((s, h) => s + h.registros, 0)} registros; `
    + `${resumen.filter((h) => h.estado === 'identica').length} idénticas omitidas; ${resumen.filter((h) => h.estado === 'pendiente_confirmacion').length} pendientes de confirmación; `
    + `${resumen.filter((h) => h.estado === 'error').length} con error.`;
  db.run('UPDATE archivo SET estado = ?, resumen = ? WHERE id = ?', estado, JSON.stringify({ mensaje, hojas: resumen }), archivoId);
  db.auditar(usuario, 'importacion', { archivo: nombre, hash, estado, mensaje });
  return { archivo_id: archivoId, nombre, hash, estado, mensaje, hojas: resumen };
}

// Confirma o rechaza el reemplazo de un lote (hoja) pendiente. Los registros anteriores NO se borran: quedan como 'reemplazada'.
export function resolverPendiente(db: Db, hojaId: number, accion: 'reemplazar' | 'rechazar', usuario: string, forzarTipo?: string): string {
  const h = db.get<any>(`SELECT h.*, a.ruta_original, a.nombre archivo FROM hoja h JOIN archivo a ON a.id = h.archivo_id WHERE h.id = ?`, hojaId);
  if (!h) throw new Error('Hoja no encontrada');
  if (!['pendiente_confirmacion', 'error'].includes(h.estado)) throw new Error(`La hoja está en estado "${h.estado}" y no requiere confirmación.`);
  if (accion === 'rechazar') {
    db.run(`UPDATE hoja SET estado = 'rechazada' WHERE id = ?`, hojaId);
    db.auditar(usuario, 'reemplazo_rechazado', { hoja: hojaId, archivo: h.archivo, nombre: h.nombre });
    recalcularEstadoArchivo(db, h.archivo_id);
    return 'Se conservó la información anterior.';
  }
  if (!h.ruta_original || !fs.existsSync(h.ruta_original)) throw new Error('No se encuentra la copia del archivo original.');
  const buf = fs.readFileSync(h.ruta_original);
  const libro = leerLibro(buf, h.archivo);
  const ctx = contexto(h.archivo, libro.hojas);
  analizarLibro(libro.hojas.filter((x) => x.nombre !== h.nombre), ctx); // recupera estructuras hermanas
  const hoja = libro.hojas.find((x) => x.nombre === h.nombre);
  if (!hoja) throw new Error('La hoja ya no existe en el archivo original.');
  const r = analizarHoja(hoja, ctx, forzarTipo);
  const clave = claveDataset(r);
  db.tx(() => {
    const anteriores = db.all<{ id: number }>(`SELECT id FROM hoja WHERE clave_dataset = ? AND estado = 'importada' AND id <> ?`, clave, hojaId);
    for (const a of anteriores) db.run(`UPDATE hoja SET estado = 'reemplazada' WHERE id = ?`, a.id);
    db.run(`UPDATE hoja SET estado = 'importada', clasificacion = ?, establecimiento_id = ?, periodo = ?, variante = ?, clave_dataset = ?,
      hash_contenido = ?, registros = ?, reemplaza_hoja_id = COALESCE(?, reemplaza_hoja_id), mensajes = ?, firmas = ? WHERE id = ?`,
      r.clasificacion, r.establecimiento, r.periodo, r.variante, clave, hashContenido(r), totalRegistros(r), anteriores[0]?.id ?? null,
      JSON.stringify(r.mensajes), JSON.stringify(firmas(r)), hojaId);
    guardarRegistros(db, hojaId, r);
  });
  postProceso(db);
  db.auditar(usuario, 'reemplazo_confirmado', { hoja: hojaId, archivo: h.archivo, nombre: h.nombre, clave });
  recalcularEstadoArchivo(db, h.archivo_id);
  return `Hoja "${h.nombre}" importada (${totalRegistros(r)} registros). La información anterior quedó archivada como reemplazada.`;
}

function recalcularEstadoArchivo(db: Db, archivoId: number) {
  const hs = db.all<{ estado: string }>('SELECT estado FROM hoja WHERE archivo_id = ?', archivoId);
  const estado = hs.some((h) => h.estado === 'pendiente_confirmacion') ? 'pendiente_confirmacion'
    : hs.some((h) => h.estado === 'error') ? 'con_errores' : 'procesado';
  db.run('UPDATE archivo SET estado = ? WHERE id = ?', estado, archivoId);
}

// Revisa la carpeta de entrada y procesa los archivos nuevos (los ya procesados se reconocen por su hash).
export function escanearCarpeta(db: Db, usuario = 'sistema'): ResumenArchivo[] {
  fs.mkdirSync(config.entradaDir, { recursive: true });
  const res: ResumenArchivo[] = [];
  for (const f of fs.readdirSync(config.entradaDir).sort()) {
    if (f.startsWith('~$') || !EXTENSIONES.includes(path.extname(f).toLowerCase())) continue;
    const buf = fs.readFileSync(path.join(config.entradaDir, f));
    if (db.get('SELECT 1 FROM archivo WHERE hash = ?', sha256(buf))) continue;
    try {
      res.push(procesarArchivo(db, buf, f, usuario, 'carpeta'));
    } catch (e: any) {
      res.push({ archivo_id: 0, nombre: f, hash: '', estado: 'error', mensaje: String(e?.message || e), hojas: [] });
    }
  }
  return res;
}

// Completa las firmas de hojas importadas antes de existir esta función (a partir del archivo original guardado)
export function completarFirmas(db: Db): number {
  const pend = db.all<any>(`SELECT h.id, h.nombre, a.nombre archivo, a.ruta_original FROM hoja h JOIN archivo a ON a.id = h.archivo_id
    WHERE h.estado = 'importada' AND h.firmas IS NULL AND a.ruta_original IS NOT NULL`);
  const porArchivo = new Map<string, any[]>();
  for (const h of pend) (porArchivo.get(h.ruta_original) || porArchivo.set(h.ruta_original, []).get(h.ruta_original)!).push(h);
  let n = 0;
  for (const [ruta, hs] of porArchivo) {
    if (!fs.existsSync(ruta)) continue;
    const libro = leerLibro(fs.readFileSync(ruta), hs[0].archivo);
    const ctx = contexto(hs[0].archivo, libro.hojas);
    for (const { h, r } of analizarLibro(libro.hojas, ctx)) {
      const x = hs.find((y) => y.nombre === h.nombre);
      if (x) { db.run('UPDATE hoja SET firmas = ? WHERE id = ?', JSON.stringify(firmas(r)), x.id); n++; }
    }
  }
  return n;
}
