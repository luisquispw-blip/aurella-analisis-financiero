import { useState } from 'react';
import Filtros from '../components/Filtros';
import { AlertaItem, Aviso, Card, Cargando, ErrorBox, EstadoChip, IconoSeveridad } from '../components/ui';
import { useApp, useDatos } from '../lib/contexto';
import { api } from '../lib/api';

export default function Alertas() {
  const { query, puede, tocar } = useApp();
  const [tab, setTab] = useState<'centro' | 'reglas'>('centro');
  const [sev, setSev] = useState('todas');
  const { data, error, cargando } = useDatos<any[]>(`/alertas${query()}`);
  const reglas = useDatos<any[]>(tab === 'reglas' ? '/alertas/reglas' : null, [tab]);
  const [msg, setMsg] = useState<string | null>(null);
  const guardar = async (codigo: string, cambios: any) => {
    try { await api(`/alertas/reglas/${codigo}`, { method: 'PUT', json: cambios }); setMsg('Regla actualizada; alertas recalculadas.'); tocar(); reglas.recargar(); } catch (e: any) { setMsg(e.message); }
  };
  const lista = (data ?? []).filter((a) => sev === 'todas' || a.severidad === sev);
  const cuenta = (s: string) => (data ?? []).filter((a) => a.severidad === s).length;
  return (
    <>
      <div className="page-head"><div><h1>Centro de alertas</h1><p>Todas las alertas se basan en reglas con umbrales configurables. Ningún umbral está fijado en el código.</p></div>
        <div className="seg"><button className={tab === 'centro' ? 'on' : ''} onClick={() => setTab('centro')}>Alertas</button><button className={tab === 'reglas' ? 'on' : ''} onClick={() => setTab('reglas')}>Reglas y umbrales</button></div></div>
      {tab === 'centro' && (
        <>
          <Filtros producto={false} />
          <ErrorBox error={error} />
          <div className="kpis">
            {[['critica', '🔴 Críticas'], ['advertencia', '🟠 Advertencias'], ['positiva', '🟢 Positivas'], ['datos', 'Calidad de datos']].map(([s, n]) => (
              <button key={s} className="kpi" style={{ textAlign: 'left', cursor: 'pointer', outline: sev === s ? '2px solid var(--gold-500)' : 'none' }} onClick={() => setSev(sev === s ? 'todas' : s)}>
                <div className="t">{n}<IconoSeveridad s={s} /></div><div className="v num">{cuenta(s)}</div>
              </button>
            ))}
          </div>
          {cargando && !data ? <Cargando /> : <Card titulo={`${lista.length} alerta(s)${sev !== 'todas' ? ` · ${sev}` : ''}`}>{lista.map((a, i) => <AlertaItem key={i} a={a} />)}{!lista.length && <div className="vacio">Sin alertas</div>}</Card>}
        </>
      )}
      {tab === 'reglas' && (
        <Card titulo="Reglas de alerta">
          {msg && <Aviso tipo="info">{msg}</Aviso>}
          {!reglas.data ? <Cargando /> : (
            <div className="tabla-wrap"><table className="tabla">
              <thead><tr><th>Regla</th><th>Severidad</th><th>Parámetro</th><th className="r">Umbral</th><th>Activa</th></tr></thead>
              <tbody>{reglas.data.map((r) => (
                <tr key={r.codigo}>
                  <td><b>{r.nombre}</b><div className="small muted">{r.codigo}</div></td>
                  <td><EstadoChip e={r.severidad} /></td>
                  <td className="small">{r.parametro.replace(/_/g, ' ')}</td>
                  <td className="r">{puede('analista') ? <input type="number" step="any" defaultValue={r.valor} style={{ width: 100, textAlign: 'right' }} onBlur={(e) => Number(e.target.value) !== r.valor && guardar(r.codigo, { valor: Number(e.target.value) })} /> : r.valor}</td>
                  <td><input type="checkbox" checked={!!r.activo} disabled={!puede('analista')} onChange={(e) => guardar(r.codigo, { activo: e.target.checked })} /></td>
                </tr>))}</tbody>
            </table></div>
          )}
        </Card>
      )}
    </>
  );
}
