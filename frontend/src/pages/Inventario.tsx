import { useState } from 'react';
import { Download } from 'lucide-react';
import Filtros from '../components/Filtros';
import { Aviso, Card, Cargando, ErrorBox, Tabla } from '../components/ui';
import { useApp, useDatos } from '../lib/contexto';
import { api, descargar } from '../lib/api';
import { NOMBRE_EST, num } from '../lib/formato';

const TIPOS = [['INVENTARIO_INICIAL', 'Inventario inicial'], ['COMPRA', 'Compra'], ['TRANSFERENCIA_ENTRADA', 'Transferencia recibida'], ['TRANSFERENCIA_SALIDA', 'Transferencia enviada'], ['DEVOLUCION', 'Devolución a proveedor'], ['BAJA', 'Baja'], ['DANADO', 'Producto dañado'], ['PERDIDA', 'Producto perdido'], ['AJUSTE', 'Ajuste (+/−)'], ['INVENTARIO_FISICO', 'Inventario físico (conteo)']];

export default function Inventario() {
  const { query, meta, puede, tocar } = useApp();
  const { data, error, cargando } = useDatos<any>(`/inventario${query()}`);
  const [f, setF] = useState<any>({ est: 'CBB', periodo: '', tipo: 'INVENTARIO_FISICO', producto: '', tamano_ml: '100', cantidad: '', costo_unitario: '', contraparte: '' });
  const [msg, setMsg] = useState<string | null>(null);
  const guardar = async (e: React.FormEvent) => {
    e.preventDefault();
    try { await api('/inventario', { method: 'POST', json: f }); setMsg('Movimiento registrado.'); setF({ ...f, producto: '', cantidad: '' }); tocar(); } catch (err: any) { setMsg(err.message); }
  };
  return (
    <>
      <div className="page-head"><div><h1>Control de inventarios</h1><p>Mercadería disponible, inventario teórico, diferencias contra el conteo físico y transferencias entre Cochabamba y La Paz.</p></div>
        <button className="btn" onClick={() => descargar('/plantillas/inventario.csv')}><Download size={15} /> Plantilla de inventario</button></div>
      <Filtros producto={false} />
      <ErrorBox error={error} />
      {data?.formulas && <div className="formula" style={{ marginBottom: 16 }}>{data.formulas.disponible}{'\n'}{data.formulas.teorico}{'\n'}{data.formulas.diferencia}</div>}
      {cargando && !data && <Cargando />}
      {data && !data.hay_datos && (
        <Aviso tipo="warn">
          <b>No hay información de inventario.</b> Los archivos recibidos no contienen inventarios ni movimientos en unidades (la hoja "Inventario" del registro de Cochabamba solo es un catálogo de nombres y marcas).
          Por lo tanto no se calcula la mercadería disponible, el inventario teórico, las diferencias, la rotación real ni el sobre-stock.
          <br /><br />Proporcione únicamente: <b>el inventario inicial</b> de cada establecimiento (Cochabamba al inicio de febrero 2026, La Paz a la apertura en abril 2026), <b>las compras en unidades</b> y <b>los conteos físicos</b> de fin de mes, por producto y tamaño. Puede subir la plantilla completada en el Centro de carga o registrar movimientos abajo.
        </Aviso>
      )}
      {data?.hay_datos && data.periodos.map((p: any) => p.establecimientos.map((e: any) => (
        <Card key={`${p.periodo}${e.est}`} titulo={`${NOMBRE_EST[e.est]} · ${p.nombre}`} style={{ marginBottom: 14 }}>
          {e.faltantes.length > 0 && <Aviso tipo="warn">{e.faltantes.slice(0, 4).join(' · ')}{e.faltantes.length > 4 ? ` · y ${e.faltantes.length - 4} más` : ''}</Aviso>}
          <Tabla filas={e.productos} nombreCsv={`inventario_${e.est}_${p.periodo}.csv`} alto={420} columnas={[
            { k: 'producto', t: 'Producto' }, { k: 'inicial', t: 'Inicial', r: true, f: (x) => (x === null ? <span className="nd-txt">N/D</span> : num(x)) },
            { k: 'compras', t: 'Compras', r: true }, { k: 't_in', t: 'Transf. recibidas', r: true }, { k: 't_out', t: 'Transf. enviadas', r: true },
            { k: 'disponible', t: 'Disponible', r: true, f: (x) => (x === null ? 'N/D' : num(x)) }, { k: 'vendidas', t: 'Vendidas', r: true }, { k: 'devoluciones', t: 'Devol.', r: true }, { k: 'bajas', t: 'Bajas', r: true },
            { k: 'teorico', t: 'Teórico', r: true, f: (x) => (x === null ? 'N/D' : <b style={{ color: x < 0 ? 'var(--crit)' : undefined }}>{num(x)}</b>) },
            { k: 'fisico', t: 'Físico', r: true, f: (x) => (x === null ? <span className="nd-txt">N/D</span> : num(x)) },
            { k: 'diferencia', t: 'Diferencia', r: true, f: (x) => (x === null ? 'N/D' : <b style={{ color: x !== 0 ? 'var(--crit)' : 'var(--ok)' }}>{num(x)}</b>) },
          ]} />
        </Card>
      )))}
      {puede('analista') && (
        <Card titulo="Registrar movimiento de inventario" sub="para cargas puntuales; para volúmenes grandes use la plantilla">
          {msg && <Aviso tipo="info">{msg}</Aviso>}
          <form className="form-row" onSubmit={guardar}>
            <label>Establecimiento<select value={f.est} onChange={(e) => setF({ ...f, est: e.target.value })}>{meta?.establecimientos.map((e) => <option key={e.id} value={e.id}>{e.nombre}</option>)}</select></label>
            <label>Periodo<select value={f.periodo} onChange={(e) => setF({ ...f, periodo: e.target.value })} required><option value="">—</option>{meta?.periodos.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}</select></label>
            <label>Tipo<select value={f.tipo} onChange={(e) => setF({ ...f, tipo: e.target.value })}>{TIPOS.map(([k, n]) => <option key={k} value={k}>{n}</option>)}</select></label>
            <label>Producto<input list="prods" value={f.producto} onChange={(e) => setF({ ...f, producto: e.target.value })} required style={{ minWidth: 200 }} /></label>
            <datalist id="prods">{meta?.productos.map((p) => <option key={p.id} value={p.nombre} />)}</datalist>
            <label>Tamaño (ml)<select value={f.tamano_ml} onChange={(e) => setF({ ...f, tamano_ml: e.target.value })}><option>10</option><option>50</option><option>100</option><option value="">N/A</option></select></label>
            <label>Cantidad<input type="number" value={f.cantidad} onChange={(e) => setF({ ...f, cantidad: e.target.value })} required style={{ width: 100 }} /></label>
            <label>Costo unitario<input type="number" step="0.01" value={f.costo_unitario} onChange={(e) => setF({ ...f, costo_unitario: e.target.value })} style={{ width: 110 }} /></label>
            {f.tipo.startsWith('TRANSFERENCIA') && <label>{f.tipo === 'TRANSFERENCIA_SALIDA' ? 'Destino' : 'Origen'}<select value={f.contraparte} onChange={(e) => setF({ ...f, contraparte: e.target.value })} required><option value="">—</option>{meta?.establecimientos.filter((x) => x.id !== f.est).map((e) => <option key={e.id} value={e.id}>{e.nombre}</option>)}</select></label>}
            <button className="btn primary">Registrar</button>
          </form>
        </Card>
      )}
    </>
  );
}
