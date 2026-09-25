// Herramientas del agente: cada una consulta el motor financiero y devuelve datos compactos.
// El agente SOLO puede responder con lo que devuelven estas herramientas (nunca con datos inventados).
import type { Db } from '../database/db.ts';
import type { Datos } from '../analytics/datos.ts';
import type { ResumenMes, V } from '../analytics/motor.ts';
import {
  analisisGastos, comparacionMeses, consolidar, inventarioPeriodo, nombrePeriodo, periodosOperacion, porDimension, porProducto, ranking,
  resumenMes, tablaMensual,
} from '../analytics/motor.ts';
import { liquidez, situacionFinanciera } from '../analytics/financiero.ts';
import { calcularAlertas } from '../analytics/alertas.ts';
import { datosFaltantes } from '../analytics/calidad.ts';
import { traza } from '../analytics/traza.ts';
import { claveTexto, similitud } from '../importers/utilidades.ts';

const EST = { type: 'string', enum: ['CBB', 'LPZ', 'TOTAL'], description: 'CBB = Cochabamba (casa matriz), LPZ = La Paz (sucursal), TOTAL = empresa consolidada' };
const PER = { type: 'string', description: 'Periodo AAAA-MM (p. ej. 2026-03)' };

export const DEFINICIONES = [
  { name: 'resumen_periodo', description: 'Indicadores de un mes para un establecimiento o el total: ventas, unidades, costo, utilidad bruta y operativa, márgenes, gastos por categoría, pagos de mercadería, caja, inventario, cobertura del mes y datos faltantes. Cada valor trae estado (ok/parcial/nd) y motivo.', input_schema: { type: 'object', properties: { periodo: PER, establecimiento: EST }, required: ['periodo', 'establecimiento'] } },
  { name: 'tabla_mensual', description: 'Serie mensual (Cochabamba, La Paz y Total) de ventas netas, utilidad bruta, gastos, utilidad operativa, márgenes y caja para un rango.', input_schema: { type: 'object', properties: { desde: PER, hasta: PER } } },
  { name: 'comparar_meses', description: 'Comparación entre meses de un establecimiento: variación absoluta y %, promedio acumulado, mejor y peor mes (excluye meses con registro parcial).', input_schema: { type: 'object', properties: { establecimiento: EST, desde: PER, hasta: PER }, required: ['establecimiento'] } },
  { name: 'ranking_productos', description: 'Ranking de productos por criterio: unidades, ventas, utilidad, margen, rotacion (velocidad de venta), crecimiento, caida.', input_schema: { type: 'object', properties: { criterio: { type: 'string', enum: ['unidades', 'ventas', 'utilidad', 'margen', 'rotacion', 'crecimiento', 'caida'] }, desde: PER, hasta: PER, establecimiento: EST, n: { type: 'number' } }, required: ['criterio'] } },
  { name: 'ventas_por_dimension', description: 'Ventas, unidades, participación y margen agrupados por marca, categoria, presentacion, tipo_pago, est (establecimiento) o periodo.', input_schema: { type: 'object', properties: { dimension: { type: 'string', enum: ['marca', 'categoria', 'presentacion', 'tipo_pago', 'est', 'periodo'] }, desde: PER, hasta: PER, establecimiento: EST }, required: ['dimension'] } },
  { name: 'buscar_producto', description: 'Busca un producto por nombre y devuelve sus ventas por mes y establecimiento, unidades, margen y precio promedio.', input_schema: { type: 'object', properties: { texto: { type: 'string' } }, required: ['texto'] } },
  { name: 'gastos', description: 'Gastos operativos por categoría y mes, participación, y los egresos individuales más grandes.', input_schema: { type: 'object', properties: { desde: PER, hasta: PER, establecimiento: EST } } },
  { name: 'situacion_financiera', description: 'Estructura de activos, pasivos y patrimonio al cierre de un mes, validación Activo = Pasivo + Patrimonio, aportes de socios e indicadores de liquidez.', input_schema: { type: 'object', properties: { periodo: PER, establecimiento: EST }, required: ['periodo', 'establecimiento'] } },
  { name: 'inventario', description: 'Control de inventario del mes (inicial, compras, transferencias, vendidas, bajas, teórico, físico, diferencia) o los datos que faltan para calcularlo.', input_schema: { type: 'object', properties: { periodo: PER, establecimiento: { type: 'string', enum: ['CBB', 'LPZ'] } }, required: ['periodo', 'establecimiento'] } },
  { name: 'alertas', description: 'Alertas críticas, advertencias y positivas según las reglas configuradas.', input_schema: { type: 'object', properties: { desde: PER, hasta: PER, establecimiento: EST } } },
  { name: 'datos_faltantes', description: 'Lista priorizada de la información que falta, qué cálculos afecta y cómo proporcionarla.', input_schema: { type: 'object', properties: {} } },
  { name: 'trazabilidad', description: 'Origen de un valor: fórmula, valor calculado y registros fuente (archivo, hoja, fila). Métricas: ventas_netas, unidades, costo_ventas, utilidad_bruta, gastos_operativos, compras_pagadas, inversion_pagada, fondo_caja, descuento_implicito.', input_schema: { type: 'object', properties: { metrica: { type: 'string' }, periodo: PER, establecimiento: EST }, required: ['metrica'] } },
];

const cv = (x: V | undefined) => (x ? (x.v === null ? { valor: null, estado: x.e, motivo: x.m } : x.e === 'ok' && !x.m ? x.v : { valor: x.v, estado: x.e, nota: x.m }) : null);

function compactarMes(r: ResumenMes) {
  return {
    periodo: r.periodo, mes: r.nombre, establecimiento: r.est, operando: r.operando, registro_parcial: r.cobertura?.parcial ?? false, nota_cobertura: (r.cobertura as any)?.motivo ?? null,
    ventas_netas: cv(r.ventas_netas), unidades: cv(r.unidades), obsequios_unidades: cv(r.obsequios), tickets: cv(r.tickets), ticket_promedio: cv(r.ticket_promedio),
    precio_promedio: cv(r.precio_promedio), descuento_implicito: cv(r.descuento_implicito), costo_ventas: cv(r.costo_ventas), cobertura_costeo_pct: cv(r.cobertura_costeo),
    utilidad_bruta: cv(r.utilidad_bruta), margen_bruto_pct: cv(r.margen_bruto), gastos_operativos: cv(r.gastos_operativos), gastos_fuente: r.gastos_fuente,
    gastos_por_categoria: r.gastos_categoria, utilidad_operativa: cv(r.utilidad_operativa), margen_operativo_pct: cv(r.margen_operativo),
    pagos_mercaderia: cv(r.compras_pagadas), inversion_pagada: cv(r.inversion_pagada), flujo_neto_registrado: cv(r.flujo_neto),
    fondo_caja: cv(r.fondo_caja), bancos: cv(r.bancos), cxc: cv(r.cxc), cxp: cv(r.cxp), inventario_final_teorico: cv(r.inv_final_teorico),
    inventario_fisico: cv(r.inv_fisico), diferencia_inventario: cv(r.inv_diferencia), ventas_por_medio_pago: r.por_medio, faltantes: r.faltantes, notas: r.notas,
  };
}

export function mesDe(d: Datos, periodo: string, est: string): ResumenMes | null {
  if (!d.periodos.includes(periodo)) return null;
  if (est === 'TOTAL') {
    const partes = d.establecimientos.map((e) => e.id).map((e) => resumenMes(d, e, periodo));
    return consolidar(partes, periodo);
  }
  return resumenMes(d, est, periodo);
}

export function ejecutarHerramienta(db: Db, d: Datos, nombre: string, input: any): unknown {
  const est = input?.establecimiento && input.establecimiento !== 'TOTAL' ? input.establecimiento : undefined;
  const f = { desde: input?.desde, hasta: input?.hasta, est };
  const noPeriodo = (p: string) => ({ error: `No hay datos para el periodo ${p}. Periodos disponibles: ${d.periodos.join(', ')}` });
  switch (nombre) {
    case 'resumen_periodo': {
      const r = mesDe(d, input.periodo, input.establecimiento ?? 'TOTAL');
      return r ? compactarMes(r) : noPeriodo(input.periodo);
    }
    case 'tabla_mensual':
      return tablaMensual(d, f).map((t) => ({
        periodo: t.periodo,
        ...Object.fromEntries(['CBB', 'LPZ', 'TOTAL'].filter((e) => t[e]).map((e) => [e, {
          ventas: cv(t[e].ventas_netas), unidades: cv(t[e].unidades), utilidad_bruta: cv(t[e].utilidad_bruta), margen_bruto: cv(t[e].margen_bruto),
          gastos: cv(t[e].gastos_operativos), utilidad_operativa: cv(t[e].utilidad_operativa), margen_operativo: cv(t[e].margen_operativo),
          pagos_mercaderia: cv(t[e].compras_pagadas), fondo_caja: cv(t[e].fondo_caja), parcial: t[e].cobertura?.parcial ?? null,
        }])),
      }));
    case 'comparar_meses': {
      const c = comparacionMeses(d, f, input.establecimiento ?? 'TOTAL');
      return { resumen: c.resumen, filas: c.filas.map((x: any) => ({ periodo: x.periodo, parcial: x.parcial, nota: x.nota, ventas: x.ventas_netas, utilidad_operativa: x.utilidad_operativa, margen_operativo: x.margen_operativo, unidades: x.unidades })) };
    }
    case 'ranking_productos': {
      const r = ranking(d, f, input.criterio, Math.min(Number(input.n) || 10, 30));
      return { ...r, filas: r.filas.map((p) => ({ producto: p.producto, marca: p.marca, unidades: p.unidades, ventas: p.ventas, utilidad: p.utilidad, margen: p.margen, velocidad_u_mes: p.velocidad, crecimiento_pct: p.crecimiento, participacion_pct: p.participacion })) };
    }
    case 'ventas_por_dimension': return porDimension(d, f, input.dimension).slice(0, 40);
    case 'buscar_producto': {
      const k = claveTexto(input.texto);
      const cands = d.productos.map((p) => ({ p, s: Math.max(similitud(k, claveTexto(p.nombre)), claveTexto(p.nombre).includes(k) ? 0.9 : 0) })).filter((x) => x.s >= 0.6).sort((a, b) => b.s - a.s).slice(0, 3);
      if (!cands.length) return { error: `No se encontró ningún producto parecido a "${input.texto}".` };
      return cands.map(({ p }) => {
        const filas = porProducto(d, { producto_id: p.id });
        const porMes = porDimension(d, { producto_id: p.id }, 'periodo').sort((a, b) => a.clave.localeCompare(b.clave));
        const porEst = porDimension(d, { producto_id: p.id }, 'est');
        return { producto: p.nombre, marca: p.marca, resumen: filas[0] ?? null, por_mes: porMes.map((x) => ({ periodo: x.clave, ventas: x.ventas, unidades: x.unidades })), por_establecimiento: porEst.map((x) => ({ est: x.clave, ventas: x.ventas, unidades: x.unidades })) };
      });
    }
    case 'gastos': {
      const g = analisisGastos(d, f);
      return { total: g.total, por_categoria: g.por_categoria, faltan_rendiciones: g.faltantes, mayores: g.mayores.slice(0, 10).map((e) => ({ est: e.est, periodo: e.periodo, descripcion: e.descripcion, categoria: e.categoria, monto: e.monto_bob, origen: `${e.hoja} fila ${e.fila}` })) };
    }
    case 'situacion_financiera': {
      if (!d.periodos.includes(input.periodo)) return noPeriodo(input.periodo);
      const s = situacionFinanciera(d, input.periodo, input.establecimiento ?? 'TOTAL');
      const l = liquidez(d, input.periodo, input.establecimiento ?? 'TOTAL');
      const lin = (x: any[]) => x.map((a) => ({ cuenta: a.cuenta, valor: cv(a.valor) }));
      return { activos: lin(s.activos), pasivos: lin(s.pasivos), patrimonio: lin(s.patrimonio), verificable: s.verificable, diferencia: s.diferencia, nota: s.nota, aportes_por_socio: s.aportes_por_socio, liquidez: l.indicadores.map((i) => ({ nombre: i.nombre, formula: i.formula, valor: cv(i.valor) })), evolucion_caja: l.serie };
    }
    case 'inventario': {
      if (!periodosOperacion(d, input.establecimiento).includes(input.periodo)) return { error: 'El establecimiento no operaba en ese periodo o no hay datos.' };
      const inv = inventarioPeriodo(d, input.establecimiento, input.periodo);
      return inv.hay ? { productos: inv.productos.slice(0, 50), faltantes: inv.faltantes.slice(0, 20) } : { disponible: false, faltantes: inv.faltantes };
    }
    case 'alertas': return calcularAlertas(db, d, f).slice(0, 25).map((a) => ({ severidad: a.severidad, titulo: a.titulo, mensaje: a.mensaje, periodo: a.periodo, est: a.est, recomendacion: a.recomendacion }));
    case 'datos_faltantes': return datosFaltantes(d).map((x) => ({ prioridad: x.prioridad, dato: x.dato, afecta: x.afecta, como: x.como }));
    case 'trazabilidad': {
      const t = traza(d, input.metrica, { periodo: input.periodo, est: input.establecimiento });
      return { formula: t.formula, valor: t.valor, estado: t.estado, motivo: t.motivo, registros: t.total_filas, suma_registros: t.suma_filas, componentes: t.componentes.slice(0, 10), ejemplos: t.filas.slice(0, 12) };
    }
    default: return { error: `Herramienta desconocida: ${nombre}` };
  }
}

export { nombrePeriodo };
