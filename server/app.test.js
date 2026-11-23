'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createApp } = require('./app');
const { createStore, parseBox } = require('./store');
const { parsePublicCsv } = require('../scripts/public-toilets');

// TEST_DATABASE_URL 이 있으면 PostgreSQL 저장소로도 같은 테스트를 돌린다
const BACKENDS = ['file'];
if (process.env.TEST_DATABASE_URL) BACKENDS.push('postgres');

async function startServer(backend, extra = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ridermap-'));
  const store = createStore({
    databaseUrl: backend === 'postgres' ? process.env.TEST_DATABASE_URL : '',
    dataFile: path.join(dir, 'toilets.json'),
  });
  await store.init();
  if (backend === 'postgres') {
    await store.pool.query('DELETE FROM toilet_reports');
    await store.pool.query('DELETE FROM toilet_revisions');
    await store.pool.query('DELETE FROM toilets');
    await store.pool.query('DELETE FROM toilet_votes');
    await store.pool.query('DELETE FROM points_log');
    await store.pool.query('DELETE FROM users');
  }
  const app = createApp({
    sessionSecret: 'test-secret',
    naverClientId: 'test-client',
    secureCookie: false,
    trustProxy: true,
    adminPassword: 'test-admin-pw',
    // 테스트용 구글 토큰: "tok:<사용자번호>"
    verifyGoogleToken: async (t) => {
      if (!t.startsWith('tok:')) throw new Error('bad token');
      return { sub: t.slice(4) };
    },
    ...extra,
  }, store);
  const listener = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  const base = `http://127.0.0.1:${listener.address().port}`;
  // device: 기기 ID (사용자 구분), ip: X-Forwarded-For 로 흉내
  const client = (device = 'device-aaaaaaaaaaaaaaaa', ip = '10.0.0.1') => {
    const jar = {};
    return async (method, url, body) => {
      const cookie = Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; ');
      const res = await fetch(base + url, {
        method,
        headers: {
          'Content-Type': 'application/json',
          'X-Device-Id': device,
          'X-Forwarded-For': ip,
          ...(cookie ? { Cookie: cookie } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
      });
      const setCookie = res.headers.get('set-cookie');
      if (setCookie) {
        const [k, v] = setCookie.split(';')[0].split('=');
        if (v) jar[k] = v; else delete jar[k];
      }
      return { status: res.status, body: await res.json().catch(() => null) };
    };
  };
  const close = () => {
    listener.close();
    if (store.close) store.close();
  };
  // 구글 로그인 + 프로필(닉네임·지역·플랫폼)까지 마친 사용자
  const member = async (device = 'device-aaaaaaaaaaaaaaaa', ip = '10.0.0.1', nickname = `u_${device.slice(-6)}`) => {
    const call = client(device, ip);
    assert.strictEqual((await call('POST', '/api/auth/google', { credential: `tok:${device}` })).status, 200);
    const p = await call('POST', '/api/me/profile', { nickname, sido: '서울특별시', sigungu: '중구', platform: 'baemin' });
    assert.strictEqual(p.status, 200, JSON.stringify(p.body));
    return call;
  };
  return { store, client, member, close, base };
}

// 서울시청 근처
const sample = {
  name: '시청역 화장실',
  address: '서울 중구 세종대로 110',
  description: '1번 출구 옆',
  password: '1234*',
  lat: 37.5665,
  lng: 126.978,
};
const SEOUL_BOX = '37.55,126.96,37.58,126.99';

test('지도 범위 문자열 검사', () => {
  assert.deepStrictEqual(parseBox('37.5,126.9,37.6,127.0'), { minLat: 37.5, minLng: 126.9, maxLat: 37.6, maxLng: 127 });
  assert.strictEqual(parseBox('37.6,126.9,37.5,127.0'), null); // 거꾸로
  assert.strictEqual(parseBox('34,124,38,129'), null); // 너무 넓음
  assert.strictEqual(parseBox('abc'), null);
});

test('공공데이터 CSV 읽기', () => {
  const csv = [
    '번호,구분,화장실명,소재지도로명주소,소재지지번주소,개방시간,개방시간상세,WGS84위도,WGS84경도,데이터기준일자',
    '1,공중화장실,"서울역, 공중화장실",서울 중구 한강대로 405,,24시간,,37.5547,126.9706,2025-01-01',
    '2,공중화장실,위치없음,,,,,,,2025-01-01',
    '3,개방화장실,제주 화장실,제주시 어딘가,,09:00~18:00,평일만,33.5,126.5,2025-01-01',
  ].join('\n');
  const rows = parsePublicCsv(csv);
  assert.strictEqual(rows.length, 2);
  assert.strictEqual(rows[0].name, '서울역, 공중화장실');
  assert.strictEqual(rows[0].openHours, '24시간');
  assert.strictEqual(rows[1].openHours, '09:00~18:00 평일만');
  assert.ok(rows[0].sourceKey && rows[0].sourceKey !== rows[1].sourceKey);
});

for (const backend of BACKENDS) {
  test(`[${backend}] 로그인한 누구나 등록·수정, 보기는 로그인 없이`, async () => {
    const { client, member, close } = await startServer(backend);
    const guest = client('device-gggggggggggggggg', '10.0.0.7');
    const call = await member();
    try {
      assert.strictEqual((await call('GET', '/api/config')).body.naverClientId, 'test-client');
      // 로그인 안 하면 등록 불가
      const noLogin = await guest('POST', '/api/toilets', sample);
      assert.strictEqual(noLogin.status, 401);
      assert.strictEqual(noLogin.body.needLogin, true);
      const created = await call('POST', '/api/toilets', sample);
      assert.strictEqual(created.status, 201);
      const id = created.body.toilet.id;
      assert.strictEqual(created.body.toilet.source, 'user');

      const list = await call('GET', `/api/toilets?box=${SEOUL_BOX}`);
      assert.strictEqual(list.body.toilets.length, 1);
      assert.strictEqual(list.body.truncated, false);
      // 범위 밖
      assert.strictEqual((await call('GET', '/api/toilets?box=35.1,129.0,35.2,129.1')).body.toilets.length, 0);
      // 너무 넓은 범위
      assert.strictEqual((await call('GET', '/api/toilets?box=33,124,38,130')).status, 400);

      // 다른 사람이 수정 (위치는 못 바꿈)
      const other = await member('device-bbbbbbbbbbbbbbbb', '10.0.0.2');
      const upd = await other('PUT', `/api/toilets/${id}`, { password: '5678#', lat: 35, lng: 129 });
      assert.strictEqual(upd.status, 200);
      assert.strictEqual(upd.body.toilet.password, '5678#');
      assert.strictEqual(upd.body.toilet.lat, sample.lat);
      assert.strictEqual(upd.body.toilet.name, sample.name);

      // 공개 API 로는 삭제 불가
      assert.strictEqual((await call('DELETE', `/api/toilets/${id}`)).status, 404);
      assert.strictEqual((await guest('GET', `/api/toilets/${id}`)).status, 200);
      assert.strictEqual((await guest('GET', `/api/toilets?box=${SEOUL_BOX}`)).body.toilets.length, 1);
    } finally {
      close();
    }
  });

  test(`[${backend}] 전국 어디든 가능, 해외는 거부, 이름 비우면 '화장실'`, async () => {
    const { member, close } = await startServer(backend);
    const call = await member();
    try {
      // 부산, 제주
      assert.strictEqual((await call('POST', '/api/toilets', { ...sample, lat: 35.1796, lng: 129.0756 })).status, 201);
      assert.strictEqual((await call('POST', '/api/toilets', { ...sample, lat: 33.4996, lng: 126.5312 })).status, 201);
      // 도쿄
      assert.strictEqual((await call('POST', '/api/toilets', { ...sample, lat: 35.6762, lng: 139.6503 })).status, 400);
      const noName = await call('POST', '/api/toilets', { ...sample, name: '  ' });
      assert.strictEqual(noName.body.toilet.name, '화장실');
      assert.strictEqual((await call('POST', '/api/toilets', { ...sample, rating: 6 })).status, 400);
    } finally {
      close();
    }
  });

  test(`[${backend}] 가장 가까운 화장실`, async () => {
    const { member, close } = await startServer(backend);
    const call = await member();
    try {
      assert.deepStrictEqual((await call('GET', '/api/toilets/nearest?lat=37.5665&lng=126.978')).body.toilets, []);
      await call('POST', '/api/toilets', { ...sample, name: '먼곳', lat: 37.58, lng: 126.99 });
      await call('POST', '/api/toilets', { ...sample, name: '가까운곳', lat: 37.5667, lng: 126.9782 });
      const near = (await call('GET', '/api/toilets/nearest?lat=37.5665&lng=126.978')).body.toilets;
      assert.strictEqual(near[0].name, '가까운곳');
      assert.ok(near[0].distance < 50);
      assert.strictEqual((await call('GET', '/api/toilets/nearest?lat=0&lng=0')).status, 400);
    } finally {
      close();
    }
  });

  test(`[${backend}] 신고 3명이면 자동 숨김, 같은 사람 중복 신고는 무시, 운영자가 복구·삭제`, async () => {
    const { client, member, close } = await startServer(backend);
    const a = await member('device-aaaaaaaaaaaaaaaa', '10.0.0.1');
    const b = client('device-bbbbbbbbbbbbbbbb', '10.0.0.2');
    const c = client('device-cccccccccccccccc', '10.0.0.3');
    try {
      const id = (await a('POST', '/api/toilets', sample)).body.toilet.id;
      assert.strictEqual((await a('POST', `/api/toilets/${id}/report`, { reason: 'nope' })).status, 400);
      assert.strictEqual((await a('POST', `/api/toilets/${id}/report`, { reason: 'wrong', note: '없는 화장실' })).body.hidden, false);
      assert.strictEqual((await a('POST', `/api/toilets/${id}/report`, { reason: 'wrong' })).body.duplicate, true);
      assert.strictEqual((await b('POST', `/api/toilets/${id}/report`, { reason: 'spam' })).body.hidden, false);
      assert.strictEqual((await c('POST', `/api/toilets/${id}/report`, { reason: 'privacy' })).body.hidden, true);
      // 숨겨지면 지도·상세·수정에서 사라짐
      assert.strictEqual((await a('GET', `/api/toilets?box=${SEOUL_BOX}`)).body.toilets.length, 0);
      assert.strictEqual((await a('GET', `/api/toilets/${id}`)).status, 404);
      assert.strictEqual((await a('PUT', `/api/toilets/${id}`, { name: 'x' })).status, 404);

      // 운영자
      const adm = client('device-adminadminadmin', '10.0.0.9');
      assert.strictEqual((await adm('GET', '/api/admin/reported')).status, 401);
      assert.strictEqual((await adm('POST', '/api/admin/login', { password: '000000' })).status, 401);
      assert.strictEqual((await adm('POST', '/api/admin/login', { password: 'test-admin-pw' })).status, 200);
      const reported = (await adm('GET', '/api/admin/reported')).body.toilets;
      assert.strictEqual(reported.length, 1);
      assert.strictEqual(reported[0].hidden, true);
      assert.strictEqual(reported[0].reportCount, 3);
      assert.strictEqual(reported[0].reports.length, 3);
      assert.strictEqual((await adm('GET', `/api/admin/toilets/${id}/revisions`)).body.revisions.length, 1);
      // 복구하면 다시 보임, 신고 기록 초기화
      assert.strictEqual((await adm('POST', `/api/admin/toilets/${id}/unhide`)).body.toilet.hidden, false);
      assert.strictEqual((await a('GET', `/api/toilets?box=${SEOUL_BOX}`)).body.toilets.length, 1);
      assert.strictEqual((await adm('GET', '/api/admin/reported')).body.toilets.length, 0);
      // 삭제
      assert.strictEqual((await adm('DELETE', `/api/admin/toilets/${id}`)).status, 200);
      assert.strictEqual((await a('GET', `/api/toilets/${id}`)).status, 404);
    } finally {
      close();
    }
  });

  test(`[${backend}] 수정 기록이 남음`, async () => {
    const { client, member, close } = await startServer(backend);
    const call = await member();
    try {
      const id = (await call('POST', '/api/toilets', sample)).body.toilet.id;
      await call('PUT', `/api/toilets/${id}`, { password: '1111' });
      await call('PUT', `/api/toilets/${id}`, { password: '2222' });
      const adm = client('device-adminadminadmin', '10.0.0.9');
      await adm('POST', '/api/admin/login', { password: 'test-admin-pw' });
      const revs = (await adm('GET', `/api/admin/toilets/${id}/revisions`)).body.revisions;
      assert.deepStrictEqual(revs.map((r) => r.data.password), ['2222', '1111', '1234*']);
    } finally {
      close();
    }
  });

  test(`[${backend}] 등록 횟수 제한`, async () => {
    const { member, close } = await startServer(backend, { rate: { create: 2 } });
    const call = await member();
    try {
      assert.strictEqual((await call('POST', '/api/toilets', sample)).status, 201);
      assert.strictEqual((await call('POST', '/api/toilets', sample)).status, 201);
      assert.strictEqual((await call('POST', '/api/toilets', sample)).status, 429);
      // 다른 사람은 가능
      assert.strictEqual((await (await member('device-bbbbbbbbbbbbbbbb', '10.0.0.2'))('POST', '/api/toilets', sample)).status, 201);
    } finally {
      close();
    }
  });

  test(`[${backend}] 공공데이터 불러오기 (다시 불러오면 갱신)`, async () => {
    const { store, member, close } = await startServer(backend);
    const call = await member();
    try {
      const rows = [
        { sourceKey: 'k1', name: '서울역 공중화장실', address: '서울 중구', openHours: '24시간', lat: 37.5547, lng: 126.9706 },
        { sourceKey: 'k2', name: '시청 공중화장실', address: '서울 중구', openHours: '', lat: 37.566, lng: 126.977 },
      ];
      assert.deepStrictEqual(await store.importPublic(rows), { added: 2, updated: 0 });
      assert.deepStrictEqual(await store.importPublic([{ ...rows[0], openHours: '06:00~24:00' }]), { added: 0, updated: 1 });
      const list = (await call('GET', '/api/toilets?box=37.55,126.96,37.57,126.98')).body.toilets;
      assert.strictEqual(list.length, 2);
      const st = list.find((t) => t.name === '서울역 공중화장실');
      assert.strictEqual(st.source, 'public');
      assert.strictEqual(st.openHours, '06:00~24:00');
      // 공공데이터 화장실에도 비밀번호·설명 추가 가능
      await new Promise((r) => setTimeout(r, 5));
      assert.strictEqual((await call('PUT', `/api/toilets/${st.id}`, { name: '서울역 1층 화장실', description: '2층' })).body.toilet.description, '2층');
      // 이용자가 수정한 화장실은 다시 가져와도 덮어쓰지 않음
      assert.deepStrictEqual(await store.importPublic([{ ...rows[0], openHours: '바뀜' }]), { added: 0, updated: 0 });
      const after = (await call('GET', `/api/toilets/${st.id}`)).body.toilet;
      assert.strictEqual(after.name, '서울역 1층 화장실');
      assert.strictEqual(after.openHours, '06:00~24:00');
    } finally {
      close();
    }
  });

  test(`[${backend}] 구글 로그인 · 프로필 · 닉네임 중복`, async () => {
    const { client, close } = await startServer(backend);
    const a = client('device-aaaaaaaaaaaaaaaa', '10.0.0.1');
    const b = client('device-bbbbbbbbbbbbbbbb', '10.0.0.2');
    try {
      assert.deepStrictEqual((await a('GET', '/api/me')).body, { loggedIn: false, user: null });
      assert.strictEqual((await a('POST', '/api/auth/google', { credential: 'forged' })).status, 401);
      assert.strictEqual((await a('POST', '/api/me/profile', { nickname: '번개' })).status, 401);
      assert.strictEqual((await a('POST', '/api/auth/google', { credential: 'tok:111' })).status, 200);
      assert.deepStrictEqual((await a('GET', '/api/me')).body, { loggedIn: true, user: null });
      // 프로필 없이 등록하면 프로필 먼저
      const np = await a('POST', '/api/toilets', sample);
      assert.strictEqual(np.status, 403);
      assert.strictEqual(np.body.needProfile, true);
      const prof = { nickname: '번개라이더', sido: '경기도', sigungu: '안양시', platform: 'coupang_plus' };
      assert.strictEqual((await a('POST', '/api/me/profile', { ...prof, sigungu: '해운대구' })).status, 400);
      assert.strictEqual((await a('POST', '/api/me/profile', { ...prof, platform: 'yogiyo' })).status, 400);
      assert.strictEqual((await a('POST', '/api/me/profile', { ...prof, nickname: 'a' })).status, 400);
      assert.strictEqual((await a('POST', '/api/me/profile', { ...prof, nickname: '운영자' })).status, 400);
      const ok = await a('POST', '/api/me/profile', prof);
      assert.deepStrictEqual(ok.body.user, { ...prof, score: 0 });
      await b('POST', '/api/auth/google', { credential: 'tok:222' });
      assert.strictEqual((await b('POST', '/api/me/profile', { ...prof, nickname: '번개라이더' })).status, 409);
      // 닉네임·지역은 나중에 바꿀 수 있음
      assert.strictEqual((await a('POST', '/api/me/profile', { ...prof, sido: '서울특별시', sigungu: '강남구' })).body.user.sigungu, '강남구');
      await a('POST', '/api/auth/logout');
      assert.strictEqual((await a('GET', '/api/me')).body.loggedIn, false);
    } finally {
      close();
    }
  });

  test(`[${backend}] 점수: 등록 100, 맞아요 +20, 틀려요 -30, 3번 틀리면 삭제·합계 -100, 순위표`, async () => {
    const { member, client, close } = await startServer(backend);
    const owner = await member('device-aaaaaaaaaaaaaaaa', '10.0.0.1', '주인');
    const v1 = await member('device-bbbbbbbbbbbbbbbb', '10.0.0.2', '투표1');
    const v2 = await member('device-cccccccccccccccc', '10.0.0.3', '투표2');
    const v3 = await member('device-dddddddddddddddd', '10.0.0.4', '투표3');
    const v4 = await member('device-eeeeeeeeeeeeeeee', '10.0.0.5', '투표4');
    const score = async (call) => (await call('GET', '/api/me')).body.user.score;
    try {
      const id = (await owner('POST', '/api/toilets', sample)).body.toilet.id;
      assert.strictEqual(await score(owner), 100);
      const d = (await v1('GET', `/api/toilets/${id}`)).body.toilet;
      assert.strictEqual(d.ownerName, '주인');
      assert.strictEqual(d.passwordByName, '주인');
      assert.strictEqual(d.voteKind, 'password');
      assert.strictEqual(d.canVote, true);
      assert.strictEqual((await owner('GET', `/api/toilets/${id}`)).body.toilet.canVote, false);
      // 자기 자신에게는 투표 불가, 로그인 안 하면 불가
      assert.strictEqual((await owner('POST', `/api/toilets/${id}/vote`, { vote: 'up' })).status, 400);
      assert.strictEqual((await client('device-zzzzzzzzzzzzzzzz')('POST', `/api/toilets/${id}/vote`, { vote: 'up' })).status, 401);

      assert.strictEqual((await v1('POST', `/api/toilets/${id}/vote`, { vote: 'up' })).body.toilet.upVotes, 1);
      assert.strictEqual((await v1('POST', `/api/toilets/${id}/vote`, { vote: 'down' })).status, 409); // 한 번만
      assert.strictEqual(await score(owner), 120);
      assert.strictEqual((await v1('GET', `/api/toilets/${id}`)).body.toilet.myVote, 1);

      assert.strictEqual((await v2('POST', `/api/toilets/${id}/vote`, { vote: 'down' })).body.deleted, false);
      assert.strictEqual(await score(owner), 90);
      await v3('POST', `/api/toilets/${id}/vote`, { vote: 'down' });
      assert.strictEqual(await score(owner), 60);
      const last = await v4('POST', `/api/toilets/${id}/vote`, { vote: 'down' });
      assert.strictEqual(last.body.deleted, true);
      assert.strictEqual(await score(owner), 20); // 120 - 100
      assert.strictEqual((await v1('GET', `/api/toilets/${id}`)).status, 404);

      // 순위표
      const id2 = (await v4('POST', '/api/toilets', { ...sample, name: '두번째' })).body.toilet.id;
      await v1('POST', `/api/toilets/${id2}/vote`, { vote: 'up' });
      const lb = (await v1('GET', '/api/leaderboard')).body;
      assert.deepStrictEqual(lb.top.slice(0, 2).map((u) => [u.rank, u.nickname, u.score]), [[1, '투표4', 120], [2, '주인', 20]]);
      assert.strictEqual(lb.me.nickname, '투표1');
      assert.strictEqual(lb.me.rank, 3);
      assert.strictEqual(lb.total, 5);
      // 지역별
      assert.strictEqual((await v1('GET', `/api/leaderboard?sido=${encodeURIComponent('서울특별시')}&sigungu=${encodeURIComponent('중구')}`)).body.total, 5);
      assert.strictEqual((await v1('GET', `/api/leaderboard?sido=${encodeURIComponent('경기도')}&sigungu=${encodeURIComponent('안양시')}`)).body.total, 0);
      assert.strictEqual((await v1('GET', '/api/leaderboard?sido=x&sigungu=y')).status, 400);
    } finally {
      close();
    }
  });

  test(`[${backend}] 비밀번호를 바꾸면 투표 초기화, 공공데이터는 3번 틀리면 비밀번호만 지움, 운영자 삭제는 100점 회수`, async () => {
    const { store, member, close } = await startServer(backend);
    const a = await member('device-aaaaaaaaaaaaaaaa', '10.0.0.1', '에이');
    const b = await member('device-bbbbbbbbbbbbbbbb', '10.0.0.2', '비이');
    const c = await member('device-cccccccccccccccc', '10.0.0.3', '씨이');
    const d = await member('device-dddddddddddddddd', '10.0.0.4', '디이');
    const score = async (call) => (await call('GET', '/api/me')).body.user.score;
    try {
      await store.importPublic([{ sourceKey: 'p1', name: '공원 화장실', address: '서울', openHours: '', lat: 37.5665, lng: 126.978 }]);
      const pub = (await a('GET', `/api/toilets?box=${SEOUL_BOX}`)).body.toilets[0];
      // 비밀번호 없는 공공데이터 화장실은 투표 대상 아님
      assert.strictEqual((await b('GET', `/api/toilets/${pub.id}`)).body.toilet.canVote, false);
      assert.strictEqual((await b('POST', `/api/toilets/${pub.id}/vote`, { vote: 'up' })).status, 400);
      // a 가 비밀번호 추가 → a 가 점수 대상 (등록 점수는 없음)
      await a('PUT', `/api/toilets/${pub.id}`, { password: '0000' });
      assert.strictEqual(await score(a), 0);
      await b('POST', `/api/toilets/${pub.id}/vote`, { vote: 'down' });
      assert.strictEqual(await score(a), -30);
      // b 가 비밀번호를 고침 → 투표 초기화, 이제 b 가 대상
      await b('PUT', `/api/toilets/${pub.id}`, { password: '1111' });
      const t = (await c('GET', `/api/toilets/${pub.id}`)).body.toilet;
      assert.deepStrictEqual([t.downVotes, t.passwordByName, t.canVote], [0, '비이', true]);
      // 설명만 고치면 투표 유지
      await c('POST', `/api/toilets/${pub.id}/vote`, { vote: 'down' });
      await a('PUT', `/api/toilets/${pub.id}`, { description: '공원 입구' });
      assert.strictEqual((await c('GET', `/api/toilets/${pub.id}`)).body.toilet.downVotes, 1);
      await d('POST', `/api/toilets/${pub.id}/vote`, { vote: 'down' });
      const third = await a('POST', `/api/toilets/${pub.id}/vote`, { vote: 'down' });
      assert.strictEqual(third.body.cleared, true);
      assert.strictEqual(third.body.toilet.password, '');
      assert.strictEqual(await score(b), -100);
      assert.strictEqual((await a('GET', `/api/toilets/${pub.id}`)).status, 200); // 화장실은 남음

      // 운영자 삭제는 등록 점수 회수
      const id = (await c('POST', '/api/toilets', sample)).body.toilet.id;
      assert.strictEqual(await score(c), 100);
      const adm = await member('device-adminadminadmin', '10.0.0.9', '관리');
      await adm('POST', '/api/admin/login', { password: 'test-admin-pw' });
      assert.strictEqual((await adm('DELETE', `/api/admin/toilets/${id}`)).status, 200);
      assert.strictEqual(await score(c), 0);
    } finally {
      close();
    }
  });

  test(`[${backend}] ADMIN_PASSWORD 없으면 운영자 기능 꺼짐`, async () => {
    const { client, close } = await startServer(backend, { adminPassword: '' });
    const call = client();
    try {
      assert.deepStrictEqual((await call('GET', '/api/admin/session')).body, { enabled: false, admin: false });
      assert.strictEqual((await call('POST', '/api/admin/login', { password: '' })).status, 503);
    } finally {
      close();
    }
  });
}
