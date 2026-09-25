import { useEffect, useRef, useState } from 'react';
import { Bot, Send, Loader2 } from 'lucide-react';
import { MiniMarkdown } from './ui';
import PanelAgente from './PanelAgente';
import type { Panel } from './PanelAgente';
import { api } from '../lib/api';

export type Msg = { rol: 'usuario' | 'agente'; texto: string; motor?: string; herramientas?: string[]; panel?: Panel | null };

export const SUGERENCIAS = [
  '¿Cuánto vendimos en marzo?', '¿Cuál fue el producto más rentable?', '¿Qué sucursal tuvo mayores ventas?', '¿Por qué cayó la utilidad en junio?',
  '¿Qué productos tienen baja rotación?', '¿Cuánto tenemos en inventario?', '¿Cuánto dinero tenemos disponible?', '¿Qué gastos están afectando más la utilidad?',
  'Compara Cochabamba y La Paz', 'Analiza el último mes', '¿Qué información falta?', '¿De dónde salen las ventas de julio?',
];

const CLAVE = 'aurella_chat';
const leer = (): Msg[] => { try { return JSON.parse(sessionStorage.getItem(CLAVE) || '[]'); } catch { return []; } };

// Conversación compartida entre la página del agente y el botón flotante (misma sesión del navegador)
export default function ChatAgente({ compacto = false, preguntaInicial, alConsumir }: { compacto?: boolean; preguntaInicial?: string | null; alConsumir?: () => void }) {
  const [msgs, setMsgs] = useState<Msg[]>(leer);
  const [texto, setTexto] = useState('');
  const [enviando, setEnviando] = useState(false);
  const fin = useRef<HTMLDivElement>(null);
  useEffect(() => {
    try { sessionStorage.setItem(CLAVE, JSON.stringify(msgs.slice(-40))); } catch { /* sin almacenamiento */ }
    fin.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [msgs]);
  const enviar = async (p?: string) => {
    const pregunta = (p ?? texto).trim();
    if (!pregunta || enviando) return;
    setTexto('');
    const historial = msgs.slice(-8).map((m) => ({ rol: m.rol, texto: m.texto }));
    setMsgs((m) => [...m, { rol: 'usuario', texto: pregunta }]);
    setEnviando(true);
    try {
      const r = await api<any>('/agente', { method: 'POST', json: { pregunta, historial } });
      setMsgs((m) => [...m, { rol: 'agente', texto: r.respuesta, motor: r.motor, herramientas: r.herramientas, panel: r.panel }]);
    } catch (e: any) {
      setMsgs((m) => [...m, { rol: 'agente', texto: `No se pudo responder: ${e.message}` }]);
    } finally { setEnviando(false); }
  };
  useEffect(() => { if (preguntaInicial) { alConsumir?.(); enviar(preguntaInicial); } /* eslint-disable-next-line */ }, [preguntaInicial]);
  return (
    <div className={`chat ${compacto ? 'compacto' : 'card'}`}>
      <div className="chat-msgs">
        {!msgs.length && (
          <div className="vacio">
            <Bot size={compacto ? 32 : 40} color="var(--gold-500)" />
            <p>Pregunte sobre ventas, costos, utilidades, gastos, inventarios, liquidez o la comparación entre Cochabamba y La Paz.</p>
          </div>
        )}
        {msgs.map((m, i) => (
          <div key={i} className={`msg ${m.rol === 'usuario' ? 'u' : 'a'}`}>
            {m.rol === 'agente' && m.panel && <PanelAgente p={m.panel} />}
            {m.rol === 'agente'
              ? <details className="analisis" open={!m.panel}><summary>Análisis detallado</summary><MiniMarkdown texto={m.texto} /></details>
              : m.texto}
            {m.rol === 'agente' && m.motor && <div className="small muted" style={{ marginTop: 6 }}>{m.motor === 'claude' ? `IA · consultó: ${[...new Set(m.herramientas ?? [])].join(', ') || '—'}` : 'Motor local de reglas'}</div>}
          </div>
        ))}
        {enviando && <div className="msg a"><Loader2 size={16} className="spin" /> Analizando los datos…</div>}
        <div ref={fin} />
      </div>
      <div className="sugerencias">{(compacto ? SUGERENCIAS.slice(0, 6) : SUGERENCIAS).map((s) => <button key={s} onClick={() => enviar(s)} disabled={enviando}>{s}</button>)}</div>
      <div className="chat-in">
        <textarea value={texto} onChange={(e) => setTexto(e.target.value)} placeholder="Escriba su pregunta…" onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); enviar(); } }} maxLength={2000} />
        <button className="btn primary" onClick={() => enviar()} disabled={enviando || !texto.trim()} aria-label="Enviar"><Send size={16} />{!compacto && ' Enviar'}</button>
      </div>
      {msgs.length > 0 && <button className="btn sm limpiar-chat" onClick={() => setMsgs([])}>Nueva conversación</button>}
    </div>
  );
}
