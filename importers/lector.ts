// Lectura de Excel (.xlsx/.xls) y CSV a una matriz de celdas por hoja, sin modificar el original.
import * as XLSX from 'xlsx';
import { norm, vacio } from './utilidades.ts';

export type HojaLeida = {
  nombre: string;
  filas: unknown[][]; // matriz densa; fila 0 = fila 1 de Excel (primera fila del rango usado)
  filaInicial: number; // número de fila de Excel de filas[0]
  columnas: number;
  combinadas: number;
};

export type LibroLeido = { tipo: 'xlsx' | 'xls' | 'csv'; hojas: HojaLeida[] };

export const EXTENSIONES = ['.xlsx', '.xls', '.xlsm', '.csv'];

// Algunas hojas declaran un rango de 1.048.576 filas aunque solo tengan datos al inicio: se recorta al rango real.
function rangoReal(ws: XLSX.WorkSheet): XLSX.Range | null {
  let maxR = -1, maxC = -1, minR = Infinity, minC = Infinity;
  for (const k of Object.keys(ws)) {
    if (k[0] === '!') continue;
    const cell = ws[k] as XLSX.CellObject;
    if (cell.v === undefined || cell.v === null || (typeof cell.v === 'string' && cell.v.trim() === '')) continue;
    const { r, c } = XLSX.utils.decode_cell(k);
    if (r > maxR) maxR = r;
    if (c > maxC) maxC = c;
    if (r < minR) minR = r;
    if (c < minC) minC = c;
  }
  if (maxR < 0) return null;
  return { s: { r: Math.min(minR, 0), c: 0 }, e: { r: maxR, c: maxC } };
}

function detectarSeparador(texto: string): string {
  const muestra = texto.split(/\r?\n/).slice(0, 20).join('\n');
  const cand = [';', ',', '\t', '|'];
  let mejor = ',', max = -1;
  for (const c of cand) {
    const n = muestra.split(c).length;
    if (n > max) { max = n; mejor = c; }
  }
  return mejor;
}

export function leerLibro(buf: Buffer, nombreArchivo: string): LibroLeido {
  const ext = nombreArchivo.toLowerCase().slice(nombreArchivo.lastIndexOf('.'));
  let wb: XLSX.WorkBook;
  let tipo: LibroLeido['tipo'];
  if (ext === '.csv') {
    tipo = 'csv';
    // UTF-8 con o sin BOM; si hay bytes inválidos se asume Windows-1252 (Excel en español)
    let texto = buf.toString('utf8');
    if (texto.includes('�')) texto = new TextDecoder('windows-1252').decode(buf);
    texto = texto.replace(/^﻿/, '');
    // raw: true evita que la librería interprete "1.234,50" o "01/03/2026" con reglas de otro país;
    // la normalización la hace el sistema con trazabilidad.
    wb = XLSX.read(texto, { type: 'string', raw: true, FS: detectarSeparador(texto) } as XLSX.ParsingOptions);
  } else {
    tipo = ext === '.xls' ? 'xls' : 'xlsx';
    wb = XLSX.read(buf, { type: 'buffer', cellDates: false, cellFormula: false, cellHTML: false });
  }
  const hojas: HojaLeida[] = [];
  for (const nombre of wb.SheetNames) {
    const ws = wb.Sheets[nombre];
    const rango = rangoReal(ws);
    if (!rango) {
      hojas.push({ nombre, filas: [], filaInicial: 1, columnas: 0, combinadas: 0 });
      continue;
    }
    const filas = XLSX.utils.sheet_to_json<unknown[]>(ws, {
      header: 1, defval: null, raw: true, blankrows: true, range: rango,
    });
    for (const f of filas) for (let i = 0; i < f.length; i++) if (typeof f[i] === 'string' && (f[i] as string).trim() === '') f[i] = null;
    hojas.push({
      nombre,
      filas,
      filaInicial: rango.s.r + 1,
      columnas: rango.e.c + 1,
      combinadas: (ws['!merges'] || []).length,
    });
  }
  return { tipo, hojas };
}

export type PerfilHoja = {
  filas_totales: number;
  filas_con_datos: number;
  columnas: number;
  celdas_combinadas: number;
  fila_encabezado: number | null;
  encabezados: string[];
  columnas_detalle: { indice: number; letra: string; encabezado: string; numericos: number; textos: number; vacios: number; tipo_dominante: string }[];
  filas_duplicadas: number;
};

// Perfilamiento genérico: tipos por columna, vacíos, duplicados exactos.
export function perfilar(h: HojaLeida, filaEncabezado: number | null): PerfilHoja {
  const conDatos = h.filas.filter((f) => f.some((v) => !vacio(v)));
  const encabezados = filaEncabezado !== null ? (h.filas[filaEncabezado] || []).map((v) => (vacio(v) ? '' : String(v).trim())) : [];
  const cuerpo = filaEncabezado !== null ? h.filas.slice(filaEncabezado + 1) : h.filas;
  const cols = [];
  for (let c = 0; c < h.columnas; c++) {
    let num = 0, txt = 0, vac = 0;
    for (const f of cuerpo) {
      const v = f[c];
      if (vacio(v)) vac++;
      else if (typeof v === 'number') num++;
      else txt++;
    }
    if (num + txt === 0 && !encabezados[c]) continue;
    cols.push({
      indice: c, letra: XLSX.utils.encode_col(c), encabezado: encabezados[c] || '',
      numericos: num, textos: txt, vacios: vac,
      tipo_dominante: num + txt === 0 ? 'vacía' : num >= txt ? 'numérica' : 'texto',
    });
  }
  const vistos = new Set<string>();
  let dup = 0;
  for (const f of cuerpo) {
    if (!f.some((v) => !vacio(v))) continue;
    const k = JSON.stringify(f);
    if (vistos.has(k)) dup++;
    else vistos.add(k);
  }
  return {
    filas_totales: h.filas.length,
    filas_con_datos: conDatos.length,
    columnas: h.columnas,
    celdas_combinadas: h.combinadas,
    fila_encabezado: filaEncabezado === null ? null : filaEncabezado + h.filaInicial,
    encabezados,
    columnas_detalle: cols,
    filas_duplicadas: dup,
  };
}

// Busca la fila de encabezados: la que contiene más sinónimos de un tipo en las primeras N filas.
export function buscarEncabezado(h: HojaLeida, requeridos: string[][], maxFilas = 25): number | null {
  let mejor: number | null = null, mejorPuntaje = 0;
  for (let i = 0; i < Math.min(h.filas.length, maxFilas); i++) {
    const celdas = h.filas[i].map((v) => norm(v));
    let puntaje = 0;
    for (const grupo of requeridos) {
      if (grupo.some((s) => celdas.some((c) => c && (c === norm(s) || c.includes(norm(s)))))) puntaje++;
    }
    if (puntaje > mejorPuntaje) { mejorPuntaje = puntaje; mejor = i; }
  }
  return mejorPuntaje >= Math.min(2, requeridos.length) ? mejor : null;
}
