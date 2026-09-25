import { useState } from 'react';
import { FileSpreadsheet, FileText, FileDown, Printer } from 'lucide-react';
import Filtros from '../components/Filtros';
import { Aviso, Card } from '../components/ui';
import { useApp } from '../lib/contexto';
import { descargar } from '../lib/api';

const DESCRIPCION: Record<string, string> = {
  ejecutivo: '16 secciones: resumen, evolución de ventas y costos, utilidades, gastos, inventarios, rentabilidad, liquidez, comparación, productos destacados y problemáticos, alertas, tendencias, recomendaciones y datos faltantes.',
  financiero: 'Análisis del último mes, gastos, situación financiera por establecimiento, aportes de socios e indicadores de liquidez.',
  inventarios: 'Control de inventario por producto (inicial, compras, transferencias, vendidas, bajas, teórico, físico, diferencia) o los datos faltantes.',
  ventas: 'Ventas por mes, establecimiento, marca, categoría, presentación, medio de pago y producto.',
  rentabilidad: 'Costo, utilidad bruta y margen por producto y por presentación.',
  comparativo: 'Cochabamba vs La Paz vs total empresa, mes a mes.',
  mensual: 'La tabla mensual obligatoria (Cochabamba / La Paz / Total) de cada periodo cargado.',
  calidad: 'Validaciones, datos faltantes, duplicados y observaciones de cada hoja importada.',
};

export default function Informes() {
  const { meta, query } = useApp();
  const [trabajando, setTrabajando] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const bajar = async (tipo: string, formato: string) => {
    setTrabajando(`${tipo}.${formato}`); setError(null);
    try { await descargar(`/reportes/${tipo}${query({ formato })}`); } catch (e: any) { setError(e.message); } finally { setTrabajando(null); }
  };
  return (
    <>
      <div className="page-head"><div><h1>Informes y exportación</h1><p>Los informes respetan los filtros seleccionados. Los valores no disponibles aparecen como N/D con su motivo; nada se estima.</p></div>
        <button className="btn" onClick={() => window.print()}><Printer size={15} /> Imprimir pantalla</button></div>
      <Filtros />
      {error && <Aviso tipo="crit">{error}</Aviso>}
      <div className="grid g2">
        {Object.entries(meta?.reportes ?? {}).map(([k, n]) => (
          <Card key={k} titulo={n}>
            <p className="small muted" style={{ minHeight: 40 }}>{DESCRIPCION[k]}</p>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button className="btn primary sm" disabled={!!trabajando} onClick={() => bajar(k, 'pdf')}><FileText size={14} /> {trabajando === `${k}.pdf` ? 'Generando…' : 'PDF'}</button>
              <button className="btn sm" disabled={!!trabajando} onClick={() => bajar(k, 'xlsx')}><FileSpreadsheet size={14} /> {trabajando === `${k}.xlsx` ? 'Generando…' : 'Excel'}</button>
              <button className="btn sm" disabled={!!trabajando} onClick={() => bajar(k, 'csv')}><FileDown size={14} /> {trabajando === `${k}.csv` ? 'Generando…' : 'CSV'}</button>
            </div>
          </Card>
        ))}
      </div>
    </>
  );
}
