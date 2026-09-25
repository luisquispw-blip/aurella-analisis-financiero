// INFORME DE CALIDAD DE DATOS y lista de DATOS FALTANTES (qué falta, qué afecta, cómo proporcionarlo).
import type { Db } from '../database/db.ts';
import type { Datos } from './datos.ts';
import { cobertura, gastosOperativos, hayRendicion, motivoSinCosto, nombrePeriodo, periodosOperacion } from './motor.ts';
import { redondear } from '../importers/utilidades.ts';
import { situacionFinanciera } from './financiero.ts';
import { mapaPrecioPresentacion, presentacionAmbigua, sugerirPresentacion } from './datos.ts';

export type Faltante = {
  id: string; prioridad: 'alta' | 'media' | 'baja'; dato: string; afecta: string; como: string;
  formulario?: { tipo: string; [k: string]: any };
};

// Sugerencias de corrección para presentaciones ambiguas (tamaños no estándar, sin tamaño, difusor sin tipo),
// agrupadas por presentación registrada y precio cobrado. Evidencia: presentación estándar vendida a ese mismo precio.
export function sugerenciasPresentacion(d: Datos) {
  const ventasCrudas = d.ventas.map((v) => ({ presentacion: v.presentacion_original, precio_unitario: v.precio }));
  const mapa = mapaPrecioPresentacion(ventasCrudas, d.costos);
  const grupos = new Map<string, { original: string; precio: number | null; lineas: number; ejemplos: string[]; ventas: number }>();
  for (const v of d.ventas) {
    if (!v.presentacion_original || !presentacionAmbigua(v.presentacion_original)) continue;
    const k = `${v.presentacion_original}|${v.precio}`;
    const g = grupos.get(k) || grupos.set(k, { original: v.presentacion_original, precio: v.precio, lineas: 0, ejemplos: [], ventas: 0 }).get(k)!;
    g.lineas++; g.ventas += v.total;
    if (g.ejemplos.length < 3) g.ejemplos.push(`${v.hoja} fila ${v.fila} (${v.producto})`);
  }
  return [...grupos.values()].map((g) => {
    const s = sugerirPresentacion(g.original, g.precio, mapa);
    return { ...g, ventas: redondear(g.ventas), sugerida: s?.presentacion ?? null,
      evidencia: s ? `${s.confianza}% de ${s.casos} ventas a Bs ${g.precio} corresponden a ${s.presentacion}` : 'Sin evidencia suficiente: requiere corrección manual en el archivo original.' };
  }).sort((a, b) => b.lineas - a.lineas);
}

export function datosFaltantes(d: Datos): Faltante[] {
  const f: Faltante[] = [];
  const ultimo = d.periodos[d.periodos.length - 1];
  for (const e of d.establecimientos) {
    const ops = periodosOperacion(d, e.id);
    if (!ops.length) continue;
    if (!d.movimientos.some((m) => m.est === e.id)) {
      f.push({
        id: `inventario_${e.id}`, prioridad: 'alta',
        dato: `Inventario inicial (al ${nombrePeriodo(ops[0])}), compras en unidades y conteos de inventario físico mensuales de ${e.nombre}`,
        afecta: 'Control de inventarios (mercadería disponible, inventario teórico, diferencias), rotación, sobre-stock/agotamiento, valorización del inventario y situación financiera.',
        como: 'Suba un archivo con columnas: FECHA, PRODUCTO, TAMAÑO (ml), TIPO (Inventario inicial / Compra / Transferencia / Baja / Inventario físico), CANTIDAD, COSTO UNITARIO, ESTABLECIMIENTO. Puede descargar la plantilla.',
        formulario: { tipo: 'plantilla_inventario' },
      });
    }
    for (const p of ops) {
      if (!hayRendicion(d, e.id, p)) {
        f.push({
          id: `gastos_${e.id}_${p}`, prioridad: 'alta', dato: `Rendición de gastos de ${e.nombre} de ${nombrePeriodo(p)}`,
          afecta: `Gastos operativos, utilidad operativa, margen operativo y flujo de ${nombrePeriodo(p)}.`,
          como: 'Suba la rendición de gastos (con y sin factura) de ese mes.', formulario: { tipo: 'archivo' },
        });
      }
    }
    for (const [concepto, nombre, afecta] of [
      ['BANCOS', 'Saldo de bancos', 'Caja y bancos, liquidez y situación financiera (los cobros por QR se depositan en el banco).'],
      ['CXC', 'Saldo de cuentas por cobrar (0 si no hay)', 'Liquidez y situación financiera.'],
      ['CXP', 'Saldo de cuentas por pagar a proveedores (0 si no hay)', 'Liquidez, pasivos y situación financiera.'],
      ['PRESTAMO', 'Saldo de préstamos (0 si no hay)', 'Pasivos, dependencia de financiamiento y situación financiera.'],
    ] as const) {
      if (!d.saldos.some((s) => s.est === e.id && s.concepto === concepto && s.periodo === ultimo)) {
        f.push({
          id: `saldo_${concepto}_${e.id}_${ultimo}`, prioridad: concepto === 'BANCOS' ? 'alta' : 'media',
          dato: `${nombre} de ${e.nombre} al cierre de ${nombrePeriodo(ultimo)}`, afecta,
          como: 'Registre el saldo en el formulario (un solo valor por establecimiento y mes).',
          formulario: { tipo: 'saldo', concepto, est: e.id, periodo: ultimo },
        });
      }
    }
  }
  if (!d.saldos.some((s) => s.concepto === 'CAPITAL')) {
    f.push({
      id: 'capital', prioridad: 'media', dato: 'Capital social de GJCD28 SRL (según escritura) y su distribución entre socios',
      afecta: 'Patrimonio y validación Activo = Pasivo + Patrimonio. La inversión de las hojas INVERSION se muestra como aportes, pero no reemplaza al capital suscrito.',
      como: 'Registre el capital social.', formulario: { tipo: 'saldo', concepto: 'CAPITAL', est: 'CBB', periodo: d.periodos[0] },
    });
  }
  const usd = d.egresos.filter((e) => e.moneda !== 'BOB' && e.estado !== 'duplicado');
  if (usd.length && !d.tipoCambio) {
    f.push({
      id: 'tipo_cambio', prioridad: 'media', dato: `Tipo de cambio Bs/USD para ${usd.length} egreso(s) registrados en dólares (USD ${redondear(usd.reduce((a, e) => a + e.monto, 0))})`,
      afecta: 'Total de inversión, activo fijo y aportes de socios.', como: 'Indique el tipo de cambio aplicado a esas compras.',
      formulario: { tipo: 'parametro', clave: 'tipo_cambio_usd' },
    });
  }
  // Presentaciones vendidas sin costo
  const sinCosto = new Map<string, { lineas: number; unidades: number; ventas: number }>();
  for (const v of d.ventas) {
    const m = motivoSinCosto(v, d);
    if (!m || (v.total === 0 && !v.cantidad)) continue;
    const k = m;
    const x = sinCosto.get(k) || sinCosto.set(k, { lineas: 0, unidades: 0, ventas: 0 }).get(k)!;
    x.lineas++; x.unidades += v.cantidad ?? 0; x.ventas += v.total;
  }
  for (const [m, x] of sinCosto) {
    const pres = m.match(/\(([A-Z_0-9]+)\)$/)?.[1];
    if (m.startsWith('tamaño no estándar') || /SIN_TAMANO|SIN_TIPO|tarjeta de regalo/.test(m)) continue; // se trata con la sugerencia de presentaciones
    f.push({
      id: `costo_${m}`, prioridad: x.ventas > 1000 ? 'alta' : 'media',
      dato: pres === 'ATOMIZADOR' ? `Costo unitario del ATOMIZADOR entregado como obsequio (${x.lineas} entregas, ${x.unidades} u.)` : `Costo de ventas: ${m} — ${x.lineas} línea(s), ${x.unidades} u., Bs ${redondear(x.ventas)} de venta`,
      afecta: 'Costo de ventas, utilidad bruta y márgenes (se muestran como PARCIALES mientras falte este dato).',
      como: pres ? `Indique el costo unitario de la presentación ${pres}.` : 'Corrija o complete las líneas de venta indicadas (ver detalle en Calidad de datos).',
      formulario: pres ? { tipo: 'costo', presentacion: pres } : undefined,
    });
  }
  const sug = sugerenciasPresentacion(d);
  const pendientes = sug.filter((x) => d.ventas.some((v) => v.presentacion_original === x.original && v.precio === x.precio && v.presentacion === x.original));
  if (pendientes.length) {
    f.push({
      id: 'presentaciones', prioridad: 'alta',
      dato: `Confirmar la presentación real de ${pendientes.reduce((a, t) => a + t.lineas, 0)} línea(s) de venta con tamaño no estándar, sin tamaño o difusor sin tipo (Bs ${redondear(pendientes.reduce((a, t) => a + t.ventas, 0))})`,
      afecta: 'Costo de ventas, utilidad bruta y márgenes de esas líneas.',
      como: 'Revise la corrección sugerida por el precio cobrado y confírmela, o corrija el archivo original.', formulario: { tipo: 'presentaciones', sugerencias: pendientes },
    });
  }
  const gift = d.ventas.filter((v) => v.presentacion === 'GIFT_CARD');
  if (gift.length) {
    f.push({
      id: 'gift_cards', prioridad: 'baja',
      dato: `Tratamiento de ${gift.length} registro(s) de tarjetas de regalo (Bs ${redondear(gift.reduce((a, v) => a + v.total, 0))} cobrados)`,
      afecta: 'Ventas netas: una tarjeta de regalo es un anticipo de cliente; la venta se produce al canjearla. Hoy se incluyen en ventas netas tal como están registradas.',
      como: 'Indique si desea excluirlas de las ventas (se registrarían como anticipo) — requiere decisión del asesor.',
    });
  }
  const sinProd = d.ventas.filter((v) => !v.texto && v.total !== 0);
  if (sinProd.length) {
    f.push({
      id: 'ventas_sin_producto', prioridad: 'baja',
      dato: `${sinProd.length} venta(s) sin nombre de producto por Bs ${redondear(sinProd.reduce((a, v) => a + v.total, 0))} (${sinProd.slice(0, 5).map((v) => `${v.hoja} fila ${v.fila}`).join('; ')}${sinProd.length > 5 ? '…' : ''})`,
      afecta: 'Costo de ventas y rankings de productos.', como: 'Corrija el registro de ventas original indicando el producto y vuelva a cargarlo.',
    });
  }
  const orden = { alta: 0, media: 1, baja: 2 };
  return f.sort((a, b) => orden[a.prioridad] - orden[b.prioridad]);
}

export function informeCalidad(db: Db, d: Datos) {
  const archivos = db.all<any>(`SELECT estado, COUNT(*) n FROM archivo GROUP BY estado`);
  const hojas = db.all<any>(`SELECT h.id, h.nombre, h.clasificacion, h.establecimiento_id, h.periodo, h.estado, h.registros, h.mensajes, a.nombre archivo
    FROM hoja h JOIN archivo a ON a.id = h.archivo_id ORDER BY a.id, h.id`);
  const mensajes = hojas.flatMap((h) => (JSON.parse(h.mensajes || '[]') as any[]).map((m) => ({ ...m, archivo: h.archivo, hoja: h.nombre, hoja_id: h.id })));
  const cuenta = (re: RegExp, nivel?: string) => mensajes.filter((m) => re.test(m.texto) && (!nivel || m.nivel === nivel));
  const ventasObs = d.ventas.filter((v) => v.estado === 'observado');
  const secciones = [
    {
      nombre: 'Validación de estructura', pregunta: '¿Existen las columnas necesarias?',
      resultado: hojas.filter((h) => h.estado === 'error').length ? 'error' : cuenta(/sin fila de encabezados|Sin fila de encabezados/).length ? 'observado' : 'ok',
      detalle: [
        `${hojas.filter((h) => h.estado === 'importada').length} hoja(s) importadas, ${hojas.filter((h) => h.estado === 'error').length} con error de estructura, ${hojas.filter((h) => h.estado === 'omitida').length} vacías.`,
        ...cuenta(/encabezados|Faltan columnas|No se pudo identificar/).map((m) => `${m.archivo} / ${m.hoja}: ${m.texto}`),
      ],
    },
    {
      nombre: 'Validación de datos', pregunta: '¿Existen valores vacíos?',
      resultado: ventasObs.length || cuenta(/sin descripción/).length ? 'observado' : 'ok',
      detalle: [
        `${d.ventas.filter((v) => !v.texto && v.total !== 0).length} venta(s) sin producto; ${d.ventas.filter((v) => v.cantidad === null && !v.es_obsequio).length} sin cantidad; ${d.ventas.filter((v) => !v.fecha).length} sin fecha.`,
        `${d.egresos.filter((e) => e.descripcion === '(sin descripción)').length} egreso(s) sin descripción.`,
      ],
    },
    {
      nombre: 'Validación numérica', pregunta: '¿Existen valores negativos o incoherentes?',
      resultado: cuenta(/no coincide con cantidad|negativo/).length ? 'observado' : 'ok',
      detalle: [
        `${cuenta(/no coincide con cantidad/).length} línea(s) donde total ≠ cantidad × precio (se respeta el total registrado).`,
        `${d.ventas.filter((v) => v.es_devolucion).length} línea(s) con valores negativos (devoluciones).`,
        `${d.egresos.filter((e) => e.monto < 0).length} egreso(s) negativos.`,
      ],
    },
    {
      nombre: 'Validación temporal', pregunta: '¿Las fechas son válidas?',
      resultado: cuenta(/fecha inválida|fuera de la secuencia|aparece dos veces|Periodo contradictorio/).length ? 'observado' : 'ok',
      detalle: [
        `${d.egresos.filter((e) => e.fecha_nota && /invertidos/.test(e.fecha_nota)).length} fecha(s) de egresos con día/mes invertidos por Excel, corregidas según el periodo del documento.`,
        `${d.egresos.filter((e) => e.fecha_nota && /año/.test(e.fecha_nota)).length} fecha(s) con año digitado fuera del periodo, corregidas.`,
        ...cuenta(/fecha inválida|fuera de la secuencia|aparece dos veces|Periodo contradictorio/).map((m) => `${m.archivo} / ${m.hoja}${m.fila ? ` fila ${m.fila}` : ''}: ${m.texto}`),
      ],
    },
    {
      nombre: 'Validación de inventario', pregunta: '¿Los movimientos cuadran?',
      resultado: d.movimientos.length ? 'ok' : 'no_verificable',
      detalle: d.movimientos.length ? [`${d.movimientos.length} movimientos de inventario cargados.`]
        : ['No se proporcionaron inventarios ni movimientos en unidades. La hoja "Inventario" del registro de Cochabamba solo contiene el catálogo (nombre y marca).'],
    },
    (() => {
      const ult = d.periodos[d.periodos.length - 1];
      const sf = ult ? situacionFinanciera(d, ult, 'TOTAL') : null;
      return {
        nombre: 'Validación financiera', pregunta: '¿Activo = Pasivo + Patrimonio?',
        resultado: !sf || !sf.verificable ? 'no_verificable' : Math.abs(sf.diferencia ?? 0) > 1 ? 'error' : 'ok',
        detalle: !sf ? ['Sin datos.'] : sf.verificable ? [`Diferencia al cierre de ${sf.nombre}: Bs ${sf.diferencia}.`]
          : [`No verificable al cierre de ${sf.nombre}. Faltan: ${sf.faltantes.map((x) => x.cuenta).join(', ')}.`],
      };
    })(),
    {
      nombre: 'Validación de transferencias', pregunta: '¿Existe correspondencia entre salida y entrada?',
      resultado: d.movimientos.some((m) => m.tipo.startsWith('TRANSFERENCIA')) ? 'ok' : 'no_verificable',
      detalle: d.movimientos.some((m) => m.tipo.startsWith('TRANSFERENCIA')) ? ['Ver alertas de transferencias sin contraparte.'] : ['No se registraron transferencias entre Cochabamba y La Paz en los archivos.'],
    },
  ];
  // Conciliación con los totales que declara el propietario
  const conciliacion: any[] = [];
  for (const e of d.establecimientos) for (const p of periodosOperacion(d, e.id)) {
    const ventas = redondear(d.ventas.filter((v) => v.est === e.id && v.periodo === p).reduce((a, v) => a + v.total, 0));
    const dec = d.control.filter((c) => c.est === e.id && c.periodo === p && c.concepto === 'total_mes_declarado');
    const g = gastosOperativos(d, e.id, p);
    const decG = d.control.filter((c) => c.est === e.id && c.periodo === p && /total_gastos_declarado/.test(c.concepto));
    const cob = cobertura(d, e.id, p);
    conciliacion.push({
      est: e.id, periodo: p, ventas_detalle: ventas, ventas_declaradas: dec.map((c) => ({ monto: c.monto, origen: `${c.hoja} fila ${c.fila}`, diferencia: redondear(c.monto - ventas) })),
      gastos_detalle: g.total.v, gastos_fuente: g.fuente, gastos_declarados: decG.map((c) => ({ monto: c.monto, origen: `${c.hoja} fila ${c.fila}` })),
      cobertura: cob,
    });
  }
  const duplicados = d.egresos.filter((e) => e.estado === 'duplicado').map((e) => {
    const b = d.egresos.find((x) => x.id === e.duplicado_de);
    return { id: e.id, est: e.est, periodo: e.periodo, descripcion: e.descripcion, monto: e.monto, origen: `${e.archivo} / ${e.hoja} fila ${e.fila}`, conservado: b ? `${b.descripcion} — ${b.archivo} / ${b.hoja} fila ${b.fila}` : `#${e.duplicado_de}` };
  });
  const alias = db.all<any>(`SELECT a.alias_texto, a.metodo, a.puntaje, p.nombre FROM producto_alias a JOIN producto p ON p.id = a.producto_id
    WHERE a.confirmado = 0 AND a.metodo <> 'exacto' ORDER BY a.puntaje`);
  return {
    generado: new Date().toISOString(), archivos, secciones, conciliacion, duplicados, presentaciones: sugerenciasPresentacion(d),
    productos_aproximados: alias, mensajes, faltantes: datosFaltantes(d),
    resumen: {
      ventas_lineas: d.ventas.length, ventas_observadas: ventasObs.length, egresos: d.egresos.length,
      egresos_duplicados: duplicados.length, egresos_usd: d.egresos.filter((e) => e.moneda !== 'BOB').length,
      errores: mensajes.filter((m) => m.nivel === 'error').length, advertencias: mensajes.filter((m) => m.nivel === 'advertencia').length,
    },
  };
}
