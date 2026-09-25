import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { AlertOctagon, AlertTriangle, CheckCircle2, Download, Info, Loader2, Search, X, HelpCircle, ArrowUpDown } from 'lucide-react';
import type { V } from '../lib/formato';
import { aCsv, bajarTexto, bs, fmtV, num, pc } from '../lib/formato';
import { api, qs } from '../lib/api';
import { useApp } from '../lib/contexto';

// ---------- Valor con estado (ok / parcial / nd) ----------
export function Valor({ x, tipo = 'bs' }: { x: V | null | undefined; tipo?: 'bs' | 'pc' | 'num' }) {
  if (!x) return <span className="muted">—</span>;
  if (x.v === null) {
    if (x.e === 'sin_operacion') return <span className="muted" title={x.m}>—</span>;
    return <span className="nd-txt" title={x.m}>N/D</span>;
  }
  return (
    <span className="num">
      {fmtV(x, tipo)}
      {x.e === 'parcial' && <span className="parcial-mark" title={x.m}>●</span>}
    </span>
  );
}

// ---------- Trazabilidad ----------
type TrazaReq = { metrica: string; periodo?: string; est?: string; titulo?: string; extra?: Record<string, unknown> };
const TrazaCtx = createContext<(r: TrazaReq) => void>(() => undefined);
export const useTraza = () => useContext(TrazaCtx);

export function TrazaProvider({ children }: { children: ReactNode }) {
  const [req, setReq] = useState<TrazaReq | null>(null);
  return (
    <TrazaCtx.Provider value={setReq}>
      {children}
      {req && <TrazaModal req={req} cerrar={() => setReq(null)} />}
    </TrazaCtx.Provider>
  );
}

function TrazaModal({ req, cerrar }: { req: TrazaReq; cerrar: () => void }) {
  const { query } = useApp();
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const extra = { metrica: req.metrica, periodo: req.periodo, ...(req.est ? { est: req.est } : {}), ...(req.extra || {}) };
    api(`/traza${req.periodo ? qs({ ...extra }) : query(extra)}`).then(setData).catch((e) => setError(e.message));
  }, [req, query]);
  return (
    <div className="modal-bg" onClick={cerrar}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>¿De dónde sale este valor? {req.titulo ? `· ${req.titulo}` : ''}</h2>
          <button className="btn sm" onClick={cerrar}><X size={16} /></button>
        </div>
        <div className="modal-body">
          {error && <div className="aviso crit">{error}</div>}
          {!data && !error && <Cargando />}
          {data && (
            <>
              <div className="formula">{data.formula}</div>
              <div className="grid g3" style={{ margin: '14px 0' }}>
                <div className="kpi"><div className="t">Valor calculado</div><div className={`v ${data.valor === null ? 'nd' : ''}`}>{data.valor === null ? 'No disponible' : bs(data.valor)}</div>
                  <div className="pie">{data.estado === 'parcial' ? <EstadoChip e="parcial" /> : null} {data.motivo}</div></div>
                <div className="kpi"><div className="t">Registros de origen</div><div className="v">{num(data.total_filas)}</div><div className="pie">Suma de registros: {bs(data.suma_filas)}</div></div>
                <div className="kpi"><div className="t">Alcance</div><div className="v" style={{ fontSize: 14 }}>{data.alcance.periodos.join(', ')}</div><div className="pie">{data.alcance.establecimientos.join(' + ')}</div></div>
              </div>
              {data.componentes?.length > 0 && (
                <div className="card" style={{ marginBottom: 12 }}>
                  <h3>Componentes</h3>
                  {data.componentes.map((c: any, i: number) => <div key={i} className="small" style={{ display: 'flex', justifyContent: 'space-between', gap: 10, padding: '3px 0' }}><span>{c.nombre}{c.nota ? ` — ${c.nota}` : ''}</span><b className="num">{c.valor === null ? 'N/D' : bs(c.valor)}</b></div>)}
                </div>
              )}
              <Tabla
                columnas={[{ k: 'archivo', t: 'Archivo' }, { k: 'hoja', t: 'Hoja' }, { k: 'fila', t: 'Fila', r: true }, { k: 'periodo', t: 'Periodo' }, { k: 'est', t: 'Est.' }, { k: 'fecha', t: 'Fecha' }, { k: 'producto', t: 'Producto' }, { k: 'detalle', t: 'Detalle' }, { k: 'valor', t: 'Valor', r: true, f: (v) => (v === null ? 'N/D' : bs(v)) }]}
                filas={data.filas} nombreCsv={`traza_${req.metrica}.csv`} alto={380}
              />
              {data.truncado && <p className="small muted">Se muestran los primeros {data.filas.length} de {data.total_filas} registros.</p>}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export function BotonTraza(p: TrazaReq) {
  const abrir = useTraza();
  return <button className="traza-btn no-print" title="¿De dónde sale este valor?" onClick={() => abrir(p)}><HelpCircle size={15} /></button>;
}

// ---------- KPI ----------
export function Kpi({ titulo, x, tipo = 'bs', icono, pie, traza }: { titulo: string; x: V | null | undefined; tipo?: 'bs' | 'pc' | 'num'; icono?: ReactNode; pie?: ReactNode; traza?: TrazaReq }) {
  const nd = !x || x.v === null;
  return (
    <div className="kpi">
      <div className="t">
        <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>{titulo}{traza && <BotonTraza {...traza} titulo={titulo} />}</span>
        {icono && <span className="ico">{icono}</span>}
      </div>
      <div className={`v num ${nd ? 'nd' : ''}`} title={x?.m}>{nd ? 'No disponible' : fmtV(x, tipo)}</div>
      <div className="pie">
        {x?.e === 'parcial' && <><EstadoChip e="parcial" /> </>}
        {nd ? <span title={x?.m}>{(x?.m || 'Sin dato').slice(0, 90)}{(x?.m?.length ?? 0) > 90 ? '…' : ''}</span> : pie}
      </div>
    </div>
  );
}

export function EstadoChip({ e, texto }: { e: string; texto?: string }) {
  const m: Record<string, [string, string]> = {
    ok: ['ok', 'Completo'], parcial: ['parcial', 'Parcial'], nd: ['warn', 'No disponible'], critica: ['critica', 'Crítica'], advertencia: ['advertencia', 'Advertencia'],
    positiva: ['positiva', 'Positiva'], datos: ['datos', 'Datos'], importada: ['ok', 'Importada'], identica: ['gris', 'Idéntica (omitida)'], omitida: ['gris', 'Omitida'],
    error: ['error', 'Error'], pendiente_confirmacion: ['warn', 'Pendiente de confirmación'], reemplazada: ['gris', 'Reemplazada'], rechazada: ['gris', 'Rechazada'],
    procesado: ['ok', 'Procesado'], con_observaciones: ['warn', 'Con observaciones'], con_errores: ['error', 'Con errores'], duplicado: ['gris', 'Duplicado'],
    valido: ['ok', 'Válido'], observado: ['warn', 'Observado'], excluido: ['gris', 'Excluido'], no_verificable: ['info', 'No verificable'],
    alta: ['critica', 'Alta'], media: ['advertencia', 'Media'], baja: ['info', 'Baja'],
  };
  const [c, t] = m[e] ?? ['gris', e];
  return <span className={`chip ${c}`}>{texto ?? t}</span>;
}

export function IconoSeveridad({ s }: { s: string }) {
  if (s === 'critica') return <AlertOctagon size={18} color="var(--crit)" />;
  if (s === 'advertencia') return <AlertTriangle size={18} color="var(--gold-500)" />;
  if (s === 'positiva') return <CheckCircle2 size={18} color="var(--ok)" />;
  return <Info size={18} color="var(--info)" />;
}

export function AlertaItem({ a }: { a: any }) {
  return (
    <div className={`alerta ${a.severidad}`}>
      <span className="ic"><IconoSeveridad s={a.severidad} /></span>
      <div style={{ minWidth: 0 }}>
        <div className="tt">{a.titulo} <EstadoChip e={a.severidad} /> {a.periodo && <span className="chip gris">{a.periodo}</span>} {a.est && <span className="chip gris">{a.est}</span>}</div>
        <div className="mm">{a.mensaje}</div>
        {a.recomendacion && <div className="rr">→ {a.recomendacion}</div>}
      </div>
    </div>
  );
}

export function Cargando({ texto = 'Cargando…' }: { texto?: string }) {
  return <div className="cargando"><Loader2 size={18} className="spin" /> {texto}</div>;
}
export function ErrorBox({ error }: { error: string | null }) {
  return error ? <div className="aviso crit"><AlertOctagon size={18} /> {error}</div> : null;
}
export function Aviso({ tipo = 'info', children }: { tipo?: 'info' | 'warn' | 'crit' | 'ok'; children: ReactNode }) {
  const I = tipo === 'crit' ? AlertOctagon : tipo === 'warn' ? AlertTriangle : tipo === 'ok' ? CheckCircle2 : Info;
  return <div className={`aviso ${tipo}`}><I size={18} style={{ flex: 'none', marginTop: 1 }} /><div>{children}</div></div>;
}

export function Card({ titulo, sub, acciones, children, style }: { titulo?: ReactNode; sub?: ReactNode; acciones?: ReactNode; children: ReactNode; style?: React.CSSProperties }) {
  return (
    <div className="card" style={style}>
      {(titulo || acciones) && <div className="card-head"><h3>{titulo} {sub && <span className="sub">{sub}</span>}</h3>{acciones}</div>}
      {children}
    </div>
  );
}

// ---------- Tabla genérica: orden, búsqueda y exportación CSV ----------
export type Col = { k: string; t: string; r?: boolean; f?: (v: any, fila: any) => ReactNode; csv?: (v: any, fila: any) => string | number | null; ancho?: number };

export function Tabla({ columnas, filas, nombreCsv, alto, buscar = true, total }: { columnas: Col[]; filas: any[]; nombreCsv?: string; alto?: number; buscar?: boolean; total?: Record<string, ReactNode> }) {
  const [q, setQ] = useState('');
  const [orden, setOrden] = useState<{ k: string; asc: boolean } | null>(null);
  const vis = useMemo(() => {
    let fs = filas || [];
    if (q) { const t = q.toLowerCase(); fs = fs.filter((f) => columnas.some((c) => String(f[c.k] ?? '').toLowerCase().includes(t))); }
    if (orden) {
      fs = [...fs].sort((a, b) => {
        const va = a[orden.k] && typeof a[orden.k] === 'object' && 'v' in a[orden.k] ? a[orden.k].v : a[orden.k];
        const vb = b[orden.k] && typeof b[orden.k] === 'object' && 'v' in b[orden.k] ? b[orden.k].v : b[orden.k];
        if (va === vb) return 0;
        if (va === null || va === undefined) return 1;
        if (vb === null || vb === undefined) return -1;
        return (va > vb ? 1 : -1) * (orden.asc ? 1 : -1);
      });
    }
    return fs;
  }, [filas, q, orden, columnas]);
  const exportar = () => {
    const val = (c: Col, f: any) => { const v = f[c.k]; if (c.csv) return c.csv(v, f); if (v && typeof v === 'object' && 'v' in v) return v.v; return v ?? null; };
    bajarTexto(aCsv(columnas.map((c) => c.t), vis.map((f) => columnas.map((c) => val(c, f)))), nombreCsv || 'tabla.csv');
  };
  return (
    <div>
      {(buscar || nombreCsv) && (
        <div className="tabla-tools no-print">
          {buscar && <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}><Search size={14} className="muted" /><input placeholder="Buscar en la tabla…" value={q} onChange={(e) => setQ(e.target.value)} /></span>}
          <span className="small muted">{vis.length} fila(s)</span>
          {nombreCsv && <button className="btn sm" style={{ marginLeft: 'auto' }} onClick={exportar}><Download size={14} /> CSV</button>}
        </div>
      )}
      <div className="tabla-wrap" style={alto ? { maxHeight: alto, overflowY: 'auto' } : undefined}>
        <table className="tabla">
          <thead><tr>{columnas.map((c) => (
            <th key={c.k} className={c.r ? 'r' : ''} style={c.ancho ? { minWidth: c.ancho } : undefined} onClick={() => setOrden((o) => (o?.k === c.k ? { k: c.k, asc: !o.asc } : { k: c.k, asc: false }))}>
              {c.t} {orden?.k === c.k ? (orden.asc ? '▲' : '▼') : <ArrowUpDown size={11} className="muted" />}
            </th>))}</tr></thead>
          <tbody>
            {vis.map((f, i) => <tr key={i}>{columnas.map((c) => <td key={c.k} className={c.r ? 'r num' : ''}>{c.f ? c.f(f[c.k], f) : f[c.k] && typeof f[c.k] === 'object' && 'e' in f[c.k] ? <Valor x={f[c.k]} /> : (f[c.k] ?? '—')}</td>)}</tr>)}
            {total && <tr className="total">{columnas.map((c) => <td key={c.k} className={c.r ? 'r num' : ''}>{total[c.k] ?? ''}</td>)}</tr>}
            {!vis.length && <tr><td colSpan={columnas.length} className="vacio">Sin datos</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ---------- Tooltip de gráficos ----------
export function TooltipChart({ active, payload, label, formato = 'bs' }: any) {
  if (!active || !payload?.length) return null;
  const f = (v: number | null) => (v === null || v === undefined ? 'N/D' : formato === 'pc' ? pc(v) : formato === 'num' ? num(v) : bs(v));
  return (
    <div className="tooltip-chart">
      <div style={{ fontWeight: 600, marginBottom: 4 }}>{payload[0]?.payload?.nombre ?? label}</div>
      {payload.map((p: any) => (
        <div className="row" key={p.dataKey}><span><i style={{ display: 'inline-block', width: 9, height: 9, borderRadius: 2, background: p.color, marginRight: 6 }} />{p.name}</span><b className="num">{f(p.value)}</b></div>
      ))}
      {payload[0]?.payload?.parcial && <div className="small nd-txt" style={{ marginTop: 4 }}>Mes con registro parcial</div>}
    </div>
  );
}

// ---------- Markdown mínimo (respuestas del agente) ----------
export function MiniMarkdown({ texto }: { texto: string }) {
  const inline = (s: string, k: number) => {
    const partes = s.split(/(\*\*[^*]+\*\*|_[^_]+_|`[^`]+`)/g);
    return <span key={k}>{partes.map((p, i) => (p.startsWith('**') ? <b key={i}>{p.slice(2, -2)}</b> : p.startsWith('_') && p.endsWith('_') && p.length > 2 ? <i key={i}>{p.slice(1, -1)}</i> : p.startsWith('`') ? <code key={i}>{p.slice(1, -1)}</code> : p))}</span>;
  };
  const bloques = texto.split(/\n{2,}/);
  return (
    <>
      {bloques.map((b, i) => {
        const lineas = b.split('\n');
        if (lineas.every((l) => /^\s*([-*]|\d+\.)\s/.test(l))) {
          const ord = /^\s*\d+\./.test(lineas[0]);
          const items = lineas.map((l, j) => <li key={j}>{inline(l.replace(/^\s*([-*]|\d+\.)\s/, ''), j)}</li>);
          return ord ? <ol key={i}>{items}</ol> : <ul key={i}>{items}</ul>;
        }
        if (/^#{1,4}\s/.test(b)) return <p key={i}><b>{b.replace(/^#+\s/, '')}</b></p>;
        return <p key={i}>{lineas.map((l, j) => <span key={j}>{inline(l, j)}{j < lineas.length - 1 && <br />}</span>)}</p>;
      })}
    </>
  );
}
