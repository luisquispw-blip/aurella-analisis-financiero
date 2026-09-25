import crypto from 'node:crypto';

export function hashPassword(password: string, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return { hash, salt };
}

export function verifyPassword(password: string, hash: string, salt: string): boolean {
  const calc = crypto.scryptSync(password, salt, 64);
  const stored = Buffer.from(hash, 'hex');
  return stored.length === calc.length && crypto.timingSafeEqual(stored, calc);
}

// Token de sesión firmado (HMAC-SHA256), sin estado en servidor.
export function firmarToken(payload: Record<string, unknown>, secret: string, horas: number): string {
  const body = Buffer.from(JSON.stringify({ ...payload, exp: Date.now() + horas * 3600_000 })).toString('base64url');
  const sig = crypto.createHmac('sha256', secret).update(body).digest('base64url');
  return `${body}.${sig}`;
}

export function verificarToken(token: string | undefined, secret: string): Record<string, any> | null {
  if (!token || !token.includes('.')) return null;
  const [body, sig] = token.split('.');
  const esperado = crypto.createHmac('sha256', secret).update(body).digest('base64url');
  if (sig.length !== esperado.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(esperado))) return null;
  try {
    const data = JSON.parse(Buffer.from(body, 'base64url').toString());
    if (typeof data.exp !== 'number' || data.exp < Date.now()) return null;
    return data;
  } catch {
    return null;
  }
}

export function sha256(buf: Buffer | string): string {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

export function passwordAleatoria(): string {
  return crypto.randomBytes(9).toString('base64url');
}
