import crypto from 'node:crypto';
import firebaseConfig from '../../firebase-applet-config.json';

const FIREBASE_CERTS_URL =
  'https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com';

interface CertCache {
  certs: Record<string, string>;
  expiresAtMs: number;
}

let cachedCerts: CertCache | null = null;

function decodeBase64UrlJson<T>(segment: string): T {
  const normalized = segment.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
  return JSON.parse(Buffer.from(padded, 'base64').toString('utf8')) as T;
}

function decodeBase64UrlBuffer(segment: string): Buffer {
  const normalized = segment.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
  return Buffer.from(padded, 'base64');
}

async function getFirebasePublicCerts(): Promise<Record<string, string>> {
  if (cachedCerts && Date.now() < cachedCerts.expiresAtMs) {
    return cachedCerts.certs;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(FIREBASE_CERTS_URL, {
      method: 'GET',
      redirect: 'error',
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`Unable to fetch Google public certificates (${response.status}).`);
    }
    const certs = (await response.json()) as Record<string, string>;
    const cacheControl = response.headers.get('cache-control') || '';
    const maxAgeMatch = /max-age=(\d+)/i.exec(cacheControl);
    const maxAgeSec = maxAgeMatch ? Math.max(60, Number(maxAgeMatch[1])) : 3600;
    cachedCerts = {
      certs,
      expiresAtMs: Date.now() + maxAgeSec * 1000,
    };
    return certs;
  } finally {
    clearTimeout(timer);
  }
}

export interface VerifiedFirebaseClaims {
  uid: string;
  email: string;
  name: string;
  emailVerified: boolean;
}

export async function verifyFirebaseIdToken(idToken: string): Promise<VerifiedFirebaseClaims> {
  const projectId = firebaseConfig?.projectId;
  if (!projectId || projectId === 'remixed-project-id') {
    throw new Error('FIREBASE_NOT_CONFIGURED');
  }

  const parts = idToken.split('.');
  if (parts.length !== 3 || parts.some((part) => !part)) {
    throw new Error('INVALID_TOKEN_FORMAT');
  }

  const [encodedHeader, encodedPayload, encodedSig] = parts;
  const header = decodeBase64UrlJson<{ alg?: string; kid?: string }>(encodedHeader);
  if (header.alg !== 'RS256' || !header.kid || typeof header.kid !== 'string') {
    throw new Error('INVALID_TOKEN_HEADER');
  }

  const certs = await getFirebasePublicCerts();
  const certPem = certs[header.kid];
  if (!certPem) {
    throw new Error('UNKNOWN_KEY_ID');
  }

  const verifier = crypto.createVerify('RSA-SHA256');
  verifier.update(`${encodedHeader}.${encodedPayload}`);
  verifier.end();
  const signature = decodeBase64UrlBuffer(encodedSig);
  if (!verifier.verify(certPem, signature)) {
    throw new Error('INVALID_TOKEN_SIGNATURE');
  }

  const payload = decodeBase64UrlJson<{
    aud?: string;
    iss?: string;
    sub?: string;
    exp?: number;
    iat?: number;
    auth_time?: number;
    email?: string;
    email_verified?: boolean;
    name?: string;
  }>(encodedPayload);

  const nowSec = Math.floor(Date.now() / 1000);
  if (payload.aud !== projectId) {
    throw new Error('INVALID_TOKEN_AUDIENCE');
  }
  if (payload.iss !== `https://securetoken.google.com/${projectId}`) {
    throw new Error('INVALID_TOKEN_ISSUER');
  }
  if (!payload.sub || !/^[a-zA-Z0-9_-]{1,128}$/.test(payload.sub)) {
    throw new Error('INVALID_TOKEN_SUBJECT');
  }
  if (typeof payload.exp !== 'number' || payload.exp <= nowSec) {
    throw new Error('TOKEN_EXPIRED');
  }
  if (typeof payload.iat !== 'number' || payload.iat > nowSec + 300) {
    throw new Error('INVALID_TOKEN_IAT');
  }
  if (typeof payload.auth_time !== 'number' || payload.auth_time > nowSec + 300) {
    throw new Error('INVALID_TOKEN_AUTH_TIME');
  }
  if (payload.email_verified !== true || !payload.email || typeof payload.email !== 'string') {
    throw new Error('EMAIL_VERIFICATION_REQUIRED');
  }

  const normalizedEmail = payload.email.trim().toLowerCase();
  const fallbackName = normalizedEmail.split('@')[0] || 'Player';
  const displayName =
    typeof payload.name === 'string' && payload.name.trim().length >= 2
      ? payload.name.trim().slice(0, 120)
      : fallbackName.slice(0, 120);

  return {
    uid: payload.sub,
    email: normalizedEmail,
    name: displayName,
    emailVerified: true,
  };
}
