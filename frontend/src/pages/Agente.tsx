import { useSearchParams } from 'react-router-dom';
import { Sparkles } from 'lucide-react';
import ChatAgente from '../components/ChatAgente';
import { useDatos } from '../lib/contexto';

export default function Agente() {
  const estado = useDatos<any>('/agente/estado');
  const [params, setParams] = useSearchParams();
  return (
    <>
      <div className="page-head"><div><h1>Agente de análisis financiero</h1>
        <p>Cada respuesta se presenta como un panel con importes (Bs), porcentajes y variaciones, más el análisis detallado. Solo usa datos procesados; si un dato no existe, indica cuál falta. {estado.data && <span className="chip info" style={{ marginLeft: 6 }}><Sparkles size={12} /> {estado.data.descripcion}</span>}</p></div>
      </div>
      <ChatAgente preguntaInicial={params.get('q')} alConsumir={() => setParams({}, { replace: true })} />
    </>
  );
}
