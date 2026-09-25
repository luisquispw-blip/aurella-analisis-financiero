import { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Bot, X, Maximize2 } from 'lucide-react';
import ChatAgente from './ChatAgente';

// Botón flotante del agente (abajo a la izquierda) disponible en todas las pantallas
export default function AgenteFlotante() {
  const [abierto, setAbierto] = useState(false);
  const loc = useLocation();
  const nav = useNavigate();
  if (loc.pathname === '/agente') return null;
  return (
    <>
      {abierto && (
        <div className="agente-flotante-ventana" role="dialog" aria-label="Agente financiero">
          <div className="agente-flotante-head">
            <span><Bot size={18} /> Agente financiero AURELLA</span>
            <span style={{ display: 'flex', gap: 4 }}>
              <button onClick={() => { setAbierto(false); nav('/agente'); }} title="Abrir en pantalla completa"><Maximize2 size={16} /></button>
              <button onClick={() => setAbierto(false)} title="Cerrar"><X size={18} /></button>
            </span>
          </div>
          <ChatAgente compacto />
        </div>
      )}
      <button className={`agente-flotante-btn ${abierto ? 'on' : ''}`} onClick={() => setAbierto(!abierto)} aria-label="Abrir agente financiero" title="Pregúntele al agente financiero">
        {abierto ? <X size={26} /> : <Bot size={28} />}
        {!abierto && <span className="agente-flotante-pulso" />}
      </button>
    </>
  );
}
