import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { BarrasH } from './Graficos';
import { TooltipChart } from './ui';
import { bs, ejeBs, num, pc } from '../lib/formato';

type Tarjeta = { titulo: string; valor: number | null; tipo: 'bs' | 'pc' | 'num'; estado: string; nota?: string; variacion_pct?: number | null; variacion_pp?: number | null; referencia?: string };
export type Panel = {
  titulo: string; tarjetas: Tarjeta[];
  grafico?: { titulo: string; tipo: 'barras' | 'barras_h'; formato: 'bs' | 'pc' | 'num'; series: { clave: string; nombre: string; color: string }[]; datos: any[] };
  tabla?: { titulo: string; columnas: { k: string; t: string; tipo?: string }[]; filas: any[] };
};

const fmt = (v: number | null | undefined, tipo?: string) => (v === null || v === undefined ? 'N/D' : tipo === 'pc' ? pc(v) : tipo === 'num' ? num(v, Number.isInteger(v) ? 0 : 1) : tipo === 'texto' ? String(v) : bs(v));

function Variacion({ t }: { t: Tarjeta }) {
  const v = t.variacion_pct ?? t.variacion_pp;
  if (v === null || v === undefined) return null;
  const up = v > 0, cero = v === 0;
  // en gastos y costos, bajar es favorable
  const favorable = /GASTO|COSTO/i.test(t.titulo) ? !up : up;
  return (
    <span className={`chip ${cero ? 'gris' : favorable ? 'ok' : 'critica'}`} title={t.referencia ? `vs ${t.referencia}` : ''}>
      {cero ? '=' : up ? '▲' : '▼'} {Math.abs(v).toLocaleString('es-BO', { maximumFractionDigits: 1 })}{t.variacion_pp !== undefined && t.variacion_pp !== null ? ' pp' : '%'}
    </span>
  );
}

export default function PanelAgente({ p }: { p: Panel }) {
  const g = p.grafico;
  return (
    <div className="panel-agente">
      <div className="panel-titulo">{p.titulo}</div>
      <div className="panel-kpis">
        {p.tarjetas.map((t, i) => (
          <div key={i} className="panel-kpi" title={t.nota ?? ''}>
            <div className="t">{t.titulo}</div>
            <div className={`v num ${t.valor === null ? 'nd' : ''}`}>{t.valor === null ? 'No disponible' : fmt(t.valor, t.tipo)}</div>
            <div className="pie">
              <Variacion t={t} />
              {t.referencia && (t.variacion_pct != null || t.variacion_pp != null) && <span className="muted"> vs {t.referencia}</span>}
              {t.estado === 'parcial' && <span className="chip parcial">parcial</span>}
              {t.valor === null && t.nota && <span className="small nd-txt">{t.nota.slice(0, 70)}</span>}
              {t.valor !== null && t.nota && t.estado === 'ok' && <span className="muted small">{t.nota}</span>}
            </div>
          </div>
        ))}
      </div>
      {(g || p.tabla) && (
        <div className={`panel-cuerpo ${g && p.tabla ? 'dos' : ''}`}>
          {g && g.datos.length > 0 && (
            <div className="panel-bloque">
              <div className="small" style={{ fontWeight: 600, marginBottom: 6 }}>{g.titulo}</div>
              {g.tipo === 'barras_h'
                ? <BarrasH filas={g.datos} clave="nombre" valor="valor" formato={g.formato} color={g.series[0].color} max={12} />
                : (
                  <ResponsiveContainer width="100%" height={230}>
                    <BarChart data={g.datos} barCategoryGap="25%">
                      <CartesianGrid stroke="var(--grid)" vertical={false} />
                      <XAxis dataKey="nombre" tick={{ fontSize: 10.5, fill: 'var(--text-3)' }} axisLine={false} tickLine={false} />
                      <YAxis tick={{ fontSize: 10.5, fill: 'var(--text-3)' }} tickFormatter={g.formato === 'pc' ? (v: number) => `${v}%` : ejeBs} axisLine={false} tickLine={false} width={46} />
                      <Tooltip content={<TooltipChart formato={g.formato} />} cursor={{ fill: 'var(--hover)' }} />
                      {g.series.length > 1 && <Legend iconType="square" iconSize={9} wrapperStyle={{ fontSize: 11 }} />}
                      {g.series.map((s) => <Bar key={s.clave} dataKey={s.clave} name={s.nombre} fill={s.color} radius={[4, 4, 0, 0]} maxBarSize={30} />)}
                    </BarChart>
                  </ResponsiveContainer>
                )}
            </div>
          )}
          {p.tabla && p.tabla.filas.length > 0 && (
            <div className="panel-bloque">
              <div className="small" style={{ fontWeight: 600, marginBottom: 6 }}>{p.tabla.titulo}</div>
              <div className="tabla-wrap" style={{ maxHeight: 300, overflowY: 'auto' }}>
                <table className="tabla">
                  <thead><tr>{p.tabla.columnas.map((c) => <th key={c.k} className={c.tipo === 'texto' ? '' : 'r'}>{c.t}</th>)}</tr></thead>
                  <tbody>{p.tabla.filas.map((f, i) => <tr key={i}>{p.tabla!.columnas.map((c) => <td key={c.k} className={c.tipo === 'texto' ? '' : 'r num'}>{fmt(f[c.k], c.tipo ?? 'texto')}</td>)}</tr>)}</tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
