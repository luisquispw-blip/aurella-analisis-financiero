// Detector de intención único, usado por el texto del agente local y por el panel visual,
// para que ambos respondan siempre a la misma pregunta. El orden de las reglas importa: lo más específico primero.
import { norm } from '../importers/utilidades.ts';

export type Intencion =
  | 'faltantes' | 'traza' | 'por_que' | 'comparar_est' | 'producto_utilidad' | 'producto_margen' | 'producto_ventas'
  | 'producto_unidades' | 'producto_peor' | 'marca' | 'rotacion' | 'inventario' | 'liquidez' | 'gastos' | 'tendencia'
  | 'ventas_mes' | 'resumen' | 'desconocida';

const PRODUCTO = /PRODUCTO|PERFUME|FRAGANCIA|ARTICULO|ITEM|\bQUE (ME )?(VENDO|VENDEMOS)\b/;

export function detectarIntencion(pregunta: string): Intencion {
  const t = ` ${norm(pregunta).replace(/[¿?¡!.,;:]/g, ' ').replace(/\s+/g, ' ')} `;
  if (/FALTA|FALTANTE|QUE INFORMACION|QUE DATOS|DATOS PENDIENTES/.test(t)) return 'faltantes';
  if (/DE DONDE SALE|DE DONDE VIENE|ORIGEN|TRAZ|COMO SE CALCUL/.test(t)) return 'traza';
  if (/POR QUE|PORQUE|CAUSA|MOTIVO|RAZON|EXPLICA/.test(t) && /UTILIDAD|GANANCIA|MARGEN|VENTA|CAY|BAJ|SUBI|AUMENT/.test(t)) return 'por_que';
  if ((/COMPAR|\bVS\b|VERSUS|DIFERENCIA ENTRE/.test(t) && /COCHABAMBA|CBB|LA PAZ|LPZ|SUCURSAL|TIENDA/.test(t))
    || /(QUE|CUAL) (SUCURSAL|TIENDA|ESTABLECIMIENTO)/.test(t)) return 'comparar_est';
  if (/\bMARCAS?\b|\bCASAS? (DE PERFUME|COMERCIAL)/.test(t) && !/ROTACION/.test(t)) return 'marca';
  if (PRODUCTO.test(t) || /MAS VENDIDO|MENOS VENDIDO|MEJORES|PEORES|\bTOP\b|RANKING/.test(t)) {
    if (/ROTACION|NO SE VENDE|LENTO|MENOS SE VENDE|SE VENDEN MENOS|VENDEN MENOS|MENOS VENDIDO|MENOS VENTAS|SIN MOVIMIENTO|ESTANCAD/.test(t)) return 'rotacion';
    if (/PEOR|MENOS (UTILIDAD|GANANCIA|RENTABLE|MARGEN)|PERDIDA|CAID|CAYO|CAYER|CAEN|BAJARON|BAJAN/.test(t)) return 'producto_peor';
    if (/MARGEN|PORCENTAJE|%/.test(t)) return 'producto_margen';
    if (/UTILIDAD|GANANCIA|RENTAB|DEJA|DEJAN|CONVIENE|RINDE|BENEFICIO|GANO|GANAMOS/.test(t)) return 'producto_utilidad';
    if (/UNIDAD|CANTIDAD|PIEZA/.test(t)) return 'producto_unidades';
    if (/VEND|VENTA|FACTUR|INGRESO|MEJOR|TOP|RANKING|MAS/.test(t)) return 'producto_ventas';
  }
  if (/ROTACION|NO SE VENDE|LENTO|MENOS SE VENDE|VENDEN MENOS/.test(t)) return 'rotacion';
  if (/INVENTARIO|STOCK|EXISTENCIA|MERCADERIA DISPONIBLE/.test(t)) return 'inventario';
  if (/DINERO|DISPONIBLE|CAJA|LIQUIDEZ|EFECTIVO|BANCO|FLUJO/.test(t)) return 'liquidez';
  if (/GASTO|EGRESO|COSTO FIJO|ALQUILER|SUELDO/.test(t)) return 'gastos';
  if (/MEJOR MES|PEOR MES|TENDENCIA|EVOLUCION|HISTORIC|CADA MES|POR MES/.test(t)) return 'tendencia';
  if (/ANALIZA|RESUMEN|COMO NOS FUE|COMO ESTAMOS|COMO VA|INFORME|SITUACION|UTILIDAD|GANANCIA|MARGEN|RENTABILIDAD/.test(t)) return 'resumen';
  if (/VEND|VENTA|FACTUR|INGRESO|COBRAMOS/.test(t)) return 'ventas_mes';
  return 'desconocida';
}
