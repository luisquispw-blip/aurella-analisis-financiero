import { useState } from 'react';
import { Aviso, Card, Cargando, Tabla } from '../components/ui';
import { useApp, useDatos } from '../lib/contexto';
import { api } from '../lib/api';
import { bs, num } from '../lib/formato';

export default function Productos() {
  const { puede, tocar } = useApp();
  const { data, recargar } = useDatos<any>('/productos');
  const [tab, setTab] = useState<'productos' | 'alias'>('alias');
  const [msg, setMsg] = useState<string | null>(null);
  const reasignar = async (alias_clave: string, producto_id: string) => {
    try { await api('/productos/alias', { method: 'PATCH', json: { alias_clave, producto_id: Number(producto_id) } }); setMsg('Nombre reasignado; ventas recalculadas.'); recargar(); tocar(); } catch (e: any) { setMsg(e.message); }
  };
  if (!data) return <Cargando />;
  const conVentas = data.productos.filter((p: any) => p.lineas > 0);
  return (
    <>
      <div className="page-head"><div><h1>Productos y unificación de nombres</h1><p>Los nombres escritos de distintas formas en las planillas ("RAPH CELESTE", "Ralph celeste", "RAPLH CELESTE") se unifican con el catálogo. Revise las asociaciones aproximadas.</p></div>
        <div className="seg"><button className={tab === 'alias' ? 'on' : ''} onClick={() => setTab('alias')}>Nombres registrados</button><button className={tab === 'productos' ? 'on' : ''} onClick={() => setTab('productos')}>Productos</button></div></div>
      {msg && <Aviso tipo="info">{msg}</Aviso>}
      {tab === 'alias' && (
        <Card titulo={`${data.alias.length} nombres distintos detectados en las ventas`} sub="método: exacto, aproximado (similitud) o contenido; los confirmados manualmente no se modifican">
          <datalist id="lista-prod">{data.productos.map((p: any) => <option key={p.id} value={`${p.id} · ${p.nombre}`} />)}</datalist>
          <Tabla alto={620} nombreCsv="alias_productos.csv" filas={data.alias} columnas={[
            { k: 'alias_texto', t: 'Como se escribió' }, { k: 'producto', t: 'Producto asignado' },
            { k: 'metodo', t: 'Método', f: (x, f) => <span className={`chip ${x === 'exacto' || x === 'manual' ? 'ok' : 'parcial'}`}>{x}{f.confirmado ? ' ✓' : ''}</span> },
            { k: 'puntaje', t: 'Similitud', r: true, f: (x) => `${Math.round(x * 100)}%` },
            ...(puede('analista') ? [{ k: 'alias_clave', t: 'Reasignar a', f: (x: string) => <input list="lista-prod" placeholder="Buscar producto…" style={{ width: 220 }} onChange={(e) => { const id = e.target.value.split(' · ')[0]; if (/^\d+$/.test(id) && e.target.value.includes(' · ')) reasignar(x, id); }} /> }] : []),
          ]} />
        </Card>
      )}
      {tab === 'productos' && (
        <Card titulo={`${conVentas.length} productos con ventas · ${data.productos.length} en total`}>
          <Tabla alto={620} nombreCsv="productos.csv" filas={data.productos} columnas={[
            { k: 'nombre', t: 'Producto' }, { k: 'marca', t: 'Marca', f: (x) => x ?? <span className="muted">sin catálogo</span> }, { k: 'categoria', t: 'Categoría' },
            { k: 'origen', t: 'Origen', f: (x) => (x === 'catalogo' ? <span className="chip ok">catálogo</span> : <span className="chip gris">creado desde ventas</span>) },
            { k: 'lineas', t: 'Líneas de venta', r: true, f: (x) => num(x) }, { k: 'ventas', t: 'Ventas', r: true, f: (x) => bs(x) },
          ]} />
        </Card>
      )}
    </>
  );
}
