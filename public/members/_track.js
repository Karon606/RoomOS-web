// 공개 랜딩 페이지 공용 트래킹 스크립트 — 입장(pageview)·스크롤·섹션별 체류·종료(closeup) 수집. 영업장 폴더 교체 시 script 참조 한 줄만 살리면 복구되도록 분리.
(function () {
  try {
    var THIS = document.currentScript;

    // slug — location.pathname 의 /members/<slug>/ 패턴에서 파생 (멀티테넌트, 하드코딩 금지)
    var m = window.location.pathname.match(/\/members\/([^/]+)/);
    var SLUG = m ? m[1] : null;
    if (!SLUG) return;  // members 경로가 아니면 트래킹하지 않음

    // 운영자 복귀 버튼 — 이 페이지는 앱 밖(공개 사이트)이라 홈화면 앱에서 열면 주소창도 뒤로가기도
    // 없어 돌아올 길이 사라진다(신고 3353a4ed, 가이드 §27.7 "새 창은 복귀 경로를 함께 둔다").
    // 트래킹 제외가 켜진 브라우저 = 운영자 본인이므로 그때만 만든다. 고객 화면에는 아예 안 생긴다.
    // 운영자 전용이라 4개 언어 병기 대상이 아니다(고객 문구가 아니다).
    function mountBackToApp() {
      var put = function () {
        if (!document.body || document.getElementById('stayeum-back-to-app')) return;
        var a = document.createElement('a');
        a.id = 'stayeum-back-to-app';
        a.href = '/dashboard';
        a.textContent = '앱으로 돌아가기';
        a.setAttribute('style', 'position:fixed;left:14px;bottom:calc(14px + env(safe-area-inset-bottom));'
          + 'z-index:95;display:inline-flex;align-items:center;min-height:44px;padding:0 16px;'
          + 'border-radius:999px;background:rgba(23,23,23,.88);color:#fff;font-size:13px;'
          + 'font-family:inherit;line-height:1;text-decoration:none;box-shadow:0 4px 14px rgba(0,0,0,.28);'
          // 테두리 한 줄 — 짙은 초록 히어로 위에서는 알약과 배경의 경계가 거의 안 보인다
          + 'border:1px solid rgba(255,255,255,.22)');
        document.body.appendChild(a);
      };
      if (document.body) put();
      else document.addEventListener('DOMContentLoaded', put);
    }

    // 본인(운영자) 제외 — 주소 뒤에 ?nolog=1 을 붙여 한 번 열면 그 브라우저는 이후 계속 제외(localStorage 기억).
    // ?nolog=0 으로 해제. 여기서 return 하면 pageview·closeup·cta·갤러리 계측(pv 의존)이 전부 차단된다.
    try {
      var flag = new URLSearchParams(window.location.search).get('nolog');
      if (flag === '1') localStorage.setItem('stayeumNoLog', '1');
      else if (flag === '0') localStorage.removeItem('stayeumNoLog');
      if (localStorage.getItem('stayeumNoLog') === '1') { mountBackToApp(); return; }
    } catch (e) { /* localStorage 막힌 브라우저는 그냥 정상 트래킹 */ }

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

    // UUID 생성 — pv_id(방문 1건)와 vid(익명 방문자 ID)가 공용. randomUUID 없으면 폴백 생성.
    function genUuid() {
      return (window.crypto && crypto.randomUUID) ? crypto.randomUUID()
        : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
            var r = (Math.random() * 16) | 0, v = c === 'x' ? r : (r & 0x3) | 0x8; return v.toString(16);
          });
    }

    // 익명 방문자 ID — localStorage 영속. 같은 브라우저면 날짜·IP(모바일 이동)가 바뀌어도 같은 방문자로
    // 이어진다(재방문 회차 과소집계 해소). storage 막힌 브라우저는 null → 서버가 기존 방식으로 폴백.
    var VID = null;
    try {
      VID = localStorage.getItem('stayeumVid');
      if (!VID) { VID = genUuid(); localStorage.setItem('stayeumVid', VID); }
    } catch (e) { VID = null; }

    // pv_id 를 클라가 만든다 — 입장 응답을 기다리지 않아, 응답 전 이탈한 빠른 방문도 closeup 이 같은 id 로
    // 기록된다(예전엔 응답 전 이탈이 통째로 유실됐다).
    var pv_id = genUuid();
    window.__stayeumPv = pv_id;   // 갤러리 스크립트(_gallery.js)가 같은 방문에 이벤트를 붙일 수 있게 노출
    var startedAt = Date.now();
    var maxScrollPct = 0;

    // 활성 체류(백그라운드 제외) — visible 인 동안만 누적. durationMs(벽시계)의 방치탭 오염을 뺀 값.
    var activeMs = 0;
    var activeSince = document.visibilityState === 'visible' ? Date.now() : null;
    // 스크롤 마일스톤 — 25/50/75/100% 처음 도달 시각(입장 후 ms). 섹션 높이에 안 휘둘리는 독립 축.
    var milestones = {};
    // CTA 클릭 로그 — closeup 에도 이중으로 실어 즉시 전송이 유실돼도 남게 한다.
    var ctaLog = [];

    // 열람 언어 — 기기 언어(navigator.language)와 별개로, 페이지에서 실제로 어떤 언어로 읽었나.
    // 사이트가 window.__stayeumLang(현재값)과 'stayeum:lang' 이벤트(전환)로 알려준다.
    // 이 파일은 영업장 공용이라 특정 사이트의 버튼·전역을 직접 뒤지지 않는다 — 안 알려주는 페이지는
    // <html lang> 을 초기값으로만 쓰고 전환은 잡히지 않는다(그 페이지엔 언어 전환이 없다는 뜻).
    var MAX_TRAIL = 12;
    function normLang(v) {
      if (typeof v !== 'string') return null;
      var s = v.trim().toLowerCase();
      return /^[a-z]{2,3}(-[a-z0-9]{2,8})?$/.test(s) ? s : null;
    }
    var viewedLang = normLang(window.__stayeumLang) || normLang(document.documentElement.lang);
    var langTrail = viewedLang ? [viewedLang] : [];

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
      vid: VID,
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
      // 열람 언어 — 진입 시점의 선택(딥링크·저장된 선택·브라우저 언어 자동 선택 결과)
      viewedLanguage: viewedLang,
      languageTrail: langTrail.length > 0 ? langTrail.join('>') : null,
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

    // 2c) CTA 클릭 — 캡처 단계로 기본동작(다이얼러·새 탭 전환) 전에 잡아 즉시 전송. 전환의 직접 신호.
    //     전에는 tel/sms 만 잡았다. 그런데 페이지에 sms 링크는 하나도 없고, 정작 주력인
    //     **카카오 상담 버튼 두 개(본문·우하단 플로터)가 통째로 안 잡혔다** — open.kakao.com 링크라서다.
    //     팝업 안 카톡 클릭만 따로 세고 있어서 화면에는 팝업 밖 전환이 0으로 보였다(D페이즈 2026-08-03).
    var CTA_SELECTOR = 'a[href^="tel:"], a[href^="sms:"], a[href*="open.kakao.com"], a[href*="pf.kakao.com"], a[href*="blog.naver.com"]';
    function ctaKind(href) {
      if (href.indexOf('tel:') === 0) return 'tel';
      if (href.indexOf('sms:') === 0) return 'sms';
      if (href.indexOf('blog.naver.com') >= 0) return 'blog';
      return 'kakao';
    }
    document.addEventListener('click', function (e) {
      var t = e.target;
      var a = (t && t.closest) ? t.closest(CTA_SELECTOR) : null;
      if (!a) return;
      // 프로모션 팝업 안 버튼은 팝업이 자기 지표로 따로 센다. 여기서도 세면 같은 클릭이
      // 두 카드에 각각 잡혀 운영자가 합산할 때 부풀어 오른다.
      if (a.closest && a.closest('.promo')) return;
      var href = a.getAttribute('href') || '';
      var kind = ctaKind(href);
      var host = a.closest ? a.closest('section[id]') : null;
      // 어떤 section 에도 안 속한 것은 우하단 플로터다. 전에는 둘 다 section=null 이라
      // '어느 위치에서 눌렀나'를 나중에 봐도 구분이 안 됐다.
      var section = host ? host.id : (a.closest && a.closest('.floaters') ? 'floating' : null);
      var tMs = Date.now() - startedAt;
      ctaLog.push({ kind: kind, section: section, tMs: tMs });
      var body = JSON.stringify({ id: pv_id, kind: kind, section: section, tMs: tMs });
      if (navigator.sendBeacon) navigator.sendBeacon('/api/track/cta', new Blob([body], { type: 'application/json' }));
      else { try { fetch('/api/track/cta', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: body, keepalive: true }); } catch (_) {} }
    }, true);

    // 2d) 언어 전환 — 바꾼 즉시 기존 행을 갱신한다(closeup 채널 재사용, 새 엔드포인트를 늘리지 않는다).
    //     closeup 에도 이중으로 실어(ctaLog 와 같은 이유) 즉시 전송이 유실돼도 마지막 상태는 남게 한다.
    document.addEventListener('stayeum:lang', function (e) {
      var next = normLang(e && e.detail && e.detail.lang);
      if (!next || next === viewedLang) return;
      viewedLang = next;
      if (langTrail.length < MAX_TRAIL) langTrail.push(next);
      var body = JSON.stringify({ id: pv_id, viewedLanguage: viewedLang, languageTrail: langTrail.join('>') });
      if (navigator.sendBeacon) navigator.sendBeacon('/api/track/closeup', new Blob([body], { type: 'application/json' }));
      else { try { fetch('/api/track/closeup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: body, keepalive: true }); } catch (_) {} }
    });

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
        viewedLanguage: viewedLang,
        languageTrail: langTrail.length > 0 ? langTrail.join('>') : null,
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
    // pagehide 가 visibilitychange 로 못 잡는 나머지(탭 닫기·다른 페이지 이동)를 덮는다.
    // beforeunload 는 걸지 않는다 — 리스너가 존재하는 것만으로 일부 브라우저가 bfcache 를 끈다.
    // 이 사이트는 카카오 상담을 새 탭으로 열었다가 뒤로가기로 돌아오는 동선이 있어 체감된다.
    // visibilitychange + pagehide 로 이미 커버되므로 중복이기도 하다(2026-08-03).
    window.addEventListener('pagehide', sendCloseup);
  } catch (e) { /* tracking 실패해도 페이지엔 영향 없게 */ }
})();
