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

    // pv_id 를 클라가 만든다 — 입장 응답을 기다리지 않아, 응답 전 이탈한 빠른 방문도 closeup 이 같은 id 로
    // 기록된다(예전엔 응답 전 이탈이 통째로 유실됐다). randomUUID 없으면 폴백 생성.
    var pv_id = (window.crypto && crypto.randomUUID) ? crypto.randomUUID()
      : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
          var r = (Math.random() * 16) | 0, v = c === 'x' ? r : (r & 0x3) | 0x8; return v.toString(16);
        });
    var startedAt = Date.now();
    var maxScrollPct = 0;

    // 활성 체류(백그라운드 제외) — visible 인 동안만 누적. durationMs(벽시계)의 방치탭 오염을 뺀 값.
    var activeMs = 0;
    var activeSince = document.visibilityState === 'visible' ? Date.now() : null;
    // 스크롤 마일스톤 — 25/50/75/100% 처음 도달 시각(입장 후 ms). 섹션 높이에 안 휘둘리는 독립 축.
    var milestones = {};
    // CTA 클릭 로그 — closeup 에도 이중으로 실어 즉시 전송이 유실돼도 남게 한다.
    var ctaLog = [];

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
      id: pv_id,
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

    // 1) 입장 기록 — id 는 클라가 이미 만들었으므로 응답을 기다릴 필요가 없다(keepalive 로 이탈 중에도 발송).
    fetch('/api/track/pageview', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      keepalive: true,
    }).catch(function(){});

    // 2) 스크롤 추적
    var ticking = false;
    function onScroll() {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(function(){
        var p = getScrollPct();
        if (p > maxScrollPct) maxScrollPct = p;
        // 마일스톤 — 각 깊이에 처음 도달한 시각(입장 후 ms)만 기록
        var ms = [25, 50, 75, 100];
        for (var i = 0; i < ms.length; i++) { if (p >= ms[i] && !milestones[ms[i]]) milestones[ms[i]] = Date.now() - startedAt; }
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

    // 2c) CTA 클릭(전화·문자) — 캡처 단계로 기본동작(다이얼러 전환) 전에 잡아 즉시 전송. 전환의 직접 신호.
    document.addEventListener('click', function (e) {
      var t = e.target;
      var a = (t && t.closest) ? t.closest('a[href^="tel:"], a[href^="sms:"]') : null;
      if (!a) return;
      var href = a.getAttribute('href') || '';
      var kind = href.indexOf('tel:') === 0 ? 'tel' : 'sms';
      var host = a.closest ? a.closest('section[id]') : null;
      var section = host ? host.id : null;
      var tMs = Date.now() - startedAt;
      ctaLog.push({ kind: kind, section: section, tMs: tMs });
      var body = JSON.stringify({ id: pv_id, kind: kind, section: section, tMs: tMs });
      if (navigator.sendBeacon) navigator.sendBeacon('/api/track/cta', new Blob([body], { type: 'application/json' }));
      else { try { fetch('/api/track/cta', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: body, keepalive: true }); } catch (_) {} }
    }, true);

    // 3) 페이지 닫을 때 closeup (체류·활성시간·스크롤·섹션·마일스톤) — sendBeacon 으로 안전 전송
    function sendCloseup() {
      var curActive = activeMs + (activeSince != null ? Date.now() - activeSince : 0);
      var data = {
        id: pv_id,
        durationMs: Date.now() - startedAt,
        activeMs: curActive,
        scrollDepthPct: getScrollPct() > maxScrollPct ? getScrollPct() : maxScrollPct,
        sectionDwellMs: sectionTimes,
        scrollMilestones: milestones,
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
    // visibilitychange(hidden)는 모바일 백그라운드 전환에도 발동 — 더 안정적.
    // 동시에 활성 체류 구간을 누적/재개해 activeMs 를 만든다(백그라운드 시간 제외).
    document.addEventListener('visibilitychange', function(){
      if (document.visibilityState === 'hidden') {
        if (activeSince != null) { activeMs += Date.now() - activeSince; activeSince = null; }
        sendCloseup();
      } else {
        activeSince = Date.now();
      }
    });
    window.addEventListener('pagehide', sendCloseup);
    window.addEventListener('beforeunload', sendCloseup);
  } catch (e) { /* tracking 실패해도 페이지엔 영향 없게 */ }
})();
