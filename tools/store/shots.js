// 플레이스토어 스크린샷: 실제 사이트 + 실제 네이버 지도, API 응답만 예시 데이터로 바꿔서 촬영
const { chromium } = require('playwright');
const dir = __dirname;
const SITE = 'https://rider-toiletmap.onrender.com/';
const HERE = { lat: 37.4979, lng: 127.0276 }; // 강남역

const now = new Date().toISOString();
const T = (id, name, dLat, dLng, o) => ({
  id, name, lat: HERE.lat + dLat, lng: HERE.lng + dLng, address: '', description: '', password: '', rating: 3,
  openHours: '', source: 'user', upVotes: 0, downVotes: 0, createdAt: now, updatedAt: now, ...o,
});
const toilets = [
  T('t1', '강남대로 카페빌딩 2층', 0.0009, 0.0006, { password: '2580*', rating: 5, address: '서울 강남구 강남대로 390', description: '2층 계산대 오른쪽 복도 끝. 깨끗해요', upVotes: 12, openHours: '07:00~22:00' }),
  T('t2', '강남역 지하상가', -0.0003, -0.0004, { source: 'public', address: '서울 강남구 강남대로 지하 396', openHours: '24시간' }),
  T('t3', '역삼 커피빌딩 2층', -0.0011, 0.0011, { password: '0909#', rating: 4, upVotes: 5 }),
  T('t4', '대륙빌딩 B1', 0.0016, -0.0010, { password: '4826*', rating: 3, upVotes: 2 }),
  T('t5', '편의점 옆 상가 3층', -0.0018, -0.0013, { password: '1357', rating: 4, upVotes: 7 }),
  T('t6', '역삼공원 공중화장실', 0.0021, 0.0019, { source: 'public', openHours: '06:00~23:00' }),
  T('t7', '강남타워 4층', 0.0002, 0.0021, { password: '7788*', rating: 3 }),
];
const me = { loggedIn: true, user: { nickname: '번개라이더', sido: '서울특별시', sigungu: '강남구', platform: 'baemin_plus', score: 2340 } };
const board = {
  total: 1284,
  top: [
    ['번개라이더', 'baemin_plus', '강남구', 2340], ['질주왕', 'coupang_plus', '송파구', 2180], ['비오는날', 'baemin', '마포구', 1960],
    ['야간전문', 'coupang', '분당구', 1720], ['달리는곰', 'baemin_plus', '안양시', 1540], ['광주콜사냥꾼', 'baemin', '서구', 1390],
    ['해운대질주', 'coupang_plus', '해운대구', 1260], ['초보탈출', 'etc', '수원시', 1120], ['점심피크', 'baemin', '강남구', 980],
  ].map(([nickname, platform, sigungu, score], i) => ({ rank: i + 1, nickname, platform, sido: '', sigungu, score })),
};
board.me = { ...board.top[0] };

async function page(browser, opts = {}) {
  const ctx = await browser.newContext({
    viewport: { width: 360, height: 740 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true,
    geolocation: { latitude: HERE.lat, longitude: HERE.lng }, permissions: ['geolocation'], locale: 'ko-KR',
  });
  await ctx.addInitScript(() => {
    try { localStorage.setItem('ridermap.loginAsked', '1'); } catch (e) { /* */ }
    window.RiderApp = { googleSignIn() {} };
    const st = document.createElement('style');
    st.textContent = '.hint{display:none!important}.map{z-index:0}';
    document.addEventListener('DOMContentLoaded', () => document.head.appendChild(st));
  });
  // 아직 배포 전인 화면 파일(index.html, style.css, app.js 등)은 로컬 것을 사용
  const PUB = require('path').join(__dirname, '..', '..', 'public');
  const TYPES = { '.html': 'text/html', '.css': 'text/css', '.js': 'application/javascript', '.json': 'application/json', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
  await ctx.route(/rider-toiletmap\.onrender\.com\/(?!api\/)/, (route) => {
    const u = new URL(route.request().url());
    let f = u.pathname === '/' ? '/index.html' : u.pathname;
    const fsx = require('fs');
    if (!fsx.existsSync(PUB + f)) return route.continue();
    return route.fulfill({ contentType: TYPES[require('path').extname(f)] || 'application/octet-stream', body: fsx.readFileSync(PUB + f) });
  });
  await ctx.route('**/api/**', (route) => {
    const u = new URL(route.request().url());
    const p = u.pathname;
    const json = (b) => route.fulfill({ contentType: 'application/json', body: JSON.stringify(b) });
    if (p === '/api/config') return route.continue();
    if (p === '/api/me') return json(opts.me || me);
    if (p === '/api/toilets') return json({ toilets, truncated: false });
    if (p === '/api/toilets/nearest') return json({ toilets: [{ ...toilets[0], distance: 120 }] });
    if (p === '/api/leaderboard') return json(board);
    const m = p.match(/^\/api\/toilets\/(t\d)$/);
    if (m) {
      const t = toilets.find((x) => x.id === m[1]);
      return json({ toilet: { ...t, ownerName: '질주왕', passwordByName: '질주왕', myVote: 0, voteKind: t.password ? 'password' : 'exists', canVote: true, mine: false } });
    }
    return json({});
  });
  const pg = await ctx.newPage();
  pg.on('pageerror', (e) => console.log('PAGEERR', e.message));
  await pg.goto(SITE);
  await pg.waitForSelector('#main:not([hidden])');
  await pg.waitForTimeout(6000); // 지도 타일·내 위치
  return pg;
}

(async () => {
  const b = await chromium.launch();
  // 예열: 첫 페이지는 지도 타일이 안 뜨는 경우가 있어 한 번 열고 닫음
  await (await page(b)).context().close();
  // 1. 확대하면 이름·비밀번호
  let p = await page(b);
  await p.click('#locate-btn');
  await p.waitForTimeout(14000);
  await p.screenshot({ path: dir + '/raw1.png' });
  // 2. 상세 + 맞아요/틀려요
  const label = await p.$('.label-marker');
  if (label) { await label.click(); } else { const pin = await p.$('.pin'); if (pin) await pin.click(); }
  await p.waitForTimeout(1500);
  await p.screenshot({ path: dir + '/raw2.png' });
  await p.context().close();
  // 3. 내 근처 + 걷는 길
  p = await page(b);
  await p.click('#near-btn');
  await p.waitForTimeout(6000);
  await p.screenshot({ path: dir + '/raw3.png' });
  await p.context().close();
  // 4. 순위표
  p = await page(b);
  await p.click('#rank-btn');
  await p.waitForTimeout(1500);
  await p.screenshot({ path: dir + '/raw4.png' });
  await p.context().close();
  // 5. 프로필 만들기
  p = await page(b, { me: { loggedIn: true, user: null } });
  await p.waitForSelector('#profile-form');
  await p.fill('[name=nickname]', '번개라이더');
  await p.selectOption('[name=sido]', '서울특별시');
  await p.selectOption('[name=sigungu]', '강남구');
  await p.click('.plat.baemin_plus span');
  await p.click('.agree input');
  await p.waitForTimeout(500);
  await p.screenshot({ path: dir + '/raw5.png' });
  await b.close();
})();
