import { test } from 'node:test';
import assert from 'node:assert/strict';
import { escenario } from './ayuda.ts';
const { preguntarAgente } = await import('../agent/agente.ts');
const { ejecutarHerramienta } = await import('../agent/herramientas.ts');
const { generarReporte } = await import('../reports/reportes.ts');

test('agente local responde con datos procesados y la estructura DATO / VARIACIÓN', async () => {
  const { db } = escenario();
  const r = await preguntarAgente(db, '¿Cuánto vendimos en enero en Cochabamba?', []);
  assert.equal(r.motor, 'local');
  assert.match(r.respuesta, /\*\*DATO:\*\*/);
  assert.match(r.respuesta, /794,00/);
});

test('agente: pregunta por inventario sin datos -> indica exactamente qué falta, no inventa', async () => {
  const { db } = escenario();
  const r = await preguntarAgente(db, '¿Cuánto tenemos en inventario?', []);
  assert.match(r.respuesta, /No es posible|no fue|proporcione únicamente/i);
});

test('herramientas del agente devuelven estados nd con motivo', () => {
  const { db, d } = escenario();
  const r: any = ejecutarHerramienta(db, d(), 'resumen_periodo', { periodo: '2030-02', establecimiento: 'LPZ' });
  assert.equal(r.utilidad_operativa.valor, null);
  assert.equal(r.utilidad_operativa.estado, 'nd');
  const e: any = ejecutarHerramienta(db, d(), 'resumen_periodo', { periodo: '2031-01', establecimiento: 'TOTAL' });
  assert.match(e.error, /No hay datos/);
});

test('informes: Excel, PDF y CSV del informe ejecutivo', async () => {
  const { db, d } = escenario();
  const x = await generarReporte(db, d(), 'ejecutivo', 'xlsx', {});
  assert.equal(x.buffer.subarray(0, 2).toString(), 'PK');
  const p = await generarReporte(db, d(), 'ejecutivo', 'pdf', {});
  assert.equal(p.buffer.subarray(0, 4).toString(), '%PDF');
  const c = await generarReporte(db, d(), 'mensual', 'csv', {});
  const txt = c.buffer.toString('utf8');
  assert.match(txt, /Ventas netas;794/);
  assert.match(txt, /N\/D/); // datos faltantes explícitos
});
