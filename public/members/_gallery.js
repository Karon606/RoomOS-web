// 공개 랜딩 페이지 공용 동적 갤러리 — '사이트 공개' 켠 방 사진을 baseRent 등급 카드에 붙이고, 카드 클릭 시 바텀 시트 캐러셀로 보여준다. slug 로 영업장 매칭(멀티테넌트).
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

    function init(groups) {
      // rent 로 인덱싱
      var byRent = {};
      groups.forEach(function (g) { byRent[g.rent] = g.photos || []; });

      var sheet = buildSheet();

      // 각 등급 카드에 대표 썸네일 + 클릭 바인딩
      var cards = document.querySelectorAll('.room-card[data-rent]');
      Array.prototype.forEach.call(cards, function (card) {
        var rent = parseInt(card.getAttribute('data-rent'), 10);
        var photos = byRent[rent];
        if (!photos || !photos.length) return;  // 매칭 없으면 컨테이너 hidden 유지

        var box = card.querySelector('.room-photo');
        if (!box) return;
        var img = document.createElement('img');
        img.src = photos[0].thumb;
        img.alt = '';
        img.loading = 'lazy';
        box.appendChild(img);
        box.hidden = false;

        var open = function () { sheet.open(card, photos); };
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
          '<div class="gsheet-track"></div>' +
          '<div class="gsheet-counter"></div>' +
        '</div>';
      document.body.appendChild(el);

      var titleEl = el.querySelector('.gsheet-title');
      var trackEl = el.querySelector('.gsheet-track');
      var counterEl = el.querySelector('.gsheet-counter');
      var isOpen = false;
      var total = 0;

      function updateCounter() {
        if (!total) return;
        var c = trackEl.scrollLeft + trackEl.clientWidth / 2;
        var best = 0, bestDist = Infinity;
        var slides = trackEl.children;
        for (var i = 0; i < slides.length; i++) {
          var s = slides[i];
          var center = s.offsetLeft + s.offsetWidth / 2;
          var d = Math.abs(center - c);
          if (d < bestDist) { bestDist = d; best = i; }
        }
        counterEl.textContent = (best + 1) + ' / ' + total;
      }
      trackEl.addEventListener('scroll', function () {
        window.requestAnimationFrame(updateCounter);
      }, { passive: true });

      function openDom(card, photos) {
        var nameEl = card.querySelector('.room-name');
        titleEl.textContent = nameEl ? nameEl.textContent : '';
        total = photos.length;
        trackEl.innerHTML = '';
        trackEl.scrollLeft = 0;
        photos.forEach(function (p) {
          var fig = document.createElement('figure');
          fig.className = 'gsheet-slide';
          var im = document.createElement('img');
          im.src = p.url;
          im.alt = '';
          im.loading = 'lazy';
          fig.appendChild(im);
          if (p.roomNo) {
            var tag = document.createElement('span');
            tag.className = 'gallery-tag';
            tag.textContent = p.roomNo + '호';
            fig.appendChild(tag);
          }
          trackEl.appendChild(fig);
        });
        counterEl.textContent = '1 / ' + total;

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
        open: function (card, photos) {
          if (isOpen) return;
          openDom(card, photos);
          history.pushState({ gsheet: true }, '');
        },
      };
    }
  } catch (e) { /* 갤러리 실패해도 페이지엔 영향 없게 */ }
})();
