import type { HojaLeida } from './lector.ts';

export type Nivel = 'error' | 'advertencia' | 'info';
export type Mensaje = { nivel: Nivel; fila?: number; texto: string };

export type VentaNueva = {
  fila: number; establecimiento_id: string; fecha: string | null; periodo: string; ticket: string | null;
  producto_texto: string | null; tamano_ml: number | null; cantidad: number | null; precio_unitario: number | null;
  total: number; tipo_pago: string | null; observaciones: string | null; es_obsequio: number; es_devolucion: number;
  estado: 'valido' | 'observado'; nota: string | null;
};
export type ControlNuevo = { fila: number; establecimiento_id: string; fecha: string | null; periodo: string; concepto: string; monto: number; nota: string | null };
export type EgresoNuevo = {
  fila: number; establecimiento_id: string; establecimiento_archivo: string; fecha: string | null; fecha_texto: string | null;
  fecha_nota: string | null; periodo: string | null; descripcion: string; proveedor: string | null; documento: string | null;
  monto: number; moneda: string; con_factura: number | null; nivel: 'detalle' | 'resumen'; origen: 'gastos' | 'inversion' | 'resumen';
  participaciones: string | null; estado: 'valido' | 'observado'; nota: string | null;
};
export type CostoNuevo = { fila: number; clave_presentacion: string; articulo: string; categoria: string; tamano_ml: number | null; costo_unitario: number | null; precio_publico: number | null };
export type CatalogoNuevo = { fila: number; nombre: string; marca: string | null; categoria: string | null; codigo: string | null };
export type InventarioNuevo = {
  fila: number; establecimiento_id: string; fecha: string | null; periodo: string; producto_texto: string; tamano_ml: number | null;
  tipo: string; cantidad: number; costo_unitario: number | null; contraparte_id: string | null; referencia: string | null; nota: string | null;
};
export type SaldoNuevo = { fila: number; establecimiento_id: string; fecha: string | null; periodo: string; concepto: string; monto: number; tercero: string | null; nota: string | null };
export type SocioNuevo = { codigo: string; participacion: number };

export type Clasificacion =
  | 'ventas_registro' | 'ventas_tabla' | 'gastos' | 'inversion' | 'resumen_gastos' | 'costos'
  | 'catalogo' | 'inventario' | 'saldos' | 'vacia' | 'desconocida';

export const DESCRIPCION_CLASIFICACION: Record<Clasificacion, string> = {
  ventas_registro: 'Registro diario de ventas',
  ventas_tabla: 'Ventas (tabla por fila)',
  gastos: 'Gastos / egresos',
  inversion: 'Inversión inicial de socios',
  resumen_gastos: 'Resumen mensual de gastos (flujo)',
  costos: 'Tabla de costos por presentación',
  catalogo: 'Catálogo de productos',
  inventario: 'Movimientos / conteos de inventario',
  saldos: 'Saldos financieros (caja, bancos, CxC, CxP, capital...)',
  vacia: 'Hoja vacía',
  desconocida: 'No identificada',
};

export type ResultadoHoja = {
  clasificacion: Clasificacion;
  confianza: number;
  establecimiento: string | null;
  periodo: string | null; // periodo principal (o lista separada por coma si abarca varios)
  variante: string;
  fila_encabezado: number | null;
  mapeo?: Record<string, number>;
  ventas: VentaNueva[];
  control: ControlNuevo[];
  egresos: EgresoNuevo[];
  costos: CostoNuevo[];
  catalogo: CatalogoNuevo[];
  inventario: InventarioNuevo[];
  saldos: SaldoNuevo[];
  socios: SocioNuevo[];
  mensajes: Mensaje[];
};

export type ContextoLibro = {
  archivo: string;
  anioArchivo: number | null;
  estArchivo: string | null;
  hojas: HojaLeida[];
  mapeosVentas: Record<string, number>[]; // mapeos de columnas ya detectados en hojas hermanas
};

export function resultadoVacio(clasificacion: Clasificacion, confianza = 0): ResultadoHoja {
  return {
    clasificacion, confianza, establecimiento: null, periodo: null, variante: '', fila_encabezado: null,
    ventas: [], control: [], egresos: [], costos: [], catalogo: [], inventario: [], saldos: [], socios: [], mensajes: [],
  };
}

export function totalRegistros(r: ResultadoHoja): number {
  return r.ventas.length + r.egresos.length + r.costos.length + r.catalogo.length + r.inventario.length + r.saldos.length;
}
