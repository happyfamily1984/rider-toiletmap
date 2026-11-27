# 작업 규칙

- 사용자에게 한국어로 답한다.
- 사용자에게 무언가를 하라고 안내할 때는 **항상 바로 누를 수 있는 링크(URL)를 함께 준다.**
- 저장소가 공개이므로 비밀번호·키·DATABASE_URL·키스토어 등 비밀 값은 코드나 문서에 넣지 않는다(환경변수/Secrets 만).
- 작업 흐름: 브랜치에 커밋 → PR → CI 통과 확인 → main 에 합치기. main 에 합치면 Render 가 자동 배포하고, GitHub Actions 가 Releases 에 새 AAB/APK 를 올린다.
- 스토어 설명·이미지에 다른 회사 상표(배민, 쿠팡, 스타벅스 등)를 쓰지 않는다 (앱 화면 안의 플랫폼 선택지는 예외).

# 프로젝트 현황 (인수인계)

## 서비스
- 앱 이름: 라이더 화장실맵 / 패키지 `com.ridertoilet.map` / 조직 계정으로 플레이스토어 **출시 완료**
- 서버: https://rider-toiletmap.onrender.com (Render 무료 웹 서비스, Docker)
- DB: Neon PostgreSQL (`DATABASE_URL` 은 Render 환경변수에만 있음)
- Render 환경변수: `NAVER_MAP_CLIENT_ID`, `GOOGLE_CLIENT_ID`, `DATABASE_URL`, `SESSION_SECRET`, `ADMIN_PASSWORD`, `NODE_ENV=production`
- 플레이 콘솔 앱: https://play.google.com/console/u/0/developers/9212377768507706097/app/4973657484374909789
- 앱은 서버 웹페이지를 WebView 로 여는 구조 → **화면(public/)·서버 변경은 배포만 하면 앱 재출시 없이 반영**. 앱을 다시 출시해야 하는 건 android/ (아이콘, 위치 권한, 광고, 구글 로그인 등)를 바꿀 때뿐.
  - 앱이 다시 보일 때 `/api/config` 의 `version`(RENDER_GIT_COMMIT)이 바뀌었으면 화면을 자동 새로 고침

## GitHub 설정 (happyfamily1984/rider-toiletmap)
- Variables: `WEB_URL`, `GOOGLE_CLIENT_ID`, `ADMOB_APP_ID`, `ADMOB_BANNER_ID`
- Secrets: `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`(rider-upload), `ANDROID_KEY_PASSWORD`
- 업로드 키 SHA-1: `6A:F1:23:40:6F:65:0F:F1:FF:74:BE:FE:92:B5:3F:29:F4:43:C1:D5` (키 파일·비밀번호는 사용자가 따로 보관)
- AdMob 게시자: `pub-7506800292724499` (public/app-ads.txt)

## 기능 요약
- 구글 로그인(앱: Credential Manager 네이티브 → `window.onGoogleCredential`, 웹: GIS) + 프로필(닉네임·시군구·플랫폼)
- 점수: 등록 +100, 맞아요 +20, 틀려요 -30, 3명 틀려요 → 삭제(공공데이터는 비밀번호만 지움)·합계 -100. 순위표(전국/지역)
- 신고 3명 → 자동 숨김. 운영자 화면은 메뉴에 없음: 브라우저에서 https://rider-toiletmap.onrender.com/#admin (`ADMIN_PASSWORD`)
- 메뉴 '배민플러스 가입문의': `public/app.js` 의 `JOIN_REGIONS` (현재 안양·과천 → 010-7449-6511)
- 위치 권한: 앱이 권한 창 / 앱 설정 / 위치 설정 화면을 자동으로 연다 (`RiderApp.fixLocation`)
- 계정 삭제: 앱 내 정보 → 계정 삭제, 안내 페이지 /delete-account.html

## 데이터
- 공공데이터 공중화장실 50,983곳: `seed/public-toilets.json.gz` (좌표 없는 CSV 를 네이버 지오코딩으로 변환). 서버 시작 때 공공데이터가 비어 있으면 자동 입력
- 예전 '안양 과천 화장실맵'(https://toiletmap-fwuq.onrender.com) 화장실 90곳: `seed/anyang-toilets.json`, 처음 한 번만 자동 입력
- 활동 지역 목록 `public/regions.json` 은 2026 행정구역 반영 (전남광주통합특별시, 인천 제물포·영종·서해·검단구)

## 서버 깨워 두기 (Render 무료 750시간/월)
- **cron-job.org** (사용자 계정): 한국 시간 06~02시, 10분마다 `/api/config` 호출 → 약 620시간/월
- 예비: `.github/workflows/keepalive.yml` (GitHub 예약 실행은 잘 안 돌아서 보조용)
- `/api/config` 는 DB 를 안 써서 Neon 사용 시간은 안 씀. 같은 Render 계정에 예전 앱 서버도 있으니 사용 시간 주의

## 스토어 이미지 다시 만들기
- `tools/store/`: `shots.js`(실제 사이트 + 실제 네이버 지도 + 예시 데이터로 화면 촬영), `compose.js`(챗GPT 배경 `art/` 위에 문구·화면 합성), `listing.txt`(스토어 설명 글)
- 실행: `NODE_PATH=<playwright 경로> node tools/store/shots.js && node tools/store/compose.js` (결과는 tools/store/ 에 png)

## 테스트
- `npm test` (파일 저장소), `TEST_DATABASE_URL=postgres://... npm test` (PostgreSQL 포함)
