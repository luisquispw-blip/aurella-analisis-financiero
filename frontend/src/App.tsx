import { lazy, Suspense } from 'react';
import { BrowserRouter, Link, Route, Routes } from 'react-router-dom';
import { AppProvider, useApp } from './lib/contexto';
import Layout from './components/Layout';
import { Aviso, Cargando, TrazaProvider } from './components/ui';
import Portada from './pages/Portada';
import Dashboard from './pages/Dashboard';

const Mensual = lazy(() => import('./pages/Mensual'));
const Ventas = lazy(() => import('./pages/Ventas'));
const Rentabilidad = lazy(() => import('./pages/Rentabilidad'));
const Gastos = lazy(() => import('./pages/Gastos'));
const Inventario = lazy(() => import('./pages/Inventario'));
const Financiero = lazy(() => import('./pages/Financiero'));
const Comparativo = lazy(() => import('./pages/Comparativo'));
const Rankings = lazy(() => import('./pages/Rankings'));
const Alertas = lazy(() => import('./pages/Alertas'));
const Agente = lazy(() => import('./pages/Agente'));
const Informes = lazy(() => import('./pages/Informes'));
const Carga = lazy(() => import('./pages/Carga'));
const Calidad = lazy(() => import('./pages/Calidad'));
const Productos = lazy(() => import('./pages/Productos'));
const Admin = lazy(() => import('./pages/Admin'));

function Rutas() {
  const { usuario, cargandoSesion, meta } = useApp();
  if (cargandoSesion) return <Cargando texto="Iniciando…" />;
  if (!usuario) return <Portada />;
  return (
    <TrazaProvider>
      <Layout>
        {usuario.debe_cambiar ? <Aviso tipo="warn">Está usando una contraseña temporal. <Link to="/admin">Cámbiela ahora →</Link></Aviso> : null}
        {meta && !meta.periodos.length && <Aviso tipo="info">Aún no hay información procesada. Cargue los archivos de la empresa en el <Link to="/carga">Centro de carga</Link>.</Aviso>}
        <Suspense fallback={<Cargando />}>
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/mensual" element={<Mensual />} />
            <Route path="/ventas" element={<Ventas />} />
            <Route path="/rentabilidad" element={<Rentabilidad />} />
            <Route path="/gastos" element={<Gastos />} />
            <Route path="/inventario" element={<Inventario />} />
            <Route path="/financiero" element={<Financiero />} />
            <Route path="/comparativo" element={<Comparativo />} />
            <Route path="/rankings" element={<Rankings />} />
            <Route path="/alertas" element={<Alertas />} />
            <Route path="/agente" element={<Agente />} />
            <Route path="/informes" element={<Informes />} />
            <Route path="/carga" element={<Carga />} />
            <Route path="/calidad" element={<Calidad />} />
            <Route path="/productos" element={<Productos />} />
            <Route path="/admin" element={<Admin />} />
            <Route path="*" element={<Dashboard />} />
          </Routes>
        </Suspense>
      </Layout>
    </TrazaProvider>
  );
}

export default function App() {
  return <BrowserRouter><AppProvider><Rutas /></AppProvider></BrowserRouter>;
}
