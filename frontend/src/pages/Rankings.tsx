import { useState } from 'react';
import Filtros from '../components/Filtros';
import { BarrasH } from '../components/Graficos';
import { Aviso, Card, Cargando, ErrorBox, Tabla } from '../components/ui';
import { useApp, useDatos } from '../lib/contexto';
import { bs, num, pc } from '../lib/formato';

const FORM: Record<string, 'bs' | 'pc' | 'num'> = { unidades: 'num', ventas: 'bs', utilidad: 'bs', margen: 'pc', rotacion: 'num', crecimiento: 'pc', caida: 'pc' };
const CAMPO: Record<string, string> = { unidades: 'unidades', ventas: 'ventas', utilidad: 'utilidad', margen: 'margen', rotacion: 'velocidad', crecimiento: 'crecimiento', caida: 'crecimiento' };

export default function Rankings() {
  const { query, meta } = useApp();
  const [criterio, setCriterio] = useState('ventas');
  const { data, error, cargando } = useDatos<any>(`/ranking${query({ criterio, n: 25 })}`, [criterio]);
  return (
    <>
      <div className="page-head"><div><h1>Rankings de productos</h1><p>Los rankings que requieren costos o dos meses de datos no se muestran si esa información no está disponible.</p></div></div>
      <Filtros producto={false} />
      <div className="seg" style={{ marginBottom: 14, flexWrap: 'wrap' }}>
        {Object.entries(meta?.criterios_ranking ?? {}).map(([k, n]) => <button key={k} className={criterio === k ? 'on' : ''} onClick={() => setCriterio(k)}>{n}</button>)}
      </div>
      <ErrorBox error={error} />
      {cargando && !data && <Cargando />}
      {data && (!data.disponible ? <Aviso tipo="warn">{data.titulo}: {data.motivo}</Aviso> : (
        <div className="grid g2">
          <Card titulo={data.titulo} sub={data.nota ?? ''}><BarrasH filas={data.filas} clave="producto" valor={CAMPO[criterio]} formato={FORM[criterio]} color={criterio === 'caida' ? 'var(--crit)' : criterio === 'margen' || criterio === 'utilidad' ? 'var(--series-3)' : 'var(--series-cbb)'} max={20} /></Card>
          <Card titulo="Detalle">
            <Tabla filas={data.filas} nombreCsv={`ranking_${criterio}.csv`} alto={640} columnas={[
              { k: 'producto', t: 'Producto' }, { k: 'marca', t: 'Marca' }, { k: 'unidades', t: 'Unid.', r: true, f: (v) => num(v) }, { k: 'ventas', t: 'Ventas', r: true, f: (v) => bs(v, 0) },
              { k: 'utilidad', t: 'Utilidad', r: true, f: (v) => (v === null ? 'N/D' : bs(v, 0)) }, { k: 'margen', t: 'Margen', r: true, f: (v) => (v === null ? 'N/D' : pc(v)) },
              { k: 'velocidad', t: 'u./mes', r: true, f: (v) => num(v, 1) }, { k: 'crecimiento', t: 'Var. %', r: true, f: (v) => (v === null ? '—' : pc(v)) },
            ]} />
          </Card>
        </div>
      ))}
    </>
  );
}
