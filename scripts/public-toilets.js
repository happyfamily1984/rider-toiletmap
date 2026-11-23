'use strict';

/**
 * 공공데이터포털 "전국공중화장실표준데이터" CSV 를 화장실 목록으로 바꿔 DB 에 넣는다.
 *
 *   DATABASE_URL=postgres://... node scripts/public-toilets.js 전국공중화장실표준데이터.csv
 *
 * - 파일 인코딩은 UTF-8 / EUC-KR(CP949) 모두 됩니다.
 * - 같은 파일을 다시 넣으면 이름·주소·개방시간·위치만 갱신됩니다(사용자가 추가한 비밀번호·설명은 유지).
 * - 출처: 공공데이터포털(data.go.kr) 전국공중화장실표준데이터, 공공누리 제1유형
 */

const fs = require('fs');
const crypto = require('crypto');
const { inKorea, cleanText, LIMITS } = require('../server/store');

// 이동화장실(행사용 등 임시)은 제외
const SKIP_KINDS = new Set(['이동화장실']);

// 큰따옴표로 감싼 값(쉼표·줄바꿈 포함)을 처리하는 간단한 CSV 파서
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else quoted = false;
      } else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(field); field = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.some((v) => v !== '')) rows.push(row);
      row = [];
    } else field += ch;
  }
  row.push(field);
  if (row.some((v) => v !== '')) rows.push(row);
  return rows;
}

function decode(buf) {
  if (typeof buf === 'string') return buf;
  const utf8 = new TextDecoder('utf-8', { fatal: false }).decode(buf);
  // 깨진 글자(�)가 많으면 EUC-KR 로 다시 읽기
  const broken = (utf8.match(/�/g) || []).length;
  return broken > 5 ? new TextDecoder('euc-kr').decode(buf) : utf8.replace(/^﻿/, '');
}

function findCol(header, names) {
  for (const n of names) {
    const i = header.findIndex((h) => h.replace(/\s/g, '') === n);
    if (i >= 0) return i;
  }
  return -1;
}

/** CSV 텍스트(또는 Buffer) → [{ sourceKey, name, address, openHours, lat, lng }] */
function parsePublicCsv(input) {
  const rows = parseCsv(decode(input));
  if (!rows.length) return [];
  const header = rows[0].map((h) => h.trim());
  const col = {
    name: findCol(header, ['화장실명']),
    road: findCol(header, ['소재지도로명주소']),
    jibun: findCol(header, ['소재지지번주소']),
    open: findCol(header, ['개방시간']),
    openDetail: findCol(header, ['개방시간상세']),
    kind: findCol(header, ['구분명', '구분']),
    lat: findCol(header, ['WGS84위도', '위도']),
    lng: findCol(header, ['WGS84경도', '경도']),
  };
  if (col.name < 0 || col.lat < 0 || col.lng < 0) {
    throw new Error('화장실명/위도/경도 열을 찾지 못했어요. 전국공중화장실표준데이터 CSV 가 맞는지 확인해 주세요.');
  }
  const out = [];
  const seen = new Set();
  for (const r of rows.slice(1)) {
    if (col.kind >= 0 && SKIP_KINDS.has(r[col.kind])) continue;
    const lat = Number(r[col.lat]);
    const lng = Number(r[col.lng]);
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || !inKorea(lat, lng)) continue;
    const name = cleanText(r[col.name], LIMITS.name) || '공중화장실';
    const address = cleanText((col.road >= 0 && r[col.road]) || (col.jibun >= 0 && r[col.jibun]) || '', LIMITS.address);
    const openHours = cleanText(
      [col.open >= 0 ? r[col.open] : '', col.openDetail >= 0 ? r[col.openDetail] : ''].filter((v) => v && v.trim()).join(' '),
      LIMITS.openHours
    );
    const sourceKey = crypto.createHash('sha1').update(`${name}|${lat.toFixed(5)}|${lng.toFixed(5)}`).digest('hex').slice(0, 20);
    if (seen.has(sourceKey)) continue;
    seen.add(sourceKey);
    out.push({ sourceKey, name, address, openHours, lat: Math.round(lat * 1e7) / 1e7, lng: Math.round(lng * 1e7) / 1e7 });
  }
  return out;
}

async function main() {
  const file = process.argv[2];
  if (!file) {
    console.error('사용법: node scripts/public-toilets.js <전국공중화장실표준데이터.csv>');
    process.exit(1);
  }
  const rows = parsePublicCsv(fs.readFileSync(file));
  console.log(`읽은 화장실: ${rows.length}곳`);
  if (process.argv.includes('--dry')) return;
  // --seed <파일.json.gz>: DB 대신 서버가 시작할 때 자동으로 넣을 데이터 파일로 저장
  const seedIdx = process.argv.indexOf('--seed');
  if (seedIdx > 0) {
    const out = process.argv[seedIdx + 1];
    const compact = rows.map((r) => [r.sourceKey, r.name, r.address, r.openHours, r.lat, r.lng]);
    fs.writeFileSync(out, require('zlib').gzipSync(JSON.stringify(compact), { level: 9 }));
    console.log(`저장: ${out}`);
    return;
  }
  const { createStore } = require('../server/store');
  const path = require('path');
  const store = createStore({
    databaseUrl: process.env.DATABASE_URL,
    dataFile: process.env.DATA_FILE || path.join(__dirname, '..', 'data', 'toilets.json'),
  });
  await store.init();
  let added = 0;
  let updated = 0;
  for (let i = 0; i < rows.length; i += 1000) {
    const r = await store.importPublic(rows.slice(i, i + 1000));
    added += r.added;
    updated += r.updated;
    process.stdout.write(`\r${Math.min(i + 1000, rows.length)} / ${rows.length}`);
  }
  console.log(`\n추가 ${added}곳, 갱신 ${updated}곳`);
  if (store.close) await store.close();
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}

module.exports = { parsePublicCsv, parseCsv };
