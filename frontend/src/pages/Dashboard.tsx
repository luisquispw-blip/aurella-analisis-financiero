import { Link } from 'react-router-dom';
import { Banknote, TrendingUp, Wallet, Percent, Boxes, Landmark, HandCoins, FileWarning, Receipt, ShoppingCart } from 'lucide-react';
import Filtros from '../components/Filtros';
import { SerieEst, BarrasH } from '../components/Graficos';
import { AlertaItem, Aviso, Card, Cargando, ErrorBox, EstadoChip, Kpi } from '../components/ui';
import { useApp, useDatos } from '../lib/contexto';
import { NOMBRE_EST, mesCorto } from '../lib/formato';

export default function Dashboard() {
  const { query, filtros, usuario, meta } = useApp();
  const { data, error, cargando } = useDatos<any>(`/dashboard${query()}`);
  const est = filtros.est || 'TOTAL';
  const k = data?.kpis;
  const rango = data?.periodos?.length ? `${mesCorto(data.periodos[0])} – ${mesCorto(data.periodos.at(-1))}` : '';
  return (
    <>
      <div className="page-head">
        <div>
          <h1>Bienvenido, {usuario?.nombre?.split(' ')[0]}</h1>
          <p>Resumen de {NOMBRE_EST[est]} · {rango} · método de costeo: {meta?.metodo_valuacion === 'COSTO_ESTANDAR_PROVEEDOR' ? 'costo estándar del proveedor' : meta?.metodo_valuacion ?? 'no definido'}</p>
        </div>
        {data && <div style={{ display: 'flex', gap: 8 }}>
          <span className="chip critica">{data.conteo_alertas.critica} críticas</span>
          <span className="chip advertencia">{data.conteo_alertas.advertencia} advertencias</span>
          <span className="chip positiva">{data.conteo_alertas.positiva} positivas</span>
        </div>}
      </div>
      <Filtros />
      <ErrorBox error={error} />
      {!data && cargando && <Cargando />}
      {data && (
        <>
          <div className="kpis">
            <Kpi titulo="Ventas netas" x={k.ventas_netas} icono={<Banknote size={16} />} traza={{ metrica: 'ventas_netas' }} pie={<span>{k.unidades.v?.toLocaleString('es-BO')} unidades</span>} />
            <Kpi titulo="Utilidad bruta" x={k.utilidad_bruta} icono={<TrendingUp size={16} />} traza={{ metrica: 'utilidad_bruta' }} />
            <Kpi titulo="Utilidad operativa" x={k.utilidad_operativa} icono={<Wallet size={16} />} traza={{ metrica: 'gastos_operativos' }} pie={<span>Gastos: {k.gastos_operativos.v?.toLocaleString('es-BO', { maximumFractionDigits: 0 })} Bs</span>} />
            <Kpi titulo="Margen bruto" x={k.margen_bruto} tipo="pc" icono={<Percent size={16} />} />
            <Kpi titulo="Margen operativo" x={k.margen_operativo} tipo="pc" icono={<Percent size={16} />} />
            <Kpi titulo="Inventario (unidades)" x={k.inventario} tipo="num" icono={<Boxes size={16} />} />
            <Kpi titulo={`Caja y bancos${k.periodo_saldos ? ` · ${mesCorto(k.periodo_saldos)}` : ''}`} x={k.caja_bancos} icono={<Landmark size={16} />} traza={{ metrica: 'fondo_caja' }} />
            <Kpi titulo="Cuentas por cobrar" x={k.cxc} icono={<HandCoins size={16} />} />
            <Kpi titulo="Cuentas por pagar" x={k.cxp} icono={<Receipt size={16} />} />
            <Kpi titulo="Pagos de mercadería" x={k.compras_pagadas} icono={<ShoppingCart size={16} />} traza={{ metrica: 'compras_pagadas' }} />
          </div>

          <div className="grid g2" style={{ marginBottom: 16 }}>
            <Card titulo="Ventas por mes" sub="Cochabamba + La Paz (apilado = total empresa)"><SerieEst datos={data.serie} metrica="ventas_netas" apilado /></Card>
            <Card titulo="Utilidad operativa por mes" sub="meses sin rendición de gastos quedan vacíos"><SerieEst datos={data.serie} metrica="utilidad_operativa" /></Card>
            <Card titulo="Ventas: Cochabamba vs La Paz" sub="evolución"><SerieEst datos={data.serie} metrica="ventas_netas" tipo="lineas" /></Card>
            <Card titulo="Margen operativo %: Cochabamba vs La Paz"><SerieEst datos={data.serie} metrica="margen_operativo" tipo="lineas" formato="pc" /></Card>
          </div>

          <div className="grid g3" style={{ marginBottom: 16 }}>
            <Card titulo="Gastos operativos por categoría"><BarrasH filas={data.gastos_categoria} clave="categoria" valor="total" color="var(--series-lpz)" /></Card>
            <Card titulo="Ranking de productos" sub="por ventas netas"><BarrasH filas={data.top_productos} clave="producto" valor="ventas" /></Card>
            <Card titulo="Margen bruto por producto" sub={data.margen_productos.nota ?? ''}>
              {data.margen_productos.disponible ? <BarrasH filas={data.margen_productos.filas} clave="producto" valor="margen" formato="pc" color="var(--series-3)" /> : <Aviso tipo="warn">{data.margen_productos.motivo}</Aviso>}
            </Card>
          </div>

          <div className="grid g2">
            <Card titulo="Evolución del inventario" sub="unidades">
              {data.serie.some((s: any) => s.inv_final_teorico_TOTAL?.v !== null && s.inv_final_teorico_TOTAL?.v !== undefined)
                ? <SerieEst datos={data.serie} metrica="inv_final_teorico" formato="num" />
                : <Aviso tipo="warn">No se puede graficar: no se proporcionaron inventarios ni movimientos en unidades. <Link to="/calidad">Ver qué datos faltan →</Link></Aviso>}
              <h3 style={{ marginTop: 16 }}><FileWarning size={16} /> Datos faltantes prioritarios</h3>
              {data.faltantes.map((f: any) => <div key={f.id} className="small" style={{ padding: '6px 0', borderBottom: '1px solid var(--grid)' }}><EstadoChip e={f.prioridad} /> {f.dato}</div>)}
              <div style={{ marginTop: 10 }}><Link to="/calidad" className="small">Ver todos y proporcionar datos →</Link></div>
            </Card>
            <Card titulo="Alertas más importantes" acciones={<Link to="/alertas" className="small">Ver todas →</Link>}>
              {data.alertas.map((a: any, i: number) => <AlertaItem key={i} a={a} />)}
              {data.positivas.map((a: any, i: number) => <AlertaItem key={`p${i}`} a={a} />)}
              {!data.alertas.length && !data.positivas.length && <div className="vacio">Sin alertas</div>}
            </Card>
          </div>
        </>
      )}
    </>
  );
}
