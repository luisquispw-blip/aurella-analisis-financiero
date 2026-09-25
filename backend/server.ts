// Servidor web: API + frontend compilado (frontend/dist). Pensado para ejecutarse en Railway o localmente.
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config/app.config.ts';
import { abrirDb } from '../database/db.ts';
import { iniciarAuth } from './auth.ts';
import { crearRouter, despuesDeCambios } from './rutas.ts';
import { completarFirmas, escanearCarpeta } from '../importers/pipeline.ts';

const db = abrirDb();
iniciarAuth(db);
try { const n = completarFirmas(db); if (n) console.log(`[carga] firmas completadas para ${n} hoja(s) ya cargadas`); } catch (e) { console.error('[carga] firmas:', e); }
fs.mkdirSync(config.entradaDir, { recursive: true });

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader('Content-Security-Policy', "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; script-src 'self'; connect-src 'self'; frame-ancestors 'none'");
  next();
});
app.use(express.json({ limit: '1mb' }));
app.use('/api', crearRouter(db));
app.use('/api', (_req, res) => res.status(404).json({ error: 'Ruta no encontrada' }));

const dist = path.join(config.root, 'frontend', 'dist');
if (fs.existsSync(dist)) {
  app.use(express.static(dist, { index: false, maxAge: '1h' }));
  app.get(/^(?!\/api).*/, (_req, res) => res.sendFile(path.join(dist, 'index.html')));
} else {
  app.get('/', (_req, res) => res.send('Frontend no compilado. Ejecute: npm run build'));
}

// Detección automática de archivos nuevos en data/entrada (al iniciar y cada 2 minutos)
function escanear(origen: string) {
  try {
    const r = escanearCarpeta(db, 'sistema');
    if (r.length) {
      despuesDeCambios(db);
      for (const a of r) console.log(`[carga:${origen}] ${a.nombre} -> ${a.estado}. ${a.mensaje}`);
    }
  } catch (e) { console.error('[carga]', e); }
}
escanear('inicio');
setInterval(() => escanear('automatica'), 120_000).unref();

app.listen(config.port, () => console.log(`AURELLA - análisis financiero escuchando en http://localhost:${config.port}`));
