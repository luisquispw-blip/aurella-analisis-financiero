import { useRef, useState } from 'react';
import { UploadCloud, FolderSearch, FileSpreadsheet, Download, ChevronRight } from 'lucide-react';
import { Aviso, Card, Cargando, EstadoChip, Tabla } from '../components/ui';
import { useApp, useDatos } from '../lib/contexto';
import { api, descargar } from '../lib/api';

const TIPOS_HOJA = [['ventas_registro', 'Registro diario de ventas'], ['ventas_tabla', 'Ventas (tabla)'], ['gastos', 'Gastos'], ['inversion', 'Inversión'], ['resumen_gastos', 'Resumen de gastos'], ['costos', 'Tabla de costos'], ['catalogo', 'Catálogo de productos'], ['inventario', 'Inventario / movimientos'], ['saldos', 'Saldos financieros']];

function Detalle({ id, cerrar }: { id: number; cerrar: () => void }) {
  const { puede, tocar } = useApp();
  const { data, recargar } = useDatos<any>(`/carga/archivos/${id}`);
  const [msg, setMsg] = useState<string | null>(null);
  const [tipo, setTipo] = useState<Record<number, string>>({});
  const resolver = async (hoja: number, accion: string) => {
    try { const r = await api<any>(`/carga/hojas/${hoja}/resolver`, { method: 'POST', json: { accion, tipo: tipo[hoja] } }); setMsg(r.mensaje); recargar(); tocar(); } catch (e: any) { setMsg(e.message); }
  };
  if (!data) return <Cargando />;
  return (
    <Card titulo={<><FileSpreadsheet size={16} /> {data.nombre}</>} sub={`hash ${data.hash.slice(0, 12)}… · ${(data.tamano / 1024).toFixed(0)} KB · ${data.fecha_carga}`} acciones={<div style={{ display: 'flex', gap: 8 }}><button className="btn sm" onClick={() => descargar(`/carga/archivos/${id}/original`)}><Download size={14} /> Original</button><button className="btn sm" onClick={cerrar}>Cerrar</button></div>}>
      {msg && <Aviso tipo="info">{msg}</Aviso>}
      {data.hojas.map((h: any) => (
        <details key={h.id} className="card" style={{ marginBottom: 10, padding: '10px 14px' }} open={h.estado === 'pendiente_confirmacion' || h.estado === 'error'}>
          <summary style={{ cursor: 'pointer', display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            <b>{h.nombre}</b> <EstadoChip e={h.estado} /> <span className="chip info">{TIPOS_HOJA.find((t) => t[0] === h.clasificacion)?.[1] ?? h.clasificacion}</span>
            <span className="small muted">{h.establecimiento_id ?? ''} {h.periodo ?? ''} · {h.registros} registros · {h.filas} filas con datos · confianza {Math.round((h.confianza ?? 0) * 100)}%</span>
          </summary>
          <div style={{ marginTop: 10 }}>
            {(h.estado === 'pendiente_confirmacion' || h.estado === 'error') && puede('analista') && (
              <div className="form-row" style={{ marginBottom: 10 }}>
                {h.estado === 'error' && <label>Tipo de información<select value={tipo[h.id] ?? ''} onChange={(e) => setTipo({ ...tipo, [h.id]: e.target.value })}><option value="">(detección automática)</option>{TIPOS_HOJA.map(([k, n]) => <option key={k} value={k}>{n}</option>)}</select></label>}
                <button className="btn primary sm" onClick={() => resolver(h.id, 'reemplazar')}>{h.estado === 'error' ? 'Reprocesar' : 'Confirmar reemplazo'}</button>
                <button className="btn sm" onClick={() => resolver(h.id, 'rechazar')}>{h.estado === 'error' ? 'Descartar' : 'Conservar información anterior'}</button>
              </div>
            )}
            {h.perfil && (
              <div className="small muted" style={{ marginBottom: 8 }}>
                Encabezados en fila {h.perfil.fila_encabezado ?? '—'} · {h.perfil.columnas} columnas · {h.perfil.celdas_combinadas} celdas combinadas · {h.perfil.filas_duplicadas} filas duplicadas exactas.
                {' '}Columnas: {h.perfil.columnas_detalle.map((c: any) => `${c.letra}${c.encabezado ? ` "${c.encabezado}"` : ''} (${c.tipo_dominante}, ${c.vacios} vacíos)`).join(' · ')}
              </div>
            )}
            {h.mensajes.length > 0 && <Tabla buscar={h.mensajes.length > 8} alto={260} filas={h.mensajes} columnas={[{ k: 'nivel', t: 'Nivel', f: (x) => <EstadoChip e={x === 'advertencia' ? 'advertencia' : x === 'error' ? 'error' : 'datos'} texto={x} /> }, { k: 'fila', t: 'Fila', r: true }, { k: 'texto', t: 'Mensaje' }]} />}
          </div>
        </details>
      ))}
    </Card>
  );
}

export default function Carga() {
  const { puede, tocar } = useApp();
  const { data, recargar } = useDatos<any[]>('/carga/archivos');
  const [resultado, setResultado] = useState<any[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [trabajando, setTrabajando] = useState(false);
  const [sel, setSel] = useState<number | null>(null);
  const [arrastre, setArrastre] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const subir = async (files: FileList | null) => {
    if (!files?.length) return;
    const fd = new FormData();
    for (const f of Array.from(files)) fd.append('archivos', f);
    setTrabajando(true); setError(null);
    try { setResultado(await api<any[]>('/carga', { method: 'POST', body: fd })); recargar(); tocar(); } catch (e: any) { setError(e.message); } finally { setTrabajando(false); }
  };
  const escanear = async () => {
    setTrabajando(true); setError(null);
    try { const r = await api<any[]>('/carga/escanear', { method: 'POST' }); setResultado(r.length ? r : [{ nombre: 'Carpeta data/entrada', estado: 'procesado', mensaje: 'No hay archivos nuevos.' }]); recargar(); tocar(); } catch (e: any) { setError(e.message); } finally { setTrabajando(false); }
  };
  return (
    <>
      <div className="page-head"><div><h1>Centro de carga de información</h1><p>Excel (.xlsx, .xls) y CSV. Cada archivo se identifica por su huella (hash): un archivo ya procesado no se vuelve a importar, y un periodo ya cargado con contenido distinto requiere su confirmación antes de reemplazarse. El original se conserva sin modificaciones.</p></div></div>
      {puede('analista') ? (
        <div className="grid g2" style={{ marginBottom: 16 }}>
          <div className={`dropzone ${arrastre ? 'on' : ''}`} onClick={() => input.current?.click()} onDragOver={(e) => { e.preventDefault(); setArrastre(true); }} onDragLeave={() => setArrastre(false)} onDrop={(e) => { e.preventDefault(); setArrastre(false); subir(e.dataTransfer.files); }}>
            <UploadCloud size={36} color="var(--gold-500)" />
            <p><b>Arrastre aquí los archivos del propietario</b> o haga clic para seleccionarlos</p>
            <p className="small muted">Ventas, gastos, inversiones, costos, inventarios, saldos… en cualquier estructura. Máximo 25 MB por archivo.</p>
            <input ref={input} type="file" multiple accept=".xlsx,.xls,.xlsm,.csv" hidden onChange={(e) => subir(e.target.files)} />
          </div>
          <Card titulo="Carpeta de entrada">
            <p className="small">El sistema revisa automáticamente la carpeta <code>data/entrada</code> al iniciar y cada 2 minutos. También puede revisarla ahora:</p>
            <button className="btn primary" onClick={escanear} disabled={trabajando}><FolderSearch size={16} /> Detectar archivos nuevos</button>
            <p className="small muted" style={{ marginTop: 12 }}>Plantillas para datos que hoy faltan:</p>
            <div style={{ display: 'flex', gap: 8 }}><button className="btn sm" onClick={() => descargar('/plantillas/inventario.csv')}><Download size={14} /> Inventario</button><button className="btn sm" onClick={() => descargar('/plantillas/saldos.csv')}><Download size={14} /> Saldos</button></div>
          </Card>
        </div>
      ) : <Aviso tipo="info">Su rol es de solo lectura: puede consultar el historial de cargas.</Aviso>}
      {trabajando && <Cargando texto="Procesando: identificando, normalizando y validando…" />}
      {error && <Aviso tipo="crit">{error}</Aviso>}
      {resultado && (
        <Card titulo="Resultado del procesamiento" style={{ marginBottom: 16 }}>
          {resultado.map((r, i) => (
            <div key={i} style={{ padding: '8px 0', borderBottom: '1px solid #eef1f6' }}>
              <b>{r.nombre}</b> <EstadoChip e={r.estado} /> <span className="small">{r.mensaje}</span>
              {r.archivo_id > 0 && <button className="btn sm" style={{ marginLeft: 8 }} onClick={() => setSel(r.archivo_id)}>Ver detalle <ChevronRight size={13} /></button>}
            </div>
          ))}
        </Card>
      )}
      {sel && <div style={{ marginBottom: 16 }}><Detalle id={sel} cerrar={() => setSel(null)} /></div>}
      <Card titulo="Historial de cargas">
        {!data ? <Cargando /> : (
          <Tabla filas={data} nombreCsv="historial_cargas.csv" columnas={[
            { k: 'fecha_carga', t: 'Fecha de carga' }, { k: 'nombre', t: 'Archivo', f: (x, f) => <a href="#" onClick={(e) => { e.preventDefault(); setSel(f.id); window.scrollTo({ top: 0, behavior: 'smooth' }); }}>{x}</a> },
            { k: 'estado', t: 'Estado', f: (x) => <EstadoChip e={x} /> }, { k: 'hojas', t: 'Hojas', r: true }, { k: 'origen', t: 'Origen' }, { k: 'usuario', t: 'Usuario' },
            { k: 'tamano', t: 'Tamaño', r: true, f: (x) => `${(x / 1024).toFixed(0)} KB` }, { k: 'resumen', t: 'Resumen', f: (x) => <span className="small">{x?.mensaje ?? x?.error ?? ''}</span>, csv: (x) => x?.mensaje ?? '' },
          ]} />
        )}
      </Card>
    </>
  );
}
