// 공개 랜딩 페이지 공용 동적 갤러리 — '사이트 공개' 켠 방 사진을 baseRent 등급 카드에 붙이고, 카드 클릭 시 바텀 시트에서 호실별 행으로 보여준다. slug 로 영업장 매칭(멀티테넌트).
(function () {
  try {
    // slug — /members/<slug>/ 패턴에서 파생 (하드코딩 금지, _track.js 와 동일 규약)
    var m = window.location.pathname.match(/\/members\/([^/]+)/);
    var SLUG = m ? m[1] : null;
    if (!SLUG) return;

    fetch('/api/public/gallery?slug=' + encodeURIComponent(SLUG))
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (data) {
        if (!data || !data.groups || !data.groups.length) return;  // 사진 없으면 조용히 종료
        init(data.groups);
      })
      .catch(function () { /* 실패해도 페이지는 정상, 텍스트 카드 유지 */ });

    // 방 목록에서 대표(공개·비360 첫 장) 썸네일을 고른다 — 첫 방이 pano 만 있으면 다음 방에서 찾음.
    function firstThumb(rooms) {
      for (var i = 0; i < rooms.length; i++) {
        if (rooms[i].photos && rooms[i].photos.length) return rooms[i].photos[0].thumb;
      }
      return null;
    }

    function init(groups) {
      // rent 로 인덱싱 — 값은 방 목록(호실별 사진)
      var byRent = {};
      groups.forEach(function (g) { byRent[g.rent] = g.rooms || []; });

      var sheet = buildSheet();

      // 각 등급 카드에 대표 썸네일 + 클릭 바인딩
      var cards = document.querySelectorAll('.room-card[data-rent]');
      Array.prototype.forEach.call(cards, function (card) {
        var rent = parseInt(card.getAttribute('data-rent'), 10);
        var rooms = byRent[rent];
        if (!rooms || !rooms.length) return;  // 매칭 없으면 컨테이너 hidden 유지
        var thumb = firstThumb(rooms);
        if (!thumb) return;

        var box = card.querySelector('.room-photo');
        if (!box) return;
        var img = document.createElement('img');
        img.src = thumb;
        img.alt = '';
        img.loading = 'lazy';
        box.appendChild(img);
        box.hidden = false;

        var open = function () { sheet.open(card, rooms); };
        box.addEventListener('click', open);
        card.style.cursor = 'pointer';
        card.addEventListener('click', function (e) {
          if (e.target.closest && e.target.closest('a')) return;  // 카드 내 링크는 그대로
          open();
        });
      });
    }

    // ---------- 바텀 시트 ----------
    function buildSheet() {
      var el = document.createElement('div');
      el.className = 'gsheet';
      el.setAttribute('role', 'dialog');
      el.setAttribute('aria-modal', 'true');
      el.hidden = true;
      el.innerHTML =
        '<div class="gsheet-backdrop" data-close></div>' +
        '<div class="gsheet-panel">' +
          '<div class="gsheet-head">' +
            '<div class="gsheet-title"></div>' +
            '<button type="button" class="gsheet-close" data-close aria-label="닫기">' +
              '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><line x1="4" y1="4" x2="20" y2="20"></line><line x1="20" y1="4" x2="4" y2="20"></line></svg>' +
            '</button>' +
          '</div>' +
          '<div class="gsheet-body"></div>' +
        '</div>';
      document.body.appendChild(el);

      var titleEl = el.querySelector('.gsheet-title');
      var bodyEl = el.querySelector('.gsheet-body');
      var isOpen = false;

      // ── 사진별 계측 — 등급(rent)별로 노출 인덱스·최대 깊이·체류를 모아 페이지 종료 시 한 번 전송.
      //    방별 행이어도 idx 는 등급 전체에서 연속(0,1,2…)이라 track/gallery 스키마는 그대로.
      var galleryByRent = {};        // rent → { n, seen:{idx:true}, maxDepth, dwell:{idx:ms} }
      var curRent = null, curStat = null;
      var visibleSince = {};         // idx → ts (현재 화면에 50%+ 보이는 슬라이드)
      // root:null(뷰포트) — 방별 행은 세로로도 스크롤되므로 뷰포트 기준이 가로·세로 노출을 모두 잡는다.
      var io = ('IntersectionObserver' in window) ? new IntersectionObserver(function (entries) {
        var now = Date.now();
        entries.forEach(function (en) {
          var idx = parseInt(en.target.getAttribute('data-idx'), 10);
          if (en.isIntersecting && en.intersectionRatio >= 0.5) {
            if (visibleSince[idx] == null) visibleSince[idx] = now;
            if (curStat && idx > curStat.maxDepth) curStat.maxDepth = idx;
          } else if (visibleSince[idx] != null) {
            accrue(idx, now - visibleSince[idx]); visibleSince[idx] = null;
          }
        });
      }, { threshold: [0, 0.5, 1] }) : null;

      function accrue(idx, ms) {
        if (!curStat || ms <= 0) return;
        curStat.dwell[idx] = (curStat.dwell[idx] || 0) + ms;
        if (curStat.dwell[idx] >= 1000) curStat.seen[idx] = true;   // 1초+ 노출을 '봤다'로
      }
      function flushVisible() {   // 화면에 남아있던 슬라이드 체류 마감(시트 닫기·페이지 종료 시)
        var now = Date.now();
        for (var k in visibleSince) { if (visibleSince[k] != null) { accrue(parseInt(k, 10), now - visibleSince[k]); visibleSince[k] = null; } }
      }
      function collectViews() {
        flushVisible();
        var out = [];
        for (var rent in galleryByRent) {
          var s = galleryByRent[rent];
          out.push({ rent: parseInt(rent, 10), n: s.n, seen: Object.keys(s.seen).map(Number), maxDepth: s.maxDepth, dwell: s.dwell });
        }
        return out;
      }
      function sendViews() {
        var id = window.__stayeumPv;
        if (!id) return;
        var views = collectViews();
        if (!views.length) return;
        var body = JSON.stringify({ id: id, views: views });
        if (navigator.sendBeacon) navigator.sendBeacon('/api/track/gallery', new Blob([body], { type: 'application/json' }));
        else { try { fetch('/api/track/gallery', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: body, keepalive: true }); } catch (_) {} }
      }
      document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'hidden') sendViews(); });
      window.addEventListener('pagehide', sendViews);

      function openDom(card, rooms) {
        var nameEl = card.querySelector('.room-name');
        titleEl.textContent = nameEl ? nameEl.textContent : '';
        bodyEl.innerHTML = '';
        // 계측 세션 시작 — 이 등급(rent) 통계를 누적. 같은 등급 재방문이면 기존 통계 이어받기.
        curRent = parseInt(card.getAttribute('data-rent'), 10);
        var totalPhotos = rooms.reduce(function (a, r) { return a + (r.photos ? r.photos.length : 0); }, 0);
        if (!galleryByRent[curRent]) galleryByRent[curRent] = { n: totalPhotos, seen: {}, maxDepth: 0, dwell: {} };
        curStat = galleryByRent[curRent];
        visibleSince = {};

        // 방별 행 — [408호 라벨] + 가로 캐러셀. idx 는 방을 가로질러 연속.
        var idx = 0;
        rooms.forEach(function (room) {
          if (!room.photos || !room.photos.length) return;   // 공개 평면사진 없는 방은 이 목록에서 제외(360 은 ③에서)
          var section = document.createElement('div');
          section.className = 'gsheet-room';
          var label = document.createElement('div');
          label.className = 'gsheet-room-label';
          label.textContent = room.roomNo + '호';
          section.appendChild(label);
          var row = document.createElement('div');
          row.className = 'gsheet-row';
          room.photos.forEach(function (p) {
            var fig = document.createElement('figure');
            fig.className = 'gsheet-slide';
            fig.setAttribute('data-idx', idx);
            var im = document.createElement('img');
            im.src = p.url;
            im.alt = '';
            im.loading = 'lazy';
            fig.appendChild(im);
            row.appendChild(fig);
            if (io) io.observe(fig);
            idx++;
          });
          section.appendChild(row);
          bodyEl.appendChild(section);
        });

        el.hidden = false;
        document.body.style.overflow = 'hidden';
        // 다음 프레임에 transition 발동
        window.requestAnimationFrame(function () {
          window.requestAnimationFrame(function () { el.classList.add('in'); });
        });
        isOpen = true;
      }

      function closeDom() {
        if (!isOpen) return;
        flushVisible();            // 남은 슬라이드 체류 마감
        if (io) io.disconnect();   // 이 시트의 슬라이드 관찰 해제(다음 열기 때 새로 observe)
        isOpen = false;
        el.classList.remove('in');
        document.body.style.overflow = '';
        var done = function () {
          if (!isOpen) el.hidden = true;
          el.removeEventListener('transitionend', done);
        };
        el.addEventListener('transitionend', done);
        window.setTimeout(function () { if (!isOpen) el.hidden = true; }, 420);
      }

      // 안드로이드 뒤로가기 대응 — 열 때 history 항목을 쌓고, 닫기는 back 을 태워 popstate 로 일원화
      function requestClose() {
        if (history.state && history.state.gsheet) history.back();
        else closeDom();
      }
      window.addEventListener('popstate', function () {
        if (isOpen) closeDom();
      });

      el.addEventListener('click', function (e) {
        if (e.target.closest && e.target.closest('[data-close]')) requestClose();
      });
      document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape' && isOpen) requestClose();
      });

      return {
        open: function (card, rooms) {
          if (isOpen) return;
          openDom(card, rooms);
          history.pushState({ gsheet: true }, '');
        },
      };
    }
  } catch (e) { /* 갤러리 실패해도 페이지엔 영향 없게 */ }
})();
