const state = { hospitals: [], markers: [], province: 'all', city: 'all', query: '' };
let map;
const mobileViewport = window.matchMedia('(max-width: 800px)');
const hospitalDialog = document.querySelector('#hospital-dialog');
const hospitalDialogTitle = document.querySelector('#hospital-dialog-title');
const hospitalDialogContent = document.querySelector('#hospital-dialog-content');
const hospitalDialogClose = document.querySelector('.hospital-dialog-close');
let dialogTrigger;

const escapeHtml = value => String(value || '-').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[char]));
const markerIcon = () => ({
  content: `<span class="map-marker"></span>`,
  size: new naver.maps.Size(16, 16),
  anchor: new naver.maps.Point(8, 8)
});
const coordsFor = hospital => {
  if (hospital.latitude == null || hospital.longitude == null || hospital.latitude === '' || hospital.longitude === '') return null;
  const latitude = Number(hospital.latitude);
  const longitude = Number(hospital.longitude);
  const placeholder = latitude === 37.566 && longitude === 127;
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || placeholder) return null;
  if (latitude < 33 || latitude > 39 || longitude < 124 || longitude > 132) return null;
  return [latitude, longitude];
};
const detailLines = value => String(value || '').split(/\r?\n/).map(line => line.trim()).filter(Boolean);
const linkifyHttps = line => line.split(/(https:\/\/[^\s<>"'\[\]{}]+)/gi).map((part, index) => {
  if (!part) return '';
  if (index % 2 === 0) return escapeHtml(part);
  let url = part.replace(/[.,!?;:，。！？、]+$/, '');
  while (url.endsWith(')') && url.split(')').length > url.split('(').length) url = url.slice(0, -1);
  url = url.replace(/[.,!?;:，。！？、]+$/, '');
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' || !parsed.hostname) return escapeHtml(part);
  } catch {
    return escapeHtml(part);
  }
  const suffix = part.slice(url.length);
  return `<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(url)}</a>${suffix ? escapeHtml(suffix) : ''}`;
}).join('');
const detailRow = (label, value, renderLine = escapeHtml) => {
  const lines = detailLines(value);
  return lines.length ? `<div class="detail"><strong>${label}</strong><ul class="detail-lines">${lines.map(line => `<li>${renderLine(line)}</li>`).join('')}</ul></div>` : '';
};
const hospitalDetails = hospital => [
  detailRow('지역', hospital.region),
  detailRow('유형', hospital.type),
  detailRow('지원 범위', hospital.support_range),
  detailRow('지원 금액 및 횟수', hospital.amount),
  detailRow('필요 서류 및 절차', hospital.docs),
  detailRow('담당', hospital.contact),
  detailRow('연락처', hospital.phone),
  detailRow('기타', hospital.other, linkifyHttps)
].join('');
const popupMarkup = hospital => `<h3>${escapeHtml(hospital.name)}</h3>${hospitalDetails(hospital)}`;

// 브라우저 자동번역 대응: 팝업을 클릭 시점이 아니라 로드 시점에 DOM에 만들어 둔다.
// 번역기는 번역을 누른 시점의 DOM 텍스트를 바꾸므로, 미리 문서에 있어야 번역문이 팝업에 따라온다.
// 네이버 InfoWindow는 넘긴 노드를 복제하지 않고 그대로 옮겨 쓰기 때문에 이동 후에도 번역문이 유지된다.
const popupStage = document.createElement('div');
popupStage.className = 'popup-stage';
popupStage.setAttribute('aria-hidden', 'true');
document.body.append(popupStage);
const popupNodes = new WeakMap();

function createPopupNode(hospital) {
  const node = document.createElement('div');
  node.className = 'popup';
  node.lang = 'ko';
  node.innerHTML = popupMarkup(hospital);
  popupStage.append(node);
  popupNodes.set(hospital, node);
  return node;
}

function loadNaverMaps() {
  if (!window.NAVER_MAPS_KEY_ID) return Promise.reject(new Error('Naver Maps Client ID를 js/config.js에 설정해야 합니다.'));

  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    let settled = false;
    let timeout;
    const cleanup = () => {
      clearTimeout(timeout);
      delete window.navermap_authFailure;
      script.remove();
    };
    const fail = message => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error(message));
    };
    const ready = () => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve();
    };

    window.navermap_authFailure = () => fail('Naver Maps 인증에 실패했습니다. Client ID와 허용 도메인을 확인하세요.');
    script.onerror = () => fail('Naver Maps SDK를 불러오지 못했습니다. 네트워크 연결을 확인하세요.');
    script.onload = () => {
      if (window.naver && window.naver.maps) ready();
      else fail('Naver Maps SDK를 초기화하지 못했습니다.');
    };
    timeout = setTimeout(() => fail('Naver Maps SDK 응답 시간이 초과되었습니다.'), 15000);
    script.src = `https://oapi.map.naver.com/openapi/v3/maps.js?ncpKeyId=${encodeURIComponent(window.NAVER_MAPS_KEY_ID)}`;
    document.head.append(script);
  });
}

function openInfoWindow(item) {
  state.markers.forEach(({ infoWindow }) => {
    if (infoWindow !== item.infoWindow) infoWindow.close();
  });
  // 스테이징에 있던 노드를 그대로 넘긴다(복제 아님). 브라우저가 이미 번역한 텍스트가 그대로 따라온다.
  const node = popupNodes.get(item.hospital);
  if (node) item.infoWindow.setContent(node);
  const popupContent = item.infoWindow.getContentElement();
  popupContent.style.maxHeight = `${Math.floor(document.querySelector('#map').clientHeight * 0.45)}px`;
  popupContent.style.overflowY = 'auto';
  popupContent.style.overscrollBehavior = 'contain';
  map.panTo(item.marker.getPosition());
  item.infoWindow.open(map, item.marker);
}

function openHospitalDialog(hospital, trigger) {
  state.markers.forEach(({ infoWindow }) => infoWindow.close());
  dialogTrigger = trigger || (document.activeElement === document.body ? null : document.activeElement);
  hospitalDialogTitle.textContent = hospital.name || '-';
  const template = popupNodes.get(hospital);
  hospitalDialogContent.replaceChildren(template ? template.cloneNode(true) : createPopupNode(hospital).cloneNode(true));
  hospitalDialog.hidden = false;
  fitHospitalDialogTitle();
  hospitalDialogClose.focus();
}

function fitHospitalDialogTitle() {
  if (hospitalDialog.hidden) return;
  let fontSize = 23;
  hospitalDialogTitle.style.fontSize = '';
  while (hospitalDialogTitle.scrollWidth > hospitalDialogTitle.clientWidth && fontSize > 14) {
    hospitalDialogTitle.style.fontSize = `${--fontSize}px`;
  }
}

function closeHospitalDialog() {
  hospitalDialog.hidden = true;
  hospitalDialogContent.replaceChildren();
  if (dialogTrigger && dialogTrigger.isConnected) dialogTrigger.focus();
  dialogTrigger = null;
}

async function loadHospitals() {
  if (!window.HOSPITALS_API_URL) throw new Error('Apps Script 웹 앱 URL을 js/config.js에 설정해야 합니다.');
  const response = await fetch(window.HOSPITALS_API_URL);
  if (!response.ok) throw new Error('Apps Script에서 병원 데이터를 읽지 못했습니다.');
  const payload = await response.json();
  if (payload.ok === false) throw new Error('Apps Script가 병원 데이터를 반환하지 못했습니다.');
  const records = Array.isArray(payload) ? payload : payload.hospitals;
  if (!Array.isArray(records)) throw new Error('Apps Script 응답 형식을 확인하세요.');

  return records.map(record => ({
    ...record,
    region: record.region || [record.province, record.city].filter(Boolean).join(' / '),
    support_range: record.support_range || record.scope || '',
    amount: record.amount || record.cost || '',
    docs: record.docs || record.procedure || '',
    other: Array.isArray(record.other) ? record.other.join('\n') : Array.isArray(record.notes) ? record.notes.join('\n') : record.other || ''
  }));
}

const provinceSelect = document.querySelector('#province-select');
const citySelect = document.querySelector('#city-select');
const sortedUnique = values => [...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b, 'ko'));
const optionMarkup = (value, label) => `<option value="${escapeHtml(value)}">${escapeHtml(label)}</option>`;
const syncQuery = () => { state.query = document.querySelector('#search').value; };

function setCityOptions(province, selected = 'all') {
  const cities = sortedUnique(state.hospitals.filter(hospital => province === 'all' || hospital.province === province).map(hospital => hospital.city));
  citySelect.innerHTML = [optionMarkup('all', '전체'), ...cities.map(city => optionMarkup(city, city))].join('');
  citySelect.value = cities.includes(selected) ? selected : 'all';
  state.city = citySelect.value;
}

function setupRegionFilters() {
  const provinces = sortedUnique(state.hospitals.map(hospital => hospital.province));
  provinceSelect.innerHTML = [optionMarkup('all', '전체'), ...provinces.map(province => optionMarkup(province, province))].join('');
  provinceSelect.value = 'all';
  state.province = 'all';
  setCityOptions('all', 'all');
}

function render() {
  const query = state.query.trim().toLowerCase();
  const filtered = state.hospitals.filter(hospital => {
    const matchesProvince = state.province === 'all' || hospital.province === state.province;
    const matchesCity = state.city === 'all' || hospital.city === state.city;
    const matchesQuery = !query || String(hospital.name || '').toLowerCase().includes(query);
    return matchesProvince && matchesCity && matchesQuery;
  });
  document.querySelector('#results').textContent = `${filtered.length}개 기관이 검색되었습니다.`;
  const list = document.querySelector('#hospital-list');
  list.innerHTML = filtered.length ? filtered.map(h => {
    const hasCoordinates = Boolean(coordsFor(h));
    const unavailable = !hasCoordinates && !mobileViewport.matches;
    return `<li><button class="hospital" data-id="${state.hospitals.indexOf(h)}" ${unavailable ? 'disabled title="좌표 정보가 등록되지 않았습니다."' : ''}><span class="hospital-name">${escapeHtml(h.name)}</span><span class="hospital-meta">${escapeHtml(h.region)} · ${escapeHtml(h.type)}</span></button></li>`;
  }).join('') : '<li class="empty">검색 결과가 없습니다.</li>';
  state.markers.forEach(item => {
    const visible = filtered.includes(item.hospital);
    item.marker.setVisible(visible);
    if (!visible) item.infoWindow.close();
  });
}

Promise.all([loadNaverMaps(), loadHospitals()]).then(([, hospitals]) => {
  map = new naver.maps.Map('map', {
    center: new naver.maps.LatLng(36.35, 127.8),
    zoom: 7,
    zoomControl: true,
    zoomControlOptions: { position: naver.maps.Position.TOP_RIGHT }
  });
  naver.maps.Event.addListener(map, 'click', () => {
    state.markers.forEach(({ infoWindow }) => infoWindow.close());
  });
  state.hospitals = hospitals;
  document.querySelector('#total-count').textContent = hospitals.length;
  setupRegionFilters();
  hospitals.forEach(hospital => {
    const coordinates = coordsFor(hospital);
    if (!coordinates) return;
    createPopupNode(hospital); // 자동번역 대상이 되도록 로드 시점에 DOM에 미리 렌더
    const marker = new naver.maps.Marker({
      position: new naver.maps.LatLng(coordinates[0], coordinates[1]),
      map,
      title: hospital.name,
      icon: markerIcon()
    });
    const infoWindow = new naver.maps.InfoWindow({
      content: '',
      maxWidth: 300,
      zIndex: 1000,
      borderWidth: 0,
      backgroundColor: 'transparent',
      disableAnchor: true
    });
    // 닫히면 노드를 스테이징으로 되돌려 문서에 남긴다(나중에 번역을 눌러도 대상이 되도록).
    naver.maps.Event.addListener(infoWindow, 'close', () => {
      const node = popupNodes.get(hospital);
      if (node && !node.isConnected) popupStage.append(node);
    });
    const item = { marker, infoWindow, hospital };
    naver.maps.Event.addListener(marker, 'click', () => {
      if (mobileViewport.matches) {
        openHospitalDialog(hospital);
        return;
      }
      if (infoWindow.getMap()) infoWindow.close();
      else openInfoWindow(item);
    });
    state.markers.push(item);
  });
  render();
}).catch(error => { document.querySelector('#results').textContent = error.message; });

document.querySelector('#search').addEventListener('input', event => { state.query = event.target.value; render(); });
provinceSelect.addEventListener('change', () => { state.province = provinceSelect.value; setCityOptions(state.province); syncQuery(); render(); });
citySelect.addEventListener('change', () => { state.city = citySelect.value; syncQuery(); render(); });
document.querySelector('#hospital-list').addEventListener('click', event => {
  const button = event.target.closest('[data-id]');
  if (!button || button.disabled) return;
  const hospital = state.hospitals[Number(button.dataset.id)];
  if (mobileViewport.matches) {
    openHospitalDialog(hospital, button);
    return;
  }
  const item = state.markers.find(marker => marker.hospital === hospital);
  if (item) openInfoWindow(item);
});
hospitalDialogClose.addEventListener('click', closeHospitalDialog);
hospitalDialog.addEventListener('click', event => {
  if (event.target === hospitalDialog) closeHospitalDialog();
});
hospitalDialog.addEventListener('keydown', event => {
  if (event.key === 'Escape') closeHospitalDialog();
  else if (event.key === 'Tab') {
    const focusable = [hospitalDialogClose, ...hospitalDialogContent.querySelectorAll('a[href]')];
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }
});
mobileViewport.addEventListener('change', () => {
  if (!mobileViewport.matches && !hospitalDialog.hidden) closeHospitalDialog();
  render();
});
window.addEventListener('resize', fitHospitalDialogTitle);
