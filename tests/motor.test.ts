import { test } from 'node:test';
import assert from 'node:assert/strict';
import { escenario, gen, motor, pipeline } from './ayuda.ts';
const { situacionFinanciera } = await import('../analytics/financiero.ts');
const { calcularAlertas } = await import('../analytics/alertas.ts');
const { datosFaltantes } = await import('../analytics/calidad.ts');
const { traza } = await import('../analytics/traza.ts');

test('ventas, descuentos, costo, utilidad bruta y márgenes', () => {
  const { d } = escenario();
  const r = motor.resumenMes(d(), 'CBB', '2030-01');
  assert.equal(r.ventas_netas.v, 794);
  assert.equal(r.unidades.v, 4); // el atomizador de obsequio no suma
  assert.equal(r.obsequios.v, 1);
  assert.equal(r.descuento_implicito.v, 60); // 2 × 280 − 500
  assert.equal(r.costo_ventas.v, 300); // 2×100 + 30 + 70
  // el atomizador de obsequio no tiene costo en la tabla: el costo queda PARCIAL y se explica, no se estima
  assert.equal(r.costo_ventas.e, 'parcial');
  assert.match(r.costo_ventas.m!, /ATOMIZADOR/);
  assert.equal(r.utilidad_bruta.v, 494);
  assert.equal(r.margen_bruto.v, 62.22);
});

test('gastos operativos excluyen compras de mercadería, inversiones y duplicados', () => {
  const { d } = escenario();
  const r = motor.resumenMes(d(), 'CBB', '2030-01');
  assert.equal(r.gastos_operativos.v, 1500);
  assert.equal(r.gastos_categoria.Alquiler, 1000);
  assert.equal(r.gastos_categoria.Sueldos, 500);
  assert.equal(r.compras_pagadas.v, 2000);
  assert.equal(r.inversion_pagada.v, 800);
  assert.equal(r.utilidad_operativa.v, -1006);
  assert.equal(r.margen_operativo.v, -126.7);
});

test('no inventa: sin rendición de gastos la utilidad operativa queda no disponible', () => {
  const { d } = escenario();
  const lpz = motor.resumenMes(d(), 'LPZ', '2030-02');
  assert.equal(lpz.ventas_netas.v, 285);
  assert.equal(lpz.utilidad_bruta.v, 195);
  assert.equal(lpz.gastos_operativos.e, 'nd');
  assert.equal(lpz.utilidad_operativa.v, null);
  const t = motor.tablaMensual(d(), {}).find((x) => x.periodo === '2030-02')!;
  assert.equal(t.TOTAL.ventas_netas.v, 565);
  assert.equal(t.TOTAL.utilidad_operativa.v, null); // el total no puede calcularse si falta La Paz
  assert.match(t.TOTAL.utilidad_operativa.m!, /LPZ/);
  const f = datosFaltantes(d());
  assert.ok(f.some((x) => x.dato === 'Rendición de gastos de La Paz de Febrero 2030'));
  assert.equal(motor.resumenMes(d(), 'LPZ', '2030-01').operando, false); // La Paz aún no operaba
});

test('inventario: mercadería disponible, teórico, diferencia y transferencias sin duplicar en el consolidado', () => {
  const { imp, d } = escenario();
  imp(gen.inventarioCsv(), 'INVENTARIO PRUEBA 2030.csv');
  const inv = motor.inventarioPeriodo(d(), 'CBB', '2030-02');
  const a = inv.productos.find((p) => /PRODUCTO A/i.test(p.producto))!;
  assert.equal(a.inicial, 10);
  assert.equal(a.t_out, 3);
  assert.equal(a.disponible, 7);
  assert.equal(a.vendidas, 1);
  assert.equal(a.teorico, 6);
  assert.equal(a.fisico, 5);
  assert.equal(a.diferencia, -1);
  const t = motor.tablaMensual(d(), {}).find((x) => x.periodo === '2030-02')!;
  assert.equal(t.TOTAL.inv_t_in.v, 0);
  assert.equal(t.TOTAL.inv_t_out.v, 0);
});

test('alertas: diferencia de inventario y transferencia sin contraparte', () => {
  const { db, imp, d } = escenario();
  imp(gen.inventarioCsv(true), 'INVENTARIO PRUEBA 2030.csv');
  const al = calcularAlertas(db, d());
  assert.ok(al.some((a) => a.codigo === 'DIFERENCIA_INVENTARIO' && a.severidad === 'critica'));
  assert.ok(al.some((a) => a.codigo === 'TRANSFERENCIA_SIN_CONTRAPARTE'));
  // umbrales configurables: desactivar la regla la elimina
  db.run(`UPDATE regla_alerta SET activo = 0 WHERE codigo = 'DIFERENCIA_INVENTARIO'`);
  assert.ok(!calcularAlertas(db, d()).some((a) => a.codigo === 'DIFERENCIA_INVENTARIO'));
});

test('situación financiera: no verificable con datos faltantes; cuadra y alerta descuadre con datos completos', () => {
  const { db, imp, d } = escenario();
  const s0 = situacionFinanciera(d(), '2030-02', 'CBB');
  assert.equal(s0.verificable, false);
  assert.ok(s0.faltantes.some((f) => f.cuenta === 'Bancos'));
  imp(gen.saldosCsv(), 'SALDOS PRUEBA 2030.csv');
  const s1 = situacionFinanciera(d(), '2030-02', 'CBB');
  // Activo: caja 100 + bancos 1974 + CxC 0 + inventario 500 + mueble 800 = 3374
  // Pasivo 200 + Patrimonio (capital 5000 + resultados -1006 -820) = 3374
  assert.equal(s1.verificable, true);
  assert.equal(s1.total_activo, 3374);
  assert.equal(s1.diferencia, 0);
  assert.ok(!calcularAlertas(db, d()).some((a) => a.codigo === 'BALANCE_DESCUADRE'));
  imp(gen.saldosCsv('2.000'), 'SALDOS v2 PRUEBA 2030.csv');
  const pend = db.get<any>(`SELECT id FROM hoja WHERE estado = 'pendiente_confirmacion'`);
  pipeline.resolverPendiente(db, pend.id, 'reemplazar', 'prueba');
  const s2 = situacionFinanciera(d(), '2030-02', 'CBB');
  assert.equal(s2.diferencia, 26);
  assert.ok(calcularAlertas(db, d()).some((a) => a.codigo === 'BALANCE_DESCUADRE' && a.severidad === 'critica'));
});

test('comparación entre meses y trazabilidad hasta archivo, hoja y fila', () => {
  const { d } = escenario();
  const c = motor.comparacionMeses(d(), {}, 'CBB');
  const feb = c.filas.find((f: any) => f.periodo === '2030-02');
  assert.equal(feb.ventas_netas.var_abs, 280 - 794);
  // los meses de prueba cubren 1-2 días: son PARCIALES y no compiten por "mejor/peor mes"
  assert.equal(c.resumen.ventas_netas.mejor, null);
  assert.deepEqual(c.resumen.ventas_netas.excluidos, ['2030-01', '2030-02']);
  const t = traza(d(), 'ventas_netas', { periodo: '2030-01', est: 'CBB' });
  assert.equal(t.valor, 794);
  assert.equal(t.suma_filas, 794);
  assert.ok(t.filas.every((f) => f.archivo.includes('VENTAS COCHABAMBA') && f.hoja === 'ENERO' && typeof f.fila === 'number'));
});

test('filtro por producto: solo hasta utilidad bruta (los gastos no se asignan a productos)', () => {
  const { d } = escenario();
  const pid = d().ventas.find((v) => /PRODUCTO A/i.test(v.producto))!.producto_id!;
  const r = motor.resumenMes(d(), 'CBB', '2030-01', { producto_id: pid });
  assert.equal(r.ventas_netas.v, 699);
  assert.equal(r.gastos_operativos.e, 'nd');
});

