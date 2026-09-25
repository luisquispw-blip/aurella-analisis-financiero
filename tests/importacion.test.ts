import { test } from 'node:test';
import assert from 'node:assert/strict';
import { escenario, gen, nuevaDb, pipeline, motor, datos } from './ayuda.ts';

test('importación Excel: clasificación de hojas, normalización y periodo', () => {
  const { db } = escenario();
  const hojas = db.all<any>('SELECT nombre, clasificacion, establecimiento_id, periodo, estado FROM hoja ORDER BY id');
  const por = (n: string, c: string) => hojas.find((h) => h.nombre === n && h.clasificacion === c);
  assert.ok(por('Sheet1', 'costos'));
  assert.ok(por('Inventario', 'catalogo'));
  assert.equal(por('ENERO', 'ventas_registro').periodo, '2030-01');
  assert.equal(por('FEBRERO', 'ventas_registro').estado, 'importada'); // hoja sin encabezados: hereda estructura
  assert.equal(hojas.filter((h) => h.clasificacion === 'gastos').length, 3);
  const lpz = hojas.find((h) => h.establecimiento_id === 'LPZ' && h.clasificacion === 'ventas_registro');
  assert.equal(lpz.periodo, '2030-02');
  assert.equal(db.parametro('metodo_valuacion'), 'COSTO_ESTANDAR_PROVEEDOR');
});

test('fechas invertidas por Excel se corrigen y los productos se unifican', () => {
  const { db } = escenario();
  const renta = db.get<any>(`SELECT fecha, fecha_nota FROM egreso WHERE descripcion = 'RENTA ENERO' AND fecha_texto NOT LIKE '%/%'`);
  assert.equal(renta.fecha, '2030-01-05');
  assert.match(renta.fecha_nota, /invertidos/);
  // "PRODUCTO A", "Producto  A" y el catálogo "Producto A" son el mismo producto
  const ids = db.all<any>(`SELECT DISTINCT producto_id FROM venta WHERE upper(producto_texto) LIKE 'PRODUCTO%A'`);
  assert.equal(ids.length, 1);
  const p = db.get<any>('SELECT marca FROM producto WHERE id = ?', ids[0].producto_id);
  assert.equal(p.marca, 'Marca Uno');
});

test('importación CSV (inventario y saldos) con separador ; y formato local', () => {
  const { imp, db } = escenario();
  const r1 = imp(gen.inventarioCsv(), 'INVENTARIO PRUEBA 2030.csv');
  assert.equal(r1.hojas[0].clasificacion, 'inventario');
  assert.equal(db.get<any>('SELECT COUNT(*) n FROM inventario_mov').n, 4);
  const r2 = imp(gen.saldosCsv(), 'SALDOS PRUEBA 2030.csv');
  assert.equal(r2.hojas[0].clasificacion, 'saldos');
  assert.equal(db.get<any>(`SELECT monto FROM saldo WHERE concepto = 'BANCOS'`).monto, 1974);
});

test('control de duplicados: archivo idéntico, periodo ya cargado y reemplazo con confirmación', () => {
  const { db, imp, d } = escenario();
  const dup = imp(gen.ventasCochabamba(), 'COPIA VENTAS COCHABAMBA PRUEBA 2030.xlsx');
  assert.equal(dup.estado, 'duplicado');
  // mismo periodo con contenido distinto: no se importa hasta confirmar
  const r = pipeline.procesarArchivo(db, gen.ventasCochabamba(100), 'VENTAS COCHABAMBA v2 PRUEBA 2030.xlsx', 'prueba', 'carga');
  const enero = r.hojas.find((h) => h.nombre === 'ENERO')!;
  const feb = r.hojas.find((h) => h.nombre === 'FEBRERO')!;
  assert.equal(enero.estado, 'pendiente_confirmacion');
  assert.equal(feb.estado, 'identica');
  assert.equal(motor.resumenMes(d(), 'CBB', '2030-01').ventas_netas.v, 794);
  pipeline.resolverPendiente(db, enero.hoja_id, 'reemplazar', 'prueba');
  assert.equal(motor.resumenMes(d(), 'CBB', '2030-01').ventas_netas.v, 894);
  // la información anterior se conserva (archivada), no se borra
  assert.equal(db.get<any>(`SELECT COUNT(*) n FROM hoja WHERE estado = 'reemplazada'`).n, 1);
  assert.ok(db.get<any>(`SELECT COUNT(*) n FROM venta v JOIN hoja h ON h.id = v.hoja_id WHERE h.estado = 'reemplazada'`).n > 0);
});

test('egresos duplicados entre hojas se marcan y no se suman dos veces', () => {
  const { db } = escenario();
  const dups = db.all<any>(`SELECT descripcion FROM egreso WHERE estado = 'duplicado'`);
  assert.equal(dups.length, 1);
  assert.equal(dups[0].descripcion, 'RENTA ENERO');
});

test('archivo con extensión no permitida es rechazado', () => {
  const db = nuevaDb();
  assert.throws(() => pipeline.procesarArchivo(db, Buffer.from('x'), 'malicioso.exe', 'prueba', 'carga'), /no permitido/);
});

test('flujo mensual: mismo archivo con una hoja más -> meses iguales se omiten, el mes en curso se amplía solo y el nuevo se importa', () => {
  const db = nuevaDb();
  const imp = (b: Buffer, n: string) => pipeline.procesarArchivo(db, b, n, 'prueba', 'carga');
  imp(gen.costos(), 'COSTOS PRUEBA.xlsx');
  imp(gen.ventasMensual(1), 'VENTAS COCHABAMBA A FEBRERO 2030.xlsx');
  const r = imp(gen.ventasMensual(2), 'VENTAS COCHABAMBA A MARZO 2030.xlsx');
  const est = (n: string) => r.hojas.find((h) => h.nombre === n)!.estado;
  assert.equal(est('ENERO'), 'identica');
  assert.equal(est('FEBRERO'), 'importada'); // ampliación automática, sin confirmación
  assert.equal(est('MARZO'), 'importada');
  assert.equal(r.estado === 'pendiente_confirmacion', false);
  const d = datos.cargar(db);
  assert.equal(motor.resumenMes(d, 'CBB', '2030-02').ventas_netas.v, 530);
  assert.equal(motor.resumenMes(d, 'CBB', '2030-03').ventas_netas.v, 280);
  assert.equal(motor.resumenMes(d, 'CBB', '2030-01').ventas_netas.v, 280); // sin duplicar
  // una corrección de datos ya cargados sí requiere confirmación
  const c = imp(gen.ventasMensualCorregido(), 'VENTAS COCHABAMBA CORRECCION 2030.xlsx');
  assert.equal(c.hojas[0].estado, 'pendiente_confirmacion');
  assert.equal(motor.resumenMes(datos.cargar(db), 'CBB', '2030-02').ventas_netas.v, 530);
});
