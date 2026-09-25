import Filtros from '../components/Filtros';
import { SerieEst, BarrasH } from '../components/Graficos';
import { Aviso, Card, Cargando, ErrorBox, Tabla, BotonTraza } from '../components/ui';
import { useApp, useDatos } from '../lib/contexto';
import { bs, num, pc } from '../lib/formato';

export default function Rentabilidad() {
  const { query, meta } = useApp();
  const v = useDatos<any>(`/ventas${query()}`);
  const d = useDatos<any>(`/dashboard${query()}`);
  const prods = v.data?.productos ?? [];
  return (
    <>
      <div className="page-head"><div><h1>Costos y rentabilidad</h1>
        <p>Método de costeo: <b>{meta?.metodo_valuacion === 'COSTO_ESTANDAR_PROVEEDOR' ? 'costo estándar del proveedor por presentación (tabla COSTOS AURELLA)' : meta?.metodo_valuacion ?? 'NO DEFINIDO'}</b>. Costo de ventas = unidades × costo unitario de su presentación.</p></div></div>
      <Filtros />
      <ErrorBox error={v.error || d.error} />
      {!meta?.metodo_valuacion && <Aviso tipo="crit">No se ha definido el método de valuación del costo. Cargue la tabla de costos por presentación o indíquelo en Administración › Parámetros. Mientras tanto no se calculan costos ni utilidades.</Aviso>}
      {(!v.data || !d.data) ? <Cargando /> : (
        <>
          <div className="formula" style={{ marginBottom: 16 }}>{meta?.formulas.costo_ventas}{'\n'}{meta?.formulas.utilidad_bruta}{'\n'}{meta?.formulas.margen_bruto}{'\n'}{meta?.formulas.utilidad_operativa}{'\n'}{meta?.formulas.rentabilidad_producto}</div>
          <div className="grid g2" style={{ marginBottom: 16 }}>
            <Card titulo={<>Utilidad bruta por mes <BotonTraza metrica="costo_ventas" titulo="Costo de ventas" /></>} sub="ventas netas − costo de ventas"><SerieEst datos={d.data.serie} metrica="utilidad_bruta" /></Card>
            <Card titulo="Margen bruto % por mes"><SerieEst datos={d.data.serie} metrica="margen_bruto" tipo="lineas" formato="pc" /></Card>
          </div>
          <div className="grid g2" style={{ marginBottom: 16 }}>
            <Card titulo="Rentabilidad por presentación">
              <Tabla buscar={false} filas={v.data.por_presentacion} nombreCsv="rentabilidad_presentacion.csv" columnas={[
                { k: 'clave', t: 'Presentación' }, { k: 'unidades', t: 'Unid.', r: true, f: (x) => num(x) }, { k: 'ventas', t: 'Ventas', r: true, f: (x) => bs(x) },
                { k: 'costo', t: 'Costo', r: true, f: (x) => bs(x) }, { k: 'utilidad', t: 'Utilidad bruta', r: true, f: (x) => (x === null ? <span className="nd-txt">N/D</span> : bs(x)) },
                { k: 'margen', t: 'Margen', r: true, f: (x, f) => (x === null ? <span className="nd-txt" title={`${f.lineas_sin_costo} línea(s) sin costo`}>N/D ({f.lineas_sin_costo})</span> : pc(x)) },
              ]} />
            </Card>
            <Card titulo="Productos con mayor utilidad bruta"><BarrasH filas={[...prods].filter((p: any) => p.utilidad !== null).sort((a: any, b: any) => b.utilidad - a.utilidad)} clave="producto" valor="utilidad" color="#1baf7a" /></Card>
          </div>
          <Card titulo="Rentabilidad por producto" sub="productos con alguna venta sin costo registrado muestran N/D">
            <Tabla filas={prods} alto={560} nombreCsv="rentabilidad_productos.csv" columnas={[
              { k: 'producto', t: 'Producto', ancho: 180 }, { k: 'marca', t: 'Marca' }, { k: 'unidades', t: 'Unid.', r: true, f: (x) => num(x) },
              { k: 'ventas', t: 'Ventas netas', r: true, f: (x) => bs(x) }, { k: 'costo', t: 'Costo', r: true, f: (x) => bs(x) },
              { k: 'utilidad', t: 'Utilidad bruta', r: true, f: (x) => (x === null ? <span className="nd-txt">N/D</span> : bs(x)) },
              { k: 'margen', t: 'Margen', r: true, f: (x) => (x === null ? <span className="nd-txt">N/D</span> : pc(x)) },
              { k: 'costo_completo', t: 'Costeo', f: (x) => (x ? <span className="chip ok">completo</span> : <span className="chip parcial">parcial</span>), csv: (x) => (x ? 'completo' : 'parcial') },
            ]} />
          </Card>
        </>
      )}
    </>
  );
}
