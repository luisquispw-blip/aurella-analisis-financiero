import { useState } from 'react';
import Filtros from '../components/Filtros';
import { Aviso, BotonTraza, Card, Cargando, ErrorBox, Valor } from '../components/ui';
import { useApp, useDatos } from '../lib/contexto';
import { NOMBRE_EST, bs, pc } from '../lib/formato';

const FILAS: [string, string, 'bs' | 'pc' | 'num', string?][] = [
  ['inv_inicial', 'Inventario inicial (u.)', 'num'],
  ['compras_pagadas', 'Compras (pagos de mercadería)', 'bs', 'compras_pagadas'],
  ['unidades', 'Unidades vendidas', 'num', 'unidades'],
  ['ventas_netas', 'Ventas netas', 'bs', 'ventas_netas'],
  ['descuento_implicito', 'Descuento implícito vs precio público', 'bs', 'descuento_implicito'],
  ['costo_ventas', 'Costo de ventas', 'bs', 'costo_ventas'],
  ['utilidad_bruta', 'Utilidad bruta', 'bs', 'utilidad_bruta'],
  ['margen_bruto', 'Margen bruto', 'pc'],
  ['gastos_operativos', 'Gastos operativos', 'bs', 'gastos_operativos'],
  ['utilidad_operativa', 'Utilidad operativa', 'bs', 'gastos_operativos'],
  ['margen_operativo', 'Margen operativo', 'pc'],
  ['inv_final_teorico', 'Inventario final (u.)', 'num'],
  ['inv_diferencia', 'Diferencia inventario (u.)', 'num'],
  ['fondo_caja', 'Fondo de caja (efectivo)', 'bs', 'fondo_caja'],
  ['caja_bancos', 'Caja y bancos', 'bs'],
  ['flujo_neto', 'Flujo neto registrado', 'bs'],
];

function TablaMes({ t }: { t: any }) {
  const ests = ['CBB', 'LPZ', 'TOTAL'].filter((e) => t[e]);
  const notas: string[] = [];
  for (const e of ['CBB', 'LPZ']) for (const n of t[e]?.notas ?? []) notas.push(`${NOMBRE_EST[e]}: ${n}`);
  return (
    <Card titulo={t.nombre} sub={t.TOTAL?.gastos_fuente ? `gastos: ${t.TOTAL.gastos_fuente}` : ''}>
      {notas.map((n, i) => <Aviso key={i} tipo="warn">{n}</Aviso>)}
      <div className="tabla-wrap">
        <table className="tabla">
          <thead><tr><th>Indicador</th>{ests.map((e) => <th key={e} className="r">{NOMBRE_EST[e]}</th>)}</tr></thead>
          <tbody>
            {FILAS.map(([k, n, tipo, tr]) => (
              <tr key={k} className={k === 'utilidad_operativa' ? 'total' : ''}>
                <td>{n}</td>
                {ests.map((e) => (
                  <td key={e} className="r">
                    <Valor x={t[e][k]} tipo={tipo} />
                    {tr && t[e][k]?.v !== null && t[e].operando && <BotonTraza metrica={tr} periodo={t.periodo} est={e} titulo={`${n} · ${NOMBRE_EST[e]} · ${t.nombre}`} />}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {ests.some((e) => t[e].faltantes?.length) && (
        <details style={{ marginTop: 8 }}><summary className="small muted" style={{ cursor: 'pointer' }}>Datos faltantes de este mes</summary>
          <ul className="small">{[...new Set(ests.flatMap((e) => t[e].faltantes ?? []))].map((f: any) => <li key={f}>{f}</li>)}</ul>
        </details>
      )}
    </Card>
  );
}

function Variacion({ x, pct }: { x: any; pct?: boolean }) {
  if (!x || x.var_abs === null || x.var_abs === undefined) return <span className="muted">—</span>;
  const c = x.var_abs > 0 ? 'var(--ok)' : x.var_abs < 0 ? 'var(--crit)' : 'inherit';
  return <span style={{ color: c }} className="num">{x.var_abs > 0 ? '▲' : x.var_abs < 0 ? '▼' : ''} {pct ? `${x.var_abs.toFixed(1)} pp` : bs(x.var_abs, 0)}{x.var_pct !== null && !pct ? ` (${pc(x.var_pct)})` : ''}</span>;
}

export default function Mensual() {
  const { query } = useApp();
  const [vista, setVista] = useState<'meses' | 'comparacion'>('meses');
  const [estComp, setEstComp] = useState('TOTAL');
  const { data, error, cargando } = useDatos<any[]>(`/mensual${query({ est: '' })}`);
  const comp = useDatos<any>(vista === 'comparacion' ? `/comparacion${query({ est: estComp })}` : null, [estComp]);
  return (
    <>
      <div className="page-head"><div><h1>Análisis mensual</h1><p>Para cada mes: Cochabamba, La Paz y Total empresa. Los valores N/D indican datos faltantes (pase el cursor para ver el motivo); ● = valor parcial.</p></div>
        <div className="seg"><button className={vista === 'meses' ? 'on' : ''} onClick={() => setVista('meses')}>Vista por mes</button><button className={vista === 'comparacion' ? 'on' : ''} onClick={() => setVista('comparacion')}>Comparación entre meses</button></div>
      </div>
      <Filtros est={false} />
      <ErrorBox error={error || comp.error} />
      {vista === 'meses' && (cargando && !data ? <Cargando /> : <div className="grid g2">{[...(data ?? [])].reverse().map((t) => <TablaMes key={t.periodo} t={t} />)}</div>)}
      {vista === 'comparacion' && (
        <>
          <div className="seg" style={{ marginBottom: 14 }}>{['TOTAL', 'CBB', 'LPZ'].map((e) => <button key={e} className={estComp === e ? 'on' : ''} onClick={() => setEstComp(e)}>{NOMBRE_EST[e]}</button>)}</div>
          {!comp.data ? <Cargando /> : (
            <>
              <Card titulo={`Comparación entre meses — ${NOMBRE_EST[estComp]}`} sub="variación vs mes anterior">
                <div className="tabla-wrap"><table className="tabla">
                  <thead><tr><th>Mes</th><th className="r">Ventas netas</th><th className="r">Utilidad bruta</th><th className="r">Utilidad operativa</th><th className="r">Margen operativo</th><th className="r">Inventario final</th><th className="r">Variación ventas</th><th className="r">Var. utilidad operativa</th><th className="r">Ventas vs promedio acumulado</th></tr></thead>
                  <tbody>{comp.data.filas.map((f: any) => (
                    <tr key={f.periodo}>
                      <td>{f.nombre} {f.parcial && <span className="chip parcial" title={f.nota}>parcial</span>}</td>
                      <td className="r"><Valor x={f.ventas_netas} /></td><td className="r"><Valor x={f.utilidad_bruta} /></td><td className="r"><Valor x={f.utilidad_operativa} /></td>
                      <td className="r"><Valor x={f.margen_operativo} tipo="pc" /></td><td className="r"><Valor x={f.inv_final_teorico} tipo="num" /></td>
                      <td className="r"><Variacion x={f.ventas_netas} /></td><td className="r"><Variacion x={f.utilidad_operativa} /></td>
                      <td className="r num">{f.ventas_netas.vs_promedio === null ? '—' : bs(f.ventas_netas.vs_promedio, 0)}</td>
                    </tr>))}</tbody>
                </table></div>
              </Card>
              <div className="grid g3" style={{ marginTop: 16 }}>
                {[['ventas_netas', 'Ventas netas'], ['utilidad_operativa', 'Utilidad operativa'], ['margen_operativo', 'Margen operativo']].map(([k, n]) => {
                  const r = comp.data.resumen[k];
                  const f = (v: number | null) => (k.startsWith('margen') ? pc(v) : bs(v, 0));
                  return (
                    <Card key={k} titulo={n}>
                      <div className="small" style={{ lineHeight: 2 }}>
                        <div>Promedio mensual: <b className="num">{f(r.promedio)}</b></div>
                        <div>Mejor mes: <b>{r.mejor ? `${r.mejor.periodo} · ${f(r.mejor.v)}` : '—'}</b></div>
                        <div>Peor mes: <b>{r.peor ? `${r.peor.periodo} · ${f(r.peor.v)}` : '—'}</b></div>
                        <div className="muted">Meses considerados: {r.meses_considerados}. Excluidos (parciales o sin dato): {r.excluidos.join(', ') || 'ninguno'}</div>
                      </div>
                    </Card>
                  );
                })}
              </div>
            </>
          )}
        </>
      )}
    </>
  );
}
