// Autenticación: sesión en cookie httpOnly firmada con HMAC, roles y límite de intentos de acceso.
import type { NextFunction, Request, Response } from 'express';
import { config } from '../config/app.config.ts';
import type { Db } from '../database/db.ts';
import { firmarToken, hashPassword, passwordAleatoria, verificarToken, verifyPassword } from '../services/seguridad.ts';

export type Usuario = { id: number; usuario: string; nombre: string; rol: 'admin' | 'analista' | 'lector'; debe_cambiar: number };
declare module 'express-serve-static-core' { interface Request { usuario?: Usuario } }

const COOKIE = 'aurella_sesion';
let secreto = '';

export function iniciarAuth(db: Db) {
  secreto = config.sessionSecret || db.parametro('session_secret') || '';
  if (!secreto) {
    secreto = passwordAleatoria() + passwordAleatoria() + passwordAleatoria();
    db.setParametro('session_secret', secreto, 'sistema', 'Secreto de firma de sesiones (generado automáticamente; defina SESSION_SECRET en producción).');
  }
}

const intentos = new Map<string, { n: number; hasta: number }>();
function bloqueado(clave: string): boolean {
  const i = intentos.get(clave);
  return !!i && i.n >= 8 && i.hasta > Date.now();
}
function registrarFallo(clave: string) {
  const i = intentos.get(clave);
  if (!i || i.hasta < Date.now()) intentos.set(clave, { n: 1, hasta: Date.now() + 15 * 60_000 });
  else i.n++;
}

function leerCookie(req: Request): string | undefined {
  const c = req.headers.cookie;
  if (!c) return undefined;
  for (const p of c.split(';')) {
    const [k, ...v] = p.trim().split('=');
    if (k === COOKIE) return decodeURIComponent(v.join('='));
  }
}

function setCookie(res: Response, valor: string, maxAgeSeg: number) {
  const seguro = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  res.setHeader('Set-Cookie', `${COOKIE}=${encodeURIComponent(valor)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSeg}${seguro}`);
}

export function login(db: Db, req: Request, res: Response) {
  const { usuario, password } = req.body ?? {};
  if (typeof usuario !== 'string' || typeof password !== 'string' || !usuario || !password) {
    return res.status(400).json({ error: 'Ingrese usuario y contraseña.' });
  }
  const clave = `${req.ip}|${usuario.toLowerCase()}`;
  if (bloqueado(clave)) return res.status(429).json({ error: 'Demasiados intentos fallidos. Espere 15 minutos.' });
  const u = db.get<any>('SELECT * FROM usuario WHERE lower(usuario) = lower(?) AND activo = 1', usuario);
  if (!u || !verifyPassword(password, u.hash, u.salt)) {
    registrarFallo(clave);
    db.auditar(usuario, 'login_fallido', { ip: req.ip });
    return res.status(401).json({ error: 'Usuario o contraseña incorrectos.' });
  }
  intentos.delete(clave);
  const token = firmarToken({ id: u.id }, secreto, config.sessionHours);
  setCookie(res, token, config.sessionHours * 3600);
  db.auditar(u.usuario, 'login', { ip: req.ip });
  res.json({ usuario: { id: u.id, usuario: u.usuario, nombre: u.nombre, rol: u.rol, debe_cambiar: u.debe_cambiar } });
}

export function logout(_req: Request, res: Response) {
  setCookie(res, '', 0);
  res.json({ ok: true });
}

export function autenticar(db: Db) {
  return (req: Request, res: Response, next: NextFunction) => {
    const data = verificarToken(leerCookie(req), secreto);
    if (!data) return res.status(401).json({ error: 'Sesión no válida o expirada.' });
    const u = db.get<Usuario>('SELECT id, usuario, nombre, rol, debe_cambiar FROM usuario WHERE id = ? AND activo = 1', data.id);
    if (!u) return res.status(401).json({ error: 'Usuario inactivo.' });
    req.usuario = u;
    next();
  };
}

const NIVEL = { lector: 0, analista: 1, admin: 2 };
export function requiereRol(rol: keyof typeof NIVEL) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.usuario || NIVEL[req.usuario.rol] < NIVEL[rol]) return res.status(403).json({ error: 'No tiene permisos para esta acción.' });
    next();
  };
}

export function cambiarPassword(db: Db, req: Request, res: Response) {
  const { actual, nueva } = req.body ?? {};
  const u = db.get<any>('SELECT * FROM usuario WHERE id = ?', req.usuario!.id);
  if (!u || typeof actual !== 'string' || !verifyPassword(actual, u.hash, u.salt)) return res.status(400).json({ error: 'La contraseña actual no es correcta.' });
  if (typeof nueva !== 'string' || nueva.length < 8) return res.status(400).json({ error: 'La nueva contraseña debe tener al menos 8 caracteres.' });
  const { hash, salt } = hashPassword(nueva);
  db.run('UPDATE usuario SET hash = ?, salt = ?, debe_cambiar = 0 WHERE id = ?', hash, salt, u.id);
  db.auditar(u.usuario, 'cambio_password');
  res.json({ ok: true });
}
