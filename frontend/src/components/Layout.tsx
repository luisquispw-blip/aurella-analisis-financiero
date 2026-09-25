import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard, CalendarRange, ShoppingBag, Percent, Receipt, Boxes, Landmark, GitCompareArrows, Trophy, Bell, Bot, UploadCloud,
  ShieldCheck, FileText, Package, Settings, LogOut, Menu, Search, RefreshCw,
} from 'lucide-react';
import { useApp } from '../lib/contexto';
import { api } from '../lib/api';
import AgenteFlotante from './AgenteFlotante';

const MENU: { grupo: string; items: { to: string; t: string; i: ReactNode; rol?: 'analista' | 'admin' }[] }[] = [
  { grupo: 'Análisis', items: [
    { to: '/', t: 'Dashboard', i: <LayoutDashboard size={18} /> },
    { to: '/mensual', t: 'Análisis mensual', i: <CalendarRange size={18} /> },
    { to: '/ventas', t: 'Ventas', i: <ShoppingBag size={18} /> },
    { to: '/rentabilidad', t: 'Costos y rentabilidad', i: <Percent size={18} /> },
    { to: '/gastos', t: 'Gastos', i: <Receipt size={18} /> },
    { to: '/inventario', t: 'Inventarios', i: <Boxes size={18} /> },
    { to: '/financiero', t: 'Situación y liquidez', i: <Landmark size={18} /> },
    { to: '/comparativo', t: 'Cochabamba vs La Paz', i: <GitCompareArrows size={18} /> },
    { to: '/rankings', t: 'Rankings', i: <Trophy size={18} /> },
  ] },
  { grupo: 'Agente e informes', items: [
    { to: '/alertas', t: 'Alertas', i: <Bell size={18} /> },
    { to: '/agente', t: 'Agente IA', i: <Bot size={18} /> },
    { to: '/informes', t: 'Informes', i: <FileText size={18} /> },
  ] },
  { grupo: 'Datos', items: [
    { to: '/carga', t: 'Centro de carga', i: <UploadCloud size={18} /> },
    { to: '/calidad', t: 'Calidad y faltantes', i: <ShieldCheck size={18} /> },
    { to: '/productos', t: 'Productos', i: <Package size={18} /> },
    { to: '/admin', t: 'Administración', i: <Settings size={18} /> },
  ] },
];

export default function Layout({ children }: { children: ReactNode }) {
  const { usuario, setUsuario, meta, tocar } = useApp();
  const [abierto, setAbierto] = useState(false);
  const [criticas, setCriticas] = useState(0);
  const [q, setQ] = useState('');
  const nav = useNavigate();
  const loc = useLocation();
  useEffect(() => setAbierto(false), [loc.pathname]);
  useEffect(() => { api<any[]>('/alertas').then((a) => setCriticas(a.filter((x) => x.severidad === 'critica').length)).catch(() => undefined); }, [meta?.version]);
  const salir = async () => { await api('/auth/logout', { method: 'POST' }).catch(() => undefined); setUsuario(null); nav('/'); };
  const buscar = (e: React.FormEvent) => { e.preventDefault(); if (q.trim()) nav(`/agente?q=${encodeURIComponent(q.trim())}`); };
  const iniciales = (usuario?.nombre || usuario?.usuario || '?').split(/\s+/).map((x) => x[0]).slice(0, 2).join('').toUpperCase();
  return (
    <div className="app">
      <aside className={`sidebar ${abierto ? 'open' : ''}`}>
        <div className="brand">
          <div className="brand-mark">A</div>
          <div><div className="brand-name">AURELLA</div><div className="brand-sub">GJCD28 SRL · FINANZAS</div></div>
        </div>
        <nav className="nav">
          {MENU.map((g) => (
            <div key={g.grupo}>
              <div className="nav-group">{g.grupo}</div>
              {g.items.map((it) => (
                <NavLink key={it.to} to={it.to} end={it.to === '/'}>
                  {it.i}<span>{it.t}</span>
                  {it.to === '/alertas' && criticas > 0 && <span className="badge">{criticas}</span>}
                </NavLink>
              ))}
            </div>
          ))}
        </nav>
        <div className="sidebar-foot"><button onClick={salir}><LogOut size={18} /> Cerrar sesión</button></div>
      </aside>
      {abierto && <div onClick={() => setAbierto(false)} style={{ position: 'fixed', inset: 0, zIndex: 25, background: 'rgba(0,0,0,0.3)' }} />}
      <div className="main">
        <header className="topbar">
          <button className="menu-btn" onClick={() => setAbierto(true)} aria-label="Menú"><Menu size={22} /></button>
          <form className="buscar" onSubmit={buscar}>
            <Search size={16} color="#9fb0c9" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Pregunte al agente: ¿cuánto vendimos en julio?, ¿qué información falta?…" />
          </form>
          <div className="acciones">
            <button className="btn sm btn-ghost" onClick={tocar} title="Recalcular con los datos más recientes"><RefreshCw size={14} /> Actualizar</button>
            <div className="user-box">
              <div className="avatar">{iniciales}</div>
              <div className="nombre"><div>{usuario?.nombre}</div><small>{usuario?.rol === 'admin' ? 'Administrador' : usuario?.rol === 'analista' ? 'Analista' : 'Lector'}</small></div>
            </div>
          </div>
        </header>
        <main className="content">{children}</main>
      </div>
      <AgenteFlotante />
    </div>
  );
}
