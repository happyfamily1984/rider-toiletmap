(function () {
  'use strict';

  // 이 줌 레벨 이상이면 마커에 이름 + 비밀번호를 표시
  var LABEL_ZOOM = 17;
  // 이 줌 레벨 이상으로 확대해야 지도를 눌러 화장실을 등록할 수 있음
  var ADD_ZOOM = 16;
  // 이 줌 레벨보다 멀리 보면(전국·시 단위) 화장실을 불러오지 않음
  var LOAD_ZOOM = 13;
  // 앱을 처음 열었을 때(위치를 모를 때) 지도 중심: 서울시청
  var DEFAULT_CENTER = { lat: 37.5665, lng: 126.978 };

  var $ = function (id) { return document.getElementById(id); };
  var state = {
    config: null,
    map: null,
    toilets: {},       // 지금 지도 범위의 화장실 (id → 화장실)
    markers: {},
    tempMarker: null,
    myMarker: null,
    nearId: null,      // 내 근처: 가장 가까운 화장실 id
    routeLine: null,   // 내 근처: 경로 선
    labelMode: false,
    addMode: false,
    me: { loggedIn: false, user: null },
    regions: null,
    detailId: null,
    loadSeq: 0,
  };

  // ---------------- 공통 ----------------
  // 디자인 시안의 아이콘 (인라인 SVG)
  var SVG = '<svg class="ico" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" aria-hidden="true" ';
  var STROKE = 'fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">';
  var ICON = {
    wc: SVG + 'fill="currentColor"><circle cx="7" cy="4.6" r="2.1"/><path d="M5 8.2h4a1.2 1.2 0 0 1 1.2 1.2V15H8.7v6H5.3v-6H3.8V9.4A1.2 1.2 0 0 1 5 8.2z"/><rect x="11.4" y="3" width="1.2" height="18" rx=".6"/><circle cx="17" cy="4.6" r="2.1"/><path d="M15.1 8.2h3.8l2.4 7.3h-2.3V21h-1.7v-4.6h-.6V21H15v-5.5h-2.3z"/></svg>',
    pin: SVG + 'fill="currentColor"><path d="M12 2C8.1 2 5 5.1 5 9c0 5.2 7 13 7 13s7-7.8 7-13c0-3.9-3.1-7-7-7zm0 9.5a2.5 2.5 0 1 1 0-5 2.5 2.5 0 0 1 0 5z"/></svg>',
    crown: SVG + 'fill="currentColor"><path d="M3 8l4.6 4L12 5l4.4 7L21 8l-2 10H5z"/></svg>',
    star: SVG + 'fill="currentColor"><path d="M12 2.5l2.9 6.1 6.6.7-4.9 4.5 1.4 6.6L12 17l-6 3.4 1.4-6.6-4.9-4.5 6.6-.7z"/></svg>',
    chat: SVG + 'fill="currentColor"><path d="M12 3C6.5 3 2 6.8 2 11.5c0 2.4 1.2 4.6 3.1 6.1L4 21l4.1-2c1.2.4 2.5.6 3.9.6 5.5 0 10-3.8 10-8.5S17.5 3 12 3zM7.5 13a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3zm4.5 0a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3zm4.5 0a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3z"/></svg>',
    pencil: SVG + 'fill="currentColor"><path d="M3 17.3V21h3.7L17.8 9.9l-3.7-3.7zM20.7 7a1 1 0 0 0 0-1.4l-2.3-2.3a1 1 0 0 0-1.4 0l-1.8 1.8 3.7 3.7z"/></svg>',
    lock: SVG + 'fill="currentColor"><path d="M17 9V7A5 5 0 0 0 7 7v2a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-9a2 2 0 0 0-2-2zm-5 8.5a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3zM9 9V7a3 3 0 0 1 6 0v2z"/></svg>',
    note: SVG + 'fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><rect x="4" y="4" width="16" height="16" rx="2.5"/><path d="M8 9h8M8 12.5h8M8 16h5"/></svg>',
    chev: SVG + STROKE + '<path d="M9 6l6 6-6 6"/></svg>',
    check: SVG + 'fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
    x: SVG + STROKE + '<path d="M6 6l12 12M18 6 6 18"/></svg>',
    plus: SVG + 'fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
    minus: SVG + 'fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><path d="M5 12h14"/></svg>',
    flag: SVG + 'fill="currentColor"><path d="M5 21V4h9l.5 2H20v9h-6.5l-.5-2H7v8z"/></svg>',
    clock: SVG + 'fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/></svg>',
    search: SVG + 'fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.5 15.5 21 21"/></svg>',
    phone: SVG + 'fill="currentColor"><path d="M6.6 10.8a15.1 15.1 0 0 0 6.6 6.6l2.2-2.2c.3-.3.7-.4 1-.2 1.1.4 2.3.6 3.6.6.6 0 1 .4 1 1V20c0 .6-.4 1-1 1A17 17 0 0 1 3 4c0-.6.4-1 1-1h3.5c.6 0 1 .4 1 1 0 1.3.2 2.5.6 3.6.1.3 0 .7-.2 1z"/></svg>',
    trophy: SVG + 'fill="currentColor"><path d="M7 3h10v2h3.5v2.5A4.5 4.5 0 0 1 16.6 12 5.5 5.5 0 0 1 13 14.8V17h3v2H8v-2h3v-2.2A5.5 5.5 0 0 1 7.4 12 4.5 4.5 0 0 1 3.5 7.5V5H7zM6 20h12v1.5H6z"/></svg>',
    google: '<svg class="ico" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" aria-hidden="true"><path fill="#FFC107" d="M43.6 20.1H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.7-.4-3.9z"/><path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.1H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.7-.4-3.9z"/></svg>',
    user: SVG + 'fill="currentColor"><path d="M12 12a4.5 4.5 0 1 0 0-9 4.5 4.5 0 0 0 0 9zm0 2c-4.4 0-8 2.2-8 5v2h16v-2c0-2.8-3.6-5-8-5z"/></svg>',
  };

  // 바텀시트 머리: 초록 원 아이콘 + 제목 + 닫기
  function sheetHead(title, icon) {
    return '<div class="sheet-head"><span class="sheet-logo">' + (icon || ICON.wc) + '</span>' +
      '<h2>' + title + '</h2>' +
      '<button type="button" class="sheet-x" data-act="close" aria-label="닫기">' + ICON.x + '</button></div>';
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  // 이 기기를 구분하는 무작위 ID (개인정보 아님). 남용 방지·중복 신고 방지에만 쓴다.
  var DEVICE_KEY = 'ridermap.device';
  var deviceId = (function () {
    var id = null;
    try { id = localStorage.getItem(DEVICE_KEY); } catch (e) { /* 무시 */ }
    if (!id || !/^[A-Za-z0-9-]{16,64}$/.test(id)) {
      id = (window.crypto && crypto.randomUUID) ? crypto.randomUUID()
        : 'd' + Date.now().toString(36) + Math.random().toString(36).slice(2, 14);
      try { localStorage.setItem(DEVICE_KEY, id); } catch (e) { /* 무시 */ }
    }
    return id;
  })();

  function api(method, url, body) {
    var headers = { 'X-Device-Id': deviceId };
    if (body) headers['Content-Type'] = 'application/json';
    return fetch(url, {
      method: method,
      credentials: 'same-origin',
      headers: headers,
      body: body ? JSON.stringify(body) : undefined,
    }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (data) {
        if (!res.ok) {
          var err = new Error(data.error || '요청에 실패했습니다.');
          err.status = res.status;
          err.data = data;
          throw err;
        }
        return data;
      });
    });
  }

  var toastTimer;
  function toast(msg, icon) {
    var el = $('toast');
    el.innerHTML = (icon ? ICON[icon] : '') + '<span>' + escapeHtml(msg) + '</span>';
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.hidden = true; }, 2800);
  }

  function fatal(html) {
    var el = $('fatal');
    el.innerHTML = html;
    el.hidden = false;
  }

  function inKorea(lat, lng) {
    var b = state.config.bounds;
    return lat >= b.minLat && lat <= b.maxLat && lng >= b.minLng && lng <= b.maxLng;
  }

  function setHint(text) {
    var hint = $('hint');
    if (!text) { hint.classList.add('fade'); return; }
    hint.textContent = text;
    hint.classList.remove('fade');
  }

  // ---------------- 지도 ----------------
  function loadNaverMaps(clientId) {
    return new Promise(function (resolve, reject) {
      if (window.naver && window.naver.maps) return resolve();
      window.navermap_authFailure = function () {
        fatal('네이버 지도 인증에 실패했습니다.<br>네이버 클라우드 플랫폼에서 Client ID와<br>Web 서비스 URL 등록을 확인해 주세요.');
      };
      var s = document.createElement('script');
      s.src = 'https://oapi.map.naver.com/openapi/v3/maps.js?ncpKeyId=' +
        encodeURIComponent(clientId) + '&submodules=geocoder';
      s.onload = function () {
        // geocoder 서브모듈은 maps.js 뒤에 따로 불러와지므로 준비될 때까지 기다린다
        if (naver.maps.Service && naver.maps.Service.geocode) return resolve();
        naver.maps.onJSContentLoaded = resolve;
        setTimeout(resolve, 5000);
      };
      s.onerror = function () { reject(new Error('네이버 지도를 불러오지 못했습니다.')); };
      document.head.appendChild(s);
    });
  }

  function initMap() {
    var nm = naver.maps;
    var b = state.config.bounds;
    state.map = new nm.Map('map', {
      center: new nm.LatLng(DEFAULT_CENTER.lat, DEFAULT_CENTER.lng),
      zoom: 15,
      minZoom: 7,
      maxBounds: new nm.LatLngBounds(new nm.LatLng(b.minLat, b.minLng), new nm.LatLng(b.maxLat, b.maxLng)),
      zoomControl: true,
      zoomControlOptions: { position: nm.Position.RIGHT_CENTER, style: nm.ZoomControlStyle.SMALL },
      mapDataControl: false,
      scaleControl: false,
      logoControlOptions: { position: nm.Position.BOTTOM_LEFT },
    });

    nm.Event.addListener(state.map, 'click', function (e) {
      $('menu').hidden = true;
      onMapClick(e.coord);
    });
    nm.Event.addListener(state.map, 'zoom_changed', function () {
      updateLabelMode();
      updateAddHint();
    });
    // 지도를 움직이고 멈추면 그 범위의 화장실을 불러온다
    nm.Event.addListener(state.map, 'idle', scheduleLoad);
    window.addEventListener('resize', function () {
      var el = $('map');
      state.map.setSize(new nm.Size(el.offsetWidth, el.offsetHeight));
    });
    updateLabelMode();
    setTimeout(function () { if (!state.addMode) setHint(''); }, 5000);
  }

  // ---------------- 별점 / 마커 ----------------
  var DEFAULT_RATING = 3;

  function ratingOf(t) {
    var r = Number(t && t.rating);
    return r >= 1 && r <= 5 ? r : DEFAULT_RATING;
  }

  function starsText(n) {
    return '★★★★★'.slice(0, n) + '☆☆☆☆☆'.slice(0, 5 - n);
  }

  // 별 5개: 금색 + 왕관 + 반짝이, 별 4개: 금색, 공공데이터(아직 아무도 손대지 않은 곳): 파란색
  function tierClass(t) {
    var r = ratingOf(t);
    if (r === 5) return ' tier5';
    if (r === 4) return ' tier4';
    return t.source === 'public' && !t.password && !t.description ? ' pub' : '';
  }

  var SPARKLES = '<span class="sparkle s1">✦</span><span class="sparkle s2">✦</span><span class="sparkle s3">✦</span>';

  function markerIcon(t) {
    var nm = naver.maps;
    var html;
    var tier = tierClass(t);
    var rankBadge = state.nearId === t.id ? '<span class="near-tag">가장 가까움</span>' : '';
    var five = ratingOf(t) === 5;
    if (state.labelMode) {
      html = '<div class="label-marker' + tier + '">' +
        (five ? '<span class="crown">👑</span>' + SPARKLES : '') + rankBadge +
        '<div class="label-name">' + escapeHtml(t.name) + '</div>' +
        '<div class="label-stars">' + starsText(ratingOf(t)) + '</div>' +
        (t.password
          ? '<div class="label-pw">🔑 ' + escapeHtml(t.password) + '</div>'
          : '<div class="label-pw none">' + (t.source === 'public' ? '공중화장실' : '비밀번호 없음') + '</div>') +
        '</div>';
    } else {
      html = '<div class="pin' + tier + '">' +
        (five ? '<span class="crown">👑</span>' + SPARKLES : '') + rankBadge +
        '<div class="pin-shape"><span>WC</span></div></div>';
    }
    return { content: html, anchor: new nm.Point(0, 0) };
  }

  function renderMarkers() {
    var nm = naver.maps;
    var seen = {};
    Object.keys(state.toilets).forEach(function (id) {
      var t = state.toilets[id];
      seen[id] = true;
      var m = state.markers[id];
      var pos = new nm.LatLng(t.lat, t.lng);
      if (!m) {
        m = new nm.Marker({ map: state.map, position: pos, icon: markerIcon(t) });
        nm.Event.addListener(m, 'click', function () {
          if (state.toilets[id]) openDetail(id);
        });
        state.markers[id] = m;
      } else {
        m.setPosition(pos);
        m.setIcon(markerIcon(t));
      }
      m.setZIndex(state.nearId === id ? 300 : (t.source === 'public' ? 40 : 60));
    });
    Object.keys(state.markers).forEach(function (id) {
      if (!seen[id]) {
        state.markers[id].setMap(null);
        delete state.markers[id];
      }
    });
  }

  function updateLabelMode() {
    var labelMode = state.map.getZoom() >= LABEL_ZOOM;
    if (labelMode !== state.labelMode) {
      state.labelMode = labelMode;
      renderMarkers();
    }
  }

  function putToilet(t) {
    state.toilets[t.id] = t;
  }

  // ---------------- 지도 범위의 화장실 불러오기 ----------------
  var loadTimer = null;
  var warnedMany = false;

  function scheduleLoad() {
    clearTimeout(loadTimer);
    loadTimer = setTimeout(loadVisible, 250);
  }

  function loadVisible() {
    if (!state.map) return Promise.resolve();
    var seq = ++state.loadSeq;
    if (state.map.getZoom() < LOAD_ZOOM) {
      // 너무 멀리 보면 지우고 안내만
      var keep = {};
      if (state.nearId && state.toilets[state.nearId]) keep[state.nearId] = state.toilets[state.nearId];
      state.toilets = keep;
      renderMarkers();
      if (!state.addMode) setHint('지도를 확대하면 화장실이 보여요');
      return Promise.resolve();
    }
    var b = state.map.getBounds();
    var sw = b.getSW();
    var ne = b.getNE();
    var box = [sw.lat(), sw.lng(), ne.lat(), ne.lng()].map(function (n) { return n.toFixed(5); }).join(',');
    return api('GET', '/api/toilets?box=' + box).then(function (data) {
      if (seq !== state.loadSeq) return; // 그 사이 지도가 또 움직임
      var next = {};
      (data.toilets || []).forEach(function (t) { next[t.id] = t; });
      if (state.nearId && state.toilets[state.nearId] && !next[state.nearId]) next[state.nearId] = state.toilets[state.nearId];
      state.toilets = next;
      renderMarkers();
      if (!state.addMode && $('hint').textContent === '지도를 확대하면 화장실이 보여요') setHint('');
      if (data.truncated && !warnedMany) {
        warnedMany = true;
        toast('화장실이 많아서 일부만 보여요. 확대하면 더 보여요');
      }
    }).catch(function (err) {
      if (err.status !== 400) toast('화장실 정보를 불러오지 못했어요');
    });
  }

  function setTempMarker(latlng) {
    var nm = naver.maps;
    if (!state.tempMarker) {
      state.tempMarker = new nm.Marker({
        map: state.map,
        position: latlng,
        zIndex: 200,
        icon: {
          content: '<div class="pin temp"><div class="pin-shape"><span>+</span></div></div>',
          anchor: new nm.Point(0, 0),
        },
      });
    } else {
      state.tempMarker.setPosition(latlng);
      state.tempMarker.setMap(state.map);
    }
  }

  function clearTempMarker() {
    if (state.tempMarker) state.tempMarker.setMap(null);
  }

  // ---------------- 주소 (네이버 지오코더) ----------------
  function hasGeocoder() {
    return !!(naver.maps.Service && naver.maps.Service.reverseGeocode);
  }

  function reverseGeocode(latlng) {
    return new Promise(function (resolve) {
      if (!hasGeocoder()) return resolve('');
      var S = naver.maps.Service;
      S.reverseGeocode({
        coords: latlng,
        orders: [S.OrderType.ADDR, S.OrderType.ROAD_ADDR].join(','),
      }, function (status, response) {
        if (status !== S.Status.OK || !response || !response.v2) return resolve('');
        var addr = response.v2.address || {};
        resolve(addr.roadAddress || addr.jibunAddress || '');
      });
    });
  }

  // ---------------- 등록 모드 ----------------
  function setAddMode(on) {
    state.addMode = on;
    var btn = $('add-btn');
    btn.classList.toggle('active', on);
    btn.innerHTML = on ? ICON.x + '등록 취소' : ICON.plus + '화장실 등록';
    if (!on) clearTempMarker();
    updateAddHint();
  }

  function updateAddHint() {
    if (!state.addMode) {
      if ($('hint').textContent.indexOf('등록') >= 0 || $('hint').textContent.indexOf('확대해 주세요') >= 0) setHint('');
      return;
    }
    var need = ADD_ZOOM - state.map.getZoom();
    setHint(need > 0 ? '지도를 ' + need + '단계 더 확대해 주세요' : '등록할 위치를 지도에서 눌러 주세요');
  }

  function onMapClick(latlng) {
    // 등록 버튼을 누른 뒤, 충분히 확대된 상태에서만 등록
    if (!state.addMode) return;
    if (state.map.getZoom() < ADD_ZOOM) {
      toast('지도를 더 확대한 뒤 위치를 눌러 주세요');
      return;
    }
    var lat = latlng.lat();
    var lng = latlng.lng();
    if (!inKorea(lat, lng)) {
      toast('대한민국 안의 위치만 등록할 수 있어요');
      return;
    }
    setTempMarker(latlng);
    reverseGeocode(latlng).then(function (address) {
      showForm({ lat: lat, lng: lng, address: address });
    });
  }

  // ---------------- 로그인 (구글) · 프로필 ----------------
  var PLATFORMS = [
    ['baemin', '배민 일반'],
    ['baemin_plus', '배민플러스'],
    ['coupang', '쿠팡 일반'],
    ['coupang_plus', '쿠팡플러스'],
    ['etc', '기타'],
  ];
  var PLATFORM_TEXT = {};
  PLATFORMS.forEach(function (p) { PLATFORM_TEXT[p[0]] = p[1]; });

  function setMe(me) {
    state.me = me || { loggedIn: false, user: null };
    var u = state.me.user;
    $('me-label').textContent = u ? u.nickname + ' · ' + u.score.toLocaleString() + '점'
      : (state.me.loggedIn ? '프로필 만들기' : '구글로 로그인');
  }

  function refreshMe() {
    return api('GET', '/api/me').then(setMe).catch(function () {});
  }

  // 등록·수정·투표 전에 로그인 + 프로필 확인
  function requireMember(then) {
    if (!state.me.loggedIn) return showLogin(then);
    if (!state.me.user) return showProfile(then);
    then();
  }

  // 서버가 "로그인 필요 / 프로필 필요" 라고 하면 해당 화면으로
  function handleAuthError(err, retry) {
    var d = err && err.data;
    if (d && d.needLogin) { setMe(null); showLogin(retry); return true; }
    if (d && d.needProfile) { state.me.user = null; showProfile(retry); return true; }
    return false;
  }

  var pendingLogin = null;

  function onCredential(token) {
    api('POST', '/api/auth/google', { credential: token }).then(function (me) {
      setMe(me);
      var then = pendingLogin;
      pendingLogin = null;
      if (!me.user) return showProfile(then);
      closeSheet();
      toast(me.user.nickname + '님, 반가워요!');
      if (then) then();
    }).catch(function (err) {
      var el = $('login-error');
      if (el) el.textContent = err.message; else toast(err.message);
    });
  }
  // 안드로이드 앱(네이티브 구글 로그인)이 결과를 넘겨주는 곳
  window.onGoogleCredential = onCredential;
  window.onGoogleCredentialError = function (msg) {
    var el = $('login-error');
    if (el) el.textContent = msg || '구글 로그인을 하지 못했어요.';
  };

  var gsiLoading = null;
  function loadGsi() {
    if (window.google && window.google.accounts && window.google.accounts.id) return Promise.resolve();
    if (gsiLoading) return gsiLoading;
    gsiLoading = new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = 'https://accounts.google.com/gsi/client';
      s.async = true;
      s.onload = resolve;
      s.onerror = function () { gsiLoading = null; reject(new Error('구글 로그인을 불러오지 못했어요.')); };
      document.head.appendChild(s);
    });
    return gsiLoading;
  }

  function showLogin(then) {
    pendingLogin = then || null;
    var nativeApp = !!(window.RiderApp && window.RiderApp.googleSignIn);
    openSheet(
      sheetHead('로그인', ICON.user) +
      '<div class="login-box">' +
        '<p class="login-lead">구글 계정으로 시작하고<br><b>화장실을 등록하면 100점!</b></p>' +
        '<ul class="point-rules">' +
          '<li><span>🚻</span>새 화장실 등록 <b class="plus">+100점</b></li>' +
          '<li><span>👍</span>내 비번이 맞다고 추천받으면 <b class="plus">+20점</b></li>' +
          '<li><span>👎</span>틀렸다고 지적받으면 <b class="minus">-30점</b></li>' +
          '<li><span>🗑️</span>3명이 틀렸다고 하면 화장실 삭제, 합계 <b class="minus">-100점</b></li>' +
        '</ul>' +
        (nativeApp
          ? '<button type="button" class="btn google-btn" data-act="google">' + ICON.google + '구글로 계속하기</button>'
          : '<div id="gsi-btn" class="gsi-btn"></div>') +
        '<p class="form-error" id="login-error"></p>' +
        '<p class="form-note">이메일·이름은 저장하지 않아요. 지도 보기는 로그인 없이도 돼요.</p>' +
      '</div>' +
      '<div class="actions"><button type="button" class="btn" data-act="later">나중에 할게요</button></div>'
    );
    $('sheet-body').onclick = function (e) {
      var btn = e.target.closest('button[data-act]');
      if (!btn) return;
      var act = btn.getAttribute('data-act');
      if (act === 'close' || act === 'later') { pendingLogin = null; closeSheet(); if (state.addMode) setAddMode(false); }
      if (act === 'google') {
        $('login-error').textContent = '';
        window.RiderApp.googleSignIn();
      }
    };
    if (nativeApp) return;
    var cid = state.config && state.config.googleClientId;
    if (!cid) { $('login-error').textContent = '구글 로그인이 아직 준비되지 않았어요.'; return; }
    loadGsi().then(function () {
      google.accounts.id.initialize({
        client_id: cid,
        callback: function (r) { onCredential(r.credential); },
        ux_mode: 'popup',
      });
      var box = $('gsi-btn');
      if (box) google.accounts.id.renderButton(box, { theme: 'filled_blue', size: 'large', shape: 'pill', text: 'continue_with', width: 280, locale: 'ko' });
    }).catch(function (err) {
      var el = $('login-error');
      if (el) el.textContent = err.message;
    });
  }

  function loadRegions() {
    if (state.regions) return Promise.resolve(state.regions);
    return fetch('/regions.json').then(function (r) { return r.json(); }).then(function (d) {
      state.regions = d.sido;
      return state.regions;
    });
  }

  function showProfile(then) {
    var u = state.me.user || {};
    var first = !state.me.user;
    loadRegions().then(function (regions) {
      openSheet(
        sheetHead(first ? '프로필 만들기' : '내 정보 수정', ICON.user) +
        '<form id="profile-form" class="pretty" autocomplete="off">' +
          '<label class="field"><span class="lbl">' + ICON.user + '닉네임 <small>(한글·영문·숫자 2~12자)</small></span>' +
            '<span class="inp"><input name="nickname" maxlength="12" value="' + escapeHtml(u.nickname) + '" placeholder="예: 번개라이더" /></span></label>' +
          '<div class="field"><span class="lbl">' + ICON.pin + '주 활동 지역</span>' +
            '<div class="region-row">' +
              '<select name="sido" class="sel"><option value="">시·도</option>' +
                regions.map(function (r) {
                  return '<option' + (r.name === u.sido ? ' selected' : '') + '>' + escapeHtml(r.name) + '</option>';
                }).join('') +
              '</select>' +
              '<select name="sigungu" class="sel"><option value="">시·군·구</option></select>' +
            '</div></div>' +
          '<div class="field"><span class="lbl">' + ICON.crown + '주로 타는 곳</span>' +
            '<div class="plat-pick">' +
              PLATFORMS.map(function (p) {
                return '<label class="plat ' + p[0] + '"><input type="radio" name="platform" value="' + p[0] + '"' +
                  (u.platform === p[0] ? ' checked' : '') + ' /><span>' + p[1] + '</span></label>';
              }).join('') +
            '</div></div>' +
          (first
            ? '<label class="agree"><input type="checkbox" name="agree" /><span><a href="/terms.html" target="_blank" rel="noopener">이용 규칙</a>과 ' +
              '<a href="/privacy.html" target="_blank" rel="noopener">개인정보처리방침</a>에 동의해요. ' +
              '실제 있는 화장실만, 공개된 비밀번호만 올릴게요.</span></label>'
            : '') +
          '<p class="form-error" id="form-error"></p>' +
          '<div class="actions">' +
            (first ? '' : '<button type="button" class="btn" data-act="logout">로그아웃</button>') +
            '<button type="submit" class="btn primary">' + ICON.check + (first ? '시작하기' : '저장') + '</button>' +
          '</div>' +
        '</form>' +
        (first ? '' : '<button type="button" class="link-btn danger-link" data-act="delete-account">계정 삭제</button>')
      );
      var form = $('profile-form');
      function fillSigungu(selected) {
        var r = regions.filter(function (x) { return x.name === form.elements.sido.value; })[0];
        form.elements.sigungu.innerHTML = '<option value="">시·군·구</option>' + (r ? r.sigungu.map(function (g) {
          return '<option' + (g === selected ? ' selected' : '') + '>' + escapeHtml(g) + '</option>';
        }).join('') : '');
      }
      fillSigungu(u.sigungu);
      form.elements.sido.onchange = function () { fillSigungu(''); };
      $('sheet-body').onclick = function (e) {
        var btn = e.target.closest('button[data-act]');
        if (!btn) return;
        if (btn.getAttribute('data-act') === 'close') { closeSheet(); if (state.addMode && !state.me.user) setAddMode(false); }
        if (btn.getAttribute('data-act') === 'delete-account') {
          if (!confirm('계정을 삭제할까요?\n닉네임·점수·투표 기록이 모두 지워지고 되돌릴 수 없어요.\n(올린 화장실 정보는 작성자 없이 남아요)')) return;
          api('DELETE', '/api/me').then(function () { setMe(null); closeSheet(); toast('계정을 삭제했어요'); })
            .catch(function (e3) { toast(e3.message); });
        }
        if (btn.getAttribute('data-act') === 'logout') {
          api('POST', '/api/auth/logout').then(function () { setMe(null); closeSheet(); toast('로그아웃했어요'); });
        }
      };
      form.onsubmit = function (e) {
        e.preventDefault();
        var err = $('form-error');
        var plat = form.querySelector('input[name="platform"]:checked');
        if (!form.elements.sigungu.value) { err.textContent = '주 활동 지역(시·군·구)을 골라 주세요.'; return; }
        if (!plat) { err.textContent = '주로 타는 곳을 골라 주세요.'; return; }
        if (first && !form.elements.agree.checked) { err.textContent = '이용 규칙에 동의해 주세요.'; return; }
        api('POST', '/api/me/profile', {
          nickname: form.elements.nickname.value.trim(),
          sido: form.elements.sido.value,
          sigungu: form.elements.sigungu.value,
          platform: plat.value,
        }).then(function (me) {
          setMe(me);
          closeSheet();
          toast(first ? '환영해요, ' + me.user.nickname + '님! 화장실을 등록하면 100점이에요' : '저장했어요');
          if (then) then();
        }).catch(function (e2) {
          if (!handleAuthError(e2, then)) err.textContent = e2.message;
        });
      };
    }).catch(function () { toast('지역 목록을 불러오지 못했어요'); });
  }

  function showMe() {
    if (!state.me.loggedIn) return showLogin();
    showProfile();
  }

  // ---------------- 순위표 ----------------
  function showLeaderboard(scope) {
    var u = state.me.user;
    if (scope === 'region' && !u) scope = 'all';
    var q = scope === 'region' ? '?sido=' + encodeURIComponent(u.sido) + '&sigungu=' + encodeURIComponent(u.sigungu) : '';
    api('GET', '/api/leaderboard' + q).then(function (data) {
      var medal = ['🥇', '🥈', '🥉'];
      var row = function (r, isMe) {
        return '<div class="lb-row' + (isMe ? ' me' : '') + (r.rank && r.rank <= 3 ? ' top' : '') + '">' +
          '<span class="lb-rank">' + (r.rank ? (r.rank <= 3 ? medal[r.rank - 1] : r.rank) : '-') + '</span>' +
          '<span class="lb-who"><b>' + escapeHtml(r.nickname) + '</b>' +
            '<small><span class="plat-tag ' + escapeHtml(r.platform) + '">' + escapeHtml(PLATFORM_TEXT[r.platform] || '') + '</span>' +
            escapeHtml(r.sigungu) + '</small></span>' +
          '<span class="lb-score">' + Number(r.score).toLocaleString() + '<small>점</small></span>' +
        '</div>';
      };
      var meName = u && u.nickname;
      openSheet(
        sheetHead('순위표', ICON.trophy) +
        '<div class="lb-tabs">' +
          '<button type="button" data-scope="all" class="' + (scope !== 'region' ? 'on' : '') + '">전국</button>' +
          '<button type="button" data-scope="region" class="' + (scope === 'region' ? 'on' : '') + '">' +
            (u ? escapeHtml(u.sigungu) : '내 지역') + '</button>' +
        '</div>' +
        '<div class="lb-list">' +
          (data.top.length ? data.top.map(function (r) { return row(r, r.nickname === meName); }).join('')
            : '<p class="empty">아직 순위가 없어요. 첫 번째 주인공이 되어 보세요!</p>') +
        '</div>' +
        (data.me ? '<div class="lb-mine"><div class="lb-cap">내 순위' + (scope === 'region' ? ' (' + escapeHtml(u.sigungu) + ')' : ' (전국)') + '</div>' + row(data.me, true) + '</div>'
          : '<div class="lb-mine"><button type="button" class="btn primary" data-act="login">구글로 로그인하고 참여하기</button></div>') +
        '<p class="form-note center">새 화장실 +100 · 맞아요 +20 · 틀려요 -30 (3번이면 삭제, 합계 -100)</p>'
      );
      $('sheet-body').onclick = function (e) {
        var tab = e.target.closest('button[data-scope]');
        if (tab) {
          if (tab.getAttribute('data-scope') === 'region' && !u) return requireMember(function () { showLeaderboard('region'); });
          return showLeaderboard(tab.getAttribute('data-scope'));
        }
        var btn = e.target.closest('button[data-act]');
        if (!btn) return;
        if (btn.getAttribute('data-act') === 'close') closeSheet();
        if (btn.getAttribute('data-act') === 'login') requireMember(function () { showLeaderboard(scope); });
      };
    }).catch(function (err) { toast(err.message); });
  }

  // ---------------- 바텀시트 ----------------
  function openSheet(html) {
    $('sheet-body').innerHTML = html;
    $('sheet').hidden = false;
    $('sheet-backdrop').hidden = false;
    $('sheet').scrollTop = 0;
  }

  function closeSheet() {
    $('sheet').hidden = true;
    $('sheet-backdrop').hidden = true;
    $('sheet-body').innerHTML = '';
    state.detailId = null;
    if (state.tempMarker) clearTempMarker();
  }

  function formatDate(iso) {
    if (!iso) return '';
    var d = new Date(iso);
    return d.getFullYear() + '.' + (d.getMonth() + 1) + '.' + d.getDate();
  }

  function voteBox(t) {
    if (!(t.canVote || t.mine || t.myVote)) return '';
    var pw = t.voteKind === 'password';
    var who = pw ? t.passwordByName : t.ownerName;
    return '<div class="vote-box">' +
      '<div class="vote-q">' + (pw ? '이 비밀번호, 맞나요?' : '실제로 있는 화장실인가요?') +
        (who ? '<small>올린 사람: <b>' + escapeHtml(who) + '</b></small>' : '') + '</div>' +
      '<div class="vote-btns">' +
        '<button type="button" class="vote up' + (t.myVote > 0 ? ' on' : '') + '" data-vote="up"' + (t.canVote ? '' : ' disabled') + '>' +
          '👍 ' + (pw ? '맞아요' : '있어요') + ' <b>' + (t.upVotes || 0) + '</b></button>' +
        '<button type="button" class="vote down' + (t.myVote < 0 ? ' on' : '') + '" data-vote="down"' + (t.canVote ? '' : ' disabled') + '>' +
          '👎 ' + (pw ? '틀려요' : '없어요') + ' <b>' + (t.downVotes || 0) + '</b></button>' +
      '</div>' +
      (t.mine ? '<p class="form-note">내가 올린 정보예요. 맞아요 1번에 +20점!</p>'
        : t.myVote ? '<p class="form-note">투표했어요. 고마워요!</p>'
          : '<p class="form-note">틀려요가 3번 모이면 ' + (t.source === 'public' ? '비밀번호가 지워져요.' : '화장실이 지워져요.') + '</p>') +
    '</div>';
  }

  function vote(t, v) {
    requireMember(function () {
      api('POST', '/api/toilets/' + encodeURIComponent(t.id) + '/vote', { vote: v }).then(function (r) {
        refreshMe();
        if (r.deleted) {
          delete state.toilets[t.id];
          renderMarkers();
          closeSheet();
          return toast('틀렸다는 의견이 3번 모여 이 화장실을 지웠어요');
        }
        if (r.toilet) { putToilet(r.toilet); renderMarkers(); }
        toast(r.cleared ? '틀렸다는 의견이 3번 모여 비밀번호를 지웠어요'
          : v === 'up' ? '고마워요! 올린 사람에게 +20점' : '알려줘서 고마워요. 올린 사람 -30점');
        openDetail(t.id);
      }).catch(function (err) {
        if (!handleAuthError(err, function () { vote(t, v); })) toast(err.message);
      });
    });
  }

  // 상세 정보 (닉네임·투표 수 포함)를 서버에서 다시 받아 그림
  function openDetail(id) {
    var base = state.toilets[id];
    if (base) showDetail(base);
    api('GET', '/api/toilets/' + encodeURIComponent(id)).then(function (d) {
      if (state.detailId === id && !$('sheet').hidden) showDetail(d.toilet);
    }).catch(function (err) {
      if (err.status === 404) {
        delete state.toilets[id];
        renderMarkers();
        if (state.detailId === id) closeSheet();
        toast('지워졌거나 숨겨진 화장실이에요');
      }
    });
  }

  function showDetail(t) {
    clearTempMarker();
    state.detailId = t.id;
    var pub = t.source === 'public';
    openSheet(
      sheetHead(escapeHtml(t.name)) +
      '<div class="detail-tags">' +
        (pub ? '<span class="tag pub">공중화장실</span>' : '<span class="tag user">라이더 등록</span>') +
        '<span class="stars">' + starsText(ratingOf(t)) + '</span>' +
      '</div>' +
      '<div class="addr-box">' + ICON.pin + '<span>' + escapeHtml(t.address || '주소 정보 없음') + '</span></div>' +
      (t.openHours ? '<div class="addr-box">' + ICON.clock + '<span>' + escapeHtml(t.openHours) + '</span></div>' : '') +
      '<div class="pw-box' + (t.password ? '' : ' none') + '">' +
        '<div><div class="k">' + ICON.lock + '비밀번호</div><div class="v">' +
          escapeHtml(t.password || (pub ? '없음 (공중화장실)' : '없음 / 개방')) + '</div></div>' +
      '</div>' +
      '<p class="desc' + (t.description ? '' : ' none') + '">' +
        escapeHtml(t.description || '설명이 없어요. 아시는 정보가 있으면 수정해서 알려주세요!') + '</p>' +
      voteBox(t) +
      '<p class="meta">최근 수정 ' + escapeHtml(formatDate(t.updatedAt)) + (pub ? ' · 출처: 공공데이터포털' : '') +
        (t.ownerName ? ' · 등록: ' + escapeHtml(t.ownerName) : '') + '</p>' +
      '<div class="actions">' +
        '<button type="button" class="btn danger" data-act="report">' + ICON.flag + '신고</button>' +
        '<button type="button" class="btn primary" data-act="edit">' + ICON.pencil + '정보 수정</button>' +
      '</div>'
    );
    $('sheet-body').onclick = function (e) {
      var vb = e.target.closest('button[data-vote]');
      if (vb) return vote(t, vb.getAttribute('data-vote'));
      var btn = e.target.closest('button[data-act]');
      if (!btn) return;
      var act = btn.getAttribute('data-act');
      if (act === 'close') closeSheet();
      if (act === 'edit') requireMember(function () { showForm(t); });
      if (act === 'report') showReport(t);
    };
  }

  function showForm(t) {
    var editing = !!t.id;
    openSheet(
      sheetHead(editing ? '화장실 정보 수정' : '화장실 등록') +
      '<form id="toilet-form" class="pretty" autocomplete="off">' +
        '<label class="field"><span class="lbl">' + ICON.pin + '주소</span>' +
          '<span class="inp gray">' + ICON.pin +
          '<input name="address" maxlength="120" value="' + escapeHtml(t.address) + '" placeholder="주소" />' +
          '</span></label>' +
        '<label class="field"><span class="lbl">' + ICON.crown + '화장실 이름 <small>(비워두면 \'화장실\')</small></span>' +
          '<span class="inp"><input name="name" maxlength="40" value="' + escapeHtml(t.name) + '" placeholder="예: ○○빌딩 2층 화장실" /></span></label>' +
        '<div class="field"><span class="lbl">' + ICON.star + '별점</span>' +
          '<div class="star-row"><div class="star-pick" id="star-pick">' +
            [1, 2, 3, 4, 5].map(function (n) {
              return '<button type="button" data-star="' + n + '" aria-label="별 ' + n + '개">' + ICON.star + '</button>';
            }).join('') +
          '</div><div class="star-step">' +
            '<button type="button" data-step="1" aria-label="별 하나 더">' + ICON.plus + '</button>' +
            '<button type="button" data-step="-1" aria-label="별 하나 빼기">' + ICON.minus + '</button>' +
          '</div></div>' +
          '<input type="hidden" name="rating" value="' + ratingOf(t) + '" /></div>' +
        '<label class="field"><span class="lbl">' + ICON.chat + '비밀번호</span>' +
          '<span class="inp">' + ICON.lock +
          '<input name="password" maxlength="40" value="' + escapeHtml(t.password) + '" placeholder="예: 1234* (없으면 비워두세요)" /></span></label>' +
        '<label class="field"><span class="lbl">' + ICON.clock + '이용 시간</span>' +
          '<span class="inp"><input name="openHours" maxlength="100" value="' + escapeHtml(t.openHours) + '" placeholder="예: 24시간, 09:00~22:00" /></span></label>' +
        '<label class="field"><span class="lbl">' + ICON.pencil + '설명</span>' +
          '<span class="inp area">' + ICON.note +
          '<textarea name="description" maxlength="500" placeholder="위치, 찾아가는 법, 청결도 등">' +
            escapeHtml(t.description) + '</textarea></span></label>' +
        '<p class="form-note">누구나 볼 수 있는 정보예요. 개인정보나 광고는 쓰지 마세요.</p>' +
        '<p class="form-error" id="form-error"></p>' +
        '<div class="actions">' +
          '<button type="button" class="btn" data-act="cancel">취소</button>' +
          '<button type="submit" class="btn primary">' + ICON.check + '저장</button>' +
        '</div>' +
      '</form>'
    );
    var form = $('toilet-form');
    function paintStars() {
      var r = Number(form.elements.rating.value);
      var btns = form.querySelectorAll('#star-pick button');
      for (var i = 0; i < btns.length; i++) btns[i].classList.toggle('on', i < r);
    }
    paintStars();
    function back() {
      if (editing) showDetail(state.toilets[t.id] || t);
      else closeSheet();
    }
    $('sheet-body').onclick = function (e) {
      var star = e.target.closest('button[data-star]');
      if (star) {
        form.elements.rating.value = star.getAttribute('data-star');
        paintStars();
        return;
      }
      var step = e.target.closest('button[data-step]');
      if (step) {
        var r = Number(form.elements.rating.value) + Number(step.getAttribute('data-step'));
        form.elements.rating.value = Math.min(5, Math.max(1, r));
        paintStars();
        return;
      }
      if (e.target.closest('button[data-act="close"], button[data-act="cancel"]')) back();
    };
    if (!editing) setTimeout(function () { form.elements.name.focus(); }, 200);

    form.onsubmit = function (e) {
      e.preventDefault();
      var submitBtn = form.querySelector('button[type="submit"]');
      var payload = {
        name: form.elements.name.value,
        address: form.elements.address.value,
        password: form.elements.password.value,
        openHours: form.elements.openHours.value,
        description: form.elements.description.value,
        rating: Number(form.elements.rating.value),
      };
      if (!editing) { payload.lat = t.lat; payload.lng = t.lng; }
      submitBtn.disabled = true;
      var req = editing
        ? api('PUT', '/api/toilets/' + encodeURIComponent(t.id), payload)
        : api('POST', '/api/toilets', payload);
      req.then(function (data) {
        var saved = data.toilet;
        putToilet(saved);
        clearTempMarker();
        if (!editing) setAddMode(false);
        renderMarkers();
        openDetail(saved.id);
        refreshMe();
        toast(editing ? '수정했어요. 고마워요!' : '등록했어요! +100점 🎉');
      }).catch(function (err) {
        submitBtn.disabled = false;
        if (handleAuthError(err, function () { showForm(t); })) return;
        $('form-error').textContent = err.message;
      });
    };
  }

  // ---------------- 신고 ----------------
  var REASONS = [
    ['wrong', '정보가 틀려요 / 없는 화장실이에요'],
    ['closed', '폐쇄됐거나 이용할 수 없어요'],
    ['spam', '광고·장난·욕설이에요'],
    ['privacy', '건물 관계자예요. 비밀번호 공개를 원하지 않아요'],
    ['other', '기타'],
  ];

  function showReport(t) {
    openSheet(
      sheetHead('신고하기', ICON.flag) +
      '<p class="sheet-sub">' + escapeHtml(t.name) + '</p>' +
      '<form id="report-form" class="pretty">' +
        '<div class="reason-list">' +
          REASONS.map(function (r, i) {
            return '<label class="reason"><input type="radio" name="reason" value="' + r[0] + '"' + (i === 0 ? ' checked' : '') + ' />' +
              '<span>' + escapeHtml(r[1]) + '</span></label>';
          }).join('') +
        '</div>' +
        '<label class="field"><span class="inp area"><textarea name="note" maxlength="200" placeholder="자세한 내용 (선택)"></textarea></span></label>' +
        '<p class="form-note">여러 명이 신고하면 자동으로 숨겨지고, 운영자가 확인해요.</p>' +
        '<p class="form-error" id="form-error"></p>' +
        '<div class="actions">' +
          '<button type="button" class="btn" data-act="cancel">취소</button>' +
          '<button type="submit" class="btn primary danger-fill">' + ICON.flag + '신고하기</button>' +
        '</div>' +
      '</form>'
    );
    var form = $('report-form');
    $('sheet-body').onclick = function (e) {
      if (e.target.closest('button[data-act="close"], button[data-act="cancel"]')) showDetail(t);
    };
    form.onsubmit = function (e) {
      e.preventDefault();
      var btn = form.querySelector('button[type="submit"]');
      btn.disabled = true;
      api('POST', '/api/toilets/' + encodeURIComponent(t.id) + '/report', {
        reason: form.querySelector('input[name="reason"]:checked').value,
        note: form.elements.note.value,
      }).then(function (r) {
        closeSheet();
        if (r.hidden) {
          delete state.toilets[t.id];
          renderMarkers();
          toast('신고가 쌓여 이 화장실을 숨겼어요');
        } else {
          toast(r.duplicate ? '이미 신고한 화장실이에요' : '신고했어요. 운영자가 확인할게요');
        }
      }).catch(function (err) {
        $('form-error').textContent = err.message;
        btn.disabled = false;
      });
    };
  }

  // ---------------- 지역 검색 ----------------
  function showSearch() {
    openSheet(
      sheetHead('지역 검색', ICON.search) +
      '<form id="search-form" class="pretty" autocomplete="off">' +
        '<label class="field"><span class="inp">' + ICON.search +
          '<input name="q" maxlength="60" placeholder="예: 강남역, 부산 해운대구 우동, 세종대로 110" enterkeyhint="search" /></span></label>' +
        '<p class="form-error" id="form-error"></p>' +
        '<div class="actions">' +
          '<button type="button" class="btn" data-act="cancel">취소</button>' +
          '<button type="submit" class="btn primary">' + ICON.search + '이동</button>' +
        '</div>' +
      '</form>'
    );
    var form = $('search-form');
    setTimeout(function () { form.elements.q.focus(); }, 200);
    $('sheet-body').onclick = function (e) {
      if (e.target.closest('button[data-act="close"], button[data-act="cancel"]')) closeSheet();
    };
    form.onsubmit = function (e) {
      e.preventDefault();
      var q = form.elements.q.value.trim();
      if (!q) return;
      if (!(naver.maps.Service && naver.maps.Service.geocode)) {
        $('form-error').textContent = '지금은 검색을 쓸 수 없어요.';
        return;
      }
      naver.maps.Service.geocode({ query: q }, function (status, response) {
        var list = status === naver.maps.Service.Status.OK && response && response.v2 && response.v2.addresses;
        if (!list || !list.length) {
          $('form-error').textContent = '찾지 못했어요. 동 이름이나 도로명 주소로 검색해 보세요.';
          return;
        }
        closeSheet();
        state.map.morph(new naver.maps.LatLng(Number(list[0].y), Number(list[0].x)), 16);
      });
    };
  }

  // ---------------- 배민플러스 가입문의 ----------------
  // 지역을 고르면 담당 번호로 전화 연결 (지역은 여기에 추가)
  var JOIN_REGIONS = [
    { name: '안양·과천', phone: '010-7449-6511' },
  ];

  function showJoin() {
    openSheet(
      sheetHead('배민플러스 가입문의', ICON.phone) +
      '<p class="sheet-sub">누르면 담당자에게 바로 전화로 연결돼요.</p>' +
      '<div class="join-list">' +
        JOIN_REGIONS.map(function (r) {
          return '<a class="join-region" href="tel:' + r.phone.replace(/[^0-9]/g, '') + '">' +
            '<span class="jr-name">' + escapeHtml(r.name) + '</span>' +
            '<span class="jr-call">' + ICON.phone + escapeHtml(r.phone) + '</span></a>';
        }).join('') +
      '</div>'
    );
    $('sheet-body').onclick = function (e) {
      if (e.target.closest('button[data-act="close"]')) closeSheet();
    };
  }

  // ---------------- 운영자 (신고 처리) ----------------
  // 앱 메뉴에는 없음. 운영자는 웹 브라우저에서 주소 끝에 #admin 을 붙여 들어온다.
  var REASON_TEXT = {};
  REASONS.forEach(function (r) { REASON_TEXT[r[0]] = r[1]; });

  function formatDateTime(iso) {
    var d = new Date(iso);
    var p = function (n) { return (n < 10 ? '0' : '') + n; };
    return d.getFullYear() + '.' + (d.getMonth() + 1) + '.' + d.getDate() + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
  }

  function openAdmin() {
    api('GET', '/api/admin/session').then(function (s) {
      if (!s.enabled) {
        openSheet(sheetHead('운영자', ICON.user) + '<p class="empty">운영자 비밀번호가 아직 설정되지 않았어요.<br>서버 환경변수 ADMIN_PASSWORD 를 넣어 주세요.</p>');
        $('sheet-body').onclick = function (e) { if (e.target.closest('button[data-act="close"]')) closeSheet(); };
        return;
      }
      if (s.admin) showReported(); else showAdminLogin();
    }).catch(function (err) { toast(err.message); });
  }

  function showAdminLogin() {
    openSheet(
      sheetHead('운영자 로그인', ICON.user) +
      '<form id="admin-form" class="pretty" autocomplete="off">' +
        '<label class="field"><span class="inp">' + ICON.lock +
          '<input name="password" type="password" maxlength="40" placeholder="운영자 비밀번호" /></span></label>' +
        '<p class="form-error" id="form-error"></p>' +
        '<div class="actions">' +
          '<button type="button" class="btn" data-act="cancel">취소</button>' +
          '<button type="submit" class="btn primary">확인</button>' +
        '</div>' +
      '</form>'
    );
    var form = $('admin-form');
    setTimeout(function () { form.elements.password.focus(); }, 200);
    $('sheet-body').onclick = function (e) {
      if (e.target.closest('button[data-act="close"], button[data-act="cancel"]')) closeSheet();
    };
    form.onsubmit = function (e) {
      e.preventDefault();
      api('POST', '/api/admin/login', { password: form.elements.password.value })
        .then(showReported)
        .catch(function (err) {
          $('form-error').textContent = err.message;
          form.elements.password.value = '';
        });
    };
  }

  function showReported() {
    api('GET', '/api/admin/reported').then(function (data) {
      var list = data.toilets || [];
      openSheet(
        sheetHead('신고된 화장실 ' + list.length + '곳', ICON.flag) +
        '<div class="apps">' +
        (list.length ? list.map(function (t) {
          return '<div class="app-card' + (t.hidden ? ' hidden-card' : '') + '">' +
            '<div class="top"><span class="nm">' + escapeHtml(t.name) + '</span>' +
              '<span class="zn ' + (t.hidden ? 'off' : 'on') + '">' + (t.hidden ? '숨김' : '보임') + ' · 신고 ' + t.reportCount + '</span></div>' +
            '<div class="meta2">' + escapeHtml(t.address || '') + '</div>' +
            '<div class="meta2">비밀번호: ' + escapeHtml(t.password || '없음') + '</div>' +
            (t.reports || []).map(function (r) {
              return '<div class="msg">· ' + escapeHtml(REASON_TEXT[r.reason] || r.reason) +
                (r.note ? ' — ' + escapeHtml(r.note) : '') + ' <small>(' + escapeHtml(formatDateTime(r.createdAt)) + ')</small></div>';
            }).join('') +
            '<div class="admin-acts">' +
              (t.hidden
                ? '<button type="button" class="btn" data-op="unhide" data-id="' + t.id + '">다시 보이기</button>'
                : '<button type="button" class="btn" data-op="hide" data-id="' + t.id + '">숨기기</button>') +
              '<button type="button" class="btn" data-op="history" data-id="' + t.id + '">수정 기록</button>' +
              '<button type="button" class="btn danger" data-op="delete" data-id="' + t.id + '">삭제</button>' +
            '</div>' +
          '</div>';
        }).join('') : '<p class="empty">처리할 신고가 없어요.</p>') +
        '</div>' +
        '<div class="actions">' +
          '<button type="button" class="btn" data-act="admin-logout">운영자 로그아웃</button>' +
          '<button type="button" class="btn primary" data-act="close">닫기</button>' +
        '</div>'
      );
      $('sheet-body').onclick = function (e) {
        var op = e.target.closest('button[data-op]');
        if (op) {
          var id = op.getAttribute('data-id');
          var kind = op.getAttribute('data-op');
          if (kind === 'history') return showHistory(id);
          if (kind === 'delete' && !confirm('이 화장실을 완전히 삭제할까요? 되돌릴 수 없어요.')) return;
          var req = kind === 'delete'
            ? api('DELETE', '/api/admin/toilets/' + encodeURIComponent(id))
            : api('POST', '/api/admin/toilets/' + encodeURIComponent(id) + '/' + kind);
          req.then(function () { scheduleLoad(); showReported(); }).catch(function (err) { toast(err.message); });
          return;
        }
        var btn = e.target.closest('button[data-act]');
        if (!btn) return;
        if (btn.getAttribute('data-act') === 'close') closeSheet();
        if (btn.getAttribute('data-act') === 'admin-logout') {
          api('POST', '/api/admin/logout').then(function () { closeSheet(); toast('운영자 로그아웃했어요'); });
        }
      };
    }).catch(function (err) {
      if (err.status === 401) showAdminLogin(); else toast(err.message);
    });
  }

  function showHistory(id) {
    api('GET', '/api/admin/toilets/' + encodeURIComponent(id) + '/revisions').then(function (data) {
      var revs = data.revisions || [];
      openSheet(
        sheetHead('수정 기록', ICON.clock) +
        '<div class="apps">' + revs.map(function (r) {
          var d = r.data || {};
          return '<div class="app-card"><div class="meta2">' + escapeHtml(formatDateTime(r.createdAt)) + '</div>' +
            '<div class="msg"><b>' + escapeHtml(d.name) + '</b> · 비밀번호 ' + escapeHtml(d.password || '없음') + '</div>' +
            (d.description ? '<div class="msg">' + escapeHtml(d.description) + '</div>' : '') + '</div>';
        }).join('') + '</div>' +
        '<div class="actions"><button type="button" class="btn primary" data-act="back">목록으로</button></div>'
      );
      $('sheet-body').onclick = function (e) {
        if (e.target.closest('button[data-act="back"], button[data-act="close"]')) showReported();
      };
    }).catch(function (err) { toast(err.message); });
  }

  // ---------------- 내 위치 ----------------
  function showMyLocation(latlng) {
    var nm = naver.maps;
    if (!state.myMarker) {
      state.myMarker = new nm.Marker({
        map: state.map,
        position: latlng,
        zIndex: 10,
        icon: {
          content: '<div style="width:16px;height:16px;border-radius:50%;background:#2f7cf6;border:3px solid #fff;box-shadow:0 0 0 2px rgba(47,124,246,.35);transform:translate(-50%,-50%)"></div>',
          anchor: new nm.Point(0, 0),
        },
      });
    } else {
      state.myMarker.setPosition(latlng);
    }
  }

  // 안드로이드 앱이면 위치 권한 창·설정 화면을 앱이 직접 열어 줌
  function canFixLocation() {
    return !!(window.RiderApp && window.RiderApp.fixLocation);
  }
  var pendingLocation = null;
  window.onLocationFix = function (state) {
    var retry = pendingLocation;
    pendingLocation = null;
    if (!retry) return;
    if (state === 'granted') { closeSheet(); getPosition(retry); } else locationHelp(1, retry);
  };

  function getPosition(onOk, quiet) {
    if (!navigator.geolocation) return quiet ? null : locationHelp(0, onOk);
    navigator.geolocation.getCurrentPosition(function (pos) {
      onOk(pos.coords.latitude, pos.coords.longitude);
    }, function (err) {
      if (quiet) return;
      var code = err && err.code;
      // 권한 없음(1)·위치 꺼짐(2): 앱이 권한 창이나 설정 화면을 바로 띄움
      if (canFixLocation() && (code === 1 || code === 2)) {
        pendingLocation = onOk;
        window.RiderApp.fixLocation(false);
        return;
      }
      locationHelp(code, onOk);
    }, { enableHighAccuracy: true, timeout: 10000, maximumAge: 30000 });
  }

  // 위치를 못 가져왔을 때 이유별 해결 방법 안내
  function locationHelp(code, retry) {
    var ua = navigator.userAgent || '';
    var android = /Android/i.test(ua);
    var inApp = /KAKAOTALK|NAVER\(inapp|Instagram|FBAN|FBAV|Line\/|DaumApps|Telegram/i.test(ua);
    var ourApp = android && /; wv\)/.test(ua) && !inApp;
    var title;
    var body;
    if (code === 2) {
      title = '휴대폰 위치(GPS)가 꺼져 있어요';
      body = '<p>화면 위쪽을 아래로 내려 <b>위치</b>를 켠 뒤 다시 시도해 주세요.</p>';
    } else if (code === 3) {
      title = '위치를 찾는 데 시간이 걸리고 있어요';
      body = '<p>실내라면 창가나 밖에서 잠시 후 다시 시도해 주세요.</p>';
    } else if (canFixLocation()) {
      title = '위치 권한을 허용해 주세요';
      body = '<p>가까운 화장실을 찾으려면 위치가 필요해요.<br>아래 버튼을 누르고 <b>앱 사용 중에만 허용</b>을 골라 주세요.</p>';
    } else if (ourApp) {
      title = '앱에 위치 권한이 없어요';
      body = '<ol><li>휴대폰 <b>설정</b> → <b>애플리케이션</b> → <b>라이더 화장실맵</b></li>' +
        '<li><b>권한</b> → <b>위치</b> → <b>앱 사용 중에만 허용</b></li></ol>';
    } else {
      title = '위치 권한이 막혀 있어요';
      body = '<p>주소창 왼쪽 아이콘 → <b>권한(사이트 설정)</b> → <b>위치 허용</b> 후 새로고침해 주세요.</p>';
    }
    openSheet(
      sheetHead(title, ICON.pin) + '<div class="loc-help">' + body + '</div>' +
      '<div class="actions"><button type="button" class="btn" data-act="cancel">닫기</button>' +
        '<button type="button" class="btn primary" data-act="retry">' +
        (canFixLocation() && code !== 3 ? '위치 허용하기' : '다시 시도') + '</button></div>'
    );
    $('sheet-body').onclick = function (e) {
      if (e.target.closest('button[data-act="cancel"], button[data-act="close"]')) closeSheet();
      if (e.target.closest('button[data-act="retry"]')) {
        if (canFixLocation() && code !== 3) {
          // 권한 창(또는 막혀 있으면 앱 설정 화면)을 바로 연다
          pendingLocation = retry;
          window.RiderApp.fixLocation(true);
          return;
        }
        closeSheet();
        getPosition(retry);
      }
    };
  }

  // 앱을 열면 내 위치를 찾아 지도 중심으로 (실패하면 조용히 기본 위치)
  function autoLocate() {
    getPosition(function (lat, lng) {
      if (state.nearId || !inKorea(lat, lng)) return;
      var latlng = new naver.maps.LatLng(lat, lng);
      showMyLocation(latlng);
      state.map.morph(latlng, NEAR_MAX_ZOOM);
    }, true);
  }

  function locate() {
    getPosition(function (lat, lng) {
      if (!inKorea(lat, lng)) {
        toast('현재 위치가 대한민국 밖이에요');
        return;
      }
      var latlng = new naver.maps.LatLng(lat, lng);
      showMyLocation(latlng);
      state.map.morph(latlng, LABEL_ZOOM);
    });
  }

  // ---------------- 내 근처 화장실 + 걷는 길 ----------------
  function formatDistance(m) {
    return m < 1000 ? Math.round(m / 10) * 10 + 'm' : (m / 1000).toFixed(1) + 'km';
  }

  // 걷는 길 경로 (OpenStreetMap 기반 무료 경로 서비스, FOSSGIS). 실패하면 직선 점선으로 표시
  var ROUTE_URL = 'https://routing.openstreetmap.de/routed-foot/route/v1/foot/';

  function fetchWalkRoute(from, to) {
    var url = ROUTE_URL + from.lng + ',' + from.lat + ';' + to.lng + ',' + to.lat + '?overview=full&geometries=geojson';
    var ctrl = window.AbortController ? new AbortController() : null;
    var timer = setTimeout(function () { if (ctrl) ctrl.abort(); }, 7000);
    return fetch(url, ctrl ? { signal: ctrl.signal } : {}).then(function (r) {
      clearTimeout(timer);
      if (!r.ok) throw new Error('route ' + r.status);
      return r.json();
    }).then(function (data) {
      var route = data && data.routes && data.routes[0];
      if (!route || !route.geometry) throw new Error('no route');
      return {
        path: route.geometry.coordinates.map(function (c) { return { lat: c[1], lng: c[0] }; }),
        distance: route.distance,
      };
    });
  }

  function clearNearby() {
    state.nearId = null;
    if (state.routeLine) { state.routeLine.setMap(null); state.routeLine = null; }
    $('near-btn').classList.remove('active');
    renderMarkers();
  }

  function drawRoute(points, dashed) {
    var nm = naver.maps;
    if (state.routeLine) state.routeLine.setMap(null);
    state.routeLine = new nm.Polyline({
      map: state.map,
      path: points.map(function (p) { return new nm.LatLng(p.lat, p.lng); }),
      strokeColor: '#1aa564',
      strokeWeight: dashed ? 4 : 6,
      strokeOpacity: 0.85,
      strokeStyle: dashed ? 'shortdash' : 'solid',
      strokeLineCap: 'round',
      strokeLineJoin: 'round',
      clickable: false,
      zIndex: 5,
    });
  }

  var NEAR_MAX_ZOOM = LABEL_ZOOM - 1; // 이름표가 나오기 직전 단계까지만 확대

  function nearby() {
    if (!state.map) return;
    if (state.nearId) return clearNearby(); // 다시 누르면 해제
    toast('내 위치를 찾는 중…');
    getPosition(function (lat, lng) {
      if (!inKorea(lat, lng)) return toast('현재 위치가 대한민국 밖이에요');
      var here = { lat: lat, lng: lng };
      showMyLocation(new naver.maps.LatLng(lat, lng));
      api('GET', '/api/toilets/nearest?lat=' + lat.toFixed(6) + '&lng=' + lng.toFixed(6)).then(function (data) {
        var best = (data.toilets || [])[0];
        if (!best) {
          state.map.morph(new naver.maps.LatLng(lat, lng), NEAR_MAX_ZOOM);
          return toast('주변 30km 안에 등록된 화장실이 없어요. 첫 번째로 등록해 주세요!');
        }
        putToilet(best);
        state.nearId = best.id;
        $('near-btn').classList.add('active');
        renderMarkers();

        var dest = { lat: best.lat, lng: best.lng };
        var fit = function (points) {
          var minLat = 90, maxLat = -90, minLng = 180, maxLng = -180;
          points.forEach(function (p) {
            minLat = Math.min(minLat, p.lat); maxLat = Math.max(maxLat, p.lat);
            minLng = Math.min(minLng, p.lng); maxLng = Math.max(maxLng, p.lng);
          });
          state.map.fitBounds(
            new naver.maps.LatLngBounds(new naver.maps.LatLng(minLat, minLng), new naver.maps.LatLng(maxLat, maxLng)),
            { top: 110, right: 70, bottom: 170, left: 70 }
          );
          if (state.map.getZoom() > NEAR_MAX_ZOOM) state.map.setZoom(NEAR_MAX_ZOOM);
        };
        var say = function (meters, viaRoad) {
          var walk = Math.max(1, Math.round(meters / 67)); // 걸음 약 4km/h
          toast('가장 가까운 화장실: ' + best.name + ' · ' + (viaRoad ? '' : '직선 ') +
            formatDistance(meters) + ' (걸어서 약 ' + walk + '분)', 'pin');
        };
        drawRoute([here, dest], true);
        fit([here, dest]);
        if (best.distance > 5000) return say(best.distance, false); // 너무 멀면 경로 생략
        fetchWalkRoute(here, dest).then(function (route) {
          if (state.nearId !== best.id) return;
          drawRoute(route.path, false);
          fit(route.path.concat([here, dest]));
          say(route.distance, true);
        }).catch(function () {
          if (state.nearId !== best.id) return;
          say(best.distance, false);
        });
      }).catch(function (err) { toast(err.message); });
    });
  }

  // 안드로이드 앱의 뒤로가기 버튼: 열린 시트/메뉴를 먼저 닫는다
  window.toiletmapBack = function () {
    if (!$('sheet').hidden) { closeSheet(); return true; }
    if (state.addMode) { setAddMode(false); return true; }
    if (!$('menu').hidden) { $('menu').hidden = true; return true; }
    return false;
  };

  function setupMainUi() {
    $('locate-btn').addEventListener('click', locate);
    $('near-btn').addEventListener('click', nearby);
    $('search-btn').addEventListener('click', function () { if (state.map) showSearch(); });
    $('rank-btn').addEventListener('click', function () { showLeaderboard('all'); });
    $('add-btn').addEventListener('click', function () {
      if (!state.map) return;
      if (state.addMode) return setAddMode(false);
      requireMember(function () { setAddMode(true); });
    });
    $('add-btn').innerHTML = ICON.plus + '화장실 등록';
    $('sheet-backdrop').addEventListener('click', closeSheet);
    $('menu-btn').addEventListener('click', function () {
      $('menu').hidden = !$('menu').hidden;
    });
    $('menu').addEventListener('click', function (e) {
      var btn = e.target.closest('button, a');
      if (!btn) return;
      $('menu').hidden = true;
      if (btn.id === 'join-btn') showJoin();
      if (btn.id === 'me-btn') showMe();
      if (btn.id === 'rank-menu-btn') showLeaderboard(state.me.user ? 'region' : 'all');
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') closeSheet();
    });
  }

  // 앱을 내렸다가 다시 열었을 때 서버에 새 버전이 올라와 있으면 화면을 새로 고친다
  // (열려 있는 입력창이 있으면 쓰던 내용이 날아가지 않게 다음 기회로 미룸)
  var lastVersionCheck = 0;
  function checkNewVersion() {
    if (!state.config || Date.now() - lastVersionCheck < 60000) return;
    lastVersionCheck = Date.now();
    api('GET', '/api/config').then(function (c) {
      if (c.version && state.config.version && c.version !== state.config.version && $('sheet').hidden) {
        location.reload();
      }
    }).catch(function () {});
  }

  // ---------------- 시작 ----------------
  function start() {
    setupMainUi();
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(function () {});
    }
    api('GET', '/api/config').then(function (config) {
      state.config = config;
      if (!config.naverClientId) {
        fatal('서버에 NAVER_MAP_CLIENT_ID 가 설정되지 않았습니다.');
        return;
      }
      $('main').hidden = false;
      if (location.hash === '#admin') openAdmin();
      window.addEventListener('hashchange', function () { if (location.hash === '#admin') openAdmin(); });
      refreshMe().then(function () {
        // 처음 열면 한 번 로그인 안내 (나중에 해도 됨)
        var asked = false;
        try { asked = localStorage.getItem('ridermap.loginAsked') === '1'; localStorage.setItem('ridermap.loginAsked', '1'); } catch (e) { /* 무시 */ }
        if (!state.me.loggedIn && !asked) showLogin();
        else if (state.me.loggedIn && !state.me.user) showProfile();
      });
      return loadNaverMaps(config.naverClientId).then(initMap).then(function () {
        autoLocate();
        return loadVisible();
      });
    }).catch(function (err) {
      fatal(err && err.message ? escapeHtml(err.message) : '서버에 연결할 수 없습니다.<br>인터넷 연결을 확인해 주세요.');
    });

    // 앱으로 돌아왔을 때 다른 사람이 수정한 내용 반영
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState !== 'visible') return;
      if (state.map) scheduleLoad();
      checkNewVersion();
    });
  }

  start();
})();
