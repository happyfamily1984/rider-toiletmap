'use strict';

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

// 공공데이터 공중화장실 (scripts/public-toilets.js --seed 로 만든 파일)
const SEED_FILE = path.join(__dirname, '..', 'seed', 'public-toilets.json.gz');

/**
 * DB 에 공공데이터 화장실이 하나도 없으면 seed 파일에서 넣는다.
 * 서버 시작 뒤 백그라운드로 돌려서 그동안에도 앱은 정상 동작.
 */
async function seedPublicIfEmpty(store, file = SEED_FILE, log = console.log) {
  if (!fs.existsSync(file)) return { skipped: 'no-file' };
  if ((await store.countPublic()) > 0) return { skipped: 'already' };
  const rows = JSON.parse(zlib.gunzipSync(fs.readFileSync(file))).map(
    ([sourceKey, name, address, openHours, lat, lng]) => ({ sourceKey, name, address, openHours, lat, lng })
  );
  let added = 0;
  for (let i = 0; i < rows.length; i += 2000) {
    added += (await store.importPublic(rows.slice(i, i + 2000))).added;
  }
  log(`공공데이터 화장실 ${added}곳을 넣었습니다.`);
  return { added };
}

module.exports = { seedPublicIfEmpty, SEED_FILE };
