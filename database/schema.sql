-- Esquema de la base histórica. Principios:
--  * Nunca se borran datos históricos: los registros se marcan (estado) y los lotes se reemplazan (hoja.estado).
--  * Cada registro conserva su trazabilidad: hoja_id + fila -> archivo original.
--  * Los datos originales (archivo) se guardan intactos en data/originales/<hash>.<ext>.
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS empresa (
  id TEXT PRIMARY KEY,
  razon_social TEXT NOT NULL,
  nombre_comercial TEXT,
  nit TEXT,
  moneda TEXT DEFAULT 'Bs'
);

CREATE TABLE IF NOT EXISTS establecimiento (
  id TEXT PRIMARY KEY,
  empresa_id TEXT NOT NULL REFERENCES empresa(id),
  nombre TEXT NOT NULL,
  ciudad TEXT,
  tipo TEXT
);

CREATE TABLE IF NOT EXISTS usuario (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  usuario TEXT NOT NULL UNIQUE,
  nombre TEXT,
  rol TEXT NOT NULL CHECK (rol IN ('admin','analista','lector')),
  hash TEXT NOT NULL,
  salt TEXT NOT NULL,
  activo INTEGER NOT NULL DEFAULT 1,
  debe_cambiar INTEGER NOT NULL DEFAULT 0,
  creado TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS auditoria (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  fecha TEXT NOT NULL DEFAULT (datetime('now')),
  usuario TEXT,
  accion TEXT NOT NULL,
  detalle TEXT
);

-- Historial de archivos cargados (identificador único = hash SHA-256 del contenido)
CREATE TABLE IF NOT EXISTS archivo (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  hash TEXT NOT NULL UNIQUE,
  nombre TEXT NOT NULL,
  extension TEXT,
  tamano INTEGER,
  ruta_original TEXT,
  origen TEXT,
  usuario TEXT,
  fecha_carga TEXT NOT NULL DEFAULT (datetime('now')),
  estado TEXT NOT NULL,
  resumen TEXT
);

-- Cada hoja (o CSV) es un lote de datos con su clave de dataset (tipo|establecimiento|periodo|variante)
CREATE TABLE IF NOT EXISTS hoja (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  archivo_id INTEGER NOT NULL REFERENCES archivo(id),
  nombre TEXT NOT NULL,
  filas INTEGER,
  columnas INTEGER,
  clasificacion TEXT,
  confianza REAL,
  establecimiento_id TEXT,
  periodo TEXT,
  variante TEXT,
  clave_dataset TEXT,
  hash_contenido TEXT,
  estado TEXT NOT NULL,
  registros INTEGER DEFAULT 0,
  reemplaza_hoja_id INTEGER,
  perfil TEXT,
  mensajes TEXT
);
CREATE INDEX IF NOT EXISTS ix_hoja_clave ON hoja(clave_dataset, estado);

CREATE TABLE IF NOT EXISTS producto (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  clave TEXT NOT NULL UNIQUE,
  nombre TEXT NOT NULL,
  marca TEXT,
  categoria TEXT,
  codigo TEXT,
  origen TEXT
);

CREATE TABLE IF NOT EXISTS producto_alias (
  alias_clave TEXT PRIMARY KEY,
  alias_texto TEXT,
  producto_id INTEGER NOT NULL REFERENCES producto(id),
  metodo TEXT,
  puntaje REAL,
  confirmado INTEGER DEFAULT 0
);

-- Tabla de costos por presentación (método de costeo: costo estándar del proveedor)
CREATE TABLE IF NOT EXISTS costo_referencia (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  hoja_id INTEGER REFERENCES hoja(id),
  fila INTEGER,
  clave_presentacion TEXT NOT NULL,
  articulo TEXT,
  categoria TEXT,
  tamano_ml INTEGER,
  costo_unitario REAL,
  precio_publico REAL
);

CREATE TABLE IF NOT EXISTS venta (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  hoja_id INTEGER NOT NULL REFERENCES hoja(id),
  fila INTEGER NOT NULL,
  establecimiento_id TEXT NOT NULL,
  fecha TEXT,
  periodo TEXT NOT NULL,
  ticket TEXT,
  producto_id INTEGER REFERENCES producto(id),
  producto_texto TEXT,
  categoria TEXT,
  tamano_ml INTEGER,
  presentacion TEXT,
  cantidad REAL,
  precio_unitario REAL,
  total REAL NOT NULL,
  tipo_pago TEXT,
  observaciones TEXT,
  es_obsequio INTEGER DEFAULT 0,
  es_devolucion INTEGER DEFAULT 0,
  estado TEXT NOT NULL DEFAULT 'valido',
  nota TEXT
);
CREATE INDEX IF NOT EXISTS ix_venta_per ON venta(periodo, establecimiento_id);
CREATE INDEX IF NOT EXISTS ix_venta_hoja ON venta(hoja_id);

-- Bloques de cierre diario de caja y totales declarados por el propietario (para conciliación)
CREATE TABLE IF NOT EXISTS control_caja (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  hoja_id INTEGER NOT NULL REFERENCES hoja(id),
  fila INTEGER,
  establecimiento_id TEXT,
  fecha TEXT,
  periodo TEXT,
  concepto TEXT NOT NULL,
  monto REAL,
  nota TEXT
);
CREATE INDEX IF NOT EXISTS ix_caja_per ON control_caja(periodo, establecimiento_id);

-- Egresos: gastos operativos, pagos de mercadería, inversiones
CREATE TABLE IF NOT EXISTS egreso (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  hoja_id INTEGER NOT NULL REFERENCES hoja(id),
  fila INTEGER,
  establecimiento_id TEXT NOT NULL,
  establecimiento_archivo TEXT,
  fecha TEXT,
  fecha_texto TEXT,
  fecha_nota TEXT,
  periodo TEXT,
  descripcion TEXT,
  proveedor TEXT,
  documento TEXT,
  monto REAL NOT NULL,
  moneda TEXT DEFAULT 'BOB',
  con_factura INTEGER,
  nivel TEXT NOT NULL DEFAULT 'detalle',
  origen TEXT NOT NULL DEFAULT 'gastos',
  clase TEXT,
  categoria TEXT,
  regla_id TEXT,
  clasificacion_manual INTEGER DEFAULT 0,
  participaciones TEXT,
  estado TEXT NOT NULL DEFAULT 'valido',
  duplicado_de INTEGER,
  nota TEXT
);
CREATE INDEX IF NOT EXISTS ix_egreso_per ON egreso(periodo, establecimiento_id);

-- Movimientos de inventario en unidades (compras, transferencias, bajas, conteos físicos...)
CREATE TABLE IF NOT EXISTS inventario_mov (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  hoja_id INTEGER REFERENCES hoja(id),
  fila INTEGER,
  establecimiento_id TEXT NOT NULL,
  fecha TEXT,
  periodo TEXT NOT NULL,
  producto_id INTEGER REFERENCES producto(id),
  producto_texto TEXT,
  tamano_ml INTEGER,
  tipo TEXT NOT NULL,
  cantidad REAL NOT NULL,
  costo_unitario REAL,
  contraparte_id TEXT,
  referencia TEXT,
  origen TEXT DEFAULT 'archivo',
  usuario TEXT,
  estado TEXT NOT NULL DEFAULT 'valido',
  nota TEXT
);
CREATE INDEX IF NOT EXISTS ix_inv_per ON inventario_mov(periodo, establecimiento_id, tipo);

-- Saldos financieros: caja, bancos, CxC, CxP, préstamos, capital, aportes, retiros
CREATE TABLE IF NOT EXISTS saldo (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  hoja_id INTEGER REFERENCES hoja(id),
  fila INTEGER,
  establecimiento_id TEXT NOT NULL,
  fecha TEXT,
  periodo TEXT NOT NULL,
  concepto TEXT NOT NULL,
  monto REAL NOT NULL,
  tercero TEXT,
  origen TEXT DEFAULT 'archivo',
  usuario TEXT,
  estado TEXT NOT NULL DEFAULT 'valido',
  nota TEXT
);
CREATE INDEX IF NOT EXISTS ix_saldo_per ON saldo(periodo, establecimiento_id, concepto);

CREATE TABLE IF NOT EXISTS socio (
  codigo TEXT PRIMARY KEY,
  nombre TEXT,
  participacion REAL,
  hoja_id INTEGER
);

CREATE TABLE IF NOT EXISTS parametro (
  clave TEXT PRIMARY KEY,
  valor TEXT,
  descripcion TEXT,
  actualizado_por TEXT,
  fecha TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS regla_alerta (
  codigo TEXT PRIMARY KEY,
  nombre TEXT NOT NULL,
  severidad TEXT NOT NULL,
  parametro TEXT,
  valor REAL,
  activo INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS alerta_historial (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  fecha_calculo TEXT NOT NULL DEFAULT (datetime('now')),
  codigo TEXT,
  severidad TEXT,
  periodo TEXT,
  establecimiento_id TEXT,
  mensaje TEXT
);

CREATE TABLE IF NOT EXISTS conversacion (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  fecha TEXT NOT NULL DEFAULT (datetime('now')),
  usuario TEXT,
  pregunta TEXT,
  respuesta TEXT,
  motor TEXT
);
