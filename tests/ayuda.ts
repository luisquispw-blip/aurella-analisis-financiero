// Entorno aislado para pruebas: carpeta de datos temporal y base de datos propia (nunca la real).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aurella-prueba-'));
process.env.DATA_DIR = dir;
process.env.ADMIN_PASSWORD = 'prueba-segura-123';
delete process.env.ANTHROPIC_API_KEY;
delete process.env.ANTHROPIC_AUTH_TOKEN;

export const { abrirDb } = await import('../database/db.ts');
export const pipeline = await import('../importers/pipeline.ts');
export const datos = await import('../analytics/datos.ts');
export const motor = await import('../analytics/motor.ts');
export const gen = await import('./fixtures/generador.ts');

export function nuevaDb() {
  return abrirDb(path.join(dir, `db-${Math.random().toString(36).slice(2)}.sqlite`), { log: () => undefined });
}

// Base con el escenario completo de prueba
export function escenario() {
  const db = nuevaDb();
  const imp = (buf: Buffer, nombre: string) => pipeline.procesarArchivo(db, buf, nombre, 'prueba', 'carga');
  imp(gen.costos(), 'COSTOS PRUEBA.xlsx');
  imp(gen.catalogo(), 'CATALOGO COCHABAMBA PRUEBA 2030.xlsx');
  imp(gen.ventasCochabamba(), 'VENTAS COCHABAMBA PRUEBA 2030.xlsx');
  imp(gen.ventasLaPaz(), 'VENTAS LA PAZ PRUEBA 2030.xlsx');
  imp(gen.gastosCochabamba(), 'GASTOS COCHABAMBA PRUEBA 2030.xlsx');
  return { db, imp, d: () => datos.cargar(db) };
}
