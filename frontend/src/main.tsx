import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles.css';
import { aplicarTemaGuardado } from './lib/tema';

aplicarTemaGuardado();

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);
