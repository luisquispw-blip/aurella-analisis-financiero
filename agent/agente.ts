// Agente conversacional. Si hay credenciales de la API de Anthropic usa Claude con herramientas sobre el motor
// financiero; si no, responde con el motor local de reglas. En ambos casos solo usa datos procesados.
import Anthropic from '@anthropic-ai/sdk';
import { config } from '../config/app.config.ts';
import type { Db } from '../database/db.ts';
import { cargar } from '../analytics/datos.ts';
import { nombrePeriodo } from '../analytics/motor.ts';
import { DEFINICIONES, ejecutarHerramienta } from './herramientas.ts';
import { responderLocal } from './local.ts';
import { panelPara } from './panel.ts';

export type Turno = { rol: 'usuario' | 'agente'; texto: string };

const INSTRUCCIONES = `Eres el agente de análisis financiero y económico de GJCD28 SRL (nombre comercial AURELLA), empresa boliviana de compra y venta de perfumes con casa matriz en Cochabamba (CBB) y sucursal en La Paz (LPZ, abierta el 25 de abril de 2026). Atiendes a un asesor financiero/contable. Montos en bolivianos (Bs).

Reglas obligatorias:
1. Usa EXCLUSIVAMENTE los datos que devuelven las herramientas. Si el dato no existe, no lo inventes ni lo estimes: di exactamente qué dato falta, qué cálculo afecta y pide solo ese dato (por ejemplo: "Falta el inventario físico de marzo para Cochabamba. Este dato afecta la diferencia de inventario. Por favor proporcione únicamente ese dato.").
2. Si un valor viene con estado "parcial", menciónalo y explica por qué (motivo). Si viene "nd", no lo calcules por tu cuenta.
3. Solo haz estimaciones si el usuario lo pide expresamente, y márcalas como **ESTIMACIÓN**, separadas de los datos reales.
4. No afirmes causas que los datos no demuestran; para interpretaciones usa "Los datos sugieren...".
5. Las recomendaciones deben apoyarse en datos concretos de las herramientas; nada genérico.
6. Las transferencias entre Cochabamba y La Paz no son ventas de la empresa. Los pagos de mercadería no son gastos operativos. La inversión inicial de las hojas INVERSION la aportaron los socios.
7. Los meses con registro parcial (p. ej. apertura o mes en curso) no son comparables con meses completos: adviértelo.

La interfaz muestra junto a tu respuesta un panel con tarjetas, gráfico y tabla de los indicadores principales; tu texto debe ser el análisis: presenta siempre importes en Bs y su porcentaje (participación, margen o variación %).
Formato de toda respuesta analítica (en español, concisa, con cifras formateadas "Bs 12.345,67" y porcentajes "12,5 %"):
**DATO:** ...
**INTERPRETACIÓN:** ...
**VARIACIÓN:** ... (contra el periodo anterior, cuando aplique)
**ALERTA:** ... (si existe)
**RECOMENDACIÓN:** ... (solo si se sustenta en los datos)
Incluye al final la fórmula usada cuando calcules un indicador. Si preguntan de dónde sale un valor, usa la herramienta trazabilidad y cita archivo, hoja y fila.`;

function hayCredenciales(): boolean {
  return !!(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
}

export function estadoAgente() {
  return hayCredenciales()
    ? { motor: 'claude', modelo: config.agente.modelo, descripcion: `Agente con IA (${config.agente.modelo}) conectado al motor financiero.` }
    : { motor: 'local', modelo: null, descripcion: 'Motor local de reglas (defina ANTHROPIC_API_KEY para activar el agente con IA).' };
}

let cliente: Anthropic | null = null;

async function llamar(params: any): Promise<any> {
  cliente ??= new Anthropic();
  if (config.agente.fallbacks) {
    try {
      return await cliente.beta.messages.create({ ...params, betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' } as any);
    } catch (e) {
      // si la cuenta o plataforma no admite respaldos del servidor, se reintenta sin ellos
      if (e instanceof Anthropic.BadRequestError && /fallback/i.test(e.message)) return await cliente.messages.create(params);
      throw e;
    }
  }
  return await cliente.messages.create(params);
}

async function responderClaude(db: Db, pregunta: string, historial: Turno[]) {
  const d = cargar(db);
  const sistema = `${INSTRUCCIONES}\n\nPeriodos con datos: ${d.periodos.map((p) => `${p} (${nombrePeriodo(p)})`).join(', ')}. Método de costeo: ${d.metodoValuacion ?? 'no definido'}. Fecha actual: ${new Date().toISOString().slice(0, 10)}.`;
  const mensajes: any[] = historial.filter((h) => h.texto).map((h) => ({ role: h.rol === 'usuario' ? 'user' : 'assistant', content: h.texto }));
  while (mensajes.length && mensajes[0].role !== 'user') mensajes.shift();
  mensajes.push({ role: 'user', content: pregunta });
  const usadas: string[] = [];
  for (let i = 0; i < 10; i++) {
    const r = await llamar({ model: config.agente.modelo, max_tokens: 16000, system: sistema, tools: DEFINICIONES, messages: mensajes });
    if (r.stop_reason === 'refusal') return { respuesta: 'La consulta no pudo ser procesada por el modelo. Reformúlela en términos del análisis financiero de la empresa.', motor: 'claude', herramientas: usadas };
    if (r.stop_reason === 'pause_turn') { mensajes.push({ role: 'assistant', content: r.content }); continue; }
    const usos = r.content.filter((b: any) => b.type === 'tool_use');
    if (r.stop_reason !== 'tool_use' || !usos.length) {
      const texto = r.content.filter((b: any) => b.type === 'text').map((b: any) => b.text).join('\n').trim();
      return { respuesta: texto || 'Sin respuesta.', motor: 'claude', herramientas: usadas };
    }
    mensajes.push({ role: 'assistant', content: r.content });
    const resultados = usos.map((u: any) => {
      usadas.push(u.name);
      let contenido: string, esError = false;
      try {
        contenido = JSON.stringify(ejecutarHerramienta(db, d, u.name, u.input ?? {}));
      } catch (e: any) { contenido = `Error: ${e?.message || e}`; esError = true; }
      return { type: 'tool_result', tool_use_id: u.id, content: contenido.slice(0, 60000), is_error: esError };
    });
    mensajes.push({ role: 'user', content: resultados });
  }
  return { respuesta: 'La consulta requirió demasiados pasos. Formule una pregunta más específica.', motor: 'claude', herramientas: usadas };
}

export async function preguntarAgente(db: Db, pregunta: string, historial: Turno[]) {
  const r = await responder(db, pregunta, historial);
  let panel = null;
  try { panel = panelPara(db, cargar(db), pregunta); } catch (e) { console.error('[agente] panel:', e); }
  return { ...r, panel };
}

async function responder(db: Db, pregunta: string, historial: Turno[]): Promise<{ respuesta: string; motor: string; herramientas: string[] }> {
  if (hayCredenciales()) {
    try {
      return await responderClaude(db, pregunta, historial);
    } catch (e: any) {
      console.error('[agente] error con la API, se usa el motor local:', e?.message || e);
      const r = responderLocal(db, cargar(db), pregunta);
      return { respuesta: `${r}\n\n_(Respuesta del motor local: el servicio de IA no respondió.)_`, motor: 'local', herramientas: [] };
    }
  }
  return { respuesta: responderLocal(db, cargar(db), pregunta), motor: 'local', herramientas: [] };
}
