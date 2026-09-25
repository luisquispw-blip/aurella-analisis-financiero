// Normalización de productos: presentación (para el costo), categoría y unificación de nombres
// escritos de distintas formas ("RAPH CELESTE", "Ralph celeste", "RAPLH CELESTE").
import type { Db } from '../database/db.ts';
import { claveTexto, norm, similitud } from '../importers/utilidades.ts';

export type Presentacion = { clave: string; categoria: string; tamano: number | null; etiqueta: string };

export function clavePresentacionArticulo(texto: string, tamano: number | null = null): Presentacion {
  const t = norm(texto);
  const ml = tamano ?? (t.match(/(\d{1,3})\s*ML\b/) ? Number(t.match(/(\d{1,3})\s*ML\b/)![1]) : null);
  if (/ATOMIZ/.test(t)) return { clave: 'ATOMIZADOR', categoria: 'Accesorio', tamano: ml, etiqueta: 'Atomizador' };
  if (/GIFT\s*CARD|TARJETA DE REGALO|GIFTCARD/.test(t)) return { clave: 'GIFT_CARD', categoria: 'Tarjeta de regalo', tamano: null, etiqueta: 'Tarjeta de regalo' };
  if (/ESENCIA/.test(t)) return { clave: 'ESENCIAS_DIFUSORES', categoria: 'Esencia', tamano: ml, etiqueta: 'Esencia para difusor' };
  if (/DIFUS|DIFFUS/.test(t)) {
    if (/\bLITE\b/.test(t)) return { clave: 'HOME_LITE_DIFUSER', categoria: 'Difusor', tamano: null, etiqueta: 'Home Lite Difuser' };
    if (/\bMULTI\b/.test(t)) return { clave: 'HOME_MULTI_DIFUSER', categoria: 'Difusor', tamano: null, etiqueta: 'Home Multi Difuser' };
    if (/\bCARS?\b/.test(t)) return { clave: 'CAR_DIFUSER', categoria: 'Difusor', tamano: null, etiqueta: 'Car Difuser' };
    return { clave: 'DIFUSOR_SIN_TIPO', categoria: 'Difusor', tamano: null, etiqueta: 'Difusor (tipo no especificado)' };
  }
  if (ml) return { clave: `PERFUME_${ml}`, categoria: 'Perfume', tamano: ml, etiqueta: `Perfume ${ml} ml` };
  return { clave: 'PERFUME_SIN_TAMANO', categoria: 'Perfume', tamano: null, etiqueta: 'Perfume (tamaño no registrado)' };
}

export function claveProducto(texto: string): string {
  return claveTexto(texto).replace(/\b\d{1,3}\s*ML\b/g, '').replace(/\s+/g, ' ').trim();
}

function titulo(s: string): string {
  return s.toLowerCase().replace(/\b([a-záéíóúñ])/g, (m) => m.toUpperCase()).replace(/\s+/g, ' ').trim();
}

type ProdCat = { id: number; clave: string; tokens: string[] };

const PALABRAS_VARIANTE = new Set(['ELIXIR', 'INTENSE', 'OUD', 'TOBACCO', 'PARFUM', 'PROFUMO', 'PROFONDO', 'ABSOLU', 'NOIR', 'BLACK', 'ROSE', 'SPORT',
  'EXTREME', 'EXTRA', 'DOSE', 'BLOOMING', 'BLUSH', 'GOLD', 'RED', 'NIGHT', 'CANDY', 'LEATHER', 'NOMADE', 'PRIVE', 'LEGEND', 'TENDRE', 'FRAICHE',
  'EDITION', 'COLOGNE', 'AQUA', 'BLUE', 'GREEN', 'PINK', 'WHITE', 'SEXY', 'VIP', 'STRAVAGANZA', 'BOUQUET', 'ABSOLUTE', 'LOVE', 'PURE']);

export type ResultadoMatch = { metodo: 'exacto' | 'aproximado' | 'contenido'; producto_id: number; puntaje: number } | null;

export function buscarEnCatalogo(clave: string, catalogo: ProdCat[]): ResultadoMatch {
  if (!clave) return null;
  const exacto = catalogo.find((c) => c.clave === clave);
  if (exacto) return { metodo: 'exacto', producto_id: exacto.id, puntaje: 1 };
  let mejor: ProdCat | null = null, mejorS = 0;
  for (const c of catalogo) {
    const s = similitud(clave, c.clave);
    if (s > mejorS) { mejorS = s; mejor = c; }
  }
  if (mejor && mejorS >= 0.85 && clave.length >= 5) return { metodo: 'aproximado', producto_id: mejor.id, puntaje: mejorS };
  // Contenido: todas las palabras del nombre vendido están en el nombre del catálogo ("STRONGER WITH YOU")
  const tk = clave.split(' ').filter((x) => x.length >= 2);
  if (tk.length && clave.length >= 4) {
    const coincide = (t: string, ct: string) => ct === t || (t.length >= 5 && similitud(t, ct) >= 0.8);
    const cands = catalogo
      .filter((c) => tk.every((t) => c.tokens.some((ct) => coincide(t, ct))))
      // si al nombre del catálogo le sobran palabras de variante (ELIXIR, OUD, TOBACCO...) es otro producto
      .filter((c) => !c.tokens.some((ct) => !tk.some((t) => coincide(t, ct)) && PALABRAS_VARIANTE.has(ct)))
      .map((c) => ({ c, cob: tk.length / c.tokens.length }))
      .filter((x) => x.cob >= 0.6)
      .sort((a, b) => b.cob - a.cob);
    if (cands.length === 1 || (cands.length > 1 && cands[0].cob > cands[1].cob)) {
      return { metodo: 'contenido', producto_id: cands[0].c.id, puntaje: redondear2(cands[0].cob) };
    }
  }
  return null;
}
function redondear2(n: number) { return Math.round(n * 100) / 100; }

// Recalcula el producto de cada venta/movimiento a partir de los alias. Los alias confirmados manualmente no se tocan.
export function recalcularProductos(db: Db): { alias: number; nuevos: number; aproximados: number } {
  let nuevos = 0, aproximados = 0;
  db.tx(() => {
    const catalogo: ProdCat[] = db.all<{ id: number; clave: string }>(`SELECT id, clave FROM producto WHERE origen = 'catalogo'`)
      .map((p) => ({ id: p.id, clave: p.clave, tokens: p.clave.split(' ') }));
    const propios = db.all<{ id: number; clave: string }>(`SELECT id, clave FROM producto WHERE origen = 'ventas'`);
    const textos = db.all<{ t: string }>(`SELECT DISTINCT producto_texto t FROM venta WHERE producto_texto IS NOT NULL
      UNION SELECT DISTINCT producto_texto FROM inventario_mov WHERE producto_texto IS NOT NULL`);
    const insAlias = db.raw.prepare(`INSERT INTO producto_alias (alias_clave, alias_texto, producto_id, metodo, puntaje, confirmado)
      VALUES (?, ?, ?, ?, ?, 0) ON CONFLICT(alias_clave) DO UPDATE SET producto_id = excluded.producto_id, metodo = excluded.metodo,
      puntaje = excluded.puntaje WHERE producto_alias.confirmado = 0`);
    const insProd = db.raw.prepare(`INSERT INTO producto (clave, nombre, marca, categoria, origen) VALUES (?, ?, NULL, ?, 'ventas')`);
    const vistos = new Set<string>();
    for (const { t } of textos) {
      const pres = clavePresentacionArticulo(t);
      const clave = pres.categoria === 'Accesorio' ? 'ATOMIZADOR' : claveProducto(t);
      if (!clave || vistos.has(clave)) continue;
      vistos.add(clave);
      const conf = db.get(`SELECT 1 FROM producto_alias WHERE alias_clave = ? AND confirmado = 1`, clave);
      if (conf) continue;
      let m = pres.categoria === 'Perfume' ? buscarEnCatalogo(clave, catalogo) : null;
      if (!m) {
        // agrupar con productos creados desde ventas con nombre casi idéntico
        let mejor: { id: number; s: number } | null = null;
        for (const p of propios) {
          const s = similitud(clave, p.clave);
          if (s >= 0.86 && (!mejor || s > mejor.s)) mejor = { id: p.id, s };
        }
        if (mejor) m = { metodo: 'aproximado', producto_id: mejor.id, puntaje: redondear2(mejor.s) };
      }
      if (!m) {
        const nombre = pres.categoria === 'Accesorio' ? 'Atomizador' : titulo(t.replace(/\b\d{1,3}\s*ml\b/gi, ''));
        const ex = db.get<{ id: number }>('SELECT id FROM producto WHERE clave = ?', clave);
        const id = ex ? ex.id : Number(insProd.run(clave, nombre, pres.categoria).lastInsertRowid);
        if (!ex) { propios.push({ id, clave }); nuevos++; }
        m = { metodo: 'exacto', producto_id: id, puntaje: 1 };
      }
      if (m.metodo !== 'exacto') aproximados++;
      insAlias.run(clave, t, m.producto_id, m.metodo, m.puntaje);
    }
    // Asignación a ventas y movimientos
    const alias = new Map(db.all<{ alias_clave: string; producto_id: number }>('SELECT alias_clave, producto_id FROM producto_alias').map((a) => [a.alias_clave, a.producto_id]));
    const ventas = db.all<{ id: number; producto_texto: string | null; tamano_ml: number | null }>('SELECT id, producto_texto, tamano_ml FROM venta');
    const upd = db.raw.prepare('UPDATE venta SET producto_id = ?, categoria = ?, presentacion = ? WHERE id = ?');
    for (const v of ventas) {
      if (!v.producto_texto) { upd.run(null, null, null, v.id); continue; }
      const pres = clavePresentacionArticulo(v.producto_texto, v.tamano_ml);
      const clave = pres.categoria === 'Accesorio' ? 'ATOMIZADOR' : claveProducto(v.producto_texto);
      upd.run(alias.get(clave) ?? null, pres.categoria, pres.clave, v.id);
    }
    const movs = db.all<{ id: number; producto_texto: string }>('SELECT id, producto_texto FROM inventario_mov');
    const updM = db.raw.prepare('UPDATE inventario_mov SET producto_id = ? WHERE id = ?');
    for (const mv of movs) updM.run(alias.get(claveProducto(mv.producto_texto)) ?? null, mv.id);
  });
  const total = db.get<{ n: number }>('SELECT COUNT(*) n FROM producto_alias')!.n;
  return { alias: total, nuevos, aproximados };
}

export function registrarCatalogo(db: Db, items: { nombre: string; marca: string | null; categoria: string | null; codigo: string | null }[]) {
  const ins = db.raw.prepare(`INSERT INTO producto (clave, nombre, marca, categoria, codigo, origen) VALUES (?, ?, ?, ?, ?, 'catalogo')
    ON CONFLICT(clave) DO UPDATE SET marca = COALESCE(excluded.marca, producto.marca), origen = 'catalogo',
    categoria = COALESCE(excluded.categoria, producto.categoria), codigo = COALESCE(excluded.codigo, producto.codigo)`);
  for (const it of items) {
    const clave = claveProducto(it.nombre);
    if (!clave) continue;
    ins.run(clave, it.nombre, it.marca ? titulo(it.marca) : null, it.categoria || clavePresentacionArticulo(it.nombre).categoria, it.codigo);
  }
}
