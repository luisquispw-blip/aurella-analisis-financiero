import { useState } from 'react';
import { Aviso, Card, Cargando, Tabla } from '../components/ui';
import { useApp, useDatos } from '../lib/contexto';
import { api } from '../lib/api';

function CambiarPassword() {
  const [f, setF] = useState({ actual: '', nueva: '', repetir: '' });
  const [msg, setMsg] = useState<{ t: 'ok' | 'crit'; m: string } | null>(null);
  const enviar = async (e: React.FormEvent) => {
    e.preventDefault();
    if (f.nueva !== f.repetir) return setMsg({ t: 'crit', m: 'Las contraseñas no coinciden.' });
    try { await api('/auth/cambiar-password', { method: 'POST', json: { actual: f.actual, nueva: f.nueva } }); setMsg({ t: 'ok', m: 'Contraseña actualizada.' }); setF({ actual: '', nueva: '', repetir: '' }); } catch (err: any) { setMsg({ t: 'crit', m: err.message }); }
  };
  return (
    <Card titulo="Cambiar mi contraseña">
      {msg && <Aviso tipo={msg.t}>{msg.m}</Aviso>}
      <form className="form-row" onSubmit={enviar}>
        <label>Actual<input type="password" value={f.actual} onChange={(e) => setF({ ...f, actual: e.target.value })} autoComplete="current-password" /></label>
        <label>Nueva (mín. 8)<input type="password" value={f.nueva} onChange={(e) => setF({ ...f, nueva: e.target.value })} autoComplete="new-password" /></label>
        <label>Repetir<input type="password" value={f.repetir} onChange={(e) => setF({ ...f, repetir: e.target.value })} autoComplete="new-password" /></label>
        <button className="btn primary">Guardar</button>
      </form>
    </Card>
  );
}

function Usuarios() {
  const { data, recargar } = useDatos<any[]>('/admin/usuarios');
  const [nuevo, setNuevo] = useState({ usuario: '', nombre: '', rol: 'analista' });
  const [msg, setMsg] = useState<{ t: 'ok' | 'crit' | 'info'; m: string } | null>(null);
  const crear = async (e: React.FormEvent) => {
    e.preventDefault();
    try { const r = await api<any>('/admin/usuarios', { method: 'POST', json: nuevo }); setMsg({ t: 'info', m: `Usuario creado. Contraseña temporal: ${r.password_temporal} (entréguela de forma segura; deberá cambiarla).` }); setNuevo({ usuario: '', nombre: '', rol: 'analista' }); recargar(); } catch (err: any) { setMsg({ t: 'crit', m: err.message }); }
  };
  const cambiar = async (id: number, c: any) => {
    try { const r = await api<any>(`/admin/usuarios/${id}`, { method: 'PATCH', json: c }); setMsg(r.password_temporal ? { t: 'info', m: `Nueva contraseña temporal: ${r.password_temporal}` } : { t: 'ok', m: 'Usuario actualizado.' }); recargar(); } catch (err: any) { setMsg({ t: 'crit', m: err.message }); }
  };
  return (
    <Card titulo="Usuarios y control de acceso" sub="admin: todo · analista: carga y corrige datos · lector: solo consulta">
      {msg && <Aviso tipo={msg.t}>{msg.m}</Aviso>}
      <form className="form-row" onSubmit={crear} style={{ marginBottom: 12 }}>
        <label>Usuario<input value={nuevo.usuario} onChange={(e) => setNuevo({ ...nuevo, usuario: e.target.value })} required /></label>
        <label>Nombre<input value={nuevo.nombre} onChange={(e) => setNuevo({ ...nuevo, nombre: e.target.value })} /></label>
        <label>Rol<select value={nuevo.rol} onChange={(e) => setNuevo({ ...nuevo, rol: e.target.value })}><option value="admin">Administrador</option><option value="analista">Analista</option><option value="lector">Lector</option></select></label>
        <button className="btn primary">Crear usuario</button>
      </form>
      {!data ? <Cargando /> : <Tabla buscar={false} filas={data} columnas={[
        { k: 'usuario', t: 'Usuario' }, { k: 'nombre', t: 'Nombre' },
        { k: 'rol', t: 'Rol', f: (x, f) => <select value={x} onChange={(e) => cambiar(f.id, { rol: e.target.value })}><option value="admin">Administrador</option><option value="analista">Analista</option><option value="lector">Lector</option></select> },
        { k: 'activo', t: 'Activo', f: (x, f) => <input type="checkbox" checked={!!x} onChange={(e) => cambiar(f.id, { activo: e.target.checked })} /> },
        { k: 'creado', t: 'Creado' }, { k: 'id', t: '', f: (x) => <button className="btn sm" onClick={() => cambiar(x, { reset: true })}>Restablecer contraseña</button> },
      ]} />}
    </Card>
  );
}

export default function Admin() {
  const { puede, meta, tocar } = useApp();
  const [tab, setTab] = useState('cuenta');
  const params = useDatos<any[]>(tab === 'parametros' ? '/datos/parametros' : null, [tab]);
  const saldos = useDatos<any[]>(tab === 'saldos' ? '/datos/saldos' : null, [tab]);
  const auditoria = useDatos<any[]>(tab === 'auditoria' && puede('admin') ? '/admin/auditoria' : null, [tab]);
  const [msg, setMsg] = useState<string | null>(null);
  const setParam = async (clave: string, valor: string) => {
    try { await api('/datos/parametro', { method: 'POST', json: { clave, valor } }); setMsg('Parámetro actualizado; indicadores recalculados.'); params.recargar(); tocar(); } catch (e: any) { setMsg(e.message); }
  };
  return (
    <>
      <div className="page-head"><div><h1>Administración</h1><p>Usuarios, parámetros de cálculo, saldos registrados y auditoría.</p></div></div>
      <div className="tabs">{[['cuenta', 'Mi cuenta'], ...(puede('admin') ? [['usuarios', 'Usuarios']] : []), ['parametros', 'Parámetros'], ['saldos', 'Saldos registrados'], ...(puede('admin') ? [['auditoria', 'Auditoría']] : [])].map(([k, n]) => <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{n}</button>)}</div>
      {msg && <Aviso tipo="info">{msg}</Aviso>}
      {tab === 'cuenta' && <CambiarPassword />}
      {tab === 'usuarios' && <Usuarios />}
      {tab === 'parametros' && (
        <Card titulo="Parámetros de cálculo">
          {puede('analista') && (
            <div className="form-row" style={{ marginBottom: 14 }}>
              <label>Método de valuación del costo<select value={meta?.metodo_valuacion ?? ''} onChange={(e) => setParam('metodo_valuacion', e.target.value)}>
                <option value="" disabled>— no definido —</option><option value="COSTO_ESTANDAR_PROVEEDOR">Costo estándar del proveedor (tabla de costos)</option>
                <option value="PROMEDIO_PONDERADO">Promedio ponderado (requiere compras valorizadas)</option><option value="PEPS">PEPS (requiere compras valorizadas)</option></select></label>
              <label>Corrección de presentación por precio<select value={params.data?.find((p) => p.clave === 'correccion_presentacion_por_precio')?.valor ?? '0'} onChange={(e) => setParam('correccion_presentacion_por_precio', e.target.value)}><option value="0">Desactivada</option><option value="1">Activada (confirmada por el usuario)</option></select></label>
            </div>
          )}
          {!params.data ? <Cargando /> : <Tabla buscar={false} filas={params.data} columnas={[{ k: 'clave', t: 'Parámetro' }, { k: 'valor', t: 'Valor', f: (x) => x ?? <span className="nd-txt">no definido</span> }, { k: 'descripcion', t: 'Descripción' }, { k: 'actualizado_por', t: 'Por' }, { k: 'fecha', t: 'Fecha' }]} />}
        </Card>
      )}
      {tab === 'saldos' && <Card titulo="Saldos financieros registrados (caja, bancos, CxC, CxP, capital…)">{!saldos.data ? <Cargando /> : <Tabla filas={saldos.data} nombreCsv="saldos.csv" columnas={[{ k: 'periodo', t: 'Periodo' }, { k: 'establecimiento_id', t: 'Est.' }, { k: 'concepto', t: 'Concepto' }, { k: 'monto', t: 'Monto', r: true }, { k: 'origen', t: 'Origen' }, { k: 'usuario', t: 'Usuario' }, { k: 'estado', t: 'Estado' }, { k: 'nota', t: 'Nota' }]} />}</Card>}
      {tab === 'auditoria' && <Card titulo="Auditoría (importaciones, cambios, accesos)">{!auditoria.data ? <Cargando /> : <Tabla filas={auditoria.data} alto={600} nombreCsv="auditoria.csv" columnas={[{ k: 'fecha', t: 'Fecha (UTC)' }, { k: 'usuario', t: 'Usuario' }, { k: 'accion', t: 'Acción' }, { k: 'detalle', t: 'Detalle', f: (x) => <span className="small">{x}</span> }]} />}</Card>}
    </>
  );
}
