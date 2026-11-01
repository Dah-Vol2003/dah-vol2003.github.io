const state = { hospitals: [], markers: [], filter: 'all', query: '' };
let map;
const mobileViewport = window.matchMedia('(max-width: 800px)');
const hospitalDialog = document.querySelector('#hospital-dialog');
const hospitalDialogTitle = document.querySelector('#hospital-dialog-title');
const hospitalDialogContent = document.querySelector('#hospital-dialog-content');
const hospitalDialogClose = document.querySelector('.hospital-dialog-close');
let dialogTrigger;

const escapeHtml = value => String(value || '-').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[char]));
const supportState = hospital => {
  const value = String(hospital.support || '').toLowerCase();
  if (['yes', '1', 'o', 'available'].includes(value)) return 'yes';
  if (['no', '0', 'x', 'unavailable'].includes(value)) return 'no';
  return 'unknown';
};
const isSupported = hospital => supportState(hospital) === 'yes';
const supportLabel = hospital => ({ yes: '지원 가능', no: '지원 불가', unknown: '확인 필요' }[supportState(hospital)]);
const markerIcon = status => ({
  content: `<span class="map-marker ${status}"></span>`,
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
const detailRow = (label, value) => value ? `<p><strong>${label}</strong><br>${escapeHtml(value)}</p>` : '';
const hospitalDetails = hospital => [
  `<p><strong>지역</strong> ${escapeHtml(hospital.region)}</p>`,
  `<p class="support ${supportState(hospital)}">● ${supportLabel(hospital)}</p>`,
  detailRow('유형', hospital.type),
  detailRow('지원 범위', hospital.support_range),
  detailRow('진료 금액', hospital.amount),
  detailRow('필요 서류', hospital.docs),
  detailRow('담당', hospital.contact),
  detailRow('연락처', hospital.phone),
  detailRow('기타', hospital.other)
].join('');
const popup = hospital => `<div class="popup"><h3>${escapeHtml(hospital.name)}</h3>${hospitalDetails(hospital)}</div>`;

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
  hospitalDialogContent.innerHTML = `<div class="popup">${hospitalDetails(hospital)}</div>`;
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

  return records.map(record => {
    const status = record.status === 'available' ? 'Yes' : record.status === 'unavailable' ? 'No' : record.status === 'unknown' ? 'Unknown' : record.support;
    return {
      ...record,
      region: record.region || [record.province, record.city].filter(Boolean).join(' / '),
      support: status,
      support_range: record.support_range || record.scope || '',
      amount: record.amount || record.cost || '',
      docs: record.docs || record.procedure || '',
      other: Array.isArray(record.other) ? record.other.join('\n') : Array.isArray(record.notes) ? record.notes.join('\n') : record.other || ''
    };
  });
}

function render() {
  const filtered = state.hospitals.filter(hospital => {
    const matchesFilter = state.filter === 'all' || supportState(hospital) === state.filter;
    const haystack = `${hospital.name} ${hospital.region} ${hospital.type}`.toLowerCase();
    return matchesFilter && haystack.includes(state.query.toLowerCase());
  });
  document.querySelector('#results').textContent = `${filtered.length}개 기관이 검색되었습니다.`;
  const list = document.querySelector('#hospital-list');
  list.innerHTML = filtered.length ? filtered.map(h => {
    const hasCoordinates = Boolean(coordsFor(h));
    const unavailable = !hasCoordinates && !mobileViewport.matches;
    return `<li><button class="hospital" data-id="${state.hospitals.indexOf(h)}" ${unavailable ? 'disabled title="좌표 정보가 등록되지 않았습니다."' : ''}><span class="hospital-name">${escapeHtml(h.name)}<span class="badge ${supportState(h)}">${supportLabel(h)}</span></span><span class="hospital-meta">${escapeHtml(h.region)} · ${escapeHtml(h.type)}</span></button></li>`;
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
  document.querySelector('#yes-count').textContent = hospitals.filter(isSupported).length;
  hospitals.forEach(hospital => {
    const coordinates = coordsFor(hospital);
    if (!coordinates) return;
    const marker = new naver.maps.Marker({
      position: new naver.maps.LatLng(coordinates[0], coordinates[1]),
      map,
      title: hospital.name,
      icon: markerIcon(supportState(hospital))
    });
    const infoWindow = new naver.maps.InfoWindow({
      content: popup(hospital),
      maxWidth: 300,
      zIndex: 1000,
      borderWidth: 0,
      backgroundColor: 'transparent',
      disableAnchor: true
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
document.querySelectorAll('.filter').forEach(button => button.addEventListener('click', () => { document.querySelectorAll('.filter').forEach(item => item.classList.remove('active')); button.classList.add('active'); state.filter = button.dataset.filter; render(); }));
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
    event.preventDefault();
    hospitalDialogClose.focus();
  }
});
mobileViewport.addEventListener('change', () => {
  if (!mobileViewport.matches && !hospitalDialog.hidden) closeHospitalDialog();
  render();
});
window.addEventListener('resize', fitHospitalDialogTitle);
