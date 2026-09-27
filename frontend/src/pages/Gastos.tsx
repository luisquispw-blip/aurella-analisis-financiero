import { useMemo, useState } from 'react';
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import Filtros from '../components/Filtros';
import { BarrasH } from '../components/Graficos';
import { Aviso, BotonTraza, Card, Cargando, ErrorBox, EstadoChip, Tabla, TooltipChart, Valor } from '../components/ui';
import { useApp, useDatos } from '../lib/contexto';
import { api } from '../lib/api';
import { bs, ejeBs, mesCorto, pc } from '../lib/formato';

// Colores categóricos en orden fijo (validados): 8 categorías de gasto
const COLORES = ['var(--series-cbb)', 'var(--series-lpz)', 'var(--series-3)', '#e87ba4', '#8b7cf6', '#f08a4b', '#6b8fd6', '#b08d57'];

export default function Gastos() {
  const { query, meta, puede, tocar } = useApp();
  const { data, error, cargando } = useDatos<any>(`/gastos${query()}`);
  const [clase, setClase] = useState('gasto_operativo');
  const [msg, setMsg] = useState<string | null>(null);
  const cats = useMemo(() => (data?.por_categoria ?? []).map((c: any) => c.categoria), [data]);
  const serie = useMemo(() => (data?.periodos ?? []).map((p: string, i: number) => ({ nombre: mesCorto(p), ...Object.fromEntries((data?.por_categoria ?? []).map((c: any) => [c.categoria, c.serie[i].v])) })), [data]);
  const egresos = (data?.egresos ?? []).filter((e: any) => clase === 'todos' || (clase === 'duplicado' ? e.estado === 'duplicado' : e.clase === clase && e.estado !== 'duplicado'));
  const cambiar = async (id: number, cambios: any) => {
    try { await api(`/egresos/${id}`, { method: 'PATCH', json: cambios }); setMsg('Clasificación actualizada; los indicadores se recalcularon.'); tocar(); } catch (e: any) { setMsg(e.message); }
  };
  return (
    <>
      <div className="page-head"><div><h1>Análisis de gastos <BotonTraza metrica="gastos_operativos" titulo="Gastos operativos" /></h1>
        <p>Solo los egresos clasificados como <b>gasto operativo</b> afectan la utilidad operativa. Pagos de mercadería e inversiones se muestran aparte. Si un mes tiene rendición detallada, no se usa el resumen mensual.</p></div></div>
      <Filtros producto={false} />
      <ErrorBox error={error} />
      {msg && <Aviso tipo="info">{msg}</Aviso>}
      {cargando && !data && <Cargando />}
      {data && (
        <>
          {data.faltantes.length > 0 && <Aviso tipo="warn">Sin rendición de gastos para: {data.faltantes.join(', ')}. En esos meses no se calcula la utilidad operativa.</Aviso>}
          <div className="kpis">
            <div className="kpi"><div className="t">Gasto operativo total</div><div className="v num">{bs(data.total)}</div></div>
            {data.por_categoria.slice(0, 4).map((c: any) => <div key={c.categoria} className="kpi"><div className="t">{c.categoria}</div><div className="v num">{bs(c.total, 0)}</div><div className="pie">{pc(c.participacion)} del gasto</div></div>)}
          </div>
          <div className="grid g2" style={{ marginBottom: 16 }}>
            <Card titulo="Gasto por categoría y mes">
              <ResponsiveContainer width="100%" height={290}>
                <BarChart data={serie} barCategoryGap="28%">
                  <CartesianGrid stroke="var(--grid)" vertical={false} />
                  <XAxis dataKey="nombre" tick={{ fontSize: 11, fill: 'var(--text-3)' }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 11, fill: 'var(--text-3)' }} tickFormatter={ejeBs} axisLine={false} tickLine={false} width={48} />
                  <Tooltip content={<TooltipChart />} />
                  <Legend iconType="square" iconSize={9} wrapperStyle={{ fontSize: 11.5 }} />
                  {cats.slice(0, 8).map((c: string, i: number) => <Bar key={c} dataKey={c} stackId="g" fill={COLORES[i]} stroke="var(--surface)" strokeWidth={1} maxBarSize={36} />)}
                </BarChart>
              </ResponsiveContainer>
            </Card>
            <Card titulo="Participación sobre ventas e impacto en la utilidad">
              <Tabla buscar={false} filas={data.sobre_ventas.map((s: any) => ({ ...s, pct: s.gastos?.v !== null && s.ventas?.v ? (s.gastos.v / s.ventas.v) * 100 : null, impacto: s.gastos?.v !== null && s.utilidad_bruta?.v ? (s.gastos.v / s.utilidad_bruta.v) * 100 : null }))} columnas={[
                { k: 'nombre', t: 'Mes' }, { k: 'ventas', t: 'Ventas', r: true, f: (x) => <Valor x={x} /> }, { k: 'gastos', t: 'Gastos operativos', r: true, f: (x) => <Valor x={x} /> },
                { k: 'pct', t: '% s/ventas', r: true, f: (x) => (x === null ? 'N/D' : pc(x)) }, { k: 'impacto', t: '% de la utilidad bruta', r: true, f: (x) => (x === null ? 'N/D' : pc(x)) },
              ]} />
            </Card>
          </div>
          <div className="grid g2" style={{ marginBottom: 16 }}>
            <Card titulo="Categorías con mayor impacto"><BarrasH filas={data.por_categoria} clave="categoria" valor="total" color="var(--series-lpz)" /></Card>
            <Card titulo="Gastos individuales más grandes">
              <Tabla buscar={false} alto={330} filas={data.mayores} columnas={[{ k: 'est', t: 'Est.' }, { k: 'periodo', t: 'Periodo' }, { k: 'descripcion', t: 'Descripción' }, { k: 'categoria', t: 'Categoría' }, { k: 'monto_bob', t: 'Monto', r: true, f: (x) => bs(x) }]} />
            </Card>
          </div>
          <Card titulo="Detalle de egresos y clasificación" acciones={
            <div className="seg">{[['gasto_operativo', 'Gastos operativos'], ['compra_mercaderia', 'Pagos de mercadería'], ['inversion_activo', 'Inversión / activo'], ['preoperativo', 'Preoperativos'], ['duplicado', 'Duplicados'], ['todos', 'Todos']].map(([k, n]) => <button key={k} className={clase === k ? 'on' : ''} onClick={() => setClase(k)}>{n}</button>)}</div>}>
            <p className="small muted">La clasificación se hace con reglas configurables (config/reglas_gastos.json). {puede('analista') ? 'Puede corregir la clase o categoría de cada egreso; el cambio queda auditado.' : ''}</p>
            <Tabla alto={560} nombreCsv={`egresos_${clase}.csv`} filas={egresos} columnas={[
              { k: 'est', t: 'Est.' }, { k: 'periodo', t: 'Periodo' }, { k: 'fecha', t: 'Fecha', f: (x, f) => <span title={f.fecha_nota ?? ''}>{x ?? '—'}{f.fecha_nota ? ' ●' : ''}</span> },
              { k: 'descripcion', t: 'Descripción', ancho: 200, f: (x, f) => <span title={f.nota ?? ''}>{x}{f.nota ? <span className="parcial-mark">●</span> : null}</span> },
              { k: 'documento', t: 'Doc.' }, { k: 'monto', t: 'Monto', r: true, f: (x, f) => (f.moneda === 'BOB' ? bs(x) : `USD ${x}`) },
              { k: 'clase', t: 'Clase', f: (x, f) => puede('analista') ? <select value={x} onChange={(e) => cambiar(f.id, { clase: e.target.value })} style={{ maxWidth: 170 }}>{Object.entries(meta?.clases ?? {}).map(([k, n]) => <option key={k} value={k}>{n as string}</option>)}</select> : meta?.clases[x] },
              { k: 'categoria', t: 'Categoría', f: (x, f) => puede('analista') && f.clase === 'gasto_operativo' ? <select value={x} onChange={(e) => cambiar(f.id, { categoria: e.target.value })}>{[...new Set([...(meta?.categorias_gasto ?? []), x])].map((c) => <option key={c}>{c}</option>)}</select> : x },
              { k: 'estado', t: 'Estado', f: (x, f) => <span style={{ display: 'flex', gap: 4, alignItems: 'center' }}><EstadoChip e={x} />{x === 'duplicado' && puede('analista') && <button className="btn sm" onClick={() => cambiar(f.id, { no_duplicado: true })}>No es duplicado</button>}{x !== 'duplicado' && puede('analista') && <button className="btn sm" title={x === 'excluido' ? 'Incluir' : 'Excluir del análisis'} onClick={() => cambiar(f.id, { estado: x === 'excluido' ? 'valido' : 'excluido' })}>{x === 'excluido' ? 'Incluir' : 'Excluir'}</button>}</span> },
              { k: 'hoja', t: 'Origen', f: (x, f) => <span className="small muted">{f.archivo?.slice(0, 22)}… › {x} › fila {f.fila}</span> },
            ]} />
          </Card>
        </>
      )}
    </>
  );
}
