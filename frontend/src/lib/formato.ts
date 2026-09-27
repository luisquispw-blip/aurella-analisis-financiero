export type V = { v: number | null; e: 'ok' | 'parcial' | 'nd' | 'sin_operacion'; m?: string };

export const bs = (n: number | null | undefined, dec = 2) =>
  n === null || n === undefined || Number.isNaN(n) ? '—' : `Bs ${n.toLocaleString('es-BO', { minimumFractionDigits: dec, maximumFractionDigits: dec })}`;
export const bsCorto = (n: number | null | undefined) => {
  if (n === null || n === undefined) return '—';
  const a = Math.abs(n);
  if (a >= 1_000_000) return `Bs ${(n / 1_000_000).toLocaleString('es-BO', { maximumFractionDigits: 2 })} M`;
  if (a >= 10_000) return `Bs ${(n / 1000).toLocaleString('es-BO', { maximumFractionDigits: 1 })} mil`;
  return bs(n, 0);
};
export const num = (n: number | null | undefined, dec = 0) => (n === null || n === undefined ? '—' : n.toLocaleString('es-BO', { minimumFractionDigits: dec, maximumFractionDigits: dec }));
export const pc = (n: number | null | undefined, dec = 1) => (n === null || n === undefined ? '—' : `${n.toLocaleString('es-BO', { minimumFractionDigits: dec, maximumFractionDigits: dec })}%`);
export const ejeBs = (n: number) => (Math.abs(n) >= 1000 ? `${(n / 1000).toLocaleString('es-BO', { maximumFractionDigits: 0 })}k` : String(n));

export const NOMBRE_EST: Record<string, string> = { CBB: 'Cochabamba', LPZ: 'La Paz', TOTAL: 'Total empresa' };
export const COLOR_EST: Record<string, string> = { CBB: 'var(--series-cbb)', LPZ: 'var(--series-lpz)', TOTAL: 'var(--series-3)' };
export const HEX_EST: Record<string, string> = { CBB: 'var(--series-cbb)', LPZ: 'var(--series-lpz)', TOTAL: 'var(--series-3)' };

const MESES = ['', 'Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
export const mesCorto = (p: string) => `${MESES[Number(p.slice(5, 7))]} ${p.slice(2, 4)}`;

export function fmtV(x: V | null | undefined, tipo: 'bs' | 'pc' | 'num' = 'bs'): string {
  if (!x) return '—';
  if (x.v === null) return x.e === 'sin_operacion' ? '—' : 'N/D';
  return tipo === 'pc' ? pc(x.v) : tipo === 'num' ? num(x.v) : bs(x.v);
}

export function aCsv(columnas: string[], filas: (string | number | null)[][]): string {
  const esc = (v: string | number | null) => {
    const s = v === null ? '' : typeof v === 'number' ? String(v).replace('.', ',') : String(v);
    return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return '﻿' + [columnas.map(esc).join(';'), ...filas.map((f) => f.map(esc).join(';'))].join('\r\n');
}

export function bajarTexto(texto: string, nombre: string, tipo = 'text/csv;charset=utf-8') {
  const url = URL.createObjectURL(new Blob([texto], { type: tipo }));
  const a = document.createElement('a');
  a.href = url; a.download = nombre; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}
