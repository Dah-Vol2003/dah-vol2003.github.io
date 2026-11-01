# 외국인 진료소 찾기 — 행동하는의사회 (DAH)

한국의 외국인 진료 지원 가능 기관을 지도에서 찾는 정적 사이트.
https://wonwooky.github.io/

## 구조

```
index.html          화면 + 스타일 (단일 파일, 빌드 없음)
js/config.js        Apps Script 웹 앱 URL, 네이버 지도 Client ID
js/main.js          데이터 로딩, 지도/목록/다이얼로그 렌더링
apps-script/Code.gs Google Sheets → JSON 공개 API (Apps Script에 붙여넣는 원본)
scripts/check.mjs   사전 점검 (파일 참조, 설정값, 데이터 형식)
paseo.json          Paseo 개발 서버/점검 스크립트
docs/               리뷰 문서
```

## Apps Script data source

The website reads the hospital list from the Apps Script web app, not from the checked-in JSON file.

- 원본 시트: `DAH-외국의료지원기관 찾기` — `1EmHCQAfs-sDlWph-YU-CDhXIIMGOM26E8xCMiXvIZYA`, 탭 `확인 완료`
- 시트 ID는 `apps-script/Code.gs`의 `SPREADSHEET_ID` 상수에 있습니다(스크립트 속성 불필요).

1. Apps Script 편집기에서 `apps-script/Code.gs` 전체를 붙여넣습니다.
2. 편집기에서 `checkSetup()`을 한 번 실행해 권한을 승인하고, 로그의 `hospitalCount` / `coordinatesCount` / `phoneCount`를 확인합니다.
3. `배포 → 배포 관리 → 수정 → 버전: 새 버전 → 배포`. 기존 `/exec` URL이 유지되므로 `js/config.js`는 그대로 둡니다.

Only the columns listed in `PUBLIC_FIELDS` are exposed. Adding a column to the sheet does not publish it until it is registered in the code.

- 지원 여부: `status` 열 (`available` / `conditional` / `program` / `unavailable` / `unknown`). 열이 없으면 전부 `unknown`(확인 필요)으로 표시됩니다.
- 좌표: `latitude` / `longitude` 열. 비어 있으면 목록에는 나오지만 지도에는 찍히지 않습니다.

The Apps Script endpoint returns JSON with CORS enabled. The page maps its `{ ok, hospitals }` response to the site data model.

## Naver Maps

The browser loads the Naver Maps Web SDK with `NAVER_MAPS_KEY_ID` from `js/config.js`. This client key is visible in the static site, so restrict its Web Service URLs in Naver Cloud Platform to `http://localhost` and `https://wonwooky.github.io`. Do not put a Client Secret in frontend code.

## 개발

```bash
paseo script start serve          # http://serve--<workspace>.localhost:6767
paseo script stop serve
paseo script start check          # node scripts/check.mjs
node scripts/check.mjs --online   # 운영 API 응답까지 확인
```

정적 파일만 있으므로 `python3 -m http.server`로도 충분합니다.
