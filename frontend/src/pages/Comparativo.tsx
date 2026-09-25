import Filtros from '../components/Filtros';
import { SerieEst, BarrasH } from '../components/Graficos';
import { Aviso, Card, Cargando, ErrorBox, Valor } from '../components/ui';
import { useApp, useDatos } from '../lib/contexto';
import { NOMBRE_EST, bs, num, pc } from '../lib/formato';

const FILAS: [string, string, 'bs' | 'pc' | 'num'][] = [
  ['ventas_netas', 'Ventas netas', 'bs'], ['unidades', 'Unidades vendidas', 'num'], ['costo_ventas', 'Costo de ventas', 'bs'], ['utilidad_bruta', 'Utilidad bruta', 'bs'],
  ['margen_bruto', 'Margen bruto', 'pc'], ['gastos_operativos', 'Gastos operativos', 'bs'], ['utilidad_operativa', 'Utilidad operativa', 'bs'], ['margen_operativo', 'Margen operativo', 'pc'],
  ['precio_promedio', 'Precio promedio', 'bs'], ['ticket_promedio', 'Ticket promedio', 'bs'], ['inv_final_teorico', 'Inventario (u.)', 'num'], ['caja_bancos', 'Caja y bancos', 'bs'], ['flujo_neto', 'Flujo neto registrado', 'bs'],
];

export default function Comparativo() {
  const { query } = useApp();
  const { data, error, cargando } = useDatos<any>(`/comparativo${query({ est: '' })}`);
  const serie = (data?.tabla ?? []).map((t: any) => ({ periodo: t.periodo, nombre: t.nombre, parcial: ['CBB', 'LPZ'].some((e) => t[e]?.cobertura?.parcial), ...Object.fromEntries(['ventas_netas', 'utilidad_operativa', 'margen_operativo', 'margen_bruto', 'unidades'].flatMap((m) => ['CBB', 'LPZ', 'TOTAL'].map((e) => [`${m}_${e}`, t[e]?.[m]])) ) }));
  const a = data?.acumulado;
  return (
    <>
      <div className="page-head"><div><h1>Cochabamba vs La Paz</h1><p>Comparación por establecimiento y total empresa. Las transferencias internas no son ventas y se eliminan en el consolidado. La Paz opera desde el 25/04/2026.</p></div></div>
      <Filtros est={false} />
      <ErrorBox error={error} />
      {cargando && !data && <Cargando />}
      {data && (
        <>
          <div className="grid g3" style={{ marginBottom: 16 }}>
            {['CBB', 'LPZ', 'TOTAL'].map((e) => (
              <Card key={e} titulo={NOMBRE_EST[e]} sub={`${a[e].meses} mes(es) con operación`}>
                <div className="small" style={{ lineHeight: 2 }}>
                  <div>Ventas netas acumuladas: <b className="num">{bs(a[e].ventas_netas.v)}</b></div>
                  <div>Promedio mensual: <b className="num">{bs(a[e].promedio_mensual)}</b></div>
                  <div>Unidades: <b className="num">{num(a[e].unidades.v)}</b></div>
                  <div>Utilidad bruta: <b className="num">{bs(a[e].utilidad_bruta.v)}</b> · margen {pc(a[e].margen_bruto)}</div>
                  <div>Utilidad operativa: <b className="num">{bs(a[e].utilidad_operativa.v)}</b> · margen {pc(a[e].margen_operativo)}</div>
                  {a[e].utilidad_operativa.excluye.length > 0 && <div className="nd-txt">Sin gastos registrados (no incluidos): {a[e].utilidad_operativa.excluye.join(', ')}</div>}
                </div>
              </Card>
            ))}
          </div>
          <div className="grid g2" style={{ marginBottom: 16 }}>
            <Card titulo="Ventas netas por mes"><SerieEst datos={serie} metrica="ventas_netas" /></Card>
            <Card titulo="Utilidad operativa por mes"><SerieEst datos={serie} metrica="utilidad_operativa" /></Card>
            <Card titulo="Margen bruto %"><SerieEst datos={serie} metrica="margen_bruto" tipo="lineas" formato="pc" /></Card>
            <Card titulo="Margen operativo %"><SerieEst datos={serie} metrica="margen_operativo" tipo="lineas" formato="pc" /></Card>
          </div>
          <div className="grid g2" style={{ marginBottom: 16 }}>
            {['CBB', 'LPZ'].map((e) => <Card key={e} titulo={`Top productos · ${NOMBRE_EST[e]}`}><BarrasH filas={data.top_por_est[e]} clave="producto" valor="ventas" color={e === 'CBB' ? '#2a5298' : '#c8912e'} /></Card>)}
          </div>
          <Aviso tipo="info">Rotación e inventario por establecimiento requieren inventarios en unidades (no proporcionados). La liquidez por establecimiento se limita al fondo de caja en tienda mientras no se registren los saldos bancarios.</Aviso>
          {[...data.tabla].reverse().map((t: any) => (
            <Card key={t.periodo} titulo={t.nombre} style={{ marginBottom: 12 }}>
              <div className="tabla-wrap"><table className="tabla">
                <thead><tr><th>Indicador</th><th className="r">Cochabamba</th><th className="r">La Paz</th><th className="r">Total empresa</th><th className="r">Participación La Paz</th></tr></thead>
                <tbody>{FILAS.map(([k, n, tp]) => {
                  const c = t.CBB?.[k], l = t.LPZ?.[k], tt = t.TOTAL?.[k];
                  const part = tp === 'bs' && l?.v !== null && l?.v !== undefined && tt?.v ? (l.v / tt.v) * 100 : null;
                  return <tr key={k}><td>{n}</td><td className="r"><Valor x={c} tipo={tp} /></td><td className="r"><Valor x={l} tipo={tp} /></td><td className="r"><Valor x={tt} tipo={tp} /></td><td className="r muted">{part === null || ['precio_promedio', 'ticket_promedio'].includes(k) ? '' : pc(part)}</td></tr>;
                })}</tbody>
              </table></div>
            </Card>
          ))}
        </>
      )}
    </>
  );
}
