#!/usr/bin/env node
// 정적 사이트 사전 점검: 파일 참조, 설정값, 데이터 형식.
// 사용: node scripts/check.mjs [--online]
//   --online 이면 Apps Script 응답까지 확인합니다.
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const problems = [];
const warnings = [];
const fail = (message) => problems.push(message);
const warn = (message) => warnings.push(message);

const read = (relative) => readFile(path.join(root, relative), 'utf8');
const exists = async (relative) => {
  try {
    await stat(path.join(root, relative));
    return true;
  } catch {
    return false;
  }
};

// 1) index.html 이 참조하는 로컬 파일이 실제로 있는지
const html = await read('index.html');
const localRefs = [...html.matchAll(/(?:src|href)="([^"#:]+)"/g)]
  .map((match) => match[1])
  .filter((ref) => !ref.startsWith('//') && !ref.startsWith('data:'));
for (const ref of localRefs) {
  if (!(await exists(ref))) fail(`index.html 이 없는 파일을 참조합니다: ${ref}`);
}

// 2) 필수 메타데이터
if (!/<html[^>]+lang="ko"/.test(html)) fail('index.html 의 <html lang="ko"> 가 없습니다.');
if (!/<meta[^>]+name="viewport"/.test(html)) fail('viewport 메타 태그가 없습니다.');
if (/notranslate/i.test(html)) warn('페이지에 notranslate 가 있어 브라우저 자동 번역이 차단됩니다.');

// 3) config.js 의 설정값
const config = await read('js/config.js');
if (!/HOSPITALS_API_URL\s*=\s*'https?:\/\//.test(config)) fail('js/config.js 의 HOSPITALS_API_URL 이 비어 있습니다.');
if (!/NAVER_MAPS_KEY_ID\s*=\s*'[^']+'/.test(config)) fail('js/config.js 의 NAVER_MAPS_KEY_ID 가 비어 있습니다.');

// 4) 정적 병원 데이터(현재 런타임에서는 미사용)
let hospitals = [];
if (await exists('data/hospitals.json')) {
  try {
    hospitals = JSON.parse(await read('data/hospitals.json'));
    if (!Array.isArray(hospitals)) throw new Error('배열이 아닙니다');
  } catch (error) {
    fail(`data/hospitals.json 파싱 실패: ${error.message}`);
  }
  const referenced = /data\/hospitals\.json/.test(html + config);
  if (!referenced) {
    warn('data/hospitals.json 은 어떤 페이지에서도 참조되지 않습니다(레거시 파일). 레코드 검사는 건너뜁니다.');
  }
  const seen = new Set();
  for (const [index, hospital] of referenced ? hospitals.entries() : []) {
    if (!hospital.name) fail(`data/hospitals.json[${index}] 에 name 이 없습니다.`);
    if (seen.has(hospital.name)) warn(`중복 기관명: ${hospital.name}`);
    seen.add(hospital.name);
    if (hospital.latitude === 37.566 && hospital.longitude === 127) warn(`좌표가 기본값(37.566, 127)입니다: ${hospital.name}`);
  }
}

// 5) 선택: 운영 API 응답 검증
if (process.argv.includes('--online')) {
  const url = config.match(/HOSPITALS_API_URL\s*=\s*'([^']+)'/)?.[1];
  const response = await fetch(url, { redirect: 'follow' });
  if (!response.ok) fail(`Apps Script 응답 실패: HTTP ${response.status}`);
  const payload = await response.json();
  if (payload.ok !== true) fail(`Apps Script ok=false: ${JSON.stringify(payload).slice(0, 200)}`);
  const records = payload.hospitals ?? [];
  if (!records.length) fail('Apps Script 가 병원 데이터를 반환하지 않았습니다.');
  const missingCoords = records.filter((record) => record.latitude == null || record.longitude == null);
  if (missingCoords.length) warn(`좌표 없는 기관 ${missingCoords.length}곳(지도에 표시되지 않음)`);
  const noPhone = records.filter((record) => !record.phone);
  if (noPhone.length) warn(`전화번호 없는 기관 ${noPhone.length}곳`);
  console.log(`online: ${records.length}개 기관, 상태 ${JSON.stringify(countBy(records, 'status'))}`);
}

function countBy(records, key) {
  return records.reduce((accumulator, record) => {
    const value = record[key] ?? 'null';
    accumulator[value] = (accumulator[value] ?? 0) + 1;
    return accumulator;
  }, {});
}

for (const message of warnings) console.log(`경고: ${message}`);
for (const message of problems) console.error(`오류: ${message}`);
console.log(problems.length ? `\n${problems.length}개 오류, ${warnings.length}개 경고` : `\n통과 (경고 ${warnings.length}개)`);
process.exit(problems.length ? 1 : 0);
