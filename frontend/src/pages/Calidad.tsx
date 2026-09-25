import { useState } from 'react';
import { Download } from 'lucide-react';
import { Aviso, Card, Cargando, EstadoChip, Tabla } from '../components/ui';
import { useApp, useDatos } from '../lib/contexto';
import { api, descargar } from '../lib/api';
import { NOMBRE_EST, bs } from '../lib/formato';

const NOMBRE_CONCEPTO: Record<string, string> = { BANCOS: 'Bancos', CXC: 'Cuentas por cobrar', CXP: 'Cuentas por pagar', PRESTAMO: 'Préstamos', CAPITAL: 'Capital social', APORTE: 'Aportes', RETIRO: 'Retiros', CAJA: 'Caja', INVENTARIO_VALORIZADO: 'Inventario valorizado', OTRO_ACTIVO: 'Otro activo', OTRO_PASIVO: 'Otro pasivo' };

// Formulario para proporcionar exactamente el dato faltante
function FormFaltante({ f, listo }: { f: any; listo: (m: string) => void }) {
  const { puede, meta } = useApp();
  const [valor, setValor] = useState('');
  const [periodo, setPeriodo] = useState(f.formulario?.periodo ?? '');
  const [est, setEst] = useState(f.formulario?.est ?? 'CBB');
  const [error, setError] = useState<string | null>(null);
  if (!f.formulario || !puede('analista')) return null;
  const t = f.formulario.tipo;
  const enviar = async (fn: () => Promise<unknown>, m: string) => { setError(null); try { await fn(); listo(m); } catch (e: any) { setError(e.message); } };
  if (t === 'plantilla_inventario') return <button className="btn sm" onClick={() => descargar('/plantillas/inventario.csv')}><Download size={14} /> Descargar plantilla</button>;
  if (t === 'archivo') return <a className="btn sm" href="/carga">Ir al Centro de carga</a>;
  if (t === 'presentaciones') {
    return (
      <div>
        <Tabla buscar={false} alto={260} filas={f.formulario.sugerencias} columnas={[
          { k: 'original', t: 'Registrado' }, { k: 'precio', t: 'Precio', r: true, f: (x) => bs(x) }, { k: 'lineas', t: 'Líneas', r: true },
          { k: 'sugerida', t: 'Presentación sugerida', f: (x) => x ?? <span className="nd-txt">sin sugerencia</span> }, { k: 'evidencia', t: 'Evidencia' }, { k: 'ejemplos', t: 'Ejemplos', f: (x) => <span className="small">{x.join('; ')}</span> },
        ]} />
        <div style={{ display: 'flex', gap: 8, marginTop: 8, alignItems: 'center' }}>
          <button className="btn primary sm" onClick={() => enviar(() => api('/datos/parametro', { method: 'POST', json: { clave: 'correccion_presentacion_por_precio', valor: '1' } }), 'Corrección por precio aplicada a las líneas con sugerencia. Las demás siguen sin costo.')}>Confirmar corrección sugerida</button>
          <span className="small muted">Solo se corrigen líneas con evidencia ≥ 80 %. La decisión queda auditada y puede revertirse en Administración.</span>
        </div>
        {error && <Aviso tipo="crit">{error}</Aviso>}
      </div>
    );
  }
  return (
    <form className="form-row" onSubmit={(e) => {
      e.preventDefault();
      if (t === 'saldo') enviar(() => api('/datos/saldo', { method: 'POST', json: { concepto: f.formulario.concepto, est, periodo, monto: Number(valor) } }), `${NOMBRE_CONCEPTO[f.formulario.concepto]} registrado.`);
      if (t === 'parametro') enviar(() => api('/datos/parametro', { method: 'POST', json: { clave: f.formulario.clave, valor } }), 'Parámetro registrado.');
      if (t === 'costo') enviar(() => api('/datos/costo', { method: 'POST', json: { presentacion: f.formulario.presentacion, costo: Number(valor) } }), 'Costo registrado.');
    }}>
      {t === 'saldo' && <>
        <label>Establecimiento<select value={est} onChange={(e) => setEst(e.target.value)}>{meta?.establecimientos.map((e) => <option key={e.id} value={e.id}>{e.nombre}</option>)}</select></label>
        <label>Al cierre de<select value={periodo} onChange={(e) => setPeriodo(e.target.value)}>{meta?.periodos.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}</select></label>
      </>}
      <label>{t === 'parametro' ? 'Tipo de cambio (Bs por USD)' : t === 'costo' ? `Costo unitario ${f.formulario.presentacion} (Bs)` : `${NOMBRE_CONCEPTO[f.formulario.concepto]} (Bs)`}
        <input type="number" step="0.01" value={valor} onChange={(e) => setValor(e.target.value)} required style={{ width: 160 }} /></label>
      <button className="btn primary sm">Registrar solo este dato</button>
      {error && <span className="nd-txt small">{error}</span>}
    </form>
  );
}

export default function Calidad() {
  const { tocar } = useApp();
  const { data, recargar } = useDatos<any>('/calidad');
  const [tab, setTab] = useState('faltantes');
  const [msg, setMsg] = useState<string | null>(null);
  const listo = (m: string) => { setMsg(m); tocar(); recargar(); };
  if (!data) return <Cargando />;
  const r = data.resumen;
  return (
    <>
      <div className="page-head"><div><h1>Calidad de datos y datos faltantes</h1><p>Informe de calidad generado antes del análisis. Cada dato faltante indica exactamente qué falta, qué cálculo afecta y cómo proporcionarlo.</p></div>
        <button className="btn" onClick={() => descargar('/reportes/calidad?formato=pdf')}><Download size={15} /> Informe PDF</button></div>
      {msg && <Aviso tipo="ok">{msg}</Aviso>}
      <div className="kpis">
        <div className="kpi"><div className="t">Líneas de venta</div><div className="v num">{r.ventas_lineas.toLocaleString('es-BO')}</div><div className="pie">{r.ventas_observadas} observadas</div></div>
        <div className="kpi"><div className="t">Egresos</div><div className="v num">{r.egresos}</div><div className="pie">{r.egresos_duplicados} duplicados excluidos · {r.egresos_usd} en USD</div></div>
        <div className="kpi"><div className="t">Datos faltantes</div><div className="v num">{data.faltantes.length}</div><div className="pie">{data.faltantes.filter((f: any) => f.prioridad === 'alta').length} de prioridad alta</div></div>
        <div className="kpi"><div className="t">Observaciones</div><div className="v num">{r.advertencias}</div><div className="pie">{r.errores} errores</div></div>
      </div>
      <div className="tabs">{[['faltantes', 'Datos faltantes'], ['validaciones', 'Validaciones'], ['conciliacion', 'Conciliación con totales del propietario'], ['duplicados', 'Duplicados'], ['mensajes', 'Observaciones por hoja']].map(([k, n]) => <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{n}</button>)}</div>
      {tab === 'faltantes' && data.faltantes.map((f: any) => (
        <Card key={f.id} style={{ marginBottom: 10 }}>
          <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
            <EstadoChip e={f.prioridad} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div><b>Falta: {f.dato}</b></div>
              <div className="small" style={{ margin: '4px 0' }}>Este dato afecta: {f.afecta}</div>
              <div className="small muted" style={{ marginBottom: 8 }}>{f.como}</div>
              <FormFaltante f={f} listo={listo} />
            </div>
          </div>
        </Card>
      ))}
      {tab === 'validaciones' && data.secciones.map((s: any) => (
        <Card key={s.nombre} titulo={<>{s.nombre} <EstadoChip e={s.resultado === 'observado' ? 'advertencia' : s.resultado} texto={s.resultado.replace('_', ' ')} /></>} sub={s.pregunta} style={{ marginBottom: 10 }}>
          <ul className="small" style={{ margin: 0 }}>{s.detalle.slice(0, 25).map((d: string, i: number) => <li key={i}>{d}</li>)}</ul>
          {s.detalle.length > 25 && <p className="small muted">… y {s.detalle.length - 25} más (ver Observaciones por hoja)</p>}
        </Card>
      ))}
      {tab === 'conciliacion' && (
        <Card titulo="Ventas del detalle vs totales declarados en las planillas">
          <Tabla filas={data.conciliacion} nombreCsv="conciliacion.csv" columnas={[
            { k: 'est', t: 'Est.', f: (x) => NOMBRE_EST[x] }, { k: 'periodo', t: 'Periodo' }, { k: 'ventas_detalle', t: 'Ventas (detalle)', r: true, f: (x) => bs(x) },
            { k: 'ventas_declaradas', t: 'Total declarado', f: (x) => x.length ? x.map((d: any, i: number) => <div key={i} className="small">{bs(d.monto)} <span className="muted">({d.origen})</span> {Math.abs(d.diferencia) > 1 ? <span className="nd-txt">dif. {bs(d.diferencia)}</span> : <span className="chip ok">cuadra</span>}</div>) : <span className="muted">—</span>, csv: (x) => x.map((d: any) => d.monto).join(' / ') },
            { k: 'gastos_detalle', t: 'Gastos operativos', r: true, f: (x, f) => (x === null ? 'N/D' : `${bs(x)} (${f.gastos_fuente})`) },
            { k: 'cobertura', t: 'Cobertura', f: (x) => (x.parcial ? <span className="chip parcial" title={x.motivo}>{x.primer_dia?.slice(8)}–{x.ultimo_dia?.slice(8)}</span> : <span className="chip ok">mes completo</span>), csv: (x) => (x.parcial ? 'parcial' : 'completo') },
          ]} />
          <p className="small muted">El sistema usa siempre el detalle línea por línea; los totales declarados solo sirven de control. Los "Total" diarios de las planillas no incluyen las ventas por DELIVERY.</p>
        </Card>
      )}
      {tab === 'duplicados' && (
        <Card titulo="Egresos marcados como duplicados (excluidos de los cálculos, no borrados)">
          <Tabla filas={data.duplicados} nombreCsv="duplicados.csv" columnas={[{ k: 'est', t: 'Est.' }, { k: 'periodo', t: 'Periodo' }, { k: 'descripcion', t: 'Descripción' }, { k: 'monto', t: 'Monto', r: true, f: (x) => bs(x) }, { k: 'origen', t: 'Registro excluido' }, { k: 'conservado', t: 'Registro conservado' }]} />
          <p className="small muted">Puede revertir una marca en Gastos › Duplicados › "No es duplicado".</p>
        </Card>
      )}
      {tab === 'mensajes' && (
        <Card titulo="Observaciones de la importación">
          <Tabla filas={data.mensajes} alto={600} nombreCsv="observaciones.csv" columnas={[{ k: 'nivel', t: 'Nivel', f: (x) => <EstadoChip e={x === 'advertencia' ? 'advertencia' : x === 'error' ? 'error' : 'datos'} texto={x} /> }, { k: 'archivo', t: 'Archivo' }, { k: 'hoja', t: 'Hoja' }, { k: 'fila', t: 'Fila', r: true }, { k: 'texto', t: 'Mensaje' }]} />
        </Card>
      )}
    </>
  );
}
