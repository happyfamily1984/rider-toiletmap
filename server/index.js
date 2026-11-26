'use strict';

const path = require('path');
const crypto = require('crypto');
const { createApp } = require('./app');
const { createStore } = require('./store');
const { seedPublicIfEmpty, seedAnyangIfMissing } = require('./seed');

const env = process.env;

if (!env.ADMIN_PASSWORD) {
  console.warn('알림: ADMIN_PASSWORD 가 없어 운영자(신고 처리) 기능이 꺼져 있습니다.');
}
if (!env.GOOGLE_CLIENT_ID) {
  console.warn('경고: GOOGLE_CLIENT_ID 가 없어 구글 로그인(등록·수정·투표)이 꺼져 있습니다.');
}
if (!env.NAVER_MAP_CLIENT_ID) {
  console.warn('경고: NAVER_MAP_CLIENT_ID 가 비어 있어 지도가 표시되지 않습니다.');
}

let sessionSecret = env.SESSION_SECRET;
if (!sessionSecret) {
  sessionSecret = crypto.randomBytes(32).toString('hex');
  console.warn('경고: SESSION_SECRET 이 없어 임시 값을 사용합니다. 재시작하면 운영자 로그인이 풀립니다.');
}

const store = createStore({
  databaseUrl: env.DATABASE_URL,
  dataFile: env.DATA_FILE || path.join(__dirname, '..', 'data', 'toilets.json'),
});

const config = {
  // 운영자(신고 처리) 비밀번호. 공개 저장소이므로 코드에 넣지 않고 환경변수로만 설정
  adminPassword: env.ADMIN_PASSWORD || '',
  sessionSecret,
  naverClientId: env.NAVER_MAP_CLIENT_ID || '',
  // 구글 로그인용 OAuth "웹 애플리케이션" 클라이언트 ID (공개 값)
  googleClientId: env.GOOGLE_CLIENT_ID || '',
  contactEmail: env.CONTACT_EMAIL || '',
  secureCookie: env.COOKIE_SECURE ? env.COOKIE_SECURE === 'true' : env.NODE_ENV === 'production',
  trustProxy: env.TRUST_PROXY !== 'false',
};

store
  .init()
  .then(() => {
    const port = Number(env.PORT) || 3000;
    createApp(config, store).listen(port, () => {
      console.log(`라이더 화장실맵 서버 실행 중: http://localhost:${port}`);
      console.log(env.DATABASE_URL ? '저장소: PostgreSQL (DATABASE_URL)' : '저장소: JSON 파일');
      seedPublicIfEmpty(store)
        .catch((err) => console.error('공공데이터 넣기 실패:', err.message))
        .then(() => seedAnyangIfMissing(store))
        .catch((err) => console.error('안양 과천 데이터 옮기기 실패:', err.message));
    });
  })
  .catch((err) => {
    console.error('저장소 연결 실패:', err.message);
    process.exit(1);
  });
