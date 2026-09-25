// Funciones puras de normalización. No dependen de la base de datos: se prueban de forma aislada.
import { config } from '../config/app.config.ts';

export function norm(v: unknown): string {
  if (v === null || v === undefined) return '';
  return String(v)
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[´`’']/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// Clave de comparación de productos: sin puntuación ni espacios repetidos.
export function claveTexto(v: unknown): string {
  return norm(v).replace(/[^A-Z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
}

export function vacio(v: unknown): boolean {
  return v === null || v === undefined || (typeof v === 'string' && v.trim() === '');
}

export const MESES: Record<string, number> = {
  ENERO: 1, FEBRERO: 2, MARZO: 3, ABRIL: 4, MAYO: 5, JUNIO: 6, JULIO: 7, AGOSTO: 8,
  SEPTIEMBRE: 9, SETIEMBRE: 9, OCTUBRE: 10, NOVIEMBRE: 11, DICIEMBRE: 12,
  JANUARY: 1, FEBRUARY: 2, MARCH: 3, APRIL: 4, MAY: 5, JUNE: 6, JULY: 7, AUGUST: 8,
  SEPTEMBER: 9, OCTOBER: 10, NOVEMBER: 11, DECEMBER: 12,
  ENE: 1, FEB: 2, MAR: 3, ABR: 4, JUN: 6, JUL: 7, AGO: 8, SEP: 9, SET: 9, OCT: 10, NOV: 11, DIC: 12,
};
export const NOMBRE_MES = ['', 'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];

export function mesDePalabra(p: string): number | null {
  const k = norm(p).replace(/[^A-Z]/g, '');
  if (k in MESES) return MESES[k];
  // tolera errores menores de digitación ("SEPTIEMBR", "AGOSOT")
  if (k.length >= 5) {
    for (const [nombre, n] of Object.entries(MESES)) {
      if (nombre.length >= 5 && similitud(k, nombre) >= 0.8) return n;
    }
  }
  return null;
}

export type Periodo = { anio: number | null; mes: number };

// Busca un mes (y año opcional) dentro de un texto libre: nombre de hoja, título, nombre de archivo.
export function periodoDeTexto(texto: string): Periodo | null {
  const t = norm(texto);
  const palabras = t.split(/[^A-Z0-9]+/).filter(Boolean);
  let mes: number | null = null;
  for (const p of palabras) {
    if (/^\d+$/.test(p)) continue;
    const exacto = MESES[p];
    if (exacto && p.length >= 3) { mes = exacto; break; }
  }
  if (!mes) for (const p of palabras) { if (p.length >= 5) { const m = mesDePalabra(p); if (m) { mes = m; break; } } }
  if (!mes) return null;
  const anio = t.match(/\b(20\d{2})\b/);
  return { mes, anio: anio ? Number(anio[1]) : null };
}

export function anioDeTexto(texto: string): number | null {
  const m = norm(texto).match(/\b(20\d{2})\b/);
  return m ? Number(m[1]) : null;
}

export function periodoStr(anio: number, mes: number): string {
  return `${anio}-${String(mes).padStart(2, '0')}`;
}

// Detecta el establecimiento por palabras clave. Devuelve null si no hay coincidencia o si es ambigua.
export function establecimientoDeTexto(texto: string): string | null {
  const t = ` ${norm(texto).replace(/[^A-Z0-9]+/g, ' ')} `;
  const hallados = config.establecimientos.filter((e) =>
    e.palabras_clave.some((k) => t.includes(` ${norm(k)} `)),
  );
  return hallados.length === 1 ? hallados[0].id : null;
}

export type NumeroParseado = { valor: number | null; nota?: string };

export function parseNumero(v: unknown): NumeroParseado {
  if (v === null || v === undefined || v === '') return { valor: null };
  if (typeof v === 'number') return Number.isFinite(v) ? { valor: v } : { valor: null, nota: 'número inválido' };
  if (typeof v === 'boolean') return { valor: null, nota: 'valor lógico en campo numérico' };
  let s = String(v).trim().replace(/\s/g, '').replace(/^(BS\.?|Bs\.?|\$|USD)/i, '');
  if (s === '' || s === '-') return { valor: null };
  let negativo = false;
  if (/^\(.*\)$/.test(s)) { negativo = true; s = s.slice(1, -1); }
  if (!/^-?[\d.,]+$/.test(s)) return { valor: null, nota: `texto no numérico: "${String(v).trim()}"` };
  const tienePunto = s.includes('.');
  const tieneComa = s.includes(',');
  let nota: string | undefined;
  if (tienePunto && tieneComa) {
    if (s.lastIndexOf(',') > s.lastIndexOf('.')) s = s.replace(/\./g, '').replace(',', '.');
    else s = s.replace(/,/g, '');
    nota = 'formato con separadores de miles normalizado';
  } else if (tieneComa) {
    if (/^-?\d{1,3}(,\d{3})+$/.test(s)) s = s.replace(/,/g, '');
    else s = s.replace(',', '.');
    nota = 'coma decimal normalizada';
  } else if (tienePunto && /^-?\d{1,3}(\.\d{3})+$/.test(s)) {
    s = s.replace(/\./g, '');
    nota = 'punto de miles normalizado';
  }
  const n = Number(s);
  if (!Number.isFinite(n)) return { valor: null, nota: `texto no numérico: "${String(v).trim()}"` };
  return { valor: negativo ? -n : n, nota };
}

export type FechaParseada = { fecha: string | null; nota?: string; corregida?: boolean };
export type ContextoFecha = { anio?: number | null; mes?: number | null };

function iso(y: number, m: number, d: number): string | null {
  if (m < 1 || m > 12 || d < 1) return null;
  const dias = new Date(Date.UTC(y, m, 0)).getUTCDate();
  if (d > dias) return null;
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

export function serialExcelAFecha(serial: number): { y: number; m: number; d: number } {
  const ms = Math.round((serial - 25569) * 86400) * 1000;
  const dt = new Date(ms);
  return { y: dt.getUTCFullYear(), m: dt.getUTCMonth() + 1, d: dt.getUTCDate() };
}

// Ajusta una fecha (y,m,d) al contexto del periodo del documento. Corrige el caso típico de Excel que
// interpreta "01/08/2026" (1 de agosto) como 8 de enero, y años digitados con error (2025/2027).
function ajustarAContexto(y: number, m: number, d: number, ctx: ContextoFecha): FechaParseada {
  const notas: string[] = [];
  let corregida = false;
  if (ctx.mes && m !== ctx.mes && d === ctx.mes && m <= 31) {
    [m, d] = [d, m];
    notas.push('día y mes invertidos (Excel interpretó el formato como mes/día); corregido según el periodo del documento');
    corregida = true;
  }
  if (ctx.anio && y !== ctx.anio && Math.abs(y - ctx.anio) === 1 && (!ctx.mes || m === ctx.mes)) {
    notas.push(`año ${y} fuera del periodo del documento; se usa ${ctx.anio}`);
    y = ctx.anio;
    corregida = true;
  }
  const f = iso(y, m, d);
  if (!f) return { fecha: null, nota: 'fecha inválida' };
  if (ctx.mes && m !== ctx.mes) notas.push(`fecha fuera del mes del documento (${NOMBRE_MES[ctx.mes]})`);
  return { fecha: f, nota: notas.join('; ') || undefined, corregida };
}

export function parseFecha(v: unknown, ctx: ContextoFecha = {}): FechaParseada {
  if (vacio(v)) return { fecha: null };
  if (typeof v === 'number') {
    if (v < 20000 || v > 80000) return { fecha: null, nota: `número ${v} no es una fecha` };
    const { y, m, d } = serialExcelAFecha(v);
    return ajustarAContexto(y, m, d, ctx);
  }
  if (v instanceof Date) return ajustarAContexto(v.getUTCFullYear(), v.getUTCMonth() + 1, v.getUTCDate(), ctx);
  const s = norm(v);
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return ajustarAContexto(+m[1], +m[2], +m[3], ctx);
  m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/);
  if (m) {
    let a = +m[1], b = +m[2];
    const y = m[3].length === 2 ? 2000 + +m[3] : +m[3];
    let nota: string | undefined;
    if (b > 12 && a <= 12) { [a, b] = [b, a]; nota = 'formato mes/día detectado; interpretado como día/mes'; }
    if (!iso(y, b, a)) return { fecha: null, nota: `fecha inválida: "${String(v).trim()}"` };
    const r = ajustarAContexto(y, b, a, ctx);
    return { ...r, nota: [nota, r.nota].filter(Boolean).join('; ') || undefined };
  }
  // Textos: "9 DE FEBRERO DE 2026", "1 de junio", "1ero de julio", "01 de Agosto", "26 DE ABRIL"
  m = s.match(/^(?:[A-Z]+\s+)?(\d{1,2})\s*(?:ERO|RO|RA|ERA|DO|TO|VO|NO|MO)?\.?\s*(?:DE\s+)?([A-Z]{3,})(?:\s*(?:DE|DEL)?\s*(\d{4}))?\.?$/);
  if (m) {
    const mes = mesDePalabra(m[2]);
    if (!mes) return { fecha: null, nota: `mes no reconocido en "${String(v).trim()}"` };
    const y = m[3] ? +m[3] : ctx.anio;
    if (!y) return { fecha: null, nota: `fecha sin año y sin periodo de referencia: "${String(v).trim()}"` };
    const f = iso(y, mes, +m[1]);
    if (!f) return { fecha: null, nota: `fecha inválida: "${String(v).trim()}"` };
    const notas: string[] = [];
    if (!m[3]) notas.push('año tomado del periodo del documento');
    if (ctx.mes && mes !== ctx.mes) notas.push(`fecha fuera del mes del documento (${NOMBRE_MES[ctx.mes]})`);
    return { fecha: f, nota: notas.join('; ') || undefined };
  }
  return { fecha: null, nota: `texto no reconocido como fecha: "${String(v).trim()}"` };
}

export function esTextoFecha(v: unknown): boolean {
  if (typeof v !== 'string') return false;
  return parseFecha(v, { anio: 2000 }).fecha !== null;
}

// Similitud normalizada (1 - distancia de Levenshtein / longitud máxima)
export function similitud(a: string, b: string): number {
  if (a === b) return 1;
  if (!a.length || !b.length) return 0;
  const prev = new Array(b.length + 1).fill(0).map((_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j];
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = tmp;
    }
  }
  return 1 - prev[b.length] / Math.max(a.length, b.length);
}

export function redondear(n: number, dec = 2): number {
  const f = 10 ** dec;
  return Math.round((n + Number.EPSILON) * f) / f;
}

// Encuentra la columna cuyo encabezado contiene alguno de los sinónimos (el sinónimo más largo gana).
export function mapearColumnas(encabezados: unknown[], sinonimos: Record<string, string[]>): Record<string, number> {
  const res: Record<string, number> = {};
  const usados = new Set<number>();
  const h = encabezados.map((x) => norm(x));
  const pares: { campo: string; idx: number; largo: number; exacto: boolean }[] = [];
  for (const [campo, lista] of Object.entries(sinonimos)) {
    for (const syn of lista) {
      const ns = norm(syn);
      h.forEach((txt, idx) => {
        if (!txt) return;
        const exacto = txt === ns;
        if (exacto || (ns.length >= 3 && txt.includes(ns)) || (ns.length < 3 && txt.split(/[^A-Z0-9/]+/).includes(ns))) {
          pares.push({ campo, idx, largo: ns.length, exacto });
        }
      });
    }
  }
  pares.sort((a, b) => Number(b.exacto) - Number(a.exacto) || b.largo - a.largo);
  for (const p of pares) {
    if (p.campo in res || usados.has(p.idx)) continue;
    res[p.campo] = p.idx;
    usados.add(p.idx);
  }
  return res;
}
