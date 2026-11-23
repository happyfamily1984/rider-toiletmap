'use strict';

const crypto = require('crypto');


function sign(payload, secret) {
  return crypto.createHmac('sha256', secret).update(payload).digest('base64url');
}

function safeEqual(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
}

function parseCookies(header) {
  const out = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx < 0) continue;
    out[part.slice(0, idx).trim()] = decodeURIComponent(part.slice(idx + 1).trim());
  }
  return out;
}


/**
 * 관리자 로그인 (가입신청 확인용). 비밀번호는 ADMIN_PASSWORD 환경변수로만 설정한다.
 * 비밀번호가 없으면 관리자 기능은 꺼진다. 멤버 세션과 별도의 쿠키(12시간)를 쓴다.
 */
function createAdminAuth({ password, secret, secureCookie }) {
  const ADMIN_COOKIE = 'tm_admin';
  const HOURS = 12;
  const key = `${secret}:admin:${password}`;
  const MAX_FAILS = 5;
  const LOCK_MS = 30 * 60 * 1000;
  const attempts = new Map();

  function cookie(value, maxAgeSec) {
    const parts = [`${ADMIN_COOKIE}=${encodeURIComponent(value)}`, 'Path=/api', 'HttpOnly', 'SameSite=Strict', `Max-Age=${maxAgeSec}`];
    if (secureCookie) parts.push('Secure');
    return parts.join('; ');
  }

  function isAdmin(req) {
    if (!password) return false;
    const token = parseCookies(req.headers.cookie)[ADMIN_COOKIE];
    if (!token) return false;
    const [exp, sig] = token.split('.');
    return !!exp && !!sig && Number(exp) > Date.now() && safeEqual(sig, sign(`admin:${exp}`, key));
  }

  function login(req, res) {
    if (!password) return res.status(503).json({ error: '관리자 비밀번호가 설정되지 않았습니다. (ADMIN_PASSWORD)' });
    const ip = req.ip || 'unknown';
    const now = Date.now();
    const rec = attempts.get(ip) || { fails: 0, lockedUntil: 0 };
    if (rec.lockedUntil > now) {
      const min = Math.ceil((rec.lockedUntil - now) / 60000);
      return res.status(429).json({ error: `시도가 너무 많습니다. ${min}분 후 다시 시도해 주세요.` });
    }
    const pw = String((req.body && req.body.password) || '');
    if (!safeEqual(pw, password)) {
      rec.fails += 1;
      if (rec.fails >= MAX_FAILS) {
        rec.fails = 0;
        rec.lockedUntil = now + LOCK_MS;
      }
      attempts.set(ip, rec);
      return res.status(401).json({ error: '관리자 비밀번호가 올바르지 않습니다.' });
    }
    attempts.delete(ip);
    const exp = String(now + HOURS * 60 * 60 * 1000);
    res.setHeader('Set-Cookie', cookie(`${exp}.${sign(`admin:${exp}`, key)}`, HOURS * 60 * 60));
    return res.json({ ok: true });
  }

  function logout(req, res) {
    res.setHeader('Set-Cookie', cookie('', 0));
    res.json({ ok: true });
  }

  function requireAdmin(req, res, next) {
    if (isAdmin(req)) return next();
    return res.status(401).json({ error: '관리자 로그인이 필요합니다.' });
  }

  return { enabled: !!password, isAdmin, login, logout, requireAdmin };
}

/**
 * 이용자 로그인 (구글 계정). 구글이 확인해 준 사용자 번호(sub)만 쓰고, 이메일·이름은 저장하지 않는다.
 * 로그인 상태는 서명한 쿠키(180일)로 유지한다.
 */
function createUserAuth({ secret, secureCookie, googleClientId, verifyGoogleToken }) {
  const USER_COOKIE = 'rt_user';
  const DAYS = 180;
  const key = `${secret}:user`;

  let verify = verifyGoogleToken;
  if (!verify && googleClientId) {
    const { OAuth2Client } = require('google-auth-library');
    const client = new OAuth2Client(googleClientId);
    verify = async (token) => {
      const ticket = await client.verifyIdToken({ idToken: token, audience: googleClientId });
      const p = ticket.getPayload();
      return { sub: p.sub };
    };
  }

  function cookie(value, maxAgeSec) {
    const parts = [`${USER_COOKIE}=${encodeURIComponent(value)}`, 'Path=/api', 'HttpOnly', 'SameSite=Lax', `Max-Age=${maxAgeSec}`];
    if (secureCookie) parts.push('Secure');
    return parts.join('; ');
  }

  /** 로그인한 사용자 id (없으면 null) */
  function userIdOf(req) {
    const token = parseCookies(req.headers.cookie)[USER_COOKIE];
    if (!token) return null;
    const [idB64, exp, sig] = token.split('.');
    if (!idB64 || !exp || !sig || Number(exp) < Date.now()) return null;
    if (!safeEqual(sig, sign(`${idB64}.${exp}`, key))) return null;
    return Buffer.from(idB64, 'base64url').toString('utf8');
  }

  /** 구글 ID 토큰을 확인하고 로그인 쿠키를 심는다. 성공하면 사용자 id */
  async function loginWithGoogle(res, credential) {
    if (!verify) {
      const e = new Error('구글 로그인이 아직 설정되지 않았습니다. (GOOGLE_CLIENT_ID)');
      e.status = 503;
      throw e;
    }
    let info;
    try {
      info = await verify(String(credential || ''));
    } catch (err) {
      const e = new Error('구글 로그인을 확인하지 못했어요. 다시 시도해 주세요.');
      e.status = 401;
      throw e;
    }
    if (!info || !info.sub) {
      const e = new Error('구글 로그인을 확인하지 못했어요.');
      e.status = 401;
      throw e;
    }
    const id = `g:${info.sub}`;
    const idB64 = Buffer.from(id).toString('base64url');
    const exp = String(Date.now() + DAYS * 24 * 60 * 60 * 1000);
    res.setHeader('Set-Cookie', cookie(`${idB64}.${exp}.${sign(`${idB64}.${exp}`, key)}`, DAYS * 24 * 60 * 60));
    return id;
  }

  function logout(res) {
    res.setHeader('Set-Cookie', cookie('', 0));
  }

  return { enabled: !!verify, userIdOf, loginWithGoogle, logout };
}

module.exports = { createAdminAuth, createUserAuth, sign, safeEqual };
