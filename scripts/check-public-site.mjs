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

if (violations.length === 0) {
  console.log('[공개 사이트] 위반 0건')
} else {
  console.log(`[공개 사이트] 위반 ${violations.length}건`)
  for (const v of violations) console.log('  - ' + v)
  process.exit(1)
}
