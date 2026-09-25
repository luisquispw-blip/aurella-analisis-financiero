// Datos FICTICIOS de prueba (año 2030, productos "PRODUCTO A/B"). Se generan en memoria y nunca se mezclan
// con la información real de la empresa: las pruebas usan una base de datos temporal propia.
import * as XLSX from 'xlsx';

const serial = (y: number, m: number, d: number) => Date.UTC(y, m - 1, d) / 86400000 + 25569;

function libro(hojas: Record<string, unknown[][]>): Buffer {
  const wb = XLSX.utils.book_new();
  for (const [n, filas] of Object.entries(hojas)) XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(filas), n);
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

const ENC = [null, 'Producto', 'Cantidad Vendida', 'Precio de Venta', 'Total Venta', 'Tamaño (ml)', 'Producto + Tamaño', 'TIPO DE PAGO', 'OBSERVACIONES'];

export function costos(): Buffer {
  return libro({ Sheet1: [['Articulo', 'Costo proveedor (Bs)', 'COSTO PUBLICO (Bs)'], ['Perfume 100ml', 100, 280], ['Perfume 50ml', 70, 199], ['Perfume 10ml', 30, 95]] });
}

export function catalogo(): Buffer {
  return libro({ Inventario: [[null, null], ['NOMBRE', 'CASA'], ['Producto A', 'Marca Uno'], ['Producto B', 'Marca Dos'], ['Producto C', 'Marca Uno']] });
}

// Enero: ventas 794 (500 + 95 + 199), 4 unidades, costo 300; Febrero (hoja SIN encabezados): 280, costo 100
export function ventasCochabamba(variante = 0): Buffer {
  return libro({
    ENERO: [
      ENC,
      ['1 DE ENERO DE 2030'],
      [1, 'PRODUCTO A', 2, 250, 500 + variante, 100, 'PRODUCTO A-100', 'QR', 'redes'],
      [null, 'producto b', 1, 95, 95, 10, 'producto b-10', 'EFECTIVO'],
      [null, 'ATOMIZADOR 5ML', 1, null, 0, null, 'ATOMIZADOR 5ML-'],
      ['TIPO PAGO', 'EFECTIVO', null, 95],
      [null, 'QR', null, 500],
      ['CAJA', null, null, 95],
      ['TOTAL DIA', null, null, 595],
      ['FONDO DE CAJA', null, null, 300],
      ['2 DE ENERO DE 2030'],
      [1, 'Producto  A', 1, 199, 199, 50, 'Producto A-50', 'DELIVERY'],
      ['TIPO PAGO', 'EFECTIVO', null, 0],
      ['Total ', null, null, 0],
      ['FONDO DE CAJA', null, null, 350],
    ],
    FEBRERO: [
      ['1 de febrero'],
      [1, 'PRODUCTO A', 1, 280, 280, 100, 'PRODUCTO A-100', 'QR'],
      ['TIPO PAGO', 'QR', null, 280],
      ['FONDO DE CAJA', null, null, 100],
    ],
  });
}

// La Paz, febrero: 3 × Producto B 10 ml = 285, costo 90
export function ventasLaPaz(): Buffer {
  return libro({ FEBRERO: [ENC, ['1 de febrero'], [1, 'PRODUCTO B', 3, 95, 285, 10, 'PRODUCTO B-10', 'QR'], ['FONDO DE CAJA', null, null, 50]] });
}

// Gastos Cochabamba. Enero: operativos 1.500 (renta 1.000 + sueldo 500); compra 2.000; mueble 800.
// La renta está en SF y CF con el mismo comprobante (duplicado). La fecha 05/01 viene invertida por Excel (1 de mayo).
export function gastosCochabamba(): Buffer {
  const tit = (mes: string, tipo: string) => [['AURELLA COCHABAMBA'], ['EMPRESA DE PRUEBA'], [tipo], [`(Rendicion del 1 al 31 de ${mes} de 2030 )`], ['(Expresado En Bolivianos)'],
    ['FECHA', 'PROVEEDOR', 'No.de Documento', 'DESCRIPCION', 'TOTAL PAGADO', 'SALDO']];
  return libro({
    'ENERO SF': [...tit('ENERO', 'GASTOS DE CAJA CHICA sin fact.'),
      [serial(2030, 5, 1), null, 123456, 'RENTA ENERO', 1000],
      ['15/01/2030', null, null, 'SUELDO VENDEDORA', 500],
      ['20/01/2030', null, 777777, 'PAGO PERFUMES PROVEEDOR', 2000],
      ['25/01/2030', null, null, 'MUEBLE VITRINA', 800],
      [null, null, null, 'INFLUENCER', null]],
    'ENERO CF': [...tit('ENERO', 'PAGOS CON FACTURA'), ['05/01/2030', null, 123456, 'RENTA ENERO', 1000]],
    'FEBRERO SF': [...tit('FEBRERO', 'GASTOS DE CAJA CHICA sin fact.'), ['03/02/2030', null, 222333, 'RENTA FEBRERO', 1000]],
  });
}

// CSV con separador ";" y fechas dd/mm/aaaa: inventario inicial, transferencia CBB -> LPZ y conteo físico
export function inventarioCsv(conSalidaHuerfana = false): Buffer {
  const filas = [
    'FECHA;ESTABLECIMIENTO;PRODUCTO;TAMAÑO (ML);TIPO;CANTIDAD;COSTO UNITARIO;DESTINO;ORIGEN',
    '01/02/2030;Cochabamba;PRODUCTO A;100;Inventario inicial;10;100;;',
    '05/02/2030;Cochabamba;PRODUCTO A;100;Transferencia salida;3;100;La Paz;',
    '05/02/2030;La Paz;PRODUCTO A;100;Transferencia entrada;3;100;;Cochabamba',
    '28/02/2030;Cochabamba;PRODUCTO A;100;Inventario fisico;5;100;;',
  ];
  if (conSalidaHuerfana) filas.push('10/02/2030;Cochabamba;PRODUCTO B;10;Transferencia salida;2;30;La Paz;');
  return Buffer.from(filas.join('\r\n'), 'utf8');
}

// Saldos de Cochabamba al cierre de febrero 2030 que cuadran Activo = Pasivo + Patrimonio (ver prueba)
export function saldosCsv(bancos = '1.974,00'): Buffer {
  return Buffer.from([
    'FECHA;ESTABLECIMIENTO;CONCEPTO;SALDO',
    `28/02/2030;Cochabamba;Bancos;${bancos}`,
    '28/02/2030;Cochabamba;Cuentas por cobrar;0',
    '28/02/2030;Cochabamba;Inventario valorizado;500',
    '28/02/2030;Cochabamba;Cuentas por pagar;200',
    '28/02/2030;Cochabamba;Préstamos;0',
    '28/02/2030;Cochabamba;Capital social;5000',
  ].join('\n'), 'utf8');
}

// Flujo mensual: el propietario envía cada mes el MISMO archivo con una hoja más.
// v1: ENERO completo + FEBRERO en curso (1 día). v2: ENERO igual, FEBRERO ampliado (2 días) y MARZO nuevo.
export function ventasMensual(version: 1 | 2): Buffer {
  const dia = (fecha: string, prod: string, total: number) => [[fecha], [1, prod, 1, total, total, 100, prod + '-100', 'QR'], ['FONDO DE CAJA', null, null, 100]];
  const hojas: Record<string, unknown[][]> = {
    ENERO: [ENC, ...dia('10 DE ENERO DE 2030', 'PRODUCTO A', 280)],
    FEBRERO: [ENC, ...dia('1 DE FEBRERO DE 2030', 'PRODUCTO A', 250), ...(version === 2 ? dia('2 DE FEBRERO DE 2030', 'PRODUCTO B', 280) : [])],
  };
  if (version === 2) hojas.MARZO = [ENC, ...dia('3 DE MARZO DE 2030', 'PRODUCTO A', 280)];
  return libro(hojas);
}
// Corrección: FEBRERO v3 cambia un importe ya cargado -> requiere confirmación
export function ventasMensualCorregido(): Buffer {
  return libro({ FEBRERO: [ENC, ['1 DE FEBRERO DE 2030'], [1, 'PRODUCTO A', 1, 199, 199, 100, 'PRODUCTO A-100', 'QR']] });
}
