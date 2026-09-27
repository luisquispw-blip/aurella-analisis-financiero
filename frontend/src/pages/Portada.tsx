import { useEffect, useState } from 'react';
import { Lock, User, Eye, EyeOff, LogIn, ShieldCheck, Mail, MessageCircle, MapPin } from 'lucide-react';
import { api } from '../lib/api';
import { useApp } from '../lib/contexto';
import Perfume from '../components/Perfume';
import { BotonTema } from '../lib/tema';

// Portada: a la izquierda los datos y el logo del desarrollador (solo aquí), a la derecha las credenciales de acceso.
export default function Portada() {
  const { setUsuario } = useApp();
  const [info, setInfo] = useState<any>(null);
  const [usuario, setU] = useState('');
  const [password, setP] = useState('');
  const [ver, setVer] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  useEffect(() => { api('/publico/portada').then(setInfo).catch(() => undefined); }, []);

  const entrar = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setEnviando(true);
    try {
      const r = await api<{ usuario: any }>('/auth/login', { method: 'POST', json: { usuario, password } });
      setUsuario(r.usuario);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setEnviando(false);
    }
  };
  const dev = info?.desarrollador;
  return (
    <div className="portada">
      <section className="portada-dev">
        <img src={dev?.logo || '/brand/lr-sinergia.jpg'} alt="L&R Sinergia — Asesoría Contable, Tributaria y Financiera — Experto en Power BI" />
        <div className="rol">Desarrollado por</div>
        <h2>{dev?.marca || 'L&R SINERGIA'}</h2>
        {dev?.nombre && dev.nombre.toLowerCase() !== dev.marca.toLowerCase() && <div className="lema" style={{ fontWeight: 500 }}>{dev.nombre}</div>}
        <div className="lema">{dev?.lema || 'Asesoría Contable, Tributaria y Financiera'}</div>
        <div className="lema">{dev?.especialidad || 'Experto en Power BI'}</div>
        <div className="servicios">
          <span>Análisis financiero</span><span>Contabilidad y tributación</span><span>Inteligencia de negocios</span>
        </div>
        <div className="contacto-dev">
          {dev?.correo && <a href={`mailto:${dev.correo}`}><Mail size={15} /> {dev.correo}</a>}
          {dev?.whatsapp && <a href={`https://wa.me/591${dev.whatsapp.replace(/\D/g, '')}`} target="_blank" rel="noopener noreferrer"><MessageCircle size={15} /> WhatsApp {dev.whatsapp}</a>}
          {dev?.ubicacion && <span><MapPin size={15} /> {dev.ubicacion}</span>}
        </div>
        {dev?.contacto && <div className="credito">{dev.contacto}</div>}
        <div className="credito">Agente de análisis financiero y económico · © {new Date().getFullYear()}</div>
      </section>

      <section className="portada-login">
        <BotonTema />
        <form className="login-box" onSubmit={entrar}>
          <div className="login-hero">
            <Perfume ancho={120} />
            <div>
              <div className="n">AURELLA</div>
              <div className="s">{info?.empresa?.razon_social || 'GJCD28 SRL'} · PERFUMERÍA</div>
              <div className="lugares">Cochabamba · La Paz</div>
            </div>
          </div>
          <h1>Acceso al sistema</h1>
          <p className="desc">Análisis financiero y económico · Cochabamba (casa matriz) y La Paz (sucursal)</p>
          <label htmlFor="u">Usuario</label>
          <div className="campo"><User size={17} color="var(--text-3)" /><input id="u" autoComplete="username" value={usuario} onChange={(e) => setU(e.target.value)} placeholder="Ingrese su usuario" autoFocus /></div>
          <label htmlFor="p">Contraseña</label>
          <div className="campo">
            <Lock size={17} color="var(--text-3)" />
            <input id="p" type={ver ? 'text' : 'password'} autoComplete="current-password" value={password} onChange={(e) => setP(e.target.value)} placeholder="Ingrese su contraseña" />
            <button type="button" onClick={() => setVer(!ver)} style={{ border: 0, background: 'none', cursor: 'pointer', color: 'var(--text-3)' }} aria-label="Mostrar contraseña">{ver ? <EyeOff size={17} /> : <Eye size={17} />}</button>
          </div>
          {error && <div className="aviso crit error">{error}</div>}
          <button className="btn primary" disabled={enviando || !usuario || !password}><LogIn size={17} /> {enviando ? 'Verificando…' : 'Ingresar'}</button>
          <div className="pie-login">
            <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}><ShieldCheck size={14} /> Conexión protegida · sesión de 12 horas</span>
            <span>NIT {info?.empresa?.nit || ''}</span>
          </div>
        </form>
      </section>
    </div>
  );
}
