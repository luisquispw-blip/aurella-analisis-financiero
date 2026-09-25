import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { alExpirarSesion, api, qs } from './api';

export type Usuario = { id: number; usuario: string; nombre: string; rol: 'admin' | 'analista' | 'lector'; debe_cambiar: number };
export type Filtros = { desde: string; hasta: string; est: string; producto_id: string; marca: string; categoria: string; anio: string };
export type Meta = {
  version: number; periodos: { id: string; nombre: string }[]; anios: string[]; establecimientos: { id: string; nombre: string }[];
  productos: { id: number; nombre: string; marca: string | null }[]; marcas: string[]; categorias: string[]; presentaciones: string[];
  metodo_valuacion: string | null; tipo_cambio: number | null; formulas: Record<string, string>; clases: Record<string, string>;
  categorias_gasto: string[]; criterios_ranking: Record<string, string>; reportes: Record<string, string>; empresa: any;
};

type Ctx = {
  usuario: Usuario | null; setUsuario: (u: Usuario | null) => void; cargandoSesion: boolean;
  meta: Meta | null; recargarMeta: () => Promise<void>; version: number; tocar: () => void;
  filtros: Filtros; setFiltros: (f: Partial<Filtros>) => void; limpiarFiltros: () => void; query: (extra?: Record<string, unknown>) => string;
  puede: (rol: 'analista' | 'admin') => boolean;
};

const C = createContext<Ctx>(null as unknown as Ctx);
export const useApp = () => useContext(C);

const VACIO: Filtros = { desde: '', hasta: '', est: '', producto_id: '', marca: '', categoria: '', anio: '' };

function leerFiltros(): Filtros {
  try { return { ...VACIO, ...JSON.parse(sessionStorage.getItem('aurella_filtros') || '{}') }; } catch { return VACIO; }
}

export function AppProvider({ children }: { children: ReactNode }) {
  const [usuario, setUsuario] = useState<Usuario | null>(null);
  const [cargandoSesion, setCargando] = useState(true);
  const [meta, setMeta] = useState<Meta | null>(null);
  const [version, setVersion] = useState(0);
  const [filtros, setF] = useState<Filtros>(leerFiltros);

  useEffect(() => {
    alExpirarSesion(() => setUsuario(null));
    api<{ usuario: Usuario }>('/auth/yo').then((r) => setUsuario(r.usuario)).catch(() => setUsuario(null)).finally(() => setCargando(false));
  }, []);

  const recargarMeta = useCallback(async () => { setMeta(await api<Meta>('/meta')); }, []);
  useEffect(() => { if (usuario) recargarMeta().catch(() => undefined); }, [usuario, version, recargarMeta]);

  const setFiltros = useCallback((f: Partial<Filtros>) => {
    setF((prev) => {
      const n = { ...prev, ...f };
      if (f.anio !== undefined) { n.desde = f.anio ? `${f.anio}-01` : ''; n.hasta = f.anio ? `${f.anio}-12` : ''; }
      try { sessionStorage.setItem('aurella_filtros', JSON.stringify(n)); } catch { /* almacenamiento no disponible */ }
      return n;
    });
  }, []);
  const limpiarFiltros = useCallback(() => setFiltros(VACIO), [setFiltros]);
  const query = useCallback((extra: Record<string, unknown> = {}) => qs({ desde: filtros.desde, hasta: filtros.hasta, est: filtros.est, producto_id: filtros.producto_id, marca: filtros.marca, categoria: filtros.categoria, ...extra }), [filtros]);
  const puede = useCallback((rol: 'analista' | 'admin') => !!usuario && (usuario.rol === 'admin' || (rol === 'analista' && usuario.rol === 'analista')), [usuario]);

  const valor = useMemo(() => ({
    usuario, setUsuario, cargandoSesion, meta, recargarMeta, version, tocar: () => setVersion((v) => v + 1),
    filtros, setFiltros, limpiarFiltros, query, puede,
  }), [usuario, cargandoSesion, meta, recargarMeta, version, filtros, setFiltros, limpiarFiltros, query, puede]);
  return <C.Provider value={valor}>{children}</C.Provider>;
}

// Hook de carga de datos con dependencia de filtros/versión
export function useDatos<T>(ruta: string | null, deps: unknown[] = []) {
  const { version } = useApp();
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(false);
  const [n, setN] = useState(0);
  useEffect(() => {
    if (!ruta) return;
    let vivo = true;
    setCargando(true);
    setError(null);
    api<T>(ruta).then((d) => { if (vivo) setData(d); }).catch((e) => { if (vivo) setError(e.message); }).finally(() => { if (vivo) setCargando(false); });
    return () => { vivo = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ruta, version, n, ...deps]);
  return { data, error, cargando, recargar: () => setN((x) => x + 1) };
}
