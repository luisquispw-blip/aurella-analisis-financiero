import { useEffect, useState } from 'react';
import { Moon, Sun } from 'lucide-react';

// Tema claro / nocturno. La elección se recuerda en este navegador; sin elección, sigue al sistema.
type Tema = 'light' | 'dark';
const CLAVE = 'aurella_tema';

function temaInicial(): Tema {
  try {
    const t = localStorage.getItem(CLAVE);
    if (t === 'light' || t === 'dark') return t;
  } catch { /* almacenamiento no disponible */ }
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function aplicarTemaGuardado() {
  document.documentElement.dataset.theme = temaInicial();
}

export function BotonTema() {
  const [tema, setTema] = useState<Tema>(temaInicial);
  useEffect(() => { document.documentElement.dataset.theme = tema; }, [tema]);
  const cambiar = () => {
    const n: Tema = tema === 'dark' ? 'light' : 'dark';
    setTema(n);
    try { localStorage.setItem(CLAVE, n); } catch { /* almacenamiento no disponible */ }
  };
  const nocturno = tema === 'dark';
  return (
    <button type="button" className="tema-btn" onClick={cambiar} aria-label={nocturno ? 'Cambiar a modo claro' : 'Cambiar a modo nocturno'} title={nocturno ? 'Modo claro' : 'Modo nocturno'}>
      {nocturno ? <Sun size={17} /> : <Moon size={17} />}
    </button>
  );
}
