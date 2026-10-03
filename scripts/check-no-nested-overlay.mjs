// 모달 JSX 안에 또 다른 오버레이를 렌더하는 것을 잡는 감지망 — 읽기 전용, 위반 시 exit 1.
//
// 무엇을 막는가. 공용 Modal 은 포털을 안 쓴다. 그래서 <Modal> 의 자식으로 둔 모달·확인창·시트는
// DOM 에서도 바깥 패널 안에 들어간다. 바깥 패널의 등장 모션(.anim-panel-in, transform)이 중간에
// 굳으면 그 패널이 안쪽 `position: fixed` 의 기준 상자가 되어, 안쪽 오버레이가 화면 전체가 아니라
// 바깥 패널 상자에 갇힌다(실측 2026-09-17, knowledge/domain-modal-shell.md (다) 넷째 행).
// 2026-10-03 홈 알림 상세(AlertDetailModal)가 환불 확인·독촉 문자 모달을 자식으로 렌더하고 있었다.
//
// 규칙: <Modal ...> 과 </Modal> 사이(자식 자리)에 오버레이 컴포넌트 태그가 오면 위반이다.
//   오버레이 컴포넌트 = Modal 자신, 그리고 이름이 Modal · Dialog · Sheet · Host 로 끝나는 컴포넌트.
//   겹쳐 띄울 것은 Fragment 로 바깥 <Modal> 과 **형제**로 둔다(화면 위 겹침은 z 가 정한다).
// 이름 규칙에 걸리지만 오버레이가 아닌 것은 NOT_OVERLAY 에 사유와 함께 올린다.
//
// 실행: node scripts/check-no-nested-overlay.mjs
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

const ROOTS = ['app', 'components']
const OVERLAY_NAME = /^(Modal|[A-Z]\w*(Modal|Dialog|Sheet|Host))$/
// 이름은 걸리지만 fixed 오버레이가 아닌 것 — 사유와 함께.
const NOT_OVERLAY = new Map([
  ['ModalFooterActions', '모달 푸터 버튼줄 — 오버레이가 아니다'],
])

// 이 그물을 세운 날(2026-10-03) 이미 있던 중첩 — 운영자 승인 범위가 홈 알림 상세 둘뿐이라 여기서
// 손대지 않고 목록으로 묶어 둔다. **새로 늘어나는 것만 막는다.** 꺼내면 목록에서 지운다
// (안 지우면 케케묵음 위반). 열쇠는 '파일|안쪽 컴포넌트'.
const KNOWN = new Set([
  'app/(app)/finance/FinanceClient.tsx|MergeSheet',
  'app/(app)/inventory/InventoryClient.tsx|TransferStockModal',
  'app/(app)/inventory/InventoryClient.tsx|LocationMoveModal',
  'components/doc/IssuedContractSheet.tsx|Modal',
  'components/doc/TenantDocBundleSheet.tsx|TenantDocSmsComposeSheet',
  'components/doc/TenantDocBundleSheet.tsx|TenantDocMailComposeSheet',
  'components/entity-modal/EntityModal.tsx|TenantDocBundleSheet',
])
const seenKnown = new Set()

function walk(p) {
  const out = []
  for (const n of readdirSync(p)) {
    const f = join(p, n)
    const st = statSync(f)
    if (st.isDirectory()) out.push(...walk(f))
    else if (/\.tsx$/.test(f)) out.push(f)
  }
  return out
}
// 주석을 공백으로 바꿔 줄 번호를 지킨다('://'는 URL 이라 예외). 블록 주석은 줄 머리나 '{' 뒤에서
// 시작하는 것만 지운다 — accept="image/*" 같은 문자열의 '/*' 가 다음 '*/' 까지 삼키던 것을 막는다.
const strip = s => s.replace(/(^[ \t]*|\{\s*)\/\*[\s\S]*?\*\//gm, m => m.replace(/[^\n]/g, ' '))
  .replace(/(^|[^:])\/\/[^\n]*/g, (m, p) => p + ' '.repeat(m.length - p.length))

/** 여는 태그의 끝 '>' 위치와 자기 닫힘 여부. 속성 안의 {…}(화살표 => 포함)는 건너뛴다. */
function tagEnd(src, at) {
  let depth = 0
  for (let i = at + 1; i < src.length; i++) {
    const c = src[i]
    if (c === '{') depth++
    else if (c === '}') depth--
    else if (c === '>' && depth === 0) return { end: i, selfClosing: src[i - 1] === '/' }
  }
  return null
}
const lineOf = (src, i) => src.slice(0, i).split('\n').length

const violations = []
let modals = 0
for (const root of ROOTS) {
  for (const f of walk(root)) {
    const src = strip(readFileSync(f, 'utf8'))
    const openRe = /<Modal(?=[\s>])/g
    let m
    while ((m = openRe.exec(src))) {
      const t = tagEnd(src, m.index)
      if (!t) { violations.push(`${f}:${lineOf(src, m.index)} — <Modal 여는 태그의 끝을 못 찾았다. 못 읽으면 통과가 아니라 위반이다`); continue }
      if (t.selfClosing) continue
      modals++
      // 짝이 되는 </Modal> — 안쪽의 열린 <Modal> 수를 센다.
      const re = /<Modal(?=[\s>])|<\/Modal>/g
      re.lastIndex = t.end + 1
      let depth = 1, close = -1, n
      while ((n = re.exec(src))) {
        if (n[0] === '</Modal>') { depth--; if (depth === 0) { close = n.index; break } }
        else { const tt = tagEnd(src, n.index); if (tt && !tt.selfClosing) depth++ }
      }
      if (close < 0) { violations.push(`${f}:${lineOf(src, m.index)} — 짝이 되는 </Modal> 을 못 찾았다`); continue }
      const body = src.slice(t.end + 1, close)
      for (const c of body.matchAll(/<([A-Z]\w*)(?=[\s/>])/g)) {
        const name = c[1]
        if (!OVERLAY_NAME.test(name) || NOT_OVERLAY.has(name)) continue
        const key = `${f}|${name}`
        if (KNOWN.has(key)) { seenKnown.add(key); continue }
        violations.push(`${f}:${lineOf(src, t.end + 1 + c.index)} — <Modal> 안에 <${name}> 를 렌더한다(바깥 모달 :${lineOf(src, m.index)}). Fragment 로 꺼내 형제로 둘 것`)
      }
    }
  }
}

for (const k of KNOWN) {
  if (!seenKnown.has(k)) violations.push(`${k.replace('|', ' — <')}> 가 KNOWN 에 있는데 이제 중첩이 아니다. 목록에서 지울 것`)
}

console.log(`[모달 안 오버레이 금지] <Modal> ${modals}개 검사 / 위반 ${violations.length}건 · 기존 중첩 ${KNOWN.size}건 대기`)
if (violations.length > 0) {
  console.error('')
  for (const v of violations) console.error(`  - ${v}`)
  console.error('')
  console.error('  공용 Modal 은 포털을 안 쓴다. 바깥 패널 모션이 굳으면 안쪽 fixed 가 그 상자에 갇힌다')
  console.error('  (knowledge/domain-modal-shell.md (다)). 겹쳐 띄울 모달은 <>…</> 로 바깥 <Modal> 의 형제로 둘 것.')
  process.exit(1)
}
