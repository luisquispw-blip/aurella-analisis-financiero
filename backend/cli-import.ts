// Uso: npm run import  -> procesa los archivos nuevos de data/entrada y muestra el resumen.
import { abrirDb } from '../database/db.ts';
import { escanearCarpeta } from '../importers/pipeline.ts';

const db = abrirDb();
const res = escanearCarpeta(db, 'cli');
if (!res.length) console.log('No hay archivos nuevos en data/entrada.');
for (const a of res) {
  console.log(`\n${a.nombre} -> ${a.estado}\n  ${a.mensaje}`);
  for (const h of a.hojas) console.log(`  - [${h.estado}] ${h.nombre}: ${h.descripcion} | ${h.establecimiento ?? '-'} ${h.periodo ?? ''} | ${h.registros} reg. | ${h.errores} err, ${h.advertencias} adv`);
}
