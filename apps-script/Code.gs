/**
 * 곁에 — Google Sheets 읽기 전용 공개 API
 * 원본 시트: DAH-외국인의료지원기관 찾기 (아래 SPREADSHEET_ID)
 * 배포: 웹 앱 / 실행 사용자: 나 / 액세스: 모든 사용자
 * 응답에 포함할 모든 셀은 공개 가능한 내용이어야 합니다.
 */
const SPREADSHEET_ID = '1EmHCQAfs-sDlWph-YU-CDhXIIMGOM26E8xCMiXvIZYA';
const SOURCE_SHEETS = {
  hospitals: '확인 완료',
  programs: [
    { id: 'national', sheet: '외국인근로자등 의료지원사업 상세', title: '외국인근로자 등 의료지원사업', region: '전국 · 보건복지부' },
    { id: 'seoul', sheet: '외국인근로자등 의료지원사업 상세(서울시)', title: '외국인근로자 등 의료지원사업', region: '서울특별시' },
    { id: 'redcross', sheet: '적십자병원 지원 상세', title: '적십자병원 의료지원', region: '서울적십자병원 기준' }
  ]
};
// 기관 시트는 아래 허용 열만 읽습니다. 추가한 임의의 열은 API에 노출되지 않습니다.
const PUBLIC_FIELDS = {
  id: ['연번', 'id'], province: ['시도', 'province'], name: ['기관명', 'name'], city: ['시군구/권역', 'city'], type: ['기관 유형', 'type'],
  supportText: ['미등록외국인 진료지원 유무', '지원여부', 'support_text'],
  scope: ['지원범위', 'scope'], cost: ['진료 금액 및 횟수', '지원 금액 및 횟수', 'cost'], procedure: ['필요서류 및 절차', 'procedure'],
  contact: ['담당', 'contact'], phone: ['연락처', 'phone'],
  note1: ['기타', '기타1', 'note1'], note2: ['기타2', 'note2'], note3: ['기타3', 'note3'],
  status: ['status'], latitude: ['latitude'], longitude: ['longitude'], address: ['address'], website: ['website'],
  naverMapUrl: ['naver_map_url'], kakaoMapUrl: ['kakao_map_url'], lastVerified: ['last_verified'], display: ['display']
};
function doGet() {
  let payload;
  try { payload = readPublicData(); }
  catch (error) {
    console.error(error && error.stack ? error.stack : String(error));
    // 공유 ID, 비공개 셀, 내부 오류 상세는 외부에 반환하지 않습니다.
    payload = { ok: false, error: 'DATA_UNAVAILABLE', message: '데이터를 불러올 수 없습니다. 운영자에게 문의해 주세요.' };
  }
  return ContentService.createTextOutput(JSON.stringify(payload)).setMimeType(ContentService.MimeType.JSON);
}
function readPublicData() {
  const spreadsheet = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = spreadsheet.getSheetByName(SOURCE_SHEETS.hospitals);
  if (!sheet) throw new Error('기관 시트를 찾을 수 없습니다: ' + SOURCE_SHEETS.hospitals);
  const hospitals = parseHospitals(sheet.getDataRange().getDisplayValues());
  const warnings = [];
  const programs = SOURCE_SHEETS.programs.map(function (definition) {
    const source = spreadsheet.getSheetByName(definition.sheet);
    if (!source) { warnings.push('MISSING_PROGRAM_' + definition.id); return null; }
    return parseProgram(source.getDataRange().getDisplayValues(), definition);
  }).filter(Boolean);
  return { ok: true, schemaVersion: 1, fetchedAt: new Date().toISOString(), hospitals: hospitals, programs: programs, warnings: warnings };
}
function headerKey(value) {
  return String(value || '').normalize('NFKC').replace(/^\s*\d+\s*[.)．]\s*/, '').replace(/[\s.．_\/]/g, '').toLowerCase();
}
function textValue(value) { return value == null ? '' : String(value).trim(); }
function isHidden(value) { return /^(false|0|n|no|x|비공개|숨김)$/i.test(textValue(value)); }
function inferStatus(explicit, original) {
  const allowed = ['available', 'conditional', 'program', 'unavailable', 'unknown'];
  if (explicit) return allowed.indexOf(explicit) >= 0 ? explicit : 'unknown';
  // 자유 서술문을 해석해서 지원 자격을 단정하지 않습니다. 관리자가 status로 정규화합니다.
  if (/^(o|○|◯)$/i.test(original)) return 'available';
  if (/^(x|×)$/i.test(original)) return 'unavailable';
  return 'unknown';
}
function numericCoordinate(value, min, max) {
  if (!textValue(value)) return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= min && number <= max ? number : null;
}
function parseHospitals(rows) {
  const headerIndex = rows.findIndex(function (row) { return row.some(function (v) { return headerKey(v) === headerKey('기관명'); }); });
  if (headerIndex < 0) throw new Error('기관명 헤더가 없습니다.');
  const headers = rows[headerIndex].map(headerKey);
  const columns = {};
  Object.keys(PUBLIC_FIELDS).forEach(function (key) { columns[key] = headers.findIndex(function (header) { return PUBLIC_FIELDS[key].some(function (alias) { return headerKey(alias) === header; }); }); });
  // 새 시트에는 지원여부(status) 열이 없을 수 있습니다. 기관명만 필수로 둡니다.
  if (columns.name < 0) throw new Error('필수 열 누락: name');
  const usedIds = {};
  return rows.slice(headerIndex + 1).map(function (row, index) {
    function cell(key) { return columns[key] < 0 ? '' : textValue(row[columns[key]]); }
    if (!cell('name') || isHidden(cell('display'))) return null;
    const rawId = cell('id') || 'row-' + (headerIndex + index + 2);
    const id = 'hospital-' + rawId;
    if (usedIds[id]) throw new Error('기관 연번이 중복되었습니다: ' + rawId);
    usedIds[id] = true;
    return {
      id: id,
      name: cell('name'),
      province: cell('province'),
      city: cell('city'),
      type: cell('type'),
      status: inferStatus(cell('status'), cell('supportText')),
      supportText: cell('supportText'),
      scope: cell('scope'),
      cost: cell('cost'),
      procedure: cell('procedure'),
      contact: cell('contact'),
      phone: cell('phone'),
      notes: [cell('note1'), cell('note2'), cell('note3')].filter(Boolean),
      latitude: numericCoordinate(cell('latitude'), 32, 39.5),
      longitude: numericCoordinate(cell('longitude'), 124, 132),
      address: cell('address'),
      website: cell('website'),
      naverMapUrl: cell('naverMapUrl'),
      kakaoMapUrl: cell('kakaoMapUrl'),
      lastVerified: cell('lastVerified')
    };
  }).filter(Boolean);
}
function parseProgram(rows, definition) {
  // 현재 세 상세 시트의 A(항목), B(상세)만 공개합니다. C 이후 메모는 노출하지 않습니다.
  const program = { id: definition.id, title: definition.title, region: definition.region, sections: [], departments: [], lastVerified: '' };
  let group = '', departments = false;
  rows.forEach(function (row) {
    const label = textValue(row[0]), text = textValue(row[1]);
    if (!label && !text) return;
    if (label === 'last_verified') { program.lastVerified = text; return; }
    if (/^\[.*\]$/.test(label) && !text) return;
    if (label.startsWith('□')) { group = label.replace(/^□\s*/, ''); departments = definition.id === 'redcross' && group === '진료 지원 내용'; return; }
    if ((label === '구분' || label === '과목') && text === '상세') return;
    const item = { label: label || '추가 안내', text: text, group: group };
    if (departments) program.departments.push(item); else program.sections.push(item);
  });
  return program;
}
/** 편집기에서 이 함수를 실행해 읽기 권한 승인 및 설정을 점검하세요. */
function checkSetup() {
  const data = readPublicData();
  const coordinatesCount = data.hospitals.filter(function (hospital) {
    return hospital.latitude != null && hospital.longitude != null;
  }).length;
  const phoneCount = data.hospitals.filter(function (hospital) { return hospital.phone; }).length;
  const contactCount = data.hospitals.filter(function (hospital) { return hospital.contact; }).length;
  console.log(JSON.stringify({
    spreadsheetId: SPREADSHEET_ID,
    ok: data.ok,
    hospitalCount: data.hospitals.length,
    coordinatesCount: coordinatesCount,
    phoneCount: phoneCount,
    contactCount: contactCount,
    firstHospital: data.hospitals[0] && {
      name: data.hospitals[0].name,
      status: data.hospitals[0].status,
      phone: data.hospitals[0].phone,
      latitude: data.hospitals[0].latitude,
      longitude: data.hospitals[0].longitude
    },
    programCount: data.programs.length,
    warnings: data.warnings
  }));
}

function updateHospitalCoordinatesForLeafletMap() {
  const spreadsheet = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheets = spreadsheet.getSheets();
  const normalize = value => String(value || '').replace(/\s+/g, '').toLowerCase();
  const headersFor = sheet => sheet.getRange(1, 1, 1, Math.max(sheet.getLastColumn(), 1)).getDisplayValues()[0];
  const findColumn = (headers, name) => headers.findIndex(header => normalize(header) === normalize(name));
  const sheet = sheets.find(candidate => findColumn(headersFor(candidate), '기관명') >= 0);
  if (!sheet) throw new Error('기관명 열이 있는 시트를 찾지 못했습니다.');

  const ensureColumn = name => {
    let headers = headersFor(sheet);
    const existing = findColumn(headers, name);
    if (existing >= 0) return existing;

    let column = headers.reduce((last, value, index) => value ? index + 1 : last, 0) + 1;
    const lastRow = Math.max(sheet.getLastRow(), 1);
    while (column <= headers.length) {
      const values = sheet.getRange(1, column, lastRow, 1).getDisplayValues();
      if (values.every(row => !row[0])) break;
      column++;
    }
    sheet.getRange(1, column).setValue(name);
    headers = headersFor(sheet);
    return findColumn(headers, name);
  };

  const latitudeColumn = ensureColumn('latitude');
  const longitudeColumn = ensureColumn('longitude');
  const headers = headersFor(sheet);
  const nameColumn = findColumn(headers, '기관명');
  const provinceColumn = findColumn(headers, '시도');
  const cityColumn = findColumn(headers, '시군구/권역');
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return;

  const rows = sheet.getRange(2, 1, lastRow - 1, sheet.getLastColumn()).getDisplayValues();
  const latitudes = [];
  const longitudes = [];
  const geocoder = Maps.newGeocoder().setLanguage('ko').setRegion('kr');
  let updated = 0;
  let unresolved = 0;

  rows.forEach((row, index) => {
    const parseCoordinate = value => value === '' ? NaN : Number(value);
    let latitude = parseCoordinate(row[latitudeColumn]);
    let longitude = parseCoordinate(row[longitudeColumn]);
    const placeholder = latitude === 37.566 && longitude === 127;
    const valid = Number.isFinite(latitude) && Number.isFinite(longitude) &&
      latitude >= 33 && latitude <= 39 && longitude >= 124 && longitude <= 132 && !placeholder;

    if (!valid) {
      const name = row[nameColumn];
      if (name) {
        const query = [name, row[cityColumn], row[provinceColumn], '대한민국'].filter(Boolean).join(' ');
        try {
          const result = geocoder.geocode(query);
          const location = result.status === 'OK' && result.results.length
            ? result.results[0].geometry.location
            : null;
          if (location && location.lat >= 33 && location.lat <= 39 && location.lng >= 124 && location.lng <= 132) {
            latitude = location.lat;
            longitude = location.lng;
            updated++;
          } else {
            latitude = '';
            longitude = '';
            unresolved++;
            Logger.log(`No usable geocoding result for row ${index + 2}: ${query}`);
          }
        } catch (error) {
          latitude = '';
          longitude = '';
          unresolved++;
          Logger.log(`Geocoding failed for row ${index + 2}: ${query}; ${error.message}`);
        }
      } else {
        latitude = '';
        longitude = '';
      }
    }

    latitudes.push([latitude]);
    longitudes.push([longitude]);
  });

  sheet.getRange(2, latitudeColumn + 1, latitudes.length, 1).setValues(latitudes);
  sheet.getRange(2, longitudeColumn + 1, longitudes.length, 1).setValues(longitudes);
  Logger.log(`Coordinate update complete: ${updated} updated, ${unresolved} unresolved.`);
}
