// 공개 홍보 사이트 회귀 감지망 (D페이즈 2026-08-03).
//
// 왜 필요한가
//   이 사이트는 4개 언어가 한 파일에 들어 있고, 문구를 고칠 때 4벌을 동시에 안 고치면
//   언어를 바꿨을 때 옛 문구가 그대로 남는다. 실제로 영어 번역본에만 em dash 8곳과
//   "도보 3분" 누락 2곳이 있었다 — 한국어 원문은 깨끗했다.
//   CSS 도 마찬가지다. 팝업용 .btn-ghost 를 같은 이름으로 나중에 정의해서
//   히어로의 첫 화면 CTA 가 배경과 대비 1.3대 1로 렌더돼 사실상 안 보였다.
//
// 실행: node scripts/check-public-site.mjs
import { readFileSync, readdirSync, existsSync } from 'fs'

const ROOT = 'public/members'
const violations = []

for (const slug of readdirSync(ROOT, { withFileTypes: true }).filter(e => e.isDirectory()).map(e => e.name)) {
  const file = `${ROOT}/${slug}/index.html`
  if (!existsSync(file)) continue
  const src = readFileSync(file, 'utf8')

  // 1. 4벌 규칙 — data-en 을 가진 요소는 zh·ja 도 함께 가져야 한다
  const tags = src.match(/<[^<>]*data-en=[^<>]*>/g) ?? []
  for (const lang of ['zh', 'ja']) {
    const n = tags.filter(t => !t.includes(`data-${lang}=`)).length
    if (n > 0) violations.push(`${slug}: data-${lang} 가 빠진 요소 ${n}건 — 언어를 바꾸면 옛 문구가 남는다`)
  }

  // 2. AI 지문 — 가이드 §29. 노출 문구만 본다(주석·CSS 는 대상이 아니다)
  for (const m of src.matchAll(/data-(en|zh|ja)="([^"]*)"/g)) {
    for (const [ch, name] of [['—', 'em dash'], ['–', 'en dash'], ['→', '화살표'], ['!', '느낌표']]) {
      if (m[2].includes(ch)) violations.push(`${slug}: data-${m[1]} 에 ${name} — "${m[2].slice(0, 50)}"`)
    }
  }

  // 3. 공유 카드 — 1차 전환 채널이 카카오톡이라 링크 미리보기가 곧 첫인상이다
  for (const tag of ['og:title', 'og:description', 'og:image', 'og:url', 'twitter:card']) {
    if (!src.includes(`"${tag}"`)) violations.push(`${slug}: ${tag} 가 없다 — 공유하면 썸네일 없는 맨 링크로 나간다`)
  }

  // 4. 클래스 이름 충돌 — 미디어쿼리 밖에서 같은 단일 클래스를 두 번 정의하면
  //    나중 것이 앞의 것을 덮는다. 맥락이 다른 두 컴포넌트가 이름을 공유하면 조용히 깨진다.
  //    정규식으로는 중첩 @media 를 못 가른다(처음 그렇게 짰다가 규칙 절반을 놓쳤다).
  //    중괄호 깊이를 직접 세면서 최상위 규칙만 모은다.
  const styles = [...src.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map(m => m[1]).join('\n')
    .replace(/\/\*[\s\S]*?\*\//g, '')
  const seen = new Map()
  let buf = '', media = 0
  for (let i = 0; i < styles.length; i++) {
    const c = styles[i]
    if (c === '{') {
      const sel = buf.trim(); buf = ''
      if (sel.startsWith('@')) { media++; continue }
      let lvl = 1, j = i + 1
      while (j < styles.length && lvl > 0) { if (styles[j] === '{') lvl++; else if (styles[j] === '}') lvl--; j++ }
      if (media === 0) {
        for (const one of sel.split(',').map(x => x.trim())) {
          if (/^\.[\w-]+$/.test(one)) seen.set(one, (seen.get(one) ?? 0) + 1)
        }
      }
      i = j - 1; continue
    }
    if (c === '}') { if (media > 0) media--; buf = ''; continue }
    buf += c
  }
  // .rate-head/.rate-row 처럼 같은 컴포넌트 안 누적 정의는 정상이라 예외로 둔다
  const OK_REDEFINE = new Set(['.rate-head', '.rate-row'])
  for (const [sel, n] of seen) {
    if (n > 1 && !OK_REDEFINE.has(sel)) {
      violations.push(`${slug}: ${sel} 이 ${n}번 정의됐다 — 맥락이 다른 두 곳이 이름을 공유하면 나중 것이 앞의 것을 덮는다`)
    }
  }
}

// ── 동적 갤러리 (_gallery.js) — 페이지 로드 뒤에 만들어지는 UI 라 [data-en] 수집 대상이 아니다.
//    그래서 4벌 규칙을 지키는 사이트에서 사진 보는 동선만 한국어로 남아 있었다.
const gal = readFileSync(`${ROOT}/_gallery.js`, 'utf8')

// 1. 언어 사전이 4벌이고 키 구성이 같아야 한다
const dict = {}
{
  const block = (gal.match(/var STR = \{([\s\S]*?)\n {4}\};/) ?? [])[1] ?? ''
  const lines = block.split('\n')
  let cur = null, buf = []
  const flush = () => { if (cur) dict[cur] = [...buf.join('\n').matchAll(/(\w+):\s*(?:function|')/g)].map(x => x[1]).sort().join(',') }
  for (const line of lines) {
    const head = line.match(/^ {6}(ko|en|zh|ja):\s*\{/)
    if (head) { flush(); cur = head[1]; buf = [line.slice(line.indexOf('{') + 1)]; continue }
    if (cur) buf.push(line)
  }
  flush()
}
for (const lang of ['ko', 'en', 'zh', 'ja']) {
  if (!dict[lang]) violations.push(`_gallery.js: STR 사전에 ${lang} 이 없다 — 그 언어에서 갤러리만 한국어로 남는다`)
}
if (dict.ko && ['en', 'zh', 'ja'].some(l => dict[l] && dict[l] !== dict.ko)) {
  violations.push('_gallery.js: STR 사전의 언어별 키 구성이 다르다 — 어떤 언어에서 문구 하나가 통째로 빠진다')
}

// 2. 사용자에게 보이는 자리에 한글이 박혀 있으면 안 된다 (사전 블록과 주석은 제외)
const galBody = gal
  .replace(/var STR = \{[\s\S]*?\n {4}\};/, '')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n').map(l => l.replace(/(^|[^:'"])\/\/.*$/, '$1')).join('\n')
for (const m of galBody.matchAll(/(['"])([^'"\n]*[가-힣][^'"\n]*)\1/g)) {
  violations.push(`_gallery.js: 한글이 사전 밖에 박혀 있다 — "${m[2].slice(0, 40)}" (언어를 바꿔도 안 바뀐다)`)
}

// 3. 접근성 — 전에는 클릭 리스너뿐이라 키보드로 사진에 도달할 방법이 아예 없었고,
//    aria-modal 을 선언해놓고 포커스 트랩·복원이 없어 Tab 이 배경으로 새어나갔다.
for (const [needle, why] of [
  ["box.setAttribute('role', 'button')", '사진 상자가 버튼으로 노출되지 않는다'],
  ["box.addEventListener('keydown'", '키보드로 갤러리를 열 수 없다'],
  ['setBackgroundInert', '시트가 열린 채 Tab 이 배경 링크로 새어나간다'],
  ["e.key !== 'Tab'", '포커스 트랩이 없다'],
  ['lastFocus = document.activeElement', '연 사람이 어디에 있었는지 기록하지 않는다'],
  ['lastFocus.focus()', '닫은 뒤 포커스가 원래 자리로 안 돌아온다'],
]) {
  if (!gal.includes(needle)) violations.push(`_gallery.js: ${why} (${needle} 없음)`)
}
// 사진 alt 를 빈 문자열로 되돌리면 안 된다 — 이 사이트에서 정보량이 가장 큰 콘텐츠다
if (/im\.alt\s*=\s*''/.test(gal)) {
  violations.push('_gallery.js: 시트·라이트박스 사진 alt 가 빈 문자열이다 — 스크린리더에서 객실 사진이 통째로 사라진다')
}

// ── 추적 정합 — 보내는 것 · 저장하는 것 · 보여주는 것이 어긋나면 지표가 조용히 틀린다.
//    실제로 CTA 클릭이 DB 에는 쌓이는데 읽는 곳이 저장소 어디에도 없었고,
//    activeMs 를 저장해두고 화면은 레거시인 durationMs 를 읽고 있었다. (D페이즈 2026-08-03)
{
  const track = readFileSync(`${ROOT}/_track.js`, 'utf8')
  const mktActions = readFileSync('app/(app)/marketing/actions.ts', 'utf8')
  const ctaRoute = readFileSync('app/api/track/cta/route.ts', 'utf8')
  const pvRoute = readFileSync('app/api/track/pageview/route.ts', 'utf8')

  // 1. pageview INSERT 이 geo 조회보다 **먼저** 일어나야 한다.
  //    반대로 두면 조회(타임아웃 1.5초) 사이에 도착한 후속 이벤트가 대상 행을 못 찾고 버려진다.
  //    가장 빨리 떠난 사람일수록 기록이 안 남아 이탈률이 과소, 평균 체류가 과대로 나온다.
  if (pvRoute.indexOf('lookupGeo(ip') < pvRoute.indexOf('pageView.create')) {
    violations.push('api/track/pageview: geo 조회가 create 앞에 있다 — 방문 시작 직후 이벤트가 조용히 유실된다')
  }

  // 2. 저장하는 CTA 종류와 보내는 CTA 종류가 같아야 한다
  // 주석에도 같은 문자열이 나오므로 셀렉터 선언 줄만 본다(처음 파일 전체로 봤다가 못 잡았다)
  const sel = (track.match(/var CTA_SELECTOR = '([^']*)'/) ?? [])[1] ?? ''
  for (const need of ['tel:', 'open.kakao.com', 'blog.naver.com']) {
    if (!sel.includes(need)) violations.push(`_track.js: CTA 셀렉터에 ${need} 가 없다 — 그 전환은 통째로 안 잡힌다`)
  }
  for (const kind of ['kakao', 'blog']) {
    if (!ctaRoute.includes(`'${kind}'`)) violations.push(`api/track/cta: ${kind} 를 허용 종류에 안 넣었다 — unknown 으로 뭉개진다`)
  }
  // 팝업 안 클릭은 팝업이 따로 센다. 여기서도 세면 같은 클릭이 두 카드에 잡힌다.
  if (!track.includes("a.closest('.promo')")) {
    violations.push('_track.js: 팝업 안 CTA 를 제외하지 않는다 — 같은 클릭이 두 카드에 각각 잡혀 합산이 부풀어 오른다')
  }

  // 3. 저장하는 것은 반드시 읽혀야 한다 — 화면에 없으면 그 지표는 존재하지 않는 것과 같다
  for (const [field, why] of [
    ['r.ctaClicks', '본문 CTA 클릭이 DB 에만 쌓이고 화면에는 0 으로 보인다'],
    ['r.activeMs ?? r.durationMs', '방치탭을 뺀 체류를 저장해두고 화면은 레거시 durationMs 를 읽는다'],
  ]) {
    if (!mktActions.includes(field)) violations.push(`marketing/actions: ${field} 를 읽지 않는다 — ${why}`)
  }

  // 4. 계측 대상으로 선언한 섹션이 실제로 있어야 한다
  for (const slug of readdirSync(ROOT, { withFileTypes: true }).filter(e => e.isDirectory()).map(e => e.name)) {
    const file = `${ROOT}/${slug}/index.html`
    if (!existsSync(file)) continue
    const html = readFileSync(file, 'utf8')
    const decl = (html.match(/data-sections="([^"]*)"/) ?? [])[1]
    if (!decl) continue
    for (const id of decl.split(',').map(x => x.trim()).filter(Boolean)) {
      if (!html.includes(`id="${id}"`)) {
        violations.push(`${slug}: 계측 대상으로 선언한 섹션 '${id}' 이 페이지에 없다 — 섹션별 체류 표에 영원히 안 뜬다`)
      }
    }
  }
}

if (violations.length === 0) {
  console.log('[공개 사이트] 위반 0건')
} else {
  console.log(`[공개 사이트] 위반 ${violations.length}건`)
  for (const v of violations) console.log('  - ' + v)
  process.exit(1)
}
