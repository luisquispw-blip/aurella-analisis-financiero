// API REST. Todas las rutas (salvo portada y login) requieren sesión.
import express from 'express';
import type { Request, Response } from 'express';
import multer from 'multer';
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config/app.config.ts';
import type { Db } from '../database/db.ts';
import { autenticar, cambiarPassword, login, logout, requiereRol } from './auth.ts';
import { cargar, invalidar } from '../analytics/datos.ts';
import type { Filtro } from '../analytics/motor.ts';
import {
  analisisGastos, comparacionMeses, CRITERIOS_RANKING, FORMULAS, inventarioPeriodo, nombrePeriodo, periodosFiltro, periodosOperacion,
  porDimension, porProducto, productosSinVentas, ranking, tablaMensual,
} from '../analytics/motor.ts';
import { liquidez, situacionFinanciera } from '../analytics/financiero.ts';
import { calcularAlertas, guardarHistorialAlertas } from '../analytics/alertas.ts';
import { datosFaltantes, informeCalidad } from '../analytics/calidad.ts';
import { traza } from '../analytics/traza.ts';
import { escanearCarpeta, procesarArchivo, resolverPendiente } from '../importers/pipeline.ts';
import { EXTENSIONES } from '../importers/lector.ts';
import { CATEGORIAS_GASTO, CLASES } from '../services/clasificacion.ts';
import { recalcularProductos } from '../services/productos.ts';
import { hashPassword, passwordAleatoria } from '../services/seguridad.ts';
import { preguntarAgente, estadoAgente } from '../agent/agente.ts';
import { generarReporte, TIPOS_REPORTE } from '../reports/reportes.ts';

const ah = (fn: (req: Request, res: Response) => unknown) => async (req: Request, res: Response) => {
  try { await fn(req, res); } catch (e: any) {
    console.error(`[api] ${req.method} ${req.path}:`, e?.message || e);
    res.status(e?.status || 400).json({ error: e?.message || 'Error inesperado' });
  }
};

export function filtroDe(q: any): Filtro {
  const s = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined);
  const per = (v: unknown) => (s(v) && /^\d{4}-\d{2}$/.test(s(v)!) ? s(v) : undefined);
  return {
    desde: per(q.desde), hasta: per(q.hasta), est: s(q.est) && s(q.est) !== 'TOTAL' ? s(q.est) : undefined,
    producto_id: q.producto_id ? Number(q.producto_id) || undefined : undefined, marca: s(q.marca), categoria: s(q.categoria), presentacion: s(q.presentacion),
    periodos: s(q.periodos)?.split(',').filter((p) => /^\d{4}-\d{2}$/.test(p)),
  };
}

export function despuesDeCambios(db: Db) {
  invalidar();
  try { guardarHistorialAlertas(db, calcularAlertas(db, cargar(db))); } catch (e) { console.error('[alertas]', e); }
}

export function crearRouter(db: Db) {
  const r = express.Router();
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: config.maxUploadMb * 1024 * 1024, files: 20 },
    fileFilter: (_req, file, cb) => cb(null, EXTENSIONES.includes(path.extname(Buffer.from(file.originalname, 'latin1').toString('utf8')).toLowerCase())),
  });

  // ---------- Público ----------
  r.get('/publico/portada', (_req, res) => res.json({ empresa: config.empresa, desarrollador: config.desarrollador, establecimientos: config.establecimientos.map((e) => ({ id: e.id, nombre: e.nombre, tipo: e.tipo })) }));
  r.post('/auth/login', (req, res) => login(db, req, res));
  r.post('/auth/logout', logout);

  r.use(autenticar(db));
  r.get('/auth/yo', (req, res) => res.json({ usuario: req.usuario }));
  r.post('/auth/cambiar-password', (req, res) => cambiarPassword(db, req, res));

  // ---------- Metadatos y filtros ----------
  r.get('/meta', ah((_req, res) => {
    const d = cargar(db);
    const vendidos = new Set(d.ventas.map((v) => v.producto_id));
    res.json({
      version: d.version, empresa: config.empresa, periodos: d.periodos.map((p) => ({ id: p, nombre: nombrePeriodo(p) })),
      anios: [...new Set(d.periodos.map((p) => p.slice(0, 4)))],
      establecimientos: d.establecimientos, productos: d.productos.filter((p) => vendidos.has(p.id)).map((p) => ({ id: p.id, nombre: p.nombre, marca: p.marca })),
      marcas: [...new Set(d.ventas.map((v) => v.marca))].sort(), categorias: [...new Set(d.ventas.map((v) => v.categoria))].sort(),
      presentaciones: [...new Set(d.ventas.map((v) => v.presentacion).filter(Boolean))].sort(),
      metodo_valuacion: d.metodoValuacion, tipo_cambio: d.tipoCambio, formulas: FORMULAS, clases: CLASES, categorias_gasto: CATEGORIAS_GASTO,
      criterios_ranking: Object.fromEntries(Object.entries(CRITERIOS_RANKING).map(([k, v]) => [k, v.titulo])), reportes: TIPOS_REPORTE,
    });
  }));

  // ---------- Análisis ----------
  r.get('/dashboard', ah((req, res) => {
    const d = cargar(db);
    const f = filtroDe(req.query);
    const tabla = tablaMensual(d, { ...f, est: undefined });
    const ests = d.establecimientos.map((e) => e.id);
    const clave = f.est ?? 'TOTAL';
    const serie = tabla.map((t) => ({
      periodo: t.periodo, nombre: t.nombre,
      ...Object.fromEntries(['ventas_netas', 'utilidad_bruta', 'utilidad_operativa', 'gastos_operativos', 'margen_bruto', 'margen_operativo', 'unidades', 'fondo_caja', 'inv_final_teorico']
        .flatMap((m) => [...ests, 'TOTAL'].map((e) => [`${m}_${e}`, t[e]?.[m] ?? null]))),
      parcial: [...ests].some((e) => t[e]?.cobertura?.parcial),
    }));
    // KPIs acumulados del rango: suma de meses (márgenes recalculados sobre la suma)
    const filas = tabla.map((t) => t[clave]).filter((x: any) => x && x.operando);
    const sum = (k: string) => {
      const vs = filas.map((x: any) => x[k]);
      if (!vs.length) return { v: null, e: 'nd', m: 'Sin datos en el rango.' };
      const faltan = filas.filter((x: any) => x[k].v === null).map((x: any) => x.nombre);
      const s = vs.reduce((a: number, x: any) => a + (x.v ?? 0), 0);
      if (faltan.length === vs.length) return { v: null, e: 'nd', m: vs[0].m };
      if (faltan.length) return { v: Math.round(s * 100) / 100, e: 'parcial', m: `No incluye: ${faltan.join(', ')} (dato no disponible).` };
      return { v: Math.round(s * 100) / 100, e: vs.some((x: any) => x.e === 'parcial') ? 'parcial' : 'ok', m: vs.find((x: any) => x.e === 'parcial')?.m };
    };
    const ult = filas[filas.length - 1] as any;
    const kVN = sum('ventas_netas'), kUB = sum('utilidad_bruta'), kUO = sum('utilidad_operativa');
    const pct = (a: any, b: any) => (a.v !== null && b.v ? { v: Math.round((a.v / b.v) * 10000) / 100, e: a.e === 'ok' && b.e === 'ok' ? 'ok' : 'parcial', m: a.m } : { v: null, e: 'nd', m: a.m });
    // Para márgenes del rango: solo meses con ambos datos
    const conUO = filas.filter((x: any) => x.utilidad_operativa.v !== null);
    const mo = conUO.length ? { v: Math.round((conUO.reduce((a: number, x: any) => a + x.utilidad_operativa.v, 0) / conUO.reduce((a: number, x: any) => a + x.ventas_netas.v, 0)) * 10000) / 100, e: conUO.length < filas.length ? 'parcial' : 'ok', m: conUO.length < filas.length ? 'Calculado solo con los meses que tienen gastos registrados.' : undefined } : { v: null, e: 'nd', m: 'Sin utilidad operativa.' };
    const kpis = {
      ventas_netas: kVN, utilidad_bruta: kUB, utilidad_operativa: kUO, margen_bruto: pct(kUB, kVN), margen_operativo: mo,
      unidades: sum('unidades'), gastos_operativos: sum('gastos_operativos'), compras_pagadas: sum('compras_pagadas'),
      inventario: ult ? ult.inv_final_teorico : { v: null, e: 'nd', m: 'Sin datos.' },
      caja_bancos: ult ? ult.caja_bancos : { v: null, e: 'nd' }, cxc: ult ? ult.cxc : { v: null, e: 'nd' }, cxp: ult ? ult.cxp : { v: null, e: 'nd' },
      periodo_saldos: ult?.periodo ?? null,
    };
    const alertas = calcularAlertas(db, d, f);
    res.json({
      filtro: f, periodos: periodosFiltro(d, f), kpis, serie,
      top_productos: ranking(d, f, 'ventas', 10).filas, margen_productos: ranking(d, f, 'margen', 10),
      gastos_categoria: analisisGastos(d, f).por_categoria.map((c) => ({ categoria: c.categoria, total: c.total, participacion: c.participacion })),
      alertas: alertas.filter((a) => a.severidad !== 'positiva').slice(0, 8), positivas: alertas.filter((a) => a.severidad === 'positiva').slice(0, 4),
      conteo_alertas: { critica: alertas.filter((a) => a.severidad === 'critica').length, advertencia: alertas.filter((a) => a.severidad === 'advertencia').length, positiva: alertas.filter((a) => a.severidad === 'positiva').length },
      faltantes: datosFaltantes(d).slice(0, 6),
    });
  }));
  r.get('/mensual', ah((req, res) => res.json(tablaMensual(cargar(db), filtroDe(req.query)))));
  r.get('/comparacion', ah((req, res) => res.json(comparacionMeses(cargar(db), filtroDe(req.query), String(req.query.est || 'TOTAL')))));
  r.get('/ventas', ah((req, res) => {
    const d = cargar(db);
    const f = filtroDe(req.query);
    const prods = porProducto(d, f);
    const ps = periodosFiltro(d, f);
    res.json({
      productos: prods, por_marca: porDimension(d, f, 'marca'), por_categoria: porDimension(d, f, 'categoria'),
      por_presentacion: porDimension(d, f, 'presentacion'), por_pago: porDimension(d, f, 'tipo_pago'), por_establecimiento: porDimension(d, f, 'est'),
      por_mes: porDimension(d, f, 'periodo').sort((a, b) => a.clave.localeCompare(b.clave)),
      top: prods.slice(0, 10), con_caida: ps.length >= 2 ? prods.filter((p) => (p.crecimiento ?? 0) < 0).sort((a, b) => (a.crecimiento ?? 0) - (b.crecimiento ?? 0)).slice(0, 10) : [],
      con_crecimiento: ps.length >= 2 ? prods.filter((p) => (p.crecimiento ?? 0) > 0).sort((a, b) => (b.crecimiento ?? 0) - (a.crecimiento ?? 0)).slice(0, 10) : [],
      baja_participacion: prods.filter((p) => p.participacion < 0.2).slice(-15), sin_ventas: productosSinVentas(d, f),
      periodos: ps, ultimo: ps.at(-1) ?? null, anterior: ps.at(-2) ?? null,
    });
  }));
  r.get('/ranking', ah((req, res) => res.json(ranking(cargar(db), filtroDe(req.query), String(req.query.criterio || 'ventas'), Number(req.query.n) || 20))));
  r.get('/gastos', ah((req, res) => {
    const d = cargar(db);
    const f = filtroDe(req.query);
    const ps = new Set(periodosFiltro(d, f));
    const g = analisisGastos(d, f);
    const tabla = tablaMensual(d, { ...f, est: undefined });
    const clave = f.est ?? 'TOTAL';
    res.json({
      ...g, sobre_ventas: tabla.map((t) => ({ periodo: t.periodo, nombre: t.nombre, gastos: t[clave]?.gastos_operativos, ventas: t[clave]?.ventas_netas, utilidad_bruta: t[clave]?.utilidad_bruta })),
      egresos: d.egresos.filter((e) => e.periodo && ps.has(e.periodo) && (!f.est || e.est === f.est)).map((e) => ({ ...e, participaciones: undefined })),
    });
  }));
  r.patch('/egresos/:id', requiereRol('analista'), ah((req, res) => {
    const id = Number(req.params.id);
    const e = db.get<any>('SELECT * FROM egreso WHERE id = ?', id);
    if (!e) throw new Error('Egreso no encontrado');
    const { clase, categoria, estado, no_duplicado } = req.body ?? {};
    if (clase !== undefined && !(clase in CLASES)) throw new Error('Clase no válida');
    if (categoria !== undefined && typeof categoria !== 'string') throw new Error('Categoría no válida');
    if (estado !== undefined && !['valido', 'excluido'].includes(estado)) throw new Error('Estado no válido');
    db.tx(() => {
      if (clase !== undefined || categoria !== undefined) db.run('UPDATE egreso SET clase = COALESCE(?, clase), categoria = COALESCE(?, categoria), clasificacion_manual = 1 WHERE id = ?', clase ?? null, categoria ?? null, id);
      if (estado !== undefined) db.run('UPDATE egreso SET estado = ? WHERE id = ?', estado, id);
      if (no_duplicado) db.run(`UPDATE egreso SET estado = 'valido', duplicado_de = -1 WHERE id = ?`, id);
    });
    db.auditar(req.usuario!.usuario, 'egreso_modificado', { id, antes: { clase: e.clase, categoria: e.categoria, estado: e.estado }, cambios: req.body });
    despuesDeCambios(db);
    res.json({ ok: true });
  }));
  r.get('/inventario', ah((req, res) => {
    const d = cargar(db);
    const f = filtroDe(req.query);
    const ps = periodosFiltro(d, f);
    const ests = d.establecimientos.map((e) => e.id).filter((e) => !f.est || f.est === e);
    const res2 = ps.map((p) => ({ periodo: p, nombre: nombrePeriodo(p), establecimientos: ests.filter((e) => periodosOperacion(d, e).includes(p)).map((e) => ({ est: e, ...inventarioPeriodo(d, e, p, f) })) }));
    const hay = d.movimientos.length > 0;
    res.json({ hay_datos: hay, periodos: res2, movimientos: d.movimientos.slice(-500), formulas: { disponible: FORMULAS.mercaderia_disponible, teorico: FORMULAS.inventario_teorico, diferencia: FORMULAS.diferencia_inventario } });
  }));
  r.post('/inventario', requiereRol('analista'), ah((req, res) => {
    const { est, periodo, fecha, producto, tamano_ml, tipo, cantidad, costo_unitario, contraparte, nota } = req.body ?? {};
    const TIPOS = ['INVENTARIO_INICIAL', 'COMPRA', 'TRANSFERENCIA_ENTRADA', 'TRANSFERENCIA_SALIDA', 'DEVOLUCION', 'BAJA', 'DANADO', 'PERDIDA', 'AJUSTE', 'INVENTARIO_FISICO'];
    if (!config.establecimientos.some((e) => e.id === est) || !/^\d{4}-\d{2}$/.test(periodo) || !TIPOS.includes(tipo) || !producto || !Number.isFinite(Number(cantidad))) throw new Error('Datos del movimiento incompletos o no válidos.');
    db.run(`INSERT INTO inventario_mov (establecimiento_id, fecha, periodo, producto_texto, tamano_ml, tipo, cantidad, costo_unitario, contraparte_id, origen, usuario, nota)
      VALUES (?,?,?,?,?,?,?,?,?, 'manual', ?, ?)`, est, fecha || null, periodo, String(producto), tamano_ml ? Number(tamano_ml) : null, tipo, Number(cantidad),
      costo_unitario ? Number(costo_unitario) : null, contraparte || null, req.usuario!.usuario, nota || null);
    recalcularProductos(db);
    db.auditar(req.usuario!.usuario, 'inventario_manual', req.body);
    despuesDeCambios(db);
    res.json({ ok: true });
  }));
  r.get('/financiero', ah((req, res) => {
    const d = cargar(db);
    const periodo = typeof req.query.periodo === 'string' && d.periodos.includes(req.query.periodo) ? req.query.periodo : d.periodos.at(-1);
    if (!periodo) return res.json({ vacio: true });
    const est = String(req.query.est || 'TOTAL');
    res.json({ situacion: situacionFinanciera(d, periodo, est), liquidez: liquidez(d, periodo, est) });
  }));
  r.get('/comparativo', ah((req, res) => {
    const d = cargar(db);
    const f = filtroDe(req.query);
    const tabla = tablaMensual(d, { ...f, est: undefined });
    const ests = d.establecimientos.map((e) => e.id);
    const metricas = ['ventas_netas', 'unidades', 'costo_ventas', 'utilidad_bruta', 'margen_bruto', 'gastos_operativos', 'utilidad_operativa', 'margen_operativo', 'precio_promedio', 'ticket_promedio', 'inv_final_teorico', 'caja_bancos', 'flujo_neto'];
    const acumulado: any = {};
    for (const e of [...ests, 'TOTAL']) {
      const filas = tabla.map((t) => t[e]).filter((x: any) => x?.operando);
      acumulado[e] = {};
      for (const m of ['ventas_netas', 'unidades', 'costo_ventas', 'utilidad_bruta', 'gastos_operativos', 'utilidad_operativa', 'flujo_neto']) {
        const nulos = filas.filter((x: any) => x[m].v === null).map((x: any) => x.nombre);
        acumulado[e][m] = { v: Math.round(filas.reduce((a: number, x: any) => a + (x[m].v ?? 0), 0) * 100) / 100, e: nulos.length ? 'parcial' : filas.some((x: any) => x[m].e === 'parcial') ? 'parcial' : 'ok', excluye: nulos };
      }
      const vn = acumulado[e].ventas_netas.v;
      acumulado[e].margen_bruto = vn ? Math.round((acumulado[e].utilidad_bruta.v / vn) * 10000) / 100 : null;
      const conUO = filas.filter((x: any) => x.utilidad_operativa.v !== null);
      const vnUO = conUO.reduce((a: number, x: any) => a + x.ventas_netas.v, 0);
      acumulado[e].margen_operativo = vnUO ? Math.round((conUO.reduce((a: number, x: any) => a + x.utilidad_operativa.v, 0) / vnUO) * 10000) / 100 : null;
      acumulado[e].meses = filas.length;
      acumulado[e].promedio_mensual = filas.length ? Math.round((vn / filas.length) * 100) / 100 : null;
    }
    res.json({ metricas, tabla, acumulado, establecimientos: d.establecimientos, top_por_est: Object.fromEntries(ests.map((e) => [e, ranking(d, { ...f, est: e }, 'ventas', 8).filas])) });
  }));
  r.get('/alertas', ah((req, res) => res.json(calcularAlertas(db, cargar(db), filtroDe(req.query)))));
  r.get('/alertas/reglas', ah((_req, res) => res.json(db.all('SELECT * FROM regla_alerta ORDER BY severidad, codigo'))));
  r.put('/alertas/reglas/:codigo', requiereRol('analista'), ah((req, res) => {
    const { valor, activo } = req.body ?? {};
    const ant = db.get<any>('SELECT * FROM regla_alerta WHERE codigo = ?', req.params.codigo);
    if (!ant) throw new Error('Regla no encontrada');
    if (valor !== undefined && !Number.isFinite(Number(valor))) throw new Error('Valor no válido');
    db.run('UPDATE regla_alerta SET valor = COALESCE(?, valor), activo = COALESCE(?, activo) WHERE codigo = ?', valor === undefined ? null : Number(valor), activo === undefined ? null : activo ? 1 : 0, req.params.codigo);
    db.auditar(req.usuario!.usuario, 'regla_alerta', { codigo: req.params.codigo, antes: { valor: ant.valor, activo: ant.activo }, despues: req.body });
    despuesDeCambios(db);
    res.json({ ok: true });
  }));
  r.get('/calidad', ah((_req, res) => res.json(informeCalidad(db, cargar(db)))));
  r.get('/faltantes', ah((_req, res) => res.json(datosFaltantes(cargar(db)))));
  r.get('/traza', ah((req, res) => {
    const f = filtroDe(req.query);
    const periodo = typeof req.query.periodo === 'string' && /^\d{4}-\d{2}$/.test(req.query.periodo) ? req.query.periodo : undefined;
    res.json(traza(cargar(db), String(req.query.metrica), { ...f, periodo, est: typeof req.query.est === 'string' ? req.query.est : undefined }));
  }));

  // ---------- Datos proporcionados por el usuario ----------
  r.post('/datos/saldo', requiereRol('analista'), ah((req, res) => {
    const { concepto, est, periodo, monto, tercero, nota } = req.body ?? {};
    const CONC = ['CAJA', 'BANCOS', 'CXC', 'CXP', 'PRESTAMO', 'CAPITAL', 'APORTE', 'RETIRO', 'INVENTARIO_VALORIZADO', 'OTRO_ACTIVO', 'OTRO_PASIVO'];
    if (!CONC.includes(concepto) || !config.establecimientos.some((e) => e.id === est) || !/^\d{4}-\d{2}$/.test(periodo) || !Number.isFinite(Number(monto))) throw new Error('Datos del saldo incompletos o no válidos.');
    const previo = db.get<any>(`SELECT id, monto FROM saldo WHERE origen = 'manual' AND estado = 'valido' AND concepto = ? AND establecimiento_id = ? AND periodo = ?`, concepto, est, periodo);
    db.tx(() => {
      if (previo) db.run(`UPDATE saldo SET estado = 'excluido', nota = COALESCE(nota, '') || ' [reemplazado]' WHERE id = ?`, previo.id);
      db.run(`INSERT INTO saldo (establecimiento_id, periodo, concepto, monto, tercero, origen, usuario, nota) VALUES (?, ?, ?, ?, ?, 'manual', ?, ?)`,
        est, periodo, concepto, Number(monto), tercero || null, req.usuario!.usuario, nota || null);
    });
    db.auditar(req.usuario!.usuario, 'saldo_manual', { concepto, est, periodo, monto: Number(monto), anterior: previo?.monto ?? null });
    despuesDeCambios(db);
    res.json({ ok: true, reemplazo: !!previo });
  }));
  r.get('/datos/saldos', ah((_req, res) => res.json(db.all(`SELECT * FROM saldo ORDER BY periodo DESC, establecimiento_id, concepto`))));
  r.post('/datos/parametro', requiereRol('analista'), ah((req, res) => {
    const { clave, valor } = req.body ?? {};
    const PERMITIDOS: Record<string, (v: any) => boolean> = {
      tipo_cambio_usd: (v) => Number(v) > 0 && Number(v) < 100,
      metodo_valuacion: (v) => ['COSTO_ESTANDAR_PROVEEDOR', 'PROMEDIO_PONDERADO', 'PEPS'].includes(v),
      correccion_presentacion_por_precio: (v) => ['0', '1'].includes(String(v)),
    };
    if (!(clave in PERMITIDOS) || !PERMITIDOS[clave](valor)) throw new Error('Parámetro o valor no válido.');
    const antes = db.parametro(clave);
    db.setParametro(clave, String(valor), req.usuario!.usuario);
    if (clave === 'metodo_valuacion') db.setParametro('metodo_valuacion_manual', '1', req.usuario!.usuario);
    db.auditar(req.usuario!.usuario, 'parametro', { clave, antes, despues: valor });
    despuesDeCambios(db);
    res.json({ ok: true });
  }));
  r.get('/datos/parametros', ah((_req, res) => res.json(db.all(`SELECT clave, valor, descripcion, actualizado_por, fecha FROM parametro WHERE clave <> 'session_secret'`))));
  r.post('/datos/costo', requiereRol('analista'), ah((req, res) => {
    const { presentacion, costo, precio_publico } = req.body ?? {};
    if (typeof presentacion !== 'string' || !/^[A-Z0-9_]+$/.test(presentacion) || !(Number(costo) >= 0)) throw new Error('Datos de costo no válidos.');
    db.run(`INSERT INTO costo_referencia (hoja_id, fila, clave_presentacion, articulo, categoria, tamano_ml, costo_unitario, precio_publico) VALUES (NULL, NULL, ?, ?, NULL, NULL, ?, ?)`,
      presentacion, `${presentacion} (registrado por ${req.usuario!.usuario})`, Number(costo), precio_publico ? Number(precio_publico) : null);
    if (!db.parametro('metodo_valuacion')) db.setParametro('metodo_valuacion', 'COSTO_ESTANDAR_PROVEEDOR', req.usuario!.usuario);
    db.auditar(req.usuario!.usuario, 'costo_manual', req.body);
    despuesDeCambios(db);
    res.json({ ok: true });
  }));

  // ---------- Centro de carga ----------
  r.post('/carga', requiereRol('analista'), upload.array('archivos', 20), ah((req, res) => {
    const files = (req.files as Express.Multer.File[]) || [];
    if (!files.length) throw new Error('No se recibieron archivos válidos (.xlsx, .xls o .csv).');
    const resultados = files.map((f) => {
      const nombre = path.basename(Buffer.from(f.originalname, 'latin1').toString('utf8'));
      try { return procesarArchivo(db, f.buffer, nombre, req.usuario!.usuario, 'carga'); } catch (e: any) { return { nombre, estado: 'error', mensaje: String(e?.message || e), hojas: [] }; }
    });
    despuesDeCambios(db);
    res.json(resultados);
  }));
  r.post('/carga/escanear', requiereRol('analista'), ah((req, res) => {
    const r2 = escanearCarpeta(db, req.usuario!.usuario);
    despuesDeCambios(db);
    res.json(r2);
  }));
  r.get('/carga/archivos', ah((_req, res) => res.json(db.all(`SELECT a.id, a.nombre, a.hash, a.tamano, a.extension, a.origen, a.usuario, a.fecha_carga, a.estado, a.resumen,
    (SELECT COUNT(*) FROM hoja h WHERE h.archivo_id = a.id) hojas FROM archivo a ORDER BY a.id DESC`).map((a: any) => ({ ...a, resumen: a.resumen ? JSON.parse(a.resumen) : null })))));
  r.get('/carga/archivos/:id', ah((req, res) => {
    const a = db.get<any>('SELECT * FROM archivo WHERE id = ?', Number(req.params.id));
    if (!a) throw new Error('Archivo no encontrado');
    const hojas = db.all<any>('SELECT * FROM hoja WHERE archivo_id = ? ORDER BY id', a.id).map((h) => ({ ...h, perfil: JSON.parse(h.perfil || 'null'), mensajes: JSON.parse(h.mensajes || '[]') }));
    res.json({ ...a, ruta_original: undefined, resumen: a.resumen ? JSON.parse(a.resumen) : null, hojas });
  }));
  r.get('/carga/archivos/:id/original', ah((req, res) => {
    const a = db.get<any>('SELECT * FROM archivo WHERE id = ?', Number(req.params.id));
    if (!a?.ruta_original || !fs.existsSync(a.ruta_original)) throw new Error('Original no disponible');
    res.download(a.ruta_original, a.nombre);
  }));
  r.post('/carga/hojas/:id/resolver', requiereRol('analista'), ah((req, res) => {
    const { accion, tipo } = req.body ?? {};
    if (!['reemplazar', 'rechazar'].includes(accion)) throw new Error('Acción no válida');
    const msg = resolverPendiente(db, Number(req.params.id), accion, req.usuario!.usuario, tipo || undefined);
    despuesDeCambios(db);
    res.json({ ok: true, mensaje: msg });
  }));

  // ---------- Productos ----------
  r.get('/productos', ah((_req, res) => {
    const d = cargar(db);
    const ventas = new Map<number, { n: number; t: number }>();
    for (const v of d.ventas) if (v.producto_id) { const x = ventas.get(v.producto_id) || { n: 0, t: 0 }; x.n++; x.t += v.total; ventas.set(v.producto_id, x); }
    res.json({
      productos: d.productos.map((p) => ({ ...p, lineas: ventas.get(p.id)?.n ?? 0, ventas: Math.round((ventas.get(p.id)?.t ?? 0) * 100) / 100 })),
      alias: db.all(`SELECT a.*, p.nombre producto FROM producto_alias a JOIN producto p ON p.id = a.producto_id ORDER BY a.confirmado, a.puntaje`),
    });
  }));
  r.patch('/productos/alias', requiereRol('analista'), ah((req, res) => {
    const { alias_clave, producto_id } = req.body ?? {};
    if (!db.get('SELECT 1 FROM producto WHERE id = ?', Number(producto_id)) || !db.get('SELECT 1 FROM producto_alias WHERE alias_clave = ?', alias_clave)) throw new Error('Datos no válidos');
    db.run('UPDATE producto_alias SET producto_id = ?, metodo = ?, puntaje = 1, confirmado = 1 WHERE alias_clave = ?', Number(producto_id), 'manual', alias_clave);
    recalcularProductos(db);
    db.auditar(req.usuario!.usuario, 'alias_producto', req.body);
    despuesDeCambios(db);
    res.json({ ok: true });
  }));

  // ---------- Agente ----------
  r.get('/agente/estado', ah((_req, res) => res.json(estadoAgente())));
  r.post('/agente', ah(async (req, res) => {
    const { pregunta, historial } = req.body ?? {};
    if (typeof pregunta !== 'string' || !pregunta.trim() || pregunta.length > 2000) throw new Error('Escriba una pregunta (máximo 2000 caracteres).');
    const r2 = await preguntarAgente(db, pregunta.trim(), Array.isArray(historial) ? historial.slice(-10) : []);
    db.run('INSERT INTO conversacion (usuario, pregunta, respuesta, motor) VALUES (?, ?, ?, ?)', req.usuario!.usuario, pregunta, r2.respuesta, r2.motor);
    res.json(r2);
  }));

  // ---------- Reportes ----------
  r.get('/reportes/:tipo', ah(async (req, res) => {
    const formato = String(req.query.formato || 'xlsx');
    if (!['xlsx', 'pdf', 'csv'].includes(formato)) throw new Error('Formato no válido');
    const out = await generarReporte(db, cargar(db), String(req.params.tipo), formato as 'xlsx' | 'pdf' | 'csv', filtroDe(req.query));
    db.auditar(req.usuario!.usuario, 'reporte', { tipo: req.params.tipo, formato });
    res.setHeader('Content-Type', out.mime);
    res.setHeader('Content-Disposition', `attachment; filename="${out.nombre}"`);
    res.send(out.buffer);
  }));
  r.get('/plantillas/:tipo', (req, res) => {
    const P: Record<string, string> = {
      'inventario.csv': 'FECHA;ESTABLECIMIENTO;PRODUCTO;TAMAÑO (ML);TIPO;CANTIDAD;COSTO UNITARIO;DESTINO;ORIGEN;REFERENCIA\n'
        + '01/03/2026;Cochabamba;Ralph Celeste;100;Inventario inicial;10;100;;;\n31/03/2026;Cochabamba;Ralph Celeste;100;Inventario fisico;6;100;;;\n',
      'saldos.csv': 'FECHA;ESTABLECIMIENTO;CONCEPTO;SALDO;TERCERO\n31/08/2026;Cochabamba;Bancos;0;Banco ...\n31/08/2026;La Paz;Cuentas por pagar;0;Proveedor ...\n',
    };
    const t = P[req.params.tipo];
    if (!t) return res.status(404).json({ error: 'Plantilla no encontrada' });
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="plantilla_${req.params.tipo}"`);
    res.send('﻿' + t);
  });

  // ---------- Administración ----------
  r.get('/admin/usuarios', requiereRol('admin'), ah((_req, res) => res.json(db.all('SELECT id, usuario, nombre, rol, activo, debe_cambiar, creado FROM usuario ORDER BY id'))));
  r.post('/admin/usuarios', requiereRol('admin'), ah((req, res) => {
    const { usuario, nombre, rol } = req.body ?? {};
    if (typeof usuario !== 'string' || !/^[a-zA-Z0-9._-]{3,30}$/.test(usuario) || !['admin', 'analista', 'lector'].includes(rol)) throw new Error('Datos de usuario no válidos (usuario de 3 a 30 caracteres sin espacios).');
    if (db.get('SELECT 1 FROM usuario WHERE lower(usuario) = lower(?)', usuario)) throw new Error('El usuario ya existe.');
    const temporal = passwordAleatoria();
    const { hash, salt } = hashPassword(temporal);
    db.run('INSERT INTO usuario (usuario, nombre, rol, hash, salt, debe_cambiar) VALUES (?, ?, ?, ?, ?, 1)', usuario, nombre || usuario, rol, hash, salt);
    db.auditar(req.usuario!.usuario, 'usuario_creado', { usuario, rol });
    res.json({ ok: true, password_temporal: temporal });
  }));
  r.patch('/admin/usuarios/:id', requiereRol('admin'), ah((req, res) => {
    const id = Number(req.params.id);
    const { activo, rol, reset } = req.body ?? {};
    if (id === req.usuario!.id && (activo === false || (rol && rol !== 'admin'))) throw new Error('No puede desactivarse ni quitarse el rol de administrador a sí mismo.');
    let temporal: string | undefined;
    if (rol !== undefined && !['admin', 'analista', 'lector'].includes(rol)) throw new Error('Rol no válido');
    if (activo !== undefined) db.run('UPDATE usuario SET activo = ? WHERE id = ?', activo ? 1 : 0, id);
    if (rol !== undefined) db.run('UPDATE usuario SET rol = ? WHERE id = ?', rol, id);
    if (reset) { temporal = passwordAleatoria(); const { hash, salt } = hashPassword(temporal); db.run('UPDATE usuario SET hash = ?, salt = ?, debe_cambiar = 1 WHERE id = ?', hash, salt, id); }
    db.auditar(req.usuario!.usuario, 'usuario_modificado', { id, activo, rol, reset: !!reset });
    res.json({ ok: true, password_temporal: temporal });
  }));
  r.get('/admin/auditoria', requiereRol('admin'), ah((req, res) => res.json(db.all('SELECT * FROM auditoria ORDER BY id DESC LIMIT ?', Math.min(Number(req.query.n) || 300, 2000)))));
  r.get('/admin/alertas-historial', ah((_req, res) => res.json(db.all('SELECT * FROM alerta_historial ORDER BY id DESC LIMIT 300'))));

  return r;
}
