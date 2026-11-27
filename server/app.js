'use strict';

const path = require('path');
const crypto = require('crypto');
const express = require('express');
const fs = require('fs');
const { createAdminAuth, createUserAuth } = require('./auth');
const {
  validateToilet, parseBox, cleanText, inKorea, KOREA_BOUNDS, REPORT_REASONS, LIMITS, POINTS, userView,
} = require('./store');

// 시도 → 시군구 목록 (화면과 같은 파일)
const REGIONS = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'public', 'regions.json'), 'utf8'));
function validRegion(sido, sigungu) {
  const s = REGIONS.sido.find((x) => x.name === sido);
  return !!s && s.sigungu.includes(sigungu);
}

// 주로 타는 플랫폼
const PLATFORMS = ['baemin', 'baemin_plus', 'coupang', 'coupang_plus', 'etc'];

const RESERVED_NICK = /운영자|관리자|admin|운영진|공식/i;

function validateProfile(body) {
  const nickname = cleanText(body.nickname, 20);
  if (!/^[가-힣A-Za-z0-9_]{2,12}$/.test(nickname)) {
    return { error: '닉네임은 한글·영문·숫자 2~12자로 정해 주세요.' };
  }
  if (RESERVED_NICK.test(nickname)) return { error: '쓸 수 없는 닉네임이에요.' };
  const sido = String(body.sido || '');
  const sigungu = String(body.sigungu || '');
  if (!validRegion(sido, sigungu)) return { error: '활동 지역(시·군·구)을 골라 주세요.' };
  const platform = String(body.platform || '');
  if (!PLATFORMS.includes(platform)) return { error: '주로 타는 플랫폼을 골라 주세요.' };
  return { value: { nickname, sido, sigungu, platform } };
}

// 비동기 라우트의 오류를 Express 오류 처리로 넘긴다
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// 배포 버전 (Render 가 넣어 주는 커밋 값, 없으면 서버 시작 시각)
const APP_VERSION = process.env.RENDER_GIT_COMMIT || String(Date.now());

// 한 번에 지도에 보내는 최대 화장실 수
const BOX_LIMIT = 500;

// 기본 남용 방지 한도 (사용자당 1시간 기준)
const DEFAULT_RATE = { create: 20, edit: 60, report: 30, vote: 60 };

/**
 * 시간당 횟수 제한. key 마다 최근 1시간 기록을 메모리에 들고 있는다.
 */
function createRateLimiter(limit, windowMs = 60 * 60 * 1000) {
  const log = new Map();
  return function hit(key) {
    const now = Date.now();
    const recent = (log.get(key) || []).filter((t) => now - t < windowMs);
    if (recent.length >= limit) {
      log.set(key, recent);
      return false;
    }
    recent.push(now);
    log.set(key, recent);
    if (log.size > 50000) log.clear(); // 메모리 보호
    return true;
  };
}

/** store 는 init() 이 끝난 저장소 (FileStore 또는 PgStore) */
function createApp(config, store) {
  const app = express();
  const admin = createAdminAuth({
    password: config.adminPassword || '',
    secret: config.sessionSecret,
    secureCookie: config.secureCookie,
  });
  const rate = { ...DEFAULT_RATE, ...(config.rate || {}) };
  const limiters = {
    create: createRateLimiter(rate.create),
    edit: createRateLimiter(rate.edit),
    report: createRateLimiter(rate.report),
    vote: createRateLimiter(rate.vote),
  };
  const users = createUserAuth({
    secret: config.sessionSecret,
    secureCookie: config.secureCookie,
    googleClientId: config.googleClientId,
    verifyGoogleToken: config.verifyGoogleToken,
  });

  if (config.trustProxy) app.set('trust proxy', 1);
  app.disable('x-powered-by');
  app.use(express.json({ limit: '20kb' }));

  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'same-origin');
    next();
  });

  // 누가 했는지 구분하는 익명 키. IP 와 기기 ID(앱이 처음 실행 때 만든 무작위 값)를 서명해서
  // 원래 값은 저장하지 않는다.
  function hashed(v) {
    return crypto.createHmac('sha256', config.sessionSecret).update(String(v)).digest('base64url').slice(0, 22);
  }
  function actorOf(req) {
    const device = String(req.get('X-Device-Id') || '');
    return /^[A-Za-z0-9-]{16,64}$/.test(device) ? `d:${hashed(device)}` : `i:${hashed(req.ip)}`;
  }
  // 횟수 제한은 기기와 IP 둘 다로 건다 (기기 ID 를 바꿔 가며 우회하는 것 방지)
  function allow(kind, req) {
    const ipKey = `ip:${hashed(req.ip)}`;
    const ipOk = createOrGetIpLimiter(kind)(ipKey);
    return limiters[kind](actorOf(req)) && ipOk;
  }
  const ipLimiters = {};
  function createOrGetIpLimiter(kind) {
    if (!ipLimiters[kind]) ipLimiters[kind] = createRateLimiter(rate[kind] * 5);
    return ipLimiters[kind];
  }
  const tooMany = (res) => res.status(429).json({ error: '너무 자주 요청했어요. 잠시 후 다시 시도해 주세요.' });

  // ---- 공개 API ----
  app.get('/api/config', (req, res) => {
    res.json({
      naverClientId: config.naverClientId,
      googleClientId: config.googleClientId || '',
      bounds: KOREA_BOUNDS,
      points: POINTS,
      contactEmail: config.contactEmail || '',
      // 배포마다 바뀌는 값. 앱이 돌아왔을 때 이 값이 바뀌었으면 화면을 새로 고친다
      version: APP_VERSION,
    });
  });

  // ---- 로그인 / 내 정보 ----
  async function meOf(req) {
    const id = users.userIdOf(req);
    if (!id) return { loggedIn: false, user: null };
    return { loggedIn: true, user: userView(await store.getUser(id)) };
  }

  // 등록·수정·투표 전에: 로그인 + 프로필(닉네임·지역·플랫폼)이 있어야 함
  async function requireMember(req, res) {
    const id = users.userIdOf(req);
    if (!id) {
      res.status(401).json({ error: '구글 계정으로 로그인해 주세요.', needLogin: true });
      return null;
    }
    if (!(await store.getUser(id))) {
      res.status(403).json({ error: '닉네임과 활동 지역을 먼저 정해 주세요.', needProfile: true });
      return null;
    }
    return id;
  }

  app.get('/api/me', wrap(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json(await meOf(req));
  }));

  app.post('/api/auth/google', wrap(async (req, res) => {
    try {
      const id = await users.loginWithGoogle(res, req.body && req.body.credential);
      res.json({ loggedIn: true, user: userView(await store.getUser(id)) });
    } catch (err) {
      if (!err.status) throw err;
      res.removeHeader('Set-Cookie');
      res.status(err.status).json({ error: err.message });
    }
  }));

  app.post('/api/auth/logout', (req, res) => {
    users.logout(res);
    res.json({ ok: true });
  });

  app.post('/api/me/profile', wrap(async (req, res) => {
    const id = users.userIdOf(req);
    if (!id) return res.status(401).json({ error: '구글 계정으로 로그인해 주세요.', needLogin: true });
    const { error, value } = validateProfile(req.body || {});
    if (error) return res.status(400).json({ error });
    const out = await store.saveProfile(id, value);
    if (out.error) return res.status(409).json({ error: '이미 쓰고 있는 닉네임이에요. 다른 닉네임을 골라 주세요.' });
    res.json({ loggedIn: true, user: userView(out.user) });
  }));

  // 계정 삭제 (구글 플레이 정책: 앱 안에서 계정 삭제 가능해야 함)
  app.delete('/api/me', wrap(async (req, res) => {
    const id = users.userIdOf(req);
    if (!id) return res.status(401).json({ error: '구글 계정으로 로그인해 주세요.', needLogin: true });
    await store.deleteUser(id);
    users.logout(res);
    res.json({ ok: true });
  }));

  // 순위표: ?sido=..&sigungu=.. 이면 그 지역만
  app.get('/api/leaderboard', wrap(async (req, res) => {
    const sido = String(req.query.sido || '');
    const sigungu = String(req.query.sigungu || '');
    const region = sido || sigungu ? { sido, sigungu } : null;
    if (region && !validRegion(sido, sigungu)) return res.status(400).json({ error: '지역이 올바르지 않습니다.' });
    res.setHeader('Cache-Control', 'no-store');
    res.json(await store.leaderboard(region, 100, users.userIdOf(req)));
  }));

  // 지도에 보이는 범위의 화장실: ?box=minLat,minLng,maxLat,maxLng
  app.get('/api/toilets', wrap(async (req, res) => {
    const box = parseBox(req.query.box);
    if (!box) return res.status(400).json({ error: '지도를 더 확대해 주세요.' });
    res.setHeader('Cache-Control', 'no-store');
    res.json(await store.inBox(box, BOX_LIMIT));
  }));

  // 가장 가까운 화장실: ?lat=..&lng=..
  app.get('/api/toilets/nearest', wrap(async (req, res) => {
    const lat = Number(req.query.lat);
    const lng = Number(req.query.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || !inKorea(lat, lng)) {
      return res.status(400).json({ error: '위치 정보가 올바르지 않습니다.' });
    }
    res.setHeader('Cache-Control', 'no-store');
    res.json({ toilets: await store.nearest(lat, lng, 5) });
  }));

  app.get('/api/toilets/:id', wrap(async (req, res) => {
    const toilet = await store.get(req.params.id, { userId: users.userIdOf(req) });
    if (!toilet) return res.status(404).json({ error: '화장실을 찾을 수 없습니다.' });
    res.setHeader('Cache-Control', 'no-store');
    res.json({ toilet });
  }));

  // 로그인한 누구나 등록 (횟수 제한, 등록하면 100점)
  app.post('/api/toilets', wrap(async (req, res) => {
    const { error, value } = validateToilet(req.body || {});
    if (error) return res.status(400).json({ error });
    const userId = await requireMember(req, res);
    if (!userId) return;
    if (!allow('create', req)) return tooMany(res);
    res.status(201).json({ toilet: await store.create(value, actorOf(req), userId) });
  }));

  // 누구나 수정 (횟수 제한, 수정 기록 남김). 위치는 바꿀 수 없음
  app.put('/api/toilets/:id', wrap(async (req, res) => {
    const body = { ...(req.body || {}) };
    delete body.lat;
    delete body.lng;
    const { error, value } = validateToilet(body, { partial: true });
    if (error) return res.status(400).json({ error });
    const userId = await requireMember(req, res);
    if (!userId) return;
    if (!allow('edit', req)) return tooMany(res);
    const toilet = await store.update(req.params.id, value, actorOf(req), userId);
    if (!toilet) return res.status(404).json({ error: '화장실을 찾을 수 없습니다.' });
    res.json({ toilet });
  }));

  // 맞아요(+20점) / 틀려요(-30점, 3번 쌓이면 삭제·합계 -100점): { vote: 'up' | 'down' }
  app.post('/api/toilets/:id/vote', wrap(async (req, res) => {
    const v = String((req.body && req.body.vote) || '');
    if (v !== 'up' && v !== 'down') return res.status(400).json({ error: '맞아요/틀려요를 골라 주세요.' });
    const userId = await requireMember(req, res);
    if (!userId) return;
    if (!allow('vote', req)) return tooMany(res);
    const out = await store.vote(req.params.id, userId, v === 'up' ? 1 : -1);
    if (!out) return res.status(404).json({ error: '화장실을 찾을 수 없습니다.' });
    if (out.error === 'self') return res.status(400).json({ error: '내가 올린 정보에는 투표할 수 없어요.' });
    if (out.error === 'duplicate') return res.status(409).json({ error: '이미 투표했어요.' });
    if (out.error === 'novote') return res.status(400).json({ error: '이 화장실은 투표할 수 없어요.' });
    res.json({ ok: true, ...out });
  }));

  // 신고: 서로 다른 사용자 3명이 신고하면 자동으로 숨김
  app.post('/api/toilets/:id/report', wrap(async (req, res) => {
    const reason = String((req.body && req.body.reason) || '');
    if (!REPORT_REASONS.includes(reason)) return res.status(400).json({ error: '신고 사유를 골라 주세요.' });
    const note = cleanText(req.body.note, LIMITS.note);
    if (!allow('report', req)) return tooMany(res);
    const result = await store.report(req.params.id, actorOf(req), reason, note);
    if (!result) return res.status(404).json({ error: '화장실을 찾을 수 없습니다.' });
    res.json({ ok: true, ...result });
  }));

  // ---- 운영자 (신고 처리) ----
  app.get('/api/admin/session', (req, res) => {
    res.json({ enabled: admin.enabled, admin: admin.isAdmin(req) });
  });
  app.post('/api/admin/login', admin.login);
  app.post('/api/admin/logout', admin.logout);
  app.get('/api/admin/reported', admin.requireAdmin, wrap(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json({ toilets: await store.listReported() });
  }));
  app.get('/api/admin/toilets/:id/revisions', admin.requireAdmin, wrap(async (req, res) => {
    res.json({ revisions: await store.listRevisions(req.params.id) });
  }));
  app.post('/api/admin/toilets/:id/hide', admin.requireAdmin, wrap(async (req, res) => {
    const toilet = await store.setHidden(req.params.id, true);
    if (!toilet) return res.status(404).json({ error: '화장실을 찾을 수 없습니다.' });
    res.json({ toilet });
  }));
  app.post('/api/admin/toilets/:id/unhide', admin.requireAdmin, wrap(async (req, res) => {
    const toilet = await store.setHidden(req.params.id, false);
    if (!toilet) return res.status(404).json({ error: '화장실을 찾을 수 없습니다.' });
    res.json({ toilet });
  }));
  app.delete('/api/admin/toilets/:id', admin.requireAdmin, wrap(async (req, res) => {
    if (!(await store.remove(req.params.id))) return res.status(404).json({ error: '화장실을 찾을 수 없습니다.' });
    res.json({ ok: true });
  }));

  app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));

  // eslint-disable-next-line no-unused-vars
  app.use('/api', (err, req, res, next) => {
    console.error(err);
    res.status(500).json({ error: '서버 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.' });
  });

  // ---- 정적 파일 (모바일 웹 화면) ----
  app.use(
    express.static(path.join(__dirname, '..', 'public'), {
      setHeaders(res, filePath) {
        if (filePath.endsWith('sw.js') || filePath.endsWith('.html')) {
          res.setHeader('Cache-Control', 'no-cache');
        }
      },
    })
  );

  return app;
}

module.exports = { createApp, BOX_LIMIT };
