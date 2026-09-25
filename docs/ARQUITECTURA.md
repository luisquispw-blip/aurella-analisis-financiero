# Arquitectura y decisiones

Prioridad del diseño: **exactitud financiera > trazabilidad > calidad de datos > funcionalidad > diseño visual**.

## Tecnología

| Capa | Elección | Motivo |
|---|---|---|
| Servidor | Node.js 24 + TypeScript (ejecución directa, sin compilación) + Express 5 | Un solo lenguaje en todo el sistema; despliegue simple en Railway |
| Base de datos | SQLite integrado en Node (`node:sqlite`), archivo en volumen persistente | Sin dependencias nativas; histórico completo y auditable. El esquema es SQL estándar, portable a PostgreSQL |
| Excel / CSV | SheetJS (xlsx, xls, csv) | Lee celdas combinadas, rangos inflados y CSV con formato local |
| PDF | PDFKit | Informes con tablas y paginación |
| Frontend | React 18 + Vite + Recharts | Aplicación empresarial responsiva |
| Agente | API de Anthropic (`claude-opus-5`) con herramientas + motor local de reglas | Respuestas basadas solo en datos calculados; funciona sin clave |

## Flujo de procesamiento

1. **Detectar** archivos nuevos (`data/entrada` o carga web). Cada archivo se identifica por su **hash SHA-256**: un archivo ya procesado se reconoce y no se reimporta.
2. **Leer** todas las hojas; se recorta el rango real (algunas hojas declaran 1.048.576 filas).
3. **Perfilar**: encabezados, tipos por columna, vacíos, duplicados exactos, celdas combinadas.
4. **Clasificar** cada hoja por puntaje (registro de ventas, gastos, inversión, resumen de gastos, costos, catálogo, inventario, saldos, ventas en tabla). Si no se reconoce, se informa y el usuario indica el tipo.
5. **Normalizar** a la estructura interna (ventas, control de caja, egresos, costos, catálogo, movimientos de inventario, saldos) conservando `hoja_id + fila` de cada registro.
6. **Validar** y registrar observaciones por fila (estructura, vacíos, numéricos, fechas, conciliación contra los totales que declara el propietario).
7. **Control de duplicados**: cada hoja es un lote con clave `tipo|establecimiento|periodo|variante` y hash de contenido.
   - mismo contenido → *idéntica*, no se importa;
   - contenido distinto para un periodo ya cargado → *pendiente de confirmación*; al confirmar, el lote anterior queda *reemplazado* (no se borra).
8. **Post-proceso**: clasificación de egresos por reglas, detección de egresos duplicados, unificación de productos, invalidación de la caché del motor y recálculo de alertas.

El original se guarda intacto en `data/originales/<hash>.<ext>`.

## Modelo de datos

- **Dimensiones:** `establecimiento` (CBB, LPZ), `producto` + `producto_alias` (nombres escritos de distintas formas), periodo `AAAA-MM`, tipo de movimiento (compra, venta, transferencia entrada/salida, devolución, baja, dañado, perdido, ajuste, inventario inicial/físico).
- **Hechos:** `venta`, `control_caja` (cierres diarios, fondo de caja, totales declarados), `egreso` (clase: gasto operativo / compra de mercadería / inversión / preoperativo; nivel: detalle o resumen), `costo_referencia`, `inventario_mov`, `saldo` (caja, bancos, CxC, CxP, préstamos, capital, aportes, retiros).
- **Gestión:** `archivo`, `hoja` (lotes, perfil y mensajes), `usuario`, `auditoria`, `parametro`, `regla_alerta`, `alerta_historial`, `conversacion`.

## Reglas de cálculo

- **Costo de ventas**: unidades × costo unitario de la presentación (método *costo estándar del proveedor*, porque el archivo de costos lo define por presentación). Si el método no está definido o la presentación no tiene costo, el costo queda **parcial** o **no disponible**, nunca estimado.
- **Gastos operativos**: si un mes tiene rendición detallada se usa el detalle; si no, el resumen mensual; si no hay ninguno, *no disponible* (y la utilidad operativa no se calcula).
- **Consolidado**: suma de establecimientos que operan en el periodo. Las transferencias internas no son ventas y se anulan en el inventario consolidado. Si falta un dato en un establecimiento, el total queda *no disponible* e indica cuál falta.
- **Meses parciales** (apertura de La Paz, mes en curso) se marcan y no compiten por mejor o peor mes.
- **Inventario teórico** = inventario inicial + compras + transferencias recibidas − enviadas − vendidas − devoluciones − bajas (± ajustes); diferencia = físico − teórico.
- **Situación financiera**: Activo = Pasivo + Patrimonio solo se valida cuando existen todas las cuentas obligatorias; si falta alguna, se informa *no verificable* y qué falta. Nunca se generan ajustes automáticos.

## Seguridad

Contraseñas con scrypt y sal; sesión en cookie `HttpOnly`/`SameSite=Lax` (y `Secure` en producción) firmada con HMAC; roles *admin / analista / lector*; bloqueo tras intentos fallidos; cabeceras de seguridad (CSP, `X-Frame-Options`, `nosniff`); validación de extensión y tamaño de archivos; auditoría de accesos, importaciones y cambios. La información histórica nunca se elimina automáticamente.

## Extensibilidad

- **Más establecimientos:** agregarlos en `config/app.config.ts` (id, ciudad y palabras clave de detección).
- **Nuevas reglas de clasificación de gastos:** `config/reglas_gastos.json`.
- **Nuevos sinónimos de columnas:** `config/sinonimos_columnas.json`.
- **Nuevos tipos de archivo:** un detector + importador en `importers/` registrado en `clasificador.ts`.
- **Nuevos indicadores:** `analytics/motor.ts` (con su fórmula en `FORMULAS` y su trazabilidad en `traza.ts`).
- **Nuevas herramientas del agente:** `agent/herramientas.ts`.
