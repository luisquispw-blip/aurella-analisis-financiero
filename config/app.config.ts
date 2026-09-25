// Configuración central de la aplicación. Todo valor de negocio editable vive aquí
// o en los JSON de /config (reglas de gastos, reglas de alertas, sinónimos de columnas).
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export type EstablecimientoConfig = {
  id: string;
  nombre: string;
  ciudad: string;
  tipo: 'CASA_MATRIZ' | 'SUCURSAL';
  // Palabras clave para detectar el establecimiento en nombres de archivo, títulos y descripciones.
  palabras_clave: string[];
};

const dataDir = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(ROOT, 'data');

export const config = {
  root: ROOT,
  port: Number(process.env.PORT || 3000),
  dataDir,
  entradaDir: path.join(dataDir, 'entrada'), // carpeta vigilada: los archivos del propietario se colocan aquí
  originalesDir: path.join(dataDir, 'originales'), // copia inmutable de cada archivo importado (por hash)
  dbPath: process.env.DATABASE_PATH ? path.resolve(process.env.DATABASE_PATH) : path.join(dataDir, 'aurella.sqlite'),
  maxUploadMb: 25,
  sessionSecret: process.env.SESSION_SECRET || '',
  sessionHours: 12,

  empresa: {
    id: 'GJCD28',
    razon_social: 'GJCD28 SRL',
    nombre_comercial: 'AURELLA',
    nit: '704085024',
    rubro: 'Compra y venta de perfumes',
    moneda: 'Bs',
  },

  establecimientos: [
    {
      id: 'CBB',
      nombre: 'Cochabamba',
      ciudad: 'Cochabamba',
      tipo: 'CASA_MATRIZ',
      palabras_clave: ['COCHABAMBA', 'CBBA', 'CBB'],
    },
    {
      id: 'LPZ',
      nombre: 'La Paz',
      ciudad: 'La Paz',
      tipo: 'SUCURSAL',
      palabras_clave: ['LA PAZ', 'LAPAZ', 'LPZ', 'EL ALTO'],
    },
  ] as EstablecimientoConfig[],

  // Datos del desarrollador: se muestran ÚNICAMENTE en la portada (pantalla de acceso).
  desarrollador: {
    marca: 'L&R SINERGIA',
    lema: 'Asesoría Contable, Tributaria y Financiera',
    especialidad: 'Experto en Power BI',
    nombre: process.env.DEV_NOMBRE || 'L&R Sinergia',
    cargo: process.env.DEV_CARGO || 'Desarrollador y asesor financiero',
    correo: process.env.DEV_CORREO || 'luisquispw@gmail.com',
    whatsapp: process.env.DEV_WHATSAPP || '70304578',
    ubicacion: process.env.DEV_UBICACION || 'Cochabamba - Bolivia',
    contacto: process.env.DEV_CONTACTO || '',
    logo: '/brand/lr-sinergia.jpg',
  },

  agente: {
    modelo: process.env.AGENT_MODEL || 'claude-opus-5',
    fallbacks: process.env.AGENT_FALLBACKS !== '0',
  },
};

export type AppConfig = typeof config;
