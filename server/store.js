'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// 대한민국 전체를 넉넉히 감싸는 영역 (제주·울릉·독도 포함)
const KOREA_BOUNDS = {
  minLat: 33.0,
  maxLat: 38.9,
  minLng: 124.5,
  maxLng: 132.0,
};

const DEFAULT_NAME = '화장실';
// 별점 1~5, 입력하지 않으면 3
const DEFAULT_RATING = 3;
// 서로 다른 사용자의 신고가 이만큼 쌓이면 자동으로 숨김
const REPORT_HIDE_THRESHOLD = 3;

const LIMITS = {
  name: 40,
  address: 120,
  description: 500,
  password: 40,
  openHours: 100,
  note: 200,
};

const REPORT_REASONS = ['wrong', 'closed', 'spam', 'privacy', 'other'];

// 점수 규칙
const POINTS = {
  create: 100,      // 화장실 새로 등록
  up: 20,           // 누가 "맞아요" 하면
  down: 30,         // 누가 "틀려요" 하면 감점
  wrongLimit: 3,    // "틀려요" 가 이만큼 쌓이면 화장실 삭제(공공데이터는 비밀번호만 지움)
  wrongTotal: 100,  // 그때까지 감점 합계 (30+30+40 = 등록 점수 100점 반환)
};

/**
 * 투표로 점수를 받거나 잃는 사람.
 * 비밀번호가 있으면 비밀번호를 올린 사람, 없으면 화장실을 등록한 사람(이용자 등록 화장실만).
 */
function voteTarget(t) {
  if (t.password) return t.passwordBy || null;
  return t.source === 'user' ? t.ownerId || null : null;
}

function downPenalty(downVotes) {
  return downVotes < POINTS.wrongLimit ? POINTS.down : POINTS.wrongTotal - POINTS.down * (POINTS.wrongLimit - 1);
}

function userView(u) {
  if (!u) return null;
  return {
    nickname: u.nickname, sido: u.sido, sigungu: u.sigungu, platform: u.platform, score: u.score || 0,
  };
}

// 같은 점수면 같은 순위 (1, 2, 2, 4 …)
function withRanks(sorted) {
  let rank = 0;
  return sorted.map((u, i) => {
    if (i === 0 || (u.score || 0) !== (sorted[i - 1].score || 0)) rank = i + 1;
    return { rank, ...userView(u) };
  });
}

function detailView(t, { ownerName, passwordByName, myVote, userId }) {
  const target = voteTarget(t);
  return {
    ...publicView(t),
    ownerName: ownerName || '',
    passwordByName: passwordByName || '',
    myVote: myVote || 0,
    voteKind: t.password ? 'password' : 'exists',
    canVote: !!target && target !== userId && !myVote,
    mine: !!target && target === userId,
  };
}

function inKorea(lat, lng) {
  return (
    lat >= KOREA_BOUNDS.minLat &&
    lat <= KOREA_BOUNDS.maxLat &&
    lng >= KOREA_BOUNDS.minLng &&
    lng <= KOREA_BOUNDS.maxLng
  );
}

function cleanText(value, max) {
  if (value === undefined || value === null) return '';
  return String(value).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').trim().slice(0, max);
}

/**
 * 입력값을 검증해 저장 가능한 형태로 돌려준다. 잘못된 값이면 { error }.
 * partial: 수정할 때 보낸 항목만 검사
 */
function validateToilet(input, { partial = false } = {}) {
  const out = {};

  if (!partial || input.name !== undefined) {
    out.name = cleanText(input.name, LIMITS.name) || DEFAULT_NAME;
  }
  if (!partial || input.address !== undefined) {
    out.address = cleanText(input.address, LIMITS.address);
  }
  if (!partial || input.description !== undefined) {
    out.description = cleanText(input.description, LIMITS.description);
  }
  if (!partial || input.password !== undefined) {
    out.password = cleanText(input.password, LIMITS.password);
  }
  if (!partial || input.openHours !== undefined) {
    out.openHours = cleanText(input.openHours, LIMITS.openHours);
  }
  if (!partial || input.rating !== undefined) {
    if (input.rating === undefined || input.rating === null || input.rating === '') {
      out.rating = DEFAULT_RATING;
    } else {
      const rating = Number(input.rating);
      if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
        return { error: '별점은 1~5 사이로 선택해 주세요.' };
      }
      out.rating = rating;
    }
  }
  if (!partial || input.lat !== undefined || input.lng !== undefined) {
    const lat = Number(input.lat);
    const lng = Number(input.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      return { error: '위치 정보가 올바르지 않습니다.' };
    }
    if (!inKorea(lat, lng)) {
      return { error: '대한민국 안의 위치만 등록할 수 있습니다.' };
    }
    out.lat = Math.round(lat * 1e7) / 1e7;
    out.lng = Math.round(lng * 1e7) / 1e7;
  }
  return { value: out };
}

/** 지도 범위 문자열 "minLat,minLng,maxLat,maxLng" → 객체. 잘못되면 null */
function parseBox(s) {
  const p = String(s || '').split(',').map(Number);
  if (p.length !== 4 || p.some((n) => !Number.isFinite(n))) return null;
  const [minLat, minLng, maxLat, maxLng] = p;
  if (minLat > maxLat || minLng > maxLng) return null;
  // 너무 넓은 범위는 거부: 지도를 확대해서 보도록
  if (maxLat - minLat > 0.6 || maxLng - minLng > 0.8) return null;
  return { minLat, minLng, maxLat, maxLng };
}

// 두 지점 사이 거리(m)
function distanceM(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const toRad = Math.PI / 180;
  const dLat = (lat2 - lat1) * toRad;
  const dLng = (lng2 - lng1) * toRad;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * toRad) * Math.cos(lat2 * toRad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

// 사용자에게 보여주는 형태 (내부 관리 항목은 숨김)
function publicView(t) {
  return {
    id: t.id,
    name: t.name,
    address: t.address,
    description: t.description,
    password: t.password,
    rating: t.rating || DEFAULT_RATING,
    openHours: t.openHours || '',
    source: t.source || 'user',
    upVotes: t.upVotes || 0,
    downVotes: t.downVotes || 0,
    lat: t.lat,
    lng: t.lng,
    createdAt: t.createdAt,
    updatedAt: t.updatedAt,
  };
}

function adminView(t) {
  return { ...publicView(t), hidden: !!t.hidden, reportCount: t.reportCount || 0 };
}

/**
 * JSON 파일 저장소 (DATABASE_URL 이 없을 때: 로컬 실행·테스트용).
 */
class FileStore {
  constructor(file) {
    this.file = file;
    this.items = [];
    this.revisions = [];
    this.reports = [];
    this.users = [];
    this.votes = [];
    this.points = [];
  }

  async init() {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      this.items = parsed.toilets || [];
      this.revisions = parsed.revisions || [];
      this.reports = parsed.reports || [];
      this.users = parsed.users || [];
      this.votes = parsed.votes || [];
      this.points = parsed.points || [];
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
    }
  }

  save() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify({
      toilets: this.items, revisions: this.revisions, reports: this.reports,
      users: this.users, votes: this.votes, points: this.points,
    }));
    fs.renameSync(tmp, this.file);
  }

  find(id) {
    return this.items.find((t) => t.id === id) || null;
  }

  addRevision(t, actor) {
    this.revisions.push({
      id: this.revisions.length + 1, toiletId: t.id, data: publicView(t), actor, createdAt: new Date().toISOString(),
    });
  }

  async inBox(b, limit) {
    const found = this.items.filter((t) => !t.hidden &&
      t.lat >= b.minLat && t.lat <= b.maxLat && t.lng >= b.minLng && t.lng <= b.maxLng);
    // 사용자가 직접 등록한 화장실을 먼저
    found.sort((a, c) => (c.source === 'user') - (a.source === 'user') || c.rating - a.rating);
    return { toilets: found.slice(0, limit).map(publicView), truncated: found.length > limit };
  }

  async nearest(lat, lng, limit) {
    return this.items.filter((t) => !t.hidden)
      .map((t) => ({ t, d: distanceM(lat, lng, t.lat, t.lng) }))
      .filter((x) => x.d <= 30000)
      .sort((a, b) => a.d - b.d)
      .slice(0, limit)
      .map((x) => ({ ...publicView(x.t), distance: Math.round(x.d) }));
  }

  async get(id, { includeHidden = false, userId = null } = {}) {
    const t = this.find(id);
    if (!t || (t.hidden && !includeHidden)) return null;
    if (includeHidden) return adminView(t);
    const nick = (uid) => (this.users.find((u) => u.id === uid) || {}).nickname;
    const v = userId && this.votes.find((x) => x.toiletId === id && x.userId === userId);
    return detailView(t, {
      ownerName: nick(t.ownerId), passwordByName: nick(t.passwordBy), myVote: v ? v.value : 0, userId,
    });
  }

  addPoints(userId, delta, reason, toiletId) {
    const u = this.users.find((x) => x.id === userId);
    if (!u || !delta) return;
    u.score = (u.score || 0) + delta;
    this.points.push({ userId, delta, reason, toiletId, createdAt: new Date().toISOString() });
    if (this.points.length > 20000) this.points.splice(0, 10000);
  }

  async create(data, actor, userId = null) {
    const now = new Date().toISOString();
    const t = {
      id: crypto.randomUUID(), rating: DEFAULT_RATING, source: 'user', hidden: false, reportCount: 0,
      upVotes: 0, downVotes: 0,
      ...data, ownerId: userId, passwordBy: data.password ? userId : null,
      createdBy: actor, createdAt: now, updatedAt: now,
    };
    this.items.push(t);
    this.addRevision(t, actor);
    this.addPoints(userId, POINTS.create, 'create', t.id);
    this.save();
    return publicView(t);
  }

  async update(id, data, actor, userId = null) {
    const t = this.find(id);
    if (!t || t.hidden) return null;
    const pwChanged = data.password !== undefined && data.password !== t.password;
    Object.assign(t, data, { updatedAt: new Date().toISOString() });
    if (pwChanged) {
      // 비밀번호가 바뀌면 새로 올린 사람 기준으로 투표를 다시 받는다
      t.passwordBy = t.password ? userId : null;
      t.upVotes = 0;
      t.downVotes = 0;
      this.votes = this.votes.filter((v) => v.toiletId !== id);
    }
    this.addRevision(t, actor);
    this.save();
    return publicView(t);
  }

  async vote(id, userId, value) {
    const t = this.find(id);
    if (!t || t.hidden) return null;
    const target = voteTarget(t);
    if (!target) return { error: 'novote' };
    if (target === userId) return { error: 'self' };
    if (this.votes.some((v) => v.toiletId === id && v.userId === userId)) return { error: 'duplicate' };
    this.votes.push({ toiletId: id, userId, value, createdAt: new Date().toISOString() });
    const out = { deleted: false, cleared: false };
    if (value > 0) {
      t.upVotes = (t.upVotes || 0) + 1;
      this.addPoints(target, POINTS.up, 'vote-up', id);
    } else {
      t.downVotes = (t.downVotes || 0) + 1;
      this.addPoints(target, -downPenalty(t.downVotes), 'vote-down', id);
      if (t.downVotes >= POINTS.wrongLimit) {
        this.votes = this.votes.filter((v) => v.toiletId !== id);
        if (t.source === 'user') {
          this.items = this.items.filter((x) => x.id !== id);
          this.reports = this.reports.filter((r) => r.toiletId !== id);
          out.deleted = true;
        } else {
          Object.assign(t, { password: '', passwordBy: null, upVotes: 0, downVotes: 0, updatedAt: new Date().toISOString() });
          this.addRevision(t, 'vote');
          out.cleared = true;
        }
      }
    }
    this.save();
    return { ...out, toilet: out.deleted ? null : publicView(t) };
  }

  // ---- 사용자 (구글 로그인) ----
  async getUser(id) {
    return this.users.find((u) => u.id === id) || null;
  }

  async saveProfile(id, p) {
    const lower = p.nickname.toLowerCase();
    if (this.users.some((u) => u.id !== id && u.nickname.toLowerCase() === lower)) return { error: 'nickname' };
    let u = this.users.find((x) => x.id === id);
    if (!u) {
      u = { id, score: 0, createdAt: new Date().toISOString() };
      this.users.push(u);
    }
    Object.assign(u, { nickname: p.nickname, sido: p.sido, sigungu: p.sigungu, platform: p.platform });
    this.save();
    return { user: u };
  }

  async leaderboard(region, limit, userId) {
    const inScope = (u) => !region || (u.sido === region.sido && u.sigungu === region.sigungu);
    const list = this.users.filter(inScope)
      .sort((a, b) => (b.score || 0) - (a.score || 0) || a.createdAt.localeCompare(b.createdAt));
    const top = withRanks(list.slice(0, limit));
    const me = this.users.find((u) => u.id === userId);
    const myRank = me && inScope(me) ? list.filter((u) => (u.score || 0) > (me.score || 0)).length + 1 : null;
    return { top, me: me ? { rank: myRank, ...userView(me) } : null, total: list.length };
  }

  async report(id, actor, reason, note) {
    const t = this.find(id);
    if (!t || t.hidden) return null;
    if (this.reports.some((r) => r.toiletId === id && r.actor === actor)) {
      return { duplicate: true, hidden: false };
    }
    this.reports.push({ toiletId: id, actor, reason, note, createdAt: new Date().toISOString() });
    t.reportCount = (t.reportCount || 0) + 1;
    if (t.reportCount >= REPORT_HIDE_THRESHOLD) t.hidden = true;
    this.save();
    return { duplicate: false, hidden: t.hidden };
  }

  async listReported() {
    return this.items.filter((t) => t.reportCount > 0)
      .sort((a, b) => b.reportCount - a.reportCount)
      .slice(0, 200)
      .map((t) => ({
        ...adminView(t),
        reports: this.reports.filter((r) => r.toiletId === t.id)
          .map((r) => ({ reason: r.reason, note: r.note, createdAt: r.createdAt })),
      }));
  }

  async setHidden(id, hidden) {
    const t = this.find(id);
    if (!t) return null;
    t.hidden = hidden;
    if (!hidden) {
      // 다시 보이게 하면 신고 기록도 정리
      t.reportCount = 0;
      this.reports = this.reports.filter((r) => r.toiletId !== id);
    }
    this.save();
    return adminView(t);
  }

  // 운영자 삭제: 이용자가 등록한 화장실이면 등록 점수(100점)를 회수
  async remove(id) {
    const t = this.find(id);
    if (!t) return false;
    if (t.source === 'user' && t.ownerId) this.addPoints(t.ownerId, -POINTS.create, 'admin-delete', id);
    this.items = this.items.filter((x) => x.id !== id);
    this.reports = this.reports.filter((r) => r.toiletId !== id);
    this.votes = this.votes.filter((v) => v.toiletId !== id);
    this.save();
    return true;
  }

  async listRevisions(id) {
    return this.revisions.filter((r) => r.toiletId === id).reverse().slice(0, 30);
  }

  async importPublic(rows) {
    let added = 0;
    let updated = 0;
    const now = new Date().toISOString();
    for (const r of rows) {
      const t = this.items.find((x) => x.sourceKey === r.sourceKey);
      if (t) {
        // 이용자가 한 번이라도 수정한 화장실은 공공데이터로 덮어쓰지 않음
        if (t.updatedAt !== t.createdAt) continue;
        Object.assign(t, { name: r.name, address: r.address, openHours: r.openHours, lat: r.lat, lng: r.lng });
        updated++;
      } else {
        this.items.push({
          id: crypto.randomUUID(), description: '', password: '', rating: DEFAULT_RATING,
          hidden: false, reportCount: 0, createdBy: 'public-data', createdAt: now, updatedAt: now,
          ...r, source: 'public',
        });
        added++;
      }
    }
    this.save();
    return { added, updated };
  }

  async count() {
    return this.items.length;
  }
}

/**
 * PostgreSQL 저장소 (Neon 무료 DB 등). DATABASE_URL 이 있으면 사용.
 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const COLUMNS = {
  name: 'name', address: 'address', description: 'description', password: 'password',
  rating: 'rating', openHours: 'open_hours', lat: 'lat', lng: 'lng',
};

function fromRow(r) {
  return {
    id: r.id,
    name: r.name,
    address: r.address,
    description: r.description,
    password: r.password,
    rating: r.rating || DEFAULT_RATING,
    openHours: r.open_hours || '',
    source: r.source,
    lat: r.lat,
    lng: r.lng,
    hidden: r.hidden,
    reportCount: r.report_count,
    ownerId: r.owner_id,
    passwordBy: r.password_by,
    upVotes: r.up_votes || 0,
    downVotes: r.down_votes || 0,
    createdAt: r.created_at.toISOString(),
    updatedAt: r.updated_at.toISOString(),
  };
}

class PgStore {
  constructor(connectionString) {
    const { Pool } = require('pg');
    this.pool = new Pool({ connectionString, max: 5, idleTimeoutMillis: 30000 });
    // Neon 무료 DB 는 쉬는 동안 연결을 끊는다. 끊긴 연결 오류로 서버가 죽지 않게 한다.
    this.pool.on('error', (err) => console.error('DB 연결 오류:', err.message));
  }

  async init() {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS toilets (
        id uuid PRIMARY KEY,
        name text NOT NULL,
        address text NOT NULL DEFAULT '',
        description text NOT NULL DEFAULT '',
        password text NOT NULL DEFAULT '',
        rating smallint NOT NULL DEFAULT ${DEFAULT_RATING},
        open_hours text NOT NULL DEFAULT '',
        lat double precision NOT NULL,
        lng double precision NOT NULL,
        source text NOT NULL DEFAULT 'user',
        source_key text UNIQUE,
        hidden boolean NOT NULL DEFAULT false,
        report_count integer NOT NULL DEFAULT 0,
        created_by text NOT NULL DEFAULT '',
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      )`);
    await this.pool.query('CREATE INDEX IF NOT EXISTS toilets_lat_lng ON toilets (lat, lng)');
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS toilet_revisions (
        id bigserial PRIMARY KEY,
        toilet_id uuid NOT NULL,
        data jsonb NOT NULL,
        actor text NOT NULL DEFAULT '',
        created_at timestamptz NOT NULL DEFAULT now()
      )`);
    await this.pool.query('CREATE INDEX IF NOT EXISTS toilet_revisions_toilet ON toilet_revisions (toilet_id, id)');
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS toilet_reports (
        toilet_id uuid NOT NULL,
        actor text NOT NULL,
        reason text NOT NULL,
        note text NOT NULL DEFAULT '',
        created_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (toilet_id, actor)
      )`);
    await this.pool.query(`
      ALTER TABLE toilets
        ADD COLUMN IF NOT EXISTS owner_id text,
        ADD COLUMN IF NOT EXISTS password_by text,
        ADD COLUMN IF NOT EXISTS up_votes integer NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS down_votes integer NOT NULL DEFAULT 0`);
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id text PRIMARY KEY,
        nickname text NOT NULL,
        sido text NOT NULL,
        sigungu text NOT NULL,
        platform text NOT NULL,
        score integer NOT NULL DEFAULT 0,
        created_at timestamptz NOT NULL DEFAULT now()
      )`);
    await this.pool.query('CREATE UNIQUE INDEX IF NOT EXISTS users_nickname ON users (lower(nickname))');
    await this.pool.query('CREATE INDEX IF NOT EXISTS users_score ON users (score DESC, created_at)');
    await this.pool.query('CREATE INDEX IF NOT EXISTS users_region ON users (sido, sigungu, score DESC)');
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS toilet_votes (
        toilet_id uuid NOT NULL,
        user_id text NOT NULL,
        value smallint NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (toilet_id, user_id)
      )`);
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS points_log (
        id bigserial PRIMARY KEY,
        user_id text NOT NULL,
        delta integer NOT NULL,
        reason text NOT NULL,
        toilet_id uuid,
        created_at timestamptz NOT NULL DEFAULT now()
      )`);
  }

  async addPoints(client, userId, delta, reason, toiletId) {
    if (!userId || !delta) return;
    const { rowCount } = await client.query('UPDATE users SET score = score + $2 WHERE id = $1', [userId, delta]);
    if (rowCount) {
      await client.query(
        'INSERT INTO points_log (user_id, delta, reason, toilet_id) VALUES ($1, $2, $3, $4)',
        [userId, delta, reason, toiletId]
      );
    }
  }

  async addRevision(client, t, actor) {
    await client.query(
      'INSERT INTO toilet_revisions (toilet_id, data, actor) VALUES ($1, $2, $3)',
      [t.id, JSON.stringify(publicView(t)), actor]
    );
  }

  async inBox(b, limit) {
    const { rows } = await this.pool.query(
      `SELECT * FROM toilets
       WHERE NOT hidden AND lat BETWEEN $1 AND $2 AND lng BETWEEN $3 AND $4
       ORDER BY (source = 'user') DESC, rating DESC
       LIMIT $5`,
      [b.minLat, b.maxLat, b.minLng, b.maxLng, limit + 1]
    );
    return { toilets: rows.slice(0, limit).map((r) => publicView(fromRow(r))), truncated: rows.length > limit };
  }

  async nearest(lat, lng, limit) {
    // 가까운 범위부터 넓혀 가며 찾는다 (약 1km → 3km → 10km → 30km)
    const cos = Math.cos((lat * Math.PI) / 180);
    for (const d of [0.01, 0.03, 0.1, 0.3]) {
      const { rows } = await this.pool.query(
        `SELECT * FROM toilets
         WHERE NOT hidden AND lat BETWEEN $1 AND $2 AND lng BETWEEN $3 AND $4
         ORDER BY (lat - $5) * (lat - $5) + ((lng - $6) * $7) * ((lng - $6) * $7)
         LIMIT $8`,
        [lat - d, lat + d, lng - d / cos, lng + d / cos, lat, lng, cos, limit]
      );
      if (rows.length) {
        return rows.map((r) => {
          const t = fromRow(r);
          return { ...publicView(t), distance: Math.round(distanceM(lat, lng, t.lat, t.lng)) };
        }).sort((a, b) => a.distance - b.distance);
      }
    }
    return [];
  }

  async get(id, { includeHidden = false, userId = null } = {}) {
    if (!UUID_RE.test(id)) return null;
    const { rows } = await this.pool.query(
      `SELECT t.*, o.nickname AS owner_name, p.nickname AS password_by_name, v.value AS my_vote
       FROM toilets t
       LEFT JOIN users o ON o.id = t.owner_id
       LEFT JOIN users p ON p.id = t.password_by
       LEFT JOIN toilet_votes v ON v.toilet_id = t.id AND v.user_id = $2
       WHERE t.id = $1`,
      [id, userId || '']
    );
    if (!rows[0]) return null;
    const t = fromRow(rows[0]);
    if (t.hidden && !includeHidden) return null;
    if (includeHidden) return adminView(t);
    return detailView(t, {
      ownerName: rows[0].owner_name, passwordByName: rows[0].password_by_name, myVote: rows[0].my_vote, userId,
    });
  }

  async tx(fn) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const out = await fn(client);
      await client.query('COMMIT');
      return out;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  async create(data, actor, userId = null) {
    return this.tx(async (client) => {
      const { rows } = await client.query(
        `INSERT INTO toilets (id, name, address, description, password, rating, open_hours, lat, lng, created_by,
           owner_id, password_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING *`,
        [crypto.randomUUID(), data.name, data.address, data.description, data.password,
          data.rating, data.openHours || '', data.lat, data.lng, actor, userId, data.password ? userId : null]
      );
      const t = fromRow(rows[0]);
      await this.addRevision(client, t, actor);
      await this.addPoints(client, userId, POINTS.create, 'create', t.id);
      return publicView(t);
    });
  }

  async update(id, data, actor, userId = null) {
    if (!UUID_RE.test(id)) return null;
    return this.tx(async (client) => {
      const cur = await client.query('SELECT password FROM toilets WHERE id = $1 AND NOT hidden FOR UPDATE', [id]);
      if (!cur.rows[0]) return null;
      const keys = Object.keys(COLUMNS).filter((k) => data[k] !== undefined);
      const params = [id, ...keys.map((k) => data[k])];
      const sets = keys.map((k, i) => `${COLUMNS[k]} = $${i + 2}`);
      sets.push('updated_at = now()');
      const pwChanged = data.password !== undefined && data.password !== cur.rows[0].password;
      if (pwChanged) {
        // 비밀번호가 바뀌면 새로 올린 사람 기준으로 투표를 다시 받는다
        params.push(data.password ? userId : null);
        sets.push(`password_by = $${params.length}`, 'up_votes = 0', 'down_votes = 0');
        await client.query('DELETE FROM toilet_votes WHERE toilet_id = $1', [id]);
      }
      const { rows } = await client.query(
        `UPDATE toilets SET ${sets.join(', ')} WHERE id = $1 RETURNING *`,
        params
      );
      const t = fromRow(rows[0]);
      await this.addRevision(client, t, actor);
      return publicView(t);
    });
  }

  async vote(id, userId, value) {
    if (!UUID_RE.test(id)) return null;
    return this.tx(async (client) => {
      const cur = await client.query('SELECT * FROM toilets WHERE id = $1 AND NOT hidden FOR UPDATE', [id]);
      if (!cur.rows[0]) return null;
      const t = fromRow(cur.rows[0]);
      const target = voteTarget(t);
      if (!target) return { error: 'novote' };
      if (target === userId) return { error: 'self' };
      const ins = await client.query(
        'INSERT INTO toilet_votes (toilet_id, user_id, value) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING',
        [id, userId, value]
      );
      if (!ins.rowCount) return { error: 'duplicate' };
      const out = { deleted: false, cleared: false };
      if (value > 0) {
        const { rows } = await client.query('UPDATE toilets SET up_votes = up_votes + 1 WHERE id = $1 RETURNING *', [id]);
        await this.addPoints(client, target, POINTS.up, 'vote-up', id);
        return { ...out, toilet: publicView(fromRow(rows[0])) };
      }
      const { rows } = await client.query('UPDATE toilets SET down_votes = down_votes + 1 WHERE id = $1 RETURNING *', [id]);
      const down = rows[0].down_votes;
      await this.addPoints(client, target, -downPenalty(down), 'vote-down', id);
      if (down < POINTS.wrongLimit) return { ...out, toilet: publicView(fromRow(rows[0])) };
      await client.query('DELETE FROM toilet_votes WHERE toilet_id = $1', [id]);
      if (t.source === 'user') {
        await client.query('DELETE FROM toilet_reports WHERE toilet_id = $1', [id]);
        await client.query('DELETE FROM toilets WHERE id = $1', [id]);
        return { ...out, deleted: true, toilet: null };
      }
      const cleared = await client.query(
        `UPDATE toilets SET password = '', password_by = NULL, up_votes = 0, down_votes = 0, updated_at = now()
         WHERE id = $1 RETURNING *`,
        [id]
      );
      const ct = fromRow(cleared.rows[0]);
      await this.addRevision(client, ct, 'vote');
      return { ...out, cleared: true, toilet: publicView(ct) };
    });
  }

  // ---- 사용자 (구글 로그인) ----
  async getUser(id) {
    const { rows } = await this.pool.query('SELECT * FROM users WHERE id = $1', [id]);
    return rows[0] || null;
  }

  async saveProfile(id, p) {
    try {
      const { rows } = await this.pool.query(
        `INSERT INTO users (id, nickname, sido, sigungu, platform) VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (id) DO UPDATE SET nickname = EXCLUDED.nickname, sido = EXCLUDED.sido,
           sigungu = EXCLUDED.sigungu, platform = EXCLUDED.platform
         RETURNING *`,
        [id, p.nickname, p.sido, p.sigungu, p.platform]
      );
      return { user: rows[0] };
    } catch (err) {
      if (err.code === '23505') return { error: 'nickname' };
      throw err;
    }
  }

  async leaderboard(region, limit, userId) {
    const where = region ? 'WHERE sido = $2 AND sigungu = $3' : '';
    const args = region ? [limit, region.sido, region.sigungu] : [limit];
    const { rows } = await this.pool.query(
      `SELECT * FROM users ${where} ORDER BY score DESC, created_at LIMIT $1`, args
    );
    const top = withRanks(rows);
    const totalRes = await this.pool.query(
      `SELECT count(*)::int AS n FROM users ${region ? 'WHERE sido = $1 AND sigungu = $2' : ''}`,
      region ? [region.sido, region.sigungu] : []
    );
    let me = null;
    const u = userId ? await this.getUser(userId) : null;
    if (u) {
      const inScope = !region || (u.sido === region.sido && u.sigungu === region.sigungu);
      let rank = null;
      if (inScope) {
        const r = await this.pool.query(
          `SELECT count(*)::int AS n FROM users WHERE score > $1 ${region ? 'AND sido = $2 AND sigungu = $3' : ''}`,
          region ? [u.score, region.sido, region.sigungu] : [u.score]
        );
        rank = r.rows[0].n + 1;
      }
      me = { rank, ...userView(u) };
    }
    return { top, me, total: totalRes.rows[0].n };
  }

  async report(id, actor, reason, note) {
    if (!UUID_RE.test(id)) return null;
    return this.tx(async (client) => {
      const exists = await client.query('SELECT 1 FROM toilets WHERE id = $1 AND NOT hidden FOR UPDATE', [id]);
      if (!exists.rows[0]) return null;
      const ins = await client.query(
        `INSERT INTO toilet_reports (toilet_id, actor, reason, note) VALUES ($1, $2, $3, $4)
         ON CONFLICT DO NOTHING`,
        [id, actor, reason, note]
      );
      if (!ins.rowCount) return { duplicate: true, hidden: false };
      const { rows } = await client.query(
        `UPDATE toilets SET report_count = report_count + 1, hidden = (report_count + 1 >= $2)
         WHERE id = $1 RETURNING hidden`,
        [id, REPORT_HIDE_THRESHOLD]
      );
      return { duplicate: false, hidden: rows[0].hidden };
    });
  }

  async listReported() {
    const { rows } = await this.pool.query(
      'SELECT * FROM toilets WHERE report_count > 0 ORDER BY report_count DESC, updated_at DESC LIMIT 200'
    );
    const out = rows.map((r) => ({ ...adminView(fromRow(r)), reports: [] }));
    if (out.length) {
      const reps = await this.pool.query(
        'SELECT toilet_id, reason, note, created_at FROM toilet_reports WHERE toilet_id = ANY($1) ORDER BY created_at',
        [out.map((t) => t.id)]
      );
      for (const r of reps.rows) {
        const t = out.find((x) => x.id === r.toilet_id);
        if (t) t.reports.push({ reason: r.reason, note: r.note, createdAt: r.created_at.toISOString() });
      }
    }
    return out;
  }

  async setHidden(id, hidden) {
    if (!UUID_RE.test(id)) return null;
    return this.tx(async (client) => {
      const { rows } = await client.query(
        hidden
          ? 'UPDATE toilets SET hidden = true WHERE id = $1 RETURNING *'
          : 'UPDATE toilets SET hidden = false, report_count = 0 WHERE id = $1 RETURNING *',
        [id]
      );
      if (!rows[0]) return null;
      if (!hidden) await client.query('DELETE FROM toilet_reports WHERE toilet_id = $1', [id]);
      return adminView(fromRow(rows[0]));
    });
  }

  // 운영자 삭제: 이용자가 등록한 화장실이면 등록 점수(100점)를 회수
  async remove(id) {
    if (!UUID_RE.test(id)) return false;
    return this.tx(async (client) => {
      await client.query('DELETE FROM toilet_reports WHERE toilet_id = $1', [id]);
      await client.query('DELETE FROM toilet_votes WHERE toilet_id = $1', [id]);
      const { rows } = await client.query('DELETE FROM toilets WHERE id = $1 RETURNING source, owner_id', [id]);
      if (!rows[0]) return false;
      if (rows[0].source === 'user') await this.addPoints(client, rows[0].owner_id, -POINTS.create, 'admin-delete', id);
      return true;
    });
  }

  async listRevisions(id) {
    if (!UUID_RE.test(id)) return [];
    const { rows } = await this.pool.query(
      'SELECT * FROM toilet_revisions WHERE toilet_id = $1 ORDER BY id DESC LIMIT 30',
      [id]
    );
    return rows.map((r) => ({
      id: Number(r.id), toiletId: r.toilet_id, data: r.data, actor: r.actor, createdAt: r.created_at.toISOString(),
    }));
  }

  async importPublic(rows) {
    let added = 0;
    let updated = 0;
    await this.tx(async (client) => {
      for (const r of rows) {
        const res = await client.query(
          `INSERT INTO toilets (id, name, address, open_hours, lat, lng, source, source_key, created_by)
           VALUES ($1, $2, $3, $4, $5, $6, 'public', $7, 'public-data')
           ON CONFLICT (source_key) DO UPDATE SET
             name = EXCLUDED.name, address = EXCLUDED.address, open_hours = EXCLUDED.open_hours,
             lat = EXCLUDED.lat, lng = EXCLUDED.lng
           WHERE toilets.updated_at = toilets.created_at
           RETURNING (xmax = 0) AS inserted`,
          [crypto.randomUUID(), r.name, r.address, r.openHours, r.lat, r.lng, r.sourceKey]
        );
        // 이용자가 수정한 화장실은 건너뜀 (행이 안 돌아옴)
        if (!res.rows.length) continue;
        if (res.rows[0].inserted) added++; else updated++;
      }
    });
    return { added, updated };
  }

  async count() {
    const { rows } = await this.pool.query('SELECT count(*)::int AS n FROM toilets');
    return rows[0].n;
  }

  async close() {
    await this.pool.end();
  }
}

function createStore({ databaseUrl, dataFile }) {
  return databaseUrl ? new PgStore(databaseUrl) : new FileStore(dataFile);
}

module.exports = {
  createStore, validateToilet, parseBox, inKorea, distanceM, cleanText,
  KOREA_BOUNDS, REPORT_REASONS, REPORT_HIDE_THRESHOLD, LIMITS, POINTS, userView,
};
