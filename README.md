# AURELLA · Agente de análisis financiero y económico

Aplicación web para **GJCD28 SRL – AURELLA** (compra y venta de perfumes; casa matriz Cochabamba, sucursal La Paz).
Carga los archivos Excel/CSV que entrega el propietario y ejecuta el ciclo completo:

**CARGAR → IDENTIFICAR → NORMALIZAR → VALIDAR → CALCULAR → ANALIZAR → COMPARAR → ALERTAR → EXPLICAR → RECOMENDAR → REPORTAR**

Principio rector: **si el dato no existe, no se inventa.** Todo indicador lleva un estado (`completo`, `parcial`, `no disponible`) con el motivo y el dato que falta; cada valor puede rastrearse hasta el archivo, la hoja y la fila de origen.

Desarrollado por **L&R Sinergia** — Asesoría Contable, Tributaria y Financiera · Experto en Power BI · luisquispw@gmail.com · WhatsApp 70304578 · Cochabamba - Bolivia.

---

## Uso local

Requisitos: **Node.js 24** o superior.

```bash
npm install
```

```bash
npm run build
```

```bash
npm start
```

Abra `http://localhost:3000`. Al primer inicio se crea el usuario `admin`: defina `ADMIN_PASSWORD` antes de iniciar, o use la contraseña temporal que aparece en la consola.

Coloque los archivos del propietario en `data/entrada/` (se detectan al iniciar y cada 2 minutos) o súbalos en **Centro de carga**.

Otros comandos:

```bash
npm test
```

```bash
npm run import
```

(`npm run import` procesa desde la terminal los archivos nuevos de `data/entrada`.)

## Publicar en Railway

1. Suba este proyecto a un repositorio de GitHub (el `.gitignore` excluye los datos reales, las bases y los Excel).
2. En Railway: **New Project → Deploy from GitHub repo**. Railway detecta el `Dockerfile` y `railway.json`.
3. **Volumen persistente**: en el servicio, *Settings → Volumes → Add volume* con *mount path* `/data`. Ahí quedan la base SQLite, los originales y la carpeta de entrada. Sin volumen, la información se pierde en cada despliegue.
4. **Variables** (ver `.env.example`): `ADMIN_USER`, `ADMIN_PASSWORD`, `SESSION_SECRET` (cadena larga aleatoria) y, opcionalmente, `ANTHROPIC_API_KEY` para activar el agente con IA (`claude-opus-5`). Sin clave, el agente usa el motor local de reglas.
5. *Settings → Networking → Generate domain*. El chequeo de salud usa `/api/publico/portada`.
6. Ingrese con el usuario administrador y suba los archivos en **Centro de carga**.

## Qué hace con los archivos actuales

| Archivo | Se interpreta como |
|---|---|
| `COSTOS AURELLA.xlsx` | Tabla de costos por presentación → método de costeo **costo estándar del proveedor** |
| `REGISTRO VENTAS … COCHABAMBA`, `… LA PAZ` | Registro diario de ventas por mes (bloques por día, tickets, cierre de caja, fondo de caja). La hoja *Inventario* es solo un catálogo (nombre y marca). *GASTOS-FLUJO* es un resumen mensual de gastos |
| `REGISTROS GASTOS CBBA`, `… LA PAZ` | Rendiciones con/sin factura por mes; hojas *INVERSION CBBA / LA PAZ* = inversión inicial aportada por los socios (51 % / 24,5 % / 24,5 %) |

Tratamientos relevantes (todos visibles en **Calidad y faltantes**):

- Fechas con día/mes invertidos por Excel se corrigen según el periodo de la rendición (y se anotan).
- Pagos de mercadería (perfumes, difusores, facturas de proveedor) **no** son gasto operativo; muebles, letreros y garantías son inversión.
- Egresos repetidos entre hojas se marcan como duplicados (no se borran) y no se suman dos veces.
- Gastos de La Paz registrados en el archivo de Cochabamba se asignan a La Paz por su descripción.
- Egresos en USD no se suman hasta registrar el tipo de cambio.
- Los "Total" diarios de las planillas excluyen DELIVERY; el sistema usa siempre el detalle línea por línea.
- Tamaños no estándar (11 ml, 101 ml…) quedan sin costo hasta que el usuario confirme la corrección sugerida por el precio.

## Estructura

```
backend/     servidor Express, autenticación, API
importers/   lectura Excel/CSV, clasificación de hojas, importadores, pipeline
validators/  detección de duplicados
analytics/   motor financiero, inventario, situación financiera, alertas, calidad, trazabilidad
agent/       agente conversacional (Claude + motor local) y sus herramientas
reports/     informes Excel / PDF / CSV
services/    productos (unificación de nombres), clasificación de egresos, seguridad
database/    esquema SQLite y acceso
config/      configuración, reglas de gastos, reglas de alertas, sinónimos de columnas
frontend/    aplicación React (src/components, src/pages)
tests/       pruebas automatizadas con datos ficticios (año 2030)
data/        entrada/ (archivos del propietario), originales/, base SQLite  ← no se versiona
docs/        arquitectura y decisiones
```

Más detalle en [docs/ARQUITECTURA.md](docs/ARQUITECTURA.md).
