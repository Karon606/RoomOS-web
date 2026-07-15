// 공개 랜딩 페이지 공용 트래킹 스크립트 — 입장(pageview)·스크롤·섹션별 체류·종료(closeup) 수집. 영업장 폴더 교체 시 script 참조 한 줄만 살리면 복구되도록 분리.
(function () {
  try {
    var THIS = document.currentScript;

    // slug — location.pathname 의 /members/<slug>/ 패턴에서 파생 (멀티테넌트, 하드코딩 금지)
    var m = window.location.pathname.match(/\/members\/([^/]+)/);
    var SLUG = m ? m[1] : null;
    if (!SLUG) return;  // members 경로가 아니면 트래킹하지 않음

    // 섹션 목록 — 우선 <script data-sections="..."> 로 페이지가 명시한 값 사용,
    // 없으면 최상위 <section id="..."> 요소에서 자동 파생.
    var SECTIONS;
    var dataSections = THIS && THIS.getAttribute('data-sections');
    if (dataSections) {
      SECTIONS = dataSections.split(',').map(function (s) { return s.trim(); }).filter(Boolean);
    } else {
      SECTIONS = Array.prototype.map.call(
        document.querySelectorAll('section[id]'),
        function (el) { return el.id; }
      );
    }

    var qs = new URLSearchParams(window.location.search);

    // 입장 시점에 1차 페이지뷰 기록 (id 반환받아 closeup 업데이트에 사용)
    var pv_id = null;
    var startedAt = Date.now();
    var maxScrollPct = 0;

    function getScrollPct() {
      var doc = document.documentElement;
      var body = document.body;
      var winH = window.innerHeight || doc.clientHeight;
      var docH = Math.max(body.scrollHeight, doc.scrollHeight, body.offsetHeight, doc.offsetHeight, body.clientHeight, doc.clientHeight);
      var scrolled = (window.pageYOffset || doc.scrollTop || 0) + winH;
      if (docH <= winH) return 100;
      return Math.max(0, Math.min(100, Math.round(scrolled / docH * 100)));
    }

    var payload = {
      slug: SLUG,
      path: window.location.pathname,
      referrer: document.referrer || null,
      utmSource:   qs.get('utm_source')   || null,
      utmMedium:   qs.get('utm_medium')   || null,
      utmCampaign: qs.get('utm_campaign') || null,
      // 화면/언어
      screenWidth:    window.screen && screen.width  || null,
      screenHeight:   window.screen && screen.height || null,
      viewportWidth:  window.innerWidth  || null,
      viewportHeight: window.innerHeight || null,
      language: navigator.language || null,
    };

    // 1) 입장 기록 (fetch 로 id 받기)
    fetch('/api/track/pageview', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      keepalive: true,
    }).then(function(r){ return r.ok ? r.json() : null; })
      .then(function(data){ if (data && data.id) pv_id = data.id; })
      .catch(function(){});

    // 2) 스크롤 추적
    var ticking = false;
    function onScroll() {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(function(){
        var p = getScrollPct();
        if (p > maxScrollPct) maxScrollPct = p;
        ticking = false;
      });
    }
    window.addEventListener('scroll', onScroll, { passive: true });

    // 2b) 섹션별 체류시간 — 1초마다 '뷰포트 중앙을 차지한 섹션'에 시간을 적립.
    //     어떤 영역(객실·편의·위치·문의 등)에 오래 머물렀는지 /marketing 에서 본다.
    var sectionTimes = {};
    var lastTick = Date.now();
    setInterval(function(){
      var now = Date.now();
      var dt = now - lastTick;
      lastTick = now;
      // 탭이 숨겨졌거나(백그라운드) 긴 공백이면 적립하지 않음
      if (document.visibilityState !== 'visible' || dt > 5000) return;
      var winH = window.innerHeight || document.documentElement.clientHeight;
      var centerY = winH / 2;
      var best = null, bestDist = Infinity;
      for (var i = 0; i < SECTIONS.length; i++) {
        var el = document.getElementById(SECTIONS[i]);
        if (!el) continue;
        var r = el.getBoundingClientRect();
        if (r.bottom < 0 || r.top > winH) continue;            // 화면 밖
        if (r.top <= centerY && r.bottom >= centerY) { best = SECTIONS[i]; break; } // 중앙 포함 = 확정
        var dist = r.top > centerY ? r.top - centerY : centerY - r.bottom;
        if (dist < bestDist) { bestDist = dist; best = SECTIONS[i]; }
      }
      if (best) sectionTimes[best] = (sectionTimes[best] || 0) + dt;
    }, 1000);

    // 3) 페이지 닫을 때 closeup (체류시간 + 최대 스크롤 + 섹션별 체류) — sendBeacon 으로 안전 전송
    function sendCloseup() {
      if (!pv_id) return;
      var data = {
        id: pv_id,
        durationMs: Date.now() - startedAt,
        scrollDepthPct: getScrollPct() > maxScrollPct ? getScrollPct() : maxScrollPct,
        sectionDwellMs: sectionTimes,
      };
      var url = '/api/track/closeup';
      var json = JSON.stringify(data);
      if (navigator.sendBeacon) {
        navigator.sendBeacon(url, new Blob([json], { type: 'application/json' }));
      } else {
        // 일부 브라우저는 unload 중 fetch가 실패할 수 있음 — 최선 노력
        try { fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: json, keepalive: true }); } catch(e){}
      }
    }
    // visibilitychange(hidden)는 모바일 백그라운드 전환에도 발동 — 더 안정적
    document.addEventListener('visibilitychange', function(){
      if (document.visibilityState === 'hidden') sendCloseup();
    });
    window.addEventListener('pagehide', sendCloseup);
    window.addEventListener('beforeunload', sendCloseup);
  } catch (e) { /* tracking 실패해도 페이지엔 영향 없게 */ }
})();
