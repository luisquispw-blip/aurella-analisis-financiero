import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseNumero, parseFecha, periodoDeTexto, establecimientoDeTexto, similitud, mapearColumnas, claveTexto } from '../importers/utilidades.ts';

test('números con distintos formatos monetarios', () => {
  assert.equal(parseNumero('2092,50').valor, 2092.5);
  assert.equal(parseNumero('1.234,56').valor, 1234.56);
  assert.equal(parseNumero('1,234.56').valor, 1234.56);
  assert.equal(parseNumero('1.800').valor, 1800);
  assert.equal(parseNumero('308.8').valor, 308.8);
  assert.equal(parseNumero('Bs 95').valor, 95);
  assert.equal(parseNumero('(150)').valor, -150);
  assert.equal(parseNumero(280).valor, 280);
  assert.equal(parseNumero('PENDIENTE').valor, null);
  assert.equal(parseNumero('').valor, null);
});

test('fechas: textos, dd/mm/aaaa y día/mes invertidos por Excel', () => {
  assert.equal(parseFecha('9 DE FEBRERO DE 2026').fecha, '2026-02-09');
  assert.equal(parseFecha('1ero de julio', { anio: 2026 }).fecha, '2026-07-01');
  assert.equal(parseFecha('01 de Agosto', { anio: 2026 }).fecha, '2026-08-01');
  assert.equal(parseFecha('29/03/2026').fecha, '2026-03-29');
  assert.equal(parseFecha('02/18/2026').fecha, '2026-02-18'); // mes/día detectado
  // serial Excel de 8 de enero dentro de una rendición de agosto -> 1 de agosto
  const r = parseFecha(46030, { anio: 2026, mes: 8 });
  assert.equal(r.fecha, '2026-08-01');
  assert.ok(r.corregida);
  // año digitado con error dentro del periodo
  assert.equal(parseFecha('24/07/2027', { anio: 2026, mes: 7 }).fecha, '2026-07-24');
  assert.equal(parseFecha('31/02/2025').fecha, null); // fecha imposible: no se inventa
  assert.equal(parseFecha('1 de junio').fecha, null); // sin año ni contexto
});

test('periodo y establecimiento a partir de textos', () => {
  assert.deepEqual(periodoDeTexto('(Rendicion del 1 al 31 de AGOSTO de 2026 )'), { mes: 8, anio: 2026 });
  assert.equal(periodoDeTexto('JUNE')?.mes, 6);
  assert.equal(periodoDeTexto('MAYO SF')?.mes, 5);
  assert.equal(establecimientoDeTexto('REGISTROS GASTOS CBBA A AGOSTO 2026.xlsx'), 'CBB');
  assert.equal(establecimientoDeTexto('REGISTRO VENTAS LA PAZ A AGOSTO 2026.xlsx'), 'LPZ');
  assert.equal(establecimientoDeTexto('TICKET CBBA-LAPAZ'), null); // ambiguo
});

test('detección de columnas por sinónimos', () => {
  const m = mapearColumnas([null, 'Producto', 'Cantidad Vendida', 'Precio de Venta', 'Total Venta', 'Tamaño (ml)', 'Producto + Tamaño', 'TIPO DE PAGO', null, 'TOTAL'],
    { producto: ['PRODUCTO'], cantidad: ['CANTIDAD'], precio: ['PRECIO'], total: ['TOTAL VENTA', 'TOTAL'], tamano: ['TAMANO'], tipo_pago: ['TIPO DE PAGO', 'PAGO'] });
  assert.deepEqual(m, { producto: 1, cantidad: 2, precio: 3, total: 4, tamano: 5, tipo_pago: 7 });
});

test('similitud de nombres escritos con errores', () => {
  assert.ok(similitud(claveTexto('RAPH CELESTE'), claveTexto('Ralph Celeste')) > 0.85);
  assert.ok(similitud(claveTexto('SAUVAGE'), claveTexto('SAUVAGE ELIXIR')) < 0.7);
});
