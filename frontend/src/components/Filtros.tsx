import { FilterX } from 'lucide-react';
import { useApp } from '../lib/contexto';

type Opciones = { producto?: boolean; est?: boolean; totalEst?: boolean };

// Filtros globales: año, periodo (desde/hasta), establecimiento, producto, marca y categoría.
export default function Filtros({ producto = true, est = true }: Opciones) {
  const { meta, filtros, setFiltros, limpiarFiltros } = useApp();
  if (!meta) return null;
  const periodos = meta.periodos;
  return (
    <div className="filtros no-print">
      <label>Año
        <select value={filtros.anio} onChange={(e) => setFiltros({ anio: e.target.value })}>
          <option value="">Todos</option>
          {meta.anios.map((a) => <option key={a} value={a}>{a}</option>)}
        </select>
      </label>
      <label>Desde
        <select value={filtros.desde} onChange={(e) => setFiltros({ desde: e.target.value })}>
          <option value="">Inicio</option>
          {periodos.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
        </select>
      </label>
      <label>Hasta
        <select value={filtros.hasta} onChange={(e) => setFiltros({ hasta: e.target.value })}>
          <option value="">Último</option>
          {periodos.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
        </select>
      </label>
      {est && (
        <label>Establecimiento
          <select value={filtros.est} onChange={(e) => setFiltros({ est: e.target.value })}>
            <option value="">Total empresa</option>
            {meta.establecimientos.map((e) => <option key={e.id} value={e.id}>{e.nombre}</option>)}
          </select>
        </label>
      )}
      {producto && (
        <>
          <label>Producto
            <select value={filtros.producto_id} onChange={(e) => setFiltros({ producto_id: e.target.value })} style={{ maxWidth: 220 }}>
              <option value="">Todos</option>
              {meta.productos.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
            </select>
          </label>
          <label>Marca
            <select value={filtros.marca} onChange={(e) => setFiltros({ marca: e.target.value })} style={{ maxWidth: 190 }}>
              <option value="">Todas</option>
              {meta.marcas.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          </label>
          <label>Categoría
            <select value={filtros.categoria} onChange={(e) => setFiltros({ categoria: e.target.value })}>
              <option value="">Todas</option>
              {meta.categorias.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          </label>
        </>
      )}
      <button className="btn sm" onClick={limpiarFiltros} title="Quitar filtros"><FilterX size={14} /> Limpiar</button>
    </div>
  );
}
