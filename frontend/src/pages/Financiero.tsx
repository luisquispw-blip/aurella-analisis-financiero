import { useState } from 'react';
import { Line, LineChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis, Legend, ReferenceLine } from 'recharts';
import { Aviso, Card, Cargando, ErrorBox, TooltipChart, Valor } from '../components/ui';
import { useApp, useDatos } from '../lib/contexto';
import { NOMBRE_EST, bs, ejeBs, mesCorto, pc } from '../lib/formato';

function Bloque({ titulo, lineas, total }: { titulo: string; lineas: any[]; total: number }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <table className="tabla">
        <thead><tr><th>{titulo}</th><th className="r">Bs</th></tr></thead>
        <tbody>
          {lineas.map((l) => <tr key={l.cuenta}><td>{l.cuenta}<div className="small muted">{l.valor.m ?? l.fuente}</div></td><td className="r"><Valor x={l.valor} /></td></tr>)}
          <tr className="total"><td>Total {titulo.toLowerCase()} (solo cuentas disponibles)</td><td className="r num">{bs(total)}</td></tr>
        </tbody>
      </table>
    </div>
  );
}

export default function Financiero() {
  const { meta } = useApp();
  const [periodo, setPeriodo] = useState('');
  const [est, setEst] = useState('TOTAL');
  const { data, error, cargando } = useDatos<any>(`/financiero?est=${est}${periodo ? `&periodo=${periodo}` : ''}`, [periodo, est]);
  const s = data?.situacion, l = data?.liquidez;
  return (
    <>
      <div className="page-head"><div><h1>Situación financiera y liquidez</h1><p>Estructura de activos, pasivos y patrimonio con la información disponible. No se inventan saldos ni ajustes contables.</p></div></div>
      <div className="filtros">
        <label>Cierre al<select value={periodo} onChange={(e) => setPeriodo(e.target.value)}><option value="">Último periodo</option>{meta?.periodos.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}</select></label>
        <div className="seg">{['TOTAL', 'CBB', 'LPZ'].map((e) => <button key={e} className={est === e ? 'on' : ''} onClick={() => setEst(e)}>{NOMBRE_EST[e]}</button>)}</div>
      </div>
      <ErrorBox error={error} />
      {cargando && !data && <Cargando />}
      {s && (
        <>
          {s.verificable
            ? (Math.abs(s.diferencia) > 1 ? <Aviso tipo="crit"><b>ALERTA CRÍTICA: Activo ≠ Pasivo + Patrimonio.</b> Diferencia {bs(s.diferencia)}. Revise saldos de bancos, inventario valorizado, cuentas por pagar y resultados acumulados. No se generan ajustes automáticos.</Aviso>
              : <Aviso tipo="ok">Activo = Pasivo + Patrimonio verificado al cierre de {s.nombre}.</Aviso>)
            : <Aviso tipo="warn"><b>Validación Activo = Pasivo + Patrimonio: no verificable.</b> {s.nota}</Aviso>}
          <div className="grid g2" style={{ marginBottom: 16 }}>
            <Card titulo={`Activos · ${NOMBRE_EST[est]} · ${s.nombre}`}><div className="tabla-wrap"><Bloque titulo="Activo" lineas={s.activos} total={s.total_activo} /></div></Card>
            <Card titulo="Pasivos y patrimonio">
              <div className="tabla-wrap"><Bloque titulo="Pasivo" lineas={s.pasivos} total={s.total_pasivo} /></div>
              <div className="tabla-wrap" style={{ marginTop: 10 }}><Bloque titulo="Patrimonio" lineas={s.patrimonio} total={s.total_patrimonio} /></div>
              <h3 style={{ marginTop: 14 }}>Aportes por socio (inversión inicial según participación)</h3>
              <table className="tabla"><tbody>{s.aportes_por_socio.map((a: any) => <tr key={a.socio}><td>{a.socio}</td><td className="r">{pc(a.participacion * 100)}</td><td className="r num">{bs(a.monto)}</td></tr>)}</tbody></table>
            </Card>
          </div>
          <div className="grid g2">
            <Card titulo="Indicadores de liquidez">
              <table className="tabla"><thead><tr><th>Indicador</th><th>Fórmula</th><th className="r">Valor</th></tr></thead><tbody>
                {l.indicadores.map((i: any) => <tr key={i.nombre}><td>{i.nombre}</td><td className="small muted">{i.formula}</td><td className="r">{i.valor.v === null ? <span className="nd-txt" title={i.valor.m}>N/D</span> : i.nombre.includes('Bs') ? bs(i.valor.v) : i.nombre.includes('Dependencia') ? pc(i.valor.v) : i.valor.v.toFixed(2)}</td></tr>)}
              </tbody></table>
              {l.indicadores.some((i: any) => i.valor.v === null) && <p className="small muted" style={{ marginTop: 8 }}>{l.indicadores.find((i: any) => i.valor.v === null)?.valor.m}</p>}
            </Card>
            <Card titulo="Flujo neto registrado y fondo de caja" sub="aproximación de caja con los egresos registrados">
              <ResponsiveContainer width="100%" height={260}>
                <LineChart data={l.serie.map((x: any) => ({ nombre: mesCorto(x.periodo), flujo: x.flujo_neto, fondo: x.fondo_caja }))}>
                  <CartesianGrid stroke="#eef1f6" vertical={false} />
                  <XAxis dataKey="nombre" tick={{ fontSize: 11, fill: '#7c8697' }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 11, fill: '#7c8697' }} tickFormatter={ejeBs} axisLine={false} tickLine={false} width={50} />
                  <ReferenceLine y={0} stroke="#b0b8c6" />
                  <Tooltip content={<TooltipChart />} />
                  <Legend wrapperStyle={{ fontSize: 12 }} iconType="plainline" />
                  <Line dataKey="flujo" name="Flujo neto registrado" stroke="#2a5298" strokeWidth={2} dot={{ r: 4, fill: '#fff', strokeWidth: 2 }} />
                  <Line dataKey="fondo" name="Fondo de caja (efectivo)" stroke="#c8912e" strokeWidth={2} dot={{ r: 4, fill: '#fff', strokeWidth: 2 }} />
                </LineChart>
              </ResponsiveContainer>
              <p className="small muted">Flujo = ventas − gastos operativos − pagos de mercadería − inversiones pagadas con fondos de la operación. No incluye la inversión inicial de socios ni saldos bancarios.</p>
            </Card>
          </div>
        </>
      )}
    </>
  );
}
