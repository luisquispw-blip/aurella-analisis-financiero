import { useState } from 'react';
import Filtros from '../components/Filtros';
import { BarrasH } from '../components/Graficos';
import { Card, Cargando, ErrorBox, Tabla, BotonTraza } from '../components/ui';
import { useApp, useDatos } from '../lib/contexto';
import { NOMBRE_EST, bs, mesCorto, num, pc } from '../lib/formato';

const DIMS: [string, string][] = [['por_marca', 'Marca'], ['por_categoria', 'Categoría'], ['por_presentacion', 'Presentación'], ['por_pago', 'Medio de pago'], ['por_establecimiento', 'Establecimiento'], ['por_mes', 'Mes']];

export default function Ventas() {
  const { query } = useApp();
  const { data, error, cargando } = useDatos<any>(`/ventas${query()}`);
  const [dim, setDim] = useState('por_marca');
  const [lista, setLista] = useState<'top' | 'con_caida' | 'con_crecimiento' | 'baja_participacion' | 'sin_ventas'>('top');
  const total = data?.productos?.reduce((s: number, p: any) => s + p.ventas, 0) ?? 0;
  const unid = data?.productos?.reduce((s: number, p: any) => s + p.unidades, 0) ?? 0;
  return (
    <>
      <div className="page-head"><div><h1>Análisis de ventas <BotonTraza metrica="ventas_netas" titulo="Ventas netas" /></h1>
        <p>Ventas netas = importes cobrados por línea. Descuento implícito = diferencia contra el precio público de la tabla de costos. Obsequios (atomizadores) no suman unidades.</p></div></div>
      <Filtros />
      <ErrorBox error={error} />
      {cargando && !data && <Cargando />}
      {data && (
        <>
          <div className="kpis">
            <div className="kpi"><div className="t">Ventas netas (productos)</div><div className="v num">{bs(total)}</div><div className="pie">excluye atomizadores de obsequio</div></div>
            <div className="kpi"><div className="t">Unidades vendidas</div><div className="v num">{num(unid)}</div></div>
            <div className="kpi"><div className="t">Precio promedio</div><div className="v num">{unid ? bs(total / unid) : '—'}</div></div>
            <div className="kpi"><div className="t">Productos con venta</div><div className="v num">{data.productos.length}</div><div className="pie">{data.sin_ventas.length} del catálogo sin ventas</div></div>
          </div>
          <div className="grid g2" style={{ marginBottom: 16 }}>
            <Card titulo="Ventas por dimensión" acciones={<select value={dim} onChange={(e) => setDim(e.target.value)} className="btn sm">{DIMS.map(([k, n]) => <option key={k} value={k}>{n}</option>)}</select>}>
              <BarrasH filas={data[dim].map((x: any) => ({ ...x, clave: dim === 'por_establecimiento' ? NOMBRE_EST[x.clave] ?? x.clave : dim === 'por_mes' ? mesCorto(x.clave) : x.clave }))} clave="clave" valor="ventas" max={15} />
            </Card>
            <Card titulo="Detalle por dimensión">
              <Tabla alto={420} nombreCsv={`ventas_${dim}.csv`} filas={data[dim]} columnas={[
                { k: 'clave', t: DIMS.find((d) => d[0] === dim)![1] }, { k: 'ventas', t: 'Ventas', r: true, f: (v) => bs(v) }, { k: 'unidades', t: 'Unidades', r: true, f: (v) => num(v) },
                { k: 'participacion', t: 'Part.', r: true, f: (v) => pc(v) }, { k: 'margen', t: 'Margen', r: true, f: (v, f) => (v === null ? <span className="nd-txt" title={`${f.lineas_sin_costo} línea(s) sin costo`}>{f.margen_parcial !== null ? `${pc(f.margen_parcial)}*` : 'N/D'}</span> : pc(v)) },
              ]} />
            </Card>
          </div>
          <Card titulo="Productos" acciones={
            <div className="seg">{[['top', 'Top ventas'], ['con_crecimiento', 'Con crecimiento'], ['con_caida', 'Con caída'], ['baja_participacion', 'Baja participación'], ['sin_ventas', 'Sin ventas']].map(([k, n]) => <button key={k} className={lista === k ? 'on' : ''} onClick={() => setLista(k as any)}>{n}</button>)}</div>}>
            {(lista === 'con_caida' || lista === 'con_crecimiento') && <p className="small muted">Comparación {data.anterior} → {data.ultimo} (último mes del filtro vs anterior).{!data.anterior && ' Se requieren al menos dos meses.'}</p>}
            {lista === 'sin_ventas'
              ? <Tabla filas={data.sin_ventas} nombreCsv="productos_sin_ventas.csv" columnas={[{ k: 'producto', t: 'Producto del catálogo' }, { k: 'marca', t: 'Marca' }]} />
              : <Tabla filas={lista === 'top' ? data.productos : data[lista]} nombreCsv={`productos_${lista}.csv`} alto={520} columnas={[
                { k: 'producto', t: 'Producto', ancho: 180 }, { k: 'marca', t: 'Marca' }, { k: 'unidades', t: 'Unid.', r: true, f: (v) => num(v) },
                { k: 'ventas', t: 'Ventas', r: true, f: (v) => bs(v) }, { k: 'participacion', t: 'Part.', r: true, f: (v) => pc(v, 2) },
                { k: 'precio_promedio', t: 'Precio prom.', r: true, f: (v) => bs(v) }, { k: 'descuento', t: 'Desc. implícito', r: true, f: (v) => bs(v) },
                { k: 'ventas_ant', t: 'Mes ant.', r: true, f: (v) => bs(v, 0) }, { k: 'ventas_ult', t: 'Último mes', r: true, f: (v) => bs(v, 0) },
                { k: 'crecimiento', t: 'Var. %', r: true, f: (v) => (v === null ? '—' : <span style={{ color: v >= 0 ? 'var(--ok)' : 'var(--crit)' }}>{pc(v)}</span>) },
              ]} />}
          </Card>
        </>
      )}
    </>
  );
}
