export class ApiError extends Error {
  status: number;
  constructor(msg: string, status: number) { super(msg); this.status = status; }
}

let onNoAutorizado: (() => void) | null = null;
export function alExpirarSesion(fn: () => void) { onNoAutorizado = fn; }

export async function api<T = any>(ruta: string, opciones: RequestInit & { json?: unknown } = {}): Promise<T> {
  const { json, ...rest } = opciones;
  const r = await fetch(`/api${ruta}`, {
    credentials: 'same-origin',
    ...rest,
    headers: { ...(json !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(rest.headers || {}) },
    body: json !== undefined ? JSON.stringify(json) : rest.body,
  });
  if (r.status === 401 && !ruta.startsWith('/auth/login')) onNoAutorizado?.();
  const tipo = r.headers.get('content-type') || '';
  const data = tipo.includes('application/json') ? await r.json() : await r.text();
  if (!r.ok) throw new ApiError((data as any)?.error || `Error ${r.status}`, r.status);
  return data as T;
}

export function qs(obj: Record<string, unknown>): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(obj)) if (v !== undefined && v !== null && v !== '') p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : '';
}

export async function descargar(ruta: string, nombre?: string) {
  const r = await fetch(`/api${ruta}`, { credentials: 'same-origin' });
  if (!r.ok) {
    let msg = `Error ${r.status}`;
    try { msg = (await r.json()).error || msg; } catch { /* respuesta no JSON */ }
    throw new ApiError(msg, r.status);
  }
  const blob = await r.blob();
  const cd = r.headers.get('content-disposition') || '';
  const n = nombre || cd.match(/filename="([^"]+)"/)?.[1] || 'descarga';
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = n; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
