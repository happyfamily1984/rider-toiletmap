# 라이더 화장실맵

배달 라이더와 누구나 **함께 만드는 전국 화장실 지도**입니다. 구글 계정으로 로그인해 화장실 위치·비밀번호·이용 시간을
등록하고 수정하며, 점수와 순위표로 경쟁합니다. 공공데이터포털의 전국 공중화장실 정보가 기본으로 들어갑니다.
네이버 지도 기반 모바일 웹앱과, 그 웹페이지를 여는 안드로이드 앱(플레이스토어용)으로 구성됩니다.

## 기능

- **지도**: 지금 보이는 범위의 화장실만 불러옵니다(최대 500곳, 줌 13 이상).
  초록 핀 = 라이더 등록, 파란 핀 = 공공데이터 공중화장실, 금색 = 별 4·5개. 줌 17 이상이면 `이름 + 별점 + 🔑 비밀번호` 라벨.
- **로그인 (구글)**: 보기는 로그인 없이. 등록·수정·투표는 로그인 + 프로필(닉네임, 주 활동 시·군·구, 주로 타는 곳:
  배민 일반/배민플러스/쿠팡 일반/쿠팡플러스/기타) 필요. 처음 프로필 만들 때 이용 규칙 동의.
  - 안드로이드 앱: 네이티브 구글 로그인(Credential Manager) → `window.onGoogleCredential(idToken)` 으로 웹에 전달
  - 웹: Google Identity Services 버튼
  - 서버는 ID 토큰을 검증하고 구글 계정 고유번호(sub)만 저장 (이메일·이름 저장 안 함)
- **점수 · 순위표** (🏆 버튼)
  - 새 화장실 등록 **+100**
  - 비밀번호가 맞다고 추천(👍 맞아요) **+20** — 비밀번호를 올린 사람에게 (비밀번호 없는 화장실은 등록한 사람에게 "있어요/없어요")
  - 틀렸다고 지적(👎 틀려요) **-30**, 3명이 틀렸다고 하면 **화장실 삭제** + 감점 합계 **-100**(30+30+40, 등록 점수 반환).
    공공데이터 화장실은 지우지 않고 비밀번호만 지움
  - 한 사람이 한 화장실에 한 번만, 내 정보에는 투표 불가. 비밀번호가 바뀌면 투표 초기화
  - 운영자가 삭제하면 등록 점수 100점 회수
  - 순위표: 전국 / 내 지역(시·군·구), 같은 점수는 같은 순위
- **남용 방지**: 기기·IP 별 시간당 횟수 제한(등록 20, 수정 60, 투표 60, 신고 30), 신고 3명이면 자동 숨김, 모든 수정 기록 보관
- **📍 내 근처**, **🔍 지역 검색**, **운영자**(☰ → 운영자, `ADMIN_PASSWORD`): 신고 목록·숨기기·수정 기록·삭제
- **페이지**: `/terms.html`(이용 규칙), `/privacy.html`(개인정보처리방침)

## 환경변수 (서버)

비밀 값은 **절대 코드에 넣지 말고** 환경변수로만 설정합니다.

| 이름 | 설명 |
| --- | --- |
| `NAVER_MAP_CLIENT_ID` | 네이버 클라우드 Maps Client ID (필수) |
| `GOOGLE_CLIENT_ID` | Google Cloud OAuth **웹 애플리케이션** 클라이언트 ID (로그인 필수) |
| `DATABASE_URL` | PostgreSQL 주소 (Neon). 없으면 `data/toilets.json` |
| `SESSION_SECRET` | 임의의 긴 문자열 (로그인 쿠키 서명) |
| `ADMIN_PASSWORD` | 운영자 비밀번호. 비우면 운영자 기능 꺼짐 |
| `NODE_ENV` | `production` |

## 구글 로그인 설정

1. Google Cloud 콘솔 → API 및 서비스 → OAuth 동의 화면 만들기
2. 사용자 인증 정보 → OAuth 클라이언트 ID
   - **웹 애플리케이션**: 승인된 JavaScript 원본에 서버 주소(예: `https://rider-toiletmap.onrender.com`) → 이 ID 를 `GOOGLE_CLIENT_ID`(서버)와 GitHub 변수 `GOOGLE_CLIENT_ID`(앱)에
   - **Android**: 패키지 `com.ridertoilet.map` + SHA-1 (업로드 키, 그리고 Play Console 의 **앱 서명 키** SHA-1 각각 하나씩)

## 공공데이터 넣기

```
DATABASE_URL=... node scripts/public-toilets.js 전국공중화장실표준데이터.csv --dry   # 미리보기
DATABASE_URL=... node scripts/public-toilets.js 전국공중화장실표준데이터.csv
```
[전국공중화장실표준데이터](https://www.data.go.kr/data/15012892/standard.do) CSV (UTF-8 / EUC-KR). 여러 번 실행해도 되고,
이용자가 수정한 화장실은 덮어쓰지 않습니다.

## 실행 / 테스트

```
npm ci
NAVER_MAP_CLIENT_ID=... GOOGLE_CLIENT_ID=... npm start   # http://localhost:3000
npm test                                                  # 파일 저장소 테스트
TEST_DATABASE_URL=postgres://... npm test                 # PostgreSQL 포함
```

## 안드로이드 앱

GitHub Actions 가 push 때마다 APK·AAB 를 빌드하고, main 브랜치면 Releases 에 올립니다.

- 저장소 **Variables**: `WEB_URL`, `GOOGLE_CLIENT_ID`, `ADMOB_APP_ID`, `ADMOB_BANNER_ID` (AdMob 없으면 구글 테스트 광고)
- 저장소 **Secrets**: `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`
- 패키지 이름: `com.ridertoilet.map`
- 최신 파일: `https://github.com/happyfamily1984/rider-toiletmap/releases/latest/download/rider-toiletmap.aab`

## 출처

- 공중화장실: 공공데이터포털 전국공중화장실표준데이터 (공공누리 제1유형)
- 지도: NAVER Maps · 걷는 길: © OpenStreetMap 기여자, FOSSGIS
