import crypto from 'node:crypto';
import { promisify } from 'node:util';

const scryptAsync = promisify(crypto.scrypt);
const SCRYPT_KEY_LENGTH = 64;

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = (await scryptAsync(password, salt, SCRYPT_KEY_LENGTH)) as Buffer;
  return `scrypt$${salt}$${derived.toString('hex')}`;
}

export async function verifyPassword(
  password: string,
  storedHash: string
): Promise<boolean> {
  if (!storedHash || !storedHash.startsWith('scrypt$')) {
    return false;
  }

  const parts = storedHash.split('$');
  if (parts.length !== 3) {
    return false;
  }

  const [, salt, hashHex] = parts;
  if (!salt || !hashHex) {
    return false;
  }

  try {
    const derived = (await scryptAsync(password, salt, SCRYPT_KEY_LENGTH)) as Buffer;
    const storedBuf = Buffer.from(hashHex, 'hex');
    if (derived.length !== storedBuf.length) {
      return false;
    }
    return crypto.timingSafeEqual(derived, storedBuf);
  } catch {
    return false;
  }
}

export function generateOpaqueToken(bytes = 32): string {
  return crypto.randomBytes(bytes).toString('base64url');
}

export function hashOpaqueToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}
