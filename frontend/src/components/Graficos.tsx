import { Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis, Cell } from 'recharts';
import { TooltipChart } from './ui';
import { HEX_EST, NOMBRE_EST, ejeBs, mesCorto, num, pc, bs } from '../lib/formato';

const EJE = { fontSize: 11, fill: 'var(--text-3)' };
const GRID = <CartesianGrid stroke="var(--grid)" vertical={false} />;

// Serie mensual por establecimiento. `datos` = [{periodo, nombre, [metrica_EST]: V}]
export function SerieEst({ datos, metrica, tipo = 'barras', ests = ['CBB', 'LPZ'], apilado = false, formato = 'bs', alto = 260 }: {
  datos: any[]; metrica: string; tipo?: 'barras' | 'lineas'; ests?: string[]; apilado?: boolean; formato?: 'bs' | 'pc' | 'num'; alto?: number;
}) {
  const filas = datos.map((d) => ({
    nombre: d.nombre, corto: mesCorto(d.periodo), parcial: d.parcial,
    ...Object.fromEntries(ests.map((e) => [e, d[`${metrica}_${e}`]?.v ?? null])),
  }));
  const fEje = formato === 'pc' ? (v: number) => `${v}%` : formato === 'num' ? (v: number) => num(v) : ejeBs;
  return (
    <ResponsiveContainer width="100%" height={alto}>
      {tipo === 'barras' ? (
        <BarChart data={filas} barGap={2} barCategoryGap="28%">
          {GRID}
          <XAxis dataKey="corto" tick={EJE} axisLine={false} tickLine={false} />
          <YAxis tick={EJE} axisLine={false} tickLine={false} tickFormatter={fEje} width={48} />
          <Tooltip content={<TooltipChart formato={formato} />} cursor={{ fill: 'var(--hover)' }} />
          <Legend iconType="square" iconSize={9} wrapperStyle={{ fontSize: 12 }} />
          {ests.map((e, i) => (
            <Bar key={e} dataKey={e} name={NOMBRE_EST[e]} fill={HEX_EST[e]} stackId={apilado ? 'a' : undefined} maxBarSize={34}
              radius={apilado ? (i === ests.length - 1 ? [4, 4, 0, 0] : [0, 0, 0, 0]) : [4, 4, 0, 0]} stroke="var(--surface)" strokeWidth={apilado ? 1 : 0} />
          ))}
        </BarChart>
      ) : (
        <LineChart data={filas}>
          {GRID}
          <XAxis dataKey="corto" tick={EJE} axisLine={false} tickLine={false} />
          <YAxis tick={EJE} axisLine={false} tickLine={false} tickFormatter={fEje} width={48} />
          <Tooltip content={<TooltipChart formato={formato} />} />
          <Legend iconType="plainline" wrapperStyle={{ fontSize: 12 }} />
          {ests.map((e) => <Line key={e} type="monotone" dataKey={e} name={NOMBRE_EST[e]} stroke={HEX_EST[e]} strokeWidth={2} dot={{ r: 4, strokeWidth: 2, fill: 'var(--surface)' }} activeDot={{ r: 5 }} connectNulls={false} />)}
        </LineChart>
      )}
    </ResponsiveContainer>
  );
}

// Barras horizontales (una sola serie): rankings, gastos por categoría, márgenes
export function BarrasH({ filas, clave, valor, formato = 'bs', color = 'var(--series-cbb)', alto, max = 10 }: {
  filas: any[]; clave: string; valor: string; formato?: 'bs' | 'pc' | 'num'; color?: string; alto?: number; max?: number;
}) {
  const data = filas.slice(0, max).map((f) => ({ nombre: String(f[clave]), v: f[valor] }));
  const fmt = (v: number) => (formato === 'pc' ? pc(v) : formato === 'num' ? num(v) : bs(v, 0));
  const ancho = Math.min(190, Math.max(90, ...data.map((d) => d.nombre.length * 6.2)));
  return (
    <ResponsiveContainer width="100%" height={alto ?? Math.max(160, data.length * 30 + 20)}>
      <BarChart data={data} layout="vertical" margin={{ left: 4, right: 70 }} barCategoryGap="22%">
        <XAxis type="number" hide />
        <YAxis type="category" dataKey="nombre" tick={{ fontSize: 11.5, fill: 'var(--text-2)' }} width={ancho} axisLine={false} tickLine={false} />
        <Tooltip content={({ active, payload }: any) => active && payload?.length ? <div className="tooltip-chart"><b>{payload[0].payload.nombre}</b><div className="num">{fmt(payload[0].value)}</div></div> : null} cursor={{ fill: 'var(--hover)' }} />
        <Bar dataKey="v" radius={[0, 4, 4, 0]} maxBarSize={18} label={{ position: 'right', fontSize: 11, fill: 'var(--text-2)', formatter: (v: number) => fmt(v) }}>
          {data.map((d, i) => <Cell key={i} fill={d.v < 0 ? 'var(--crit)' : color} />)}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
