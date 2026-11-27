// 챗GPT로 만든 배경 위에 문구 + 실제 앱 화면을 얹어 스토어 이미지 만들기
const { chromium } = require('playwright');
const fs = require('fs');
const dir = __dirname;
const ART = __dirname + '/art/';
const b64 = (f) => 'data:image/png;base64,' + fs.readFileSync(f).toString('base64');
const RIDER = b64(ART + 'feature-rider-night.png');   // 밤거리 라이더 (1536x1024)
const BG = b64(ART + 'screenshot-bg-green.png');      // 초록 지도 배경 (1024x1536)
const ICON = b64(__dirname + '/../../public/icons/icon-512.png');

const SHOTS = [
  ['raw1.png', '확대하면<br>비밀번호가 바로!', '전국 화장실 위치·비밀번호를 한눈에'],
  ['raw3.png', '급할 땐<br>「내 근처」 한 번', '가장 가까운 화장실까지 걷는 길 안내'],
  ['raw2.png', '비번 맞아요 👍<br>틀려요 👎', '라이더들이 함께 확인해서 정확해요'],
  ['raw4.png', '등록하면<br>+100점!', '전국·우리 동네 라이더 순위 경쟁'],
  ['raw5.png', '구글 계정으로<br>3초 시작', '닉네임·활동 지역만 정하면 끝'],
];

const FONT = `*{margin:0;box-sizing:border-box}body{font-family:"Noto Sans CJK KR","Noto Sans KR",sans-serif}`;

function shotHtml(img, title, sub) {
  return `<html><head><style>${FONT}
  body{width:1080px;height:1920px;overflow:hidden;position:relative;background:#14a862 url(${BG}) center top/cover no-repeat}
  .t{position:absolute;top:110px;left:80px;width:700px;color:#fff}
  h1{font-size:92px;font-weight:900;letter-spacing:-3px;line-height:1.12;text-shadow:0 4px 18px rgba(0,60,30,.35)}
  p{margin-top:22px;font-size:42px;font-weight:700;color:#eafff3;text-shadow:0 2px 10px rgba(0,60,30,.3)}
  .ph{position:absolute;left:50%;top:560px;transform:translateX(-50%);width:700px;height:1440px;border-radius:72px;overflow:hidden;
    border:14px solid #0f2219;box-shadow:0 40px 90px rgba(0,40,20,.45),0 0 0 3px rgba(255,255,255,.25);background:#fff}
  .ph img{width:100%;display:block}
  </style></head><body><div class="t"><h1>${title}</h1><p>${sub}</p></div><div class="ph"><img src="${b64(dir + '/' + img)}"></div></body></html>`;
}

// 그래픽 이미지 1024x500: 라이더 그림(오른쪽) + 왼쪽 글자
const featureHtml = `<html><head><style>${FONT}
  body{width:1024px;height:500px;overflow:hidden;position:relative;background:#06183f}
  .bg{position:absolute;right:-40px;top:-40px;width:1110px;height:740px;background:url(${RIDER}) right top/cover no-repeat}
  .shade{position:absolute;inset:0;background:linear-gradient(90deg,rgba(6,22,63,.95) 0%,rgba(6,22,63,.85) 38%,rgba(6,22,63,0) 62%)}
  .l{position:absolute;left:56px;top:0;bottom:0;display:flex;flex-direction:column;justify-content:center;color:#fff;width:520px}
  .brand{display:flex;align-items:center;gap:16px;margin-bottom:18px}
  .brand img{width:76px;height:76px;border-radius:20px;background:#fff;box-shadow:0 6px 20px rgba(0,0,0,.35)}
  .brand span{font-size:22px;font-weight:800;color:#8ff0bf;letter-spacing:-.3px}
  h1{font-size:56px;font-weight:900;letter-spacing:-2px;line-height:1.12;white-space:nowrap}
  h1 em{font-style:normal;color:#3fe08f}
  p{margin-top:14px;font-size:24px;font-weight:700;color:#d6e4ff;line-height:1.4}
  </style></head><body>
  <div class="bg"></div><div class="shade"></div>
  <div class="l"><div class="brand"><img src="${ICON}"><span>라이더 화장실맵</span></div>
  <h1>급할 때,<br><em>가장 가까운</em><br>화장실 바로 찾기</h1><p>전국 화장실 위치와 비밀번호를<br>라이더들이 함께 알려줘요</p></div>
  </body></html>`;

(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1080, height: 1920 } });
  for (let i = 0; i < SHOTS.length; i++) {
    await p.setContent(shotHtml(...SHOTS[i]));
    await p.waitForTimeout(200);
    await p.screenshot({ path: `${dir}/screenshot-${i + 1}.png` });
  }
  await p.setViewportSize({ width: 1024, height: 500 });
  await p.setContent(featureHtml);
  await p.waitForTimeout(200);
  await p.screenshot({ path: `${dir}/feature-graphic.png` });
  await b.close();
})();
