import crypto from 'crypto';

const COOKIE_NAME = 'kwr_admin';
const MAX_AGE_SECONDS = 12 * 60 * 60;

export function requireAdmin(req, res) {
  const secret = getAdminSecret();
  if (!secret) {
    if (isProduction()) {
      res.status(503).json({ error: 'admin auth not configured' });
      return false;
    }
    return true;
  }

  if (hasValidCookie(req, secret)) return true;

  const auth = req.headers.authorization || '';
  if (auth.startsWith('Basic ')) {
    const decoded = Buffer.from(auth.slice(6), 'base64').toString('utf8');
    const password = decoded.includes(':') ? decoded.slice(decoded.indexOf(':') + 1) : decoded;
    if (safeEqual(password, secret)) {
      setAdminCookie(res, secret);
      return true;
    }
  }

  res.setHeader('WWW-Authenticate', 'Basic realm="KWR Admin", charset="UTF-8"');
  res.status(401).json({ error: 'admin auth required' });
  return false;
}

export function setAdminCookie(res, secret = getAdminSecret()) {
  if (!secret) return;
  const issuedAt = String(Date.now());
  const sig = sign(issuedAt, secret);
  const secure = isProduction() ? '; Secure' : '';
  res.setHeader(
    'Set-Cookie',
    `${COOKIE_NAME}=${issuedAt}.${sig}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${MAX_AGE_SECONDS}${secure}`
  );
}

export function adminHeaders(extra = {}) {
  return {
    'Cache-Control': 'no-store, private',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'same-origin',
    'X-Frame-Options': 'DENY',
    ...extra
  };
}

function hasValidCookie(req, secret) {
  const cookies = parseCookies(req.headers.cookie || '');
  const value = cookies[COOKIE_NAME];
  if (!value || !value.includes('.')) return false;
  const [issuedAt, sig] = value.split('.', 2);
  const issued = Number(issuedAt);
  if (!Number.isFinite(issued)) return false;
  if (Date.now() - issued > MAX_AGE_SECONDS * 1000) return false;
  return safeEqual(sig, sign(issuedAt, secret));
}

function parseCookies(header) {
  const out = {};
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    const val = part.slice(idx + 1).trim();
    if (key) out[key] = val;
  }
  return out;
}

function sign(value, secret) {
  return crypto.createHmac('sha256', secret).update(value).digest('base64url');
}

function safeEqual(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

function getAdminSecret() {
  return process.env.ADMIN_PASSWORD || process.env.ADMIN_TOKEN || '';
}

function isProduction() {
  return process.env.VERCEL_ENV === 'production' || process.env.NODE_ENV === 'production';
}
