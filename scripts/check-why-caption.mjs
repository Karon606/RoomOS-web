// 막힘과 이유(가이드 §27.8) 감지망. 읽기 전용, 위반 시 exit 1.
//
// 왜 필요한가(2026-10-23 운영자 요청). 입실 취소한 입주자를 '문의'로 돌리려는데 상태 칸의 '문의'가 투어일 때문에
// 비활성이었고, 이유는 코드 주석에만 있었다. 운영자 원문 "이렇게 묻지 않도록 비활성화 된 이유와 풀 수 있는 방법을
// 간단하게 확인할 수 있는게 있으면 좋겠어". 고친 자리가 다시 막히거나, 이유가 title 로 숨어 들어가면 붉게 선다.
//
// 축 넷.
//   ⓐ 정본 모양. WhyCaption(10.5px · --warm-muted · 링크 --tc-text · 링크 히트 44px · id · 구분점과 링크 한 덩이),
//      Btn·RowActionBtn 의 reason 이 aria-disabled + aria-describedby 를 달고 클릭을 막는다, DatePicker describedBy.
//   ⓑ 상태 칸 '문의'. option 이 열려 있고, 고르면 투어일을 비우며 지운 값과 직전 상태를 쥐고, 되살리기 링크가 그 값과
//      직전 상태를 그대로 돌려놓는다. '문의' 를 떠날 때의 투어일 복귀는 모든 갈래 앞이다. 캡션은 select 의 aria-describedby 로 이어진다.
//   ⓓ 놓이는 면(2026-10-26 개정). 불투명 면(--canvas·--cream·--cream-soft·--cream-3)은 check-seg-ink-off ⓖ 가 보조 잉크
//      4.5:1 을 보장하므로 따로 보지 않는다. 캡션이 반투명 틴트 면(bg-[var(--x)]/NN · -bg 토큰 · style rgba/color-mix) 안에
//      서면 그 자리를 아래 MEASURED 표에 라이트·다크 실측과 함께 적어야 한다(표에 없으면 붉게). 캡션 자체는 바탕을 갖지 않는다.
//   ⓒ 1차 자리. 단기 입주일 잠김·희망 호실 5개 상한은 WhyCaption 을 describedby 로 잇고, '발행 기록' 은 reason 을 쓰며,
//      배치도 적용취소·다시 적용은 title 만으로 이름을 말하지 않고 화살표 글자를 쓰지 않는다.
//
// 실행: node scripts/check-why-caption.mjs
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const strip = s => s
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, m => m.replace(/[^\n]/g, ''))
  .replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ''))
  .replace(/^[^\S\n]*\/\/.*$/gm, '')
const read = f => strip(readFileSync(f, 'utf8'))

const violations = []
const need = (ok, msg) => { if (!ok) violations.push(msg) }

// ⓐ 정본 모양
const WHY = 'components/ui/WhyCaption.tsx'
{
  const s = read(WHY)
  need(/export function WhyCaption\(\{ id, children, action/.test(s), `${WHY}: WhyCaption(id · 글 · 선택 링크) 모양이 아니다.`)
  need(/<p id=\{id\}/.test(s), `${WHY}: 캡션이 id 를 달지 않는다(막힌 컨트롤이 describedby 로 가리킬 자리가 없다).`)
  need(/<p id=\{id\} className=\{`[^`]*text-\[0\.65625rem\][^`]*text-\[var\(--warm-muted\)\]/.test(s), `${WHY}: 캡션 글자가 10.5px --warm-muted 가 아니다(§27.8).`)
  const btn = s.match(/<button type="button" onClick=\{action\.onClick\}[\s\S]*?className="([^"]*)"/)
  need(!!btn, `${WHY}: 되살리기 링크가 button(onClick=action.onClick) 이 아니다.`)
  if (btn) {
    need(/min-h-\[44px\]/.test(btn[1]), `${WHY}: 링크 히트가 44px 이 아니다.`)
    need(/text-\[var\(--tc-text\)\]/.test(btn[1]), `${WHY}: 링크 글자가 --tc-text 가 아니다(§28 테라코타 글자).`)
  }
}
for (const f of ['components/ui/Btn.tsx', 'components/ui/RowActionBtn.tsx']) {
  const s = read(f)
  need(/reason\?: string \| null \| false/.test(s), `${f}: reason 프롭이 없다(§27.8).`)
  need(/const blocked = !!reason/.test(s), `${f}: reason 이 막힘을 정하지 않는다.`)
  need(/aria-disabled=\{blocked/.test(s), `${f}: reason 이 aria-disabled 를 달지 않는다.`)
  need(/aria-describedby=\{blocked \? /.test(s), `${f}: reason 이 aria-describedby 를 달지 않는다.`)
  need(/disabled=\{blocked \? undefined : disabled\}/.test(s), `${f}: reason 이 있는데 네이티브 disabled 로 막는다(포커스가 이유에 닿지 않는다).`)
  // 막힌 갈래의 정확한 모양을 본다. 'blocked ? onClick : onClick' 같은 겉모양만 맞춘 것을 통과시키지 않는다.
  const clickOk = f.endsWith('Btn.tsx') && !f.endsWith('RowActionBtn.tsx')
    ? /onClick=\{blocked \? e => e\.preventDefault\(\) : onClick\}/.test(s)
    : /onClick=\{blocked \? undefined : onClick\}/.test(s)
  need(clickOk, `${f}: reason 으로 막힌 버튼이 클릭을 먹는다.`)
}
{
  const s = read('components/ui/Btn.tsx')
  need(/className=\{blocked \? cls\.split\(\/\\s\+\/\)\.filter\(t => !\/\^\(hover\|active\):\/\.test\(t\)\)\.join\(' '\) : cls\}/.test(s),
    'components/ui/Btn.tsx: 막힌 Btn 이 hover·active 피드백을 그대로 둔다(눌리는 줄로 읽힌다).')
}
{
  const s = read(WHY)
  need(/<span className="whitespace-nowrap">\s*\{'· '\}\s*<button type="button" onClick=\{action\.onClick\}/.test(s),
    `${WHY}: 구분점과 링크가 한 덩이(nowrap)가 아니다(좁은 폭에서 ' ·' 가 줄 끝에 홀로 남는다).`)
}
{
  const f = 'components/ui/DatePicker.tsx'
  const s = read(f)
  need(/aria-describedby=\{describedBy\}/.test(s), `${f}: 트리거가 describedBy 를 aria-describedby 로 넘기지 않는다.`)
}

// ⓑ 상태 칸 '문의'
const TC = 'app/(app)/tenants/TenantClient.tsx'
const tc = read(TC)
{
  const opt = tc.match(/<option value="INQUIRY"[^>]*>문의<\/option>/)
  need(!!opt, `${TC}: 상태 칸에 '문의' option 이 없다.`)
  if (opt) need(!/disabled/.test(opt[0]), `${TC}: 상태 칸 '문의' 가 다시 막혔다. 그 자리에서 풀 수 있는 막힘은 막지 않는다(§27.8 ①): ${opt[0]}`)
  const inq = tc.match(/if \(v === 'INQUIRY'\) \{([\s\S]*?)\n\s*\}\n/)
  need(!!inq, `${TC}: 상태 칸 onChange 에 '문의' 갈래가 없다.`)
  if (inq) need(/if \(tourDateVal\) \{ setTourCleared\(\{ date: tourDateVal, status: statusVal, kind: uiWaitingKind \}\); setTourDateVal\(''\) \}/.test(inq[1]),
    `${TC}: '문의' 를 고를 때 투어일을 비우며 지운 값과 직전 상태(status·uiWaitingKind)를 함께 쥐지 않는다(되살리기가 돌려놓을 모습이 없다).`)
  // 복귀 줄은 '문의' 갈래 바로 다음, 다른 모든 갈래 앞이어야 한다. 사이에 return 이나 다른 갈래가 끼면 그 상태로 갈 때 투어일이 사라진다.
  need(/setStatusVal\('WAITING_TOUR'\); setUiWaitingKind\('INQUIRY'\)\s*return\s*\}\s*if \(tourCleared && !tourDateVal\) \{ setTourDateVal\(tourCleared\.date\); setTourCleared\(null\) \}\s*if \(v === 'WAITING_TOUR'\)/.test(tc),
    `${TC}: '문의' 를 떠날 때의 투어일 복귀가 모든 갈래 앞에 return 없이 서 있지 않다(문의 때문에 비운 값이 다른 상태 저장에서 사라진다).`)
  const why = tc.match(/<WhyCaption id=\{statusWhyId\}[\s\S]*?<\/WhyCaption>/)
  need(!!why, `${TC}: 상태 칸 아래 '투어일을 비웠습니다' 캡션(WhyCaption id=statusWhyId)이 없다.`)
  if (why) {
    need(/label: '투어일 되살리기', onClick: \(\) => \{ setTourDateVal\(tourCleared\.date\); setStatusVal\(tourCleared\.status\); setUiWaitingKind\(tourCleared\.kind\); setTourCleared\(null\) \}/.test(why[0]),
      `${TC}: [투어일 되살리기] 가 투어일과 고르기 직전 상태를 그대로 돌려놓지 않는다(입실 취소에서 왔는데 투어 예정이 된다).`)
    need(/을 비웠습니다 · 저장하면 문의로 바뀝니다/.test(why[0]), `${TC}: 되살리기 캡션 문장이 승인안과 다르다.`)
    need(!/confirmDialog/.test(why[0]), `${TC}: 되살리기에 확인창이 붙었다(§27.8 ① 확인창 없음).`)
  }
  need(/aria-describedby=\{tourCleared && !tourDateVal \? statusWhyId : undefined\}/.test(tc), `${TC}: 상태 select 가 되살리기 캡션을 aria-describedby 로 가리키지 않는다.`)
}

// ⓒ 1차 자리
{
  need(/disabled=\{moveInSameAsParent\} describedBy=\{moveInSameAsParent \? shortMoveInWhyId : undefined\}/.test(tc),
    `${TC}: 단기 요금 박스 입주일 잠김이 이유 캡션을 describedby 로 잇지 않는다.`)
  const shortCap = tc.match(/<WhyCaption id=\{shortMoveInWhyId\}[\s\S]*?<\/WhyCaption>/)
  need(!!shortCap && /className="col-span-2/.test(shortCap[0]) && /메인 계약을 따라가는 입주일이라 고칠 수 없습니다 · &lsquo;입주일 따로 정하기&rsquo;를 켜면 됩니다/.test(shortCap[0]),
    `${TC}: 단기 입주일 잠김 캡션이 격자 밑 전폭(col-span-2) 한 줄이 아니거나 문장이 다르다(반 칸이면 320px 에서 다섯 줄).`)
  if (shortCap) need(!/같은 (날짜|입주일)/.test(shortCap[0]), `${TC}: 단기 입주일 잠김 캡션이 상속 안내의 '같은 입주일' 을 되풀이한다.`)
  need(/disabled=\{wishCapped\}\s*aria-describedby=\{wishCapped \? wishCapWhyId : undefined\}/.test(tc),
    `${TC}: 희망 호실 5개 상한 select 가 이유 캡션을 describedby 로 잇지 않는다.`)
  need(/<WhyCaption id=\{wishCapWhyId\}>희망 호실은 5개까지라서 더 고를 수 없습니다 · 아래에서 하나를 빼면 됩니다<\/WhyCaption>/.test(tc),
    `${TC}: 희망 호실 5개 상한 캡션이 없다.`)
  need(!/disabled=\{selected\.length >= 5\}/.test(tc), `${TC}: 희망 호실 select 가 이유 없이 5개에서 막힌다.`)

  const PR = 'components/entity-modal/widgets/PaymentRecordList.tsx'
  const pr = read(PR)
  need(/<RowActionBtn tone="accent" disabled=\{pending \|\| crOnBlocked\} reason=\{crOnBlocked && crPv !== null \? crWhyId : undefined\}/.test(pr),
    `${PR}: '발행 기록' 이 막힐 때 이유 줄을 reason 으로 잇지 않는다.`)
  need((pr.match(/<p id=\{crWhyId\}/g) ?? []).length === 2, `${PR}: 이유 줄 둘(읽기 실패 · keep/none)이 crWhyId 를 달지 않는다.`)

  const FP = 'app/(app)/floor-plan/FloorPlanEditor.tsx'
  const fp = read(FP)
  const undo = fp.match(/<button onClick=\{undo\}[^\n]*<\/button>/)
  const redo = fp.match(/<button onClick=\{redo\}[^\n]*<\/button>/)
  need(!!undo && !!redo, `${FP}: 편집 이력 버튼 두 개를 찾지 못했다.`)
  for (const b of [undo?.[0], redo?.[0]].filter(Boolean)) {
    need(!/title=/.test(b), `${FP}: 편집 이력 버튼 이름이 title 에 있다(§27.8 ④): ${b.slice(0, 90)}`)
    need(!/[↩↪]/.test(b), `${FP}: 편집 이력 버튼이 화살표 글자를 쓴다(§29): ${b.slice(0, 90)}`)
  }
  if (undo) need(/적용취소<\/button>$/.test(undo[0]), `${FP}: 적용취소 버튼에 글자 라벨이 없다.`)
  // 단축키 안내는 keydown 처리(meta = metaKey || ctrlKey)와 같아야 한다. Control 만 적으면 Mac 사용자가 못 듣는다.
  if (undo) need(/aria-keyshortcuts="Control\+Z Meta\+Z"/.test(undo[0]), `${FP}: 적용취소 단축키 안내에 Meta+Z 가 없다.`)
  if (redo) need(/aria-keyshortcuts="Control\+Y Meta\+Y Control\+Shift\+Z Meta\+Shift\+Z"/.test(redo[0]), `${FP}: 다시 적용 단축키 안내가 keydown 처리와 다르다.`)
  if (redo) need(/다시 적용<\/button>$/.test(redo[0]), `${FP}: 다시 적용 버튼에 글자 라벨이 없다.`)
}

// ⓓ 놓이는 면. 불투명 면은 ⓖ(check-seg-ink-off)가 보장하고, 반투명 틴트 면은 실측해 이 표에 적는다.
//    키는 '파일#캡션 id 식', 값은 실측 대비(헤드리스 Chrome, 계산된 색). 둘 다 4.5 이상이어야 한다.
const MEASURED = {
  // 단기 요금 박스 입주일 잠김. 모달 --cream 위 --canvas/50 박스(2026-10-26 실측, 보조 잉크 #6A5644 · 다크 --d-ink-m #948270).
  'app/(app)/tenants/TenantClient.tsx#shortMoveInWhyId': { light: 5.81, dark: 5.37, surface: 'bg-[var(--canvas)]/50' },
}
{
  const s = read(WHY)
  const p = s.match(/<p id=\{id\} className=\{`([^`]*)`\}/)
  need(!!p && !/(^|\s)bg-/.test(p[1]), `${WHY}: 캡션이 자기 바탕(bg-)을 갖는다. 대비는 놓이는 면이 정한다(§27.8).`)
  const walkTsx = (dir, out = []) => { for (const n of readdirSync(dir)) { if (n === 'node_modules' || n.startsWith('.')) continue; const f = join(dir, n); statSync(f).isDirectory() ? walkTsx(f, out) : n.endsWith('.tsx') && out.push(f) } return out }
  // 여는 태그의 끝('>')을 중괄호 깊이를 따져 찾는다(onClick={() => ...} 의 '>' 를 끝으로 읽지 않게).
  const tagEnd = (src, from) => { let d = 0; for (let k = from; k < src.length; k++) { const c = src[k]; if (c === '{') d++; else if (c === '}') d--; else if (c === '>' && d === 0) return k } return -1 }
  const TINT = /(?:^|[\s"'`])bg-\[var\(--[\w-]+\)\]\/\d+|(?:^|[\s"'`])bg-\[var\(--[\w-]+-bg\)\]|background:\s*'(?:rgba|color-mix)/
  const OPAQUE = /(?:^|[\s"'`])bg-\[var\(--[\w-]+\)\](?!\/)|background:\s*'var\(--[\w-]+\)'/
  let seen = 0
  for (const f of [...walkTsx('app'), ...walkTsx('components')]) {
    if (f === WHY) continue
    const src = read(f)
    for (const m of src.matchAll(/<WhyCaption\s+id=\{([^}]+)\}/g)) {
      seen++
      const tags = [...src.slice(0, m.index).matchAll(/<(\/?)([A-Za-z][\w.]*)/g)].map(t => {
        const end = tagEnd(src, t.index)
        return { close: t[1] === '/', self: end > 0 && src[end - 1] === '/', text: end > 0 ? src.slice(t.index, end + 1) : '' }
      })
      let depth = 0, verdict = null, found = 0
      for (let k = tags.length - 1; k >= 0 && found < 8 && !verdict; k--) {
        const t = tags[k]
        if (t.close) { depth++; continue }
        if (t.self) continue
        if (depth > 0) { depth--; continue }
        found++
        const own = t.text.replace(/(?:hover|focus|active|disabled|focus-visible|group-hover|sm|md|lg|dark):[^\s"'`]+/g, '')
        if (TINT.test(own)) verdict = 'tint'
        else if (OPAQUE.test(own)) verdict = 'opaque'
      }
      if (verdict !== 'tint') continue
      const key = `${f}#${m[1].trim()}`
      const row = MEASURED[key]
      need(!!row && row.light >= 4.5 && row.dark >= 4.5, `${key}: WhyCaption 이 반투명 틴트 면 위에 선다. 불투명 면은 보조 잉크가 4.5:1 을 보장하지만 틴트는 겹친 결과가 달라 실측해 MEASURED 표에 적는다(§27.8).`)
    }
  }
  need(seen >= 3, `WhyCaption 쓰는 자리가 ${seen}곳뿐이다(1차 자리 3곳). 이름을 바꿨다면 ⓓ 를 옮긴다.`)
}

if (violations.length) {
  console.error(`check-why-caption: 위반 ${violations.length}건`)
  for (const v of violations) console.error('  - ' + v)
  process.exit(1)
}
console.log('check-why-caption: 통과 (정본 모양 · 상태 칸 문의 · 1차 자리 5곳 · 놓이는 면)')
