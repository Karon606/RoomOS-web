// 현금영수증 기한 알림의 자리 판정이 흩어지는 것을 잡는 감지망. 읽기 전용, 위반 시 exit 1.
//
// 왜 필요한가. 이 알림은 자리가 셋이다(임박·자진발급 감경 창·기한 지남). 종전에는 대시보드가
// `left <= 2` 인라인 하나로 전부를 갈랐고, 자리가 늘자 제목과 라벨이 서로 반대말을 했다
// (감경 건이 정렬상 늘 최악이라 '임박' 제목 아래 '경과' 라벨이 섰다, 2026-09-03).
//
//   ⓐ 대시보드가 자리 판정을 정본 함수로 한다. 인라인 일수 비교가 되살아나면 위반.
//   ⓑ 세 자리가 다 화면에 선다. 하나가 빠지면 그 건들이 소리 없이 사라진다.
//   ⓒ 요약 줄의 mute 는 건별 키다. `receipt:summary` 같은 합성 키를 만들면 한 번 끄고
//      다음 달 기한까지 영구 침묵한다(디자이너 판정 2026-09-02).
//   ⓓ 조회창에 고정 일수가 되살아나지 않는다. 요약 줄은 "기한 지난 미발행 전부"를 자칭하는
//      숫자라 창이 있으면 **발급 없이도 시간이 지나면 숫자가 줄고**, 가장 오래 묵어 위험이
//      큰 건부터 화면에서 빠진다(운영자가 철회한 '자연 소멸'의 뒷문, 2026-09-03).
//   ⓔ 사용자에게 보이는 문자열에 '§' 를 쓰지 않는다. 그것은 가이드·노트의 내부 표기 관습이고
//      한국 법령 인용은 조문식('제81조의9')이다. 운영자가 세무 담당자에게 그대로 읽어 줄 문구다.
//
// 실행: node scripts/check-receipt-alert-axis.mjs
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const PAGE = 'app/(app)/dashboard/page.tsx'
const violations = []
// 줄 수를 보존한다(`\s*` 는 m 플래그에서 줄바꿈을 먹는다).
const stripComments = s => s
  .replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ''))
  .replace(/^[^\S\n]*\/\/.*$/gm, '')

const src = stripComments(readFileSync(PAGE, 'utf8'))
// 현금영수증 알림 블록만 떼어 본다 — 페이지의 다른 알림에는 고정 일수 창이 정상인 자리가 있다.
const start = src.indexOf('const crTodayYmd')
// 끝 앵커는 try 블록의 catch 다. '보증금 반환 대기'로 잡으면 그 알림의 text 리터럴에 걸려
// 블록이 다음 알림까지 늘어나고, 거기 정상적으로 있는 고정 일수 계산이 ⓓ 에 헛걸린다.
const end = src.indexOf('} catch', start)
if (start < 0 || end < 0) {
  violations.push(`${PAGE} — 현금영수증 알림 블록을 못 찾았다. 구조가 바뀌었으면 이 그물도 같이 고쳐야 한다.`)
} else {
  const block = src.slice(start, end)

  // ⓐ 자리 판정은 정본 함수로.
  if (!/cashReceiptAlertSlot\(/.test(block)) {
    violations.push(`${PAGE} — 자리 판정에 cashReceiptAlertSlot 을 안 쓴다. 인라인 일수 비교는 화면마다 갈린다.`)
  }
  if (/\bleft\s*<=\s*\d/.test(block)) {
    violations.push(`${PAGE} — 인라인 일수 비교(left <= N)가 되살아났다. 자리 판정 정본은 cashReceiptAlertSlot 하나다.`)
  }

  // ⓑ 세 자리가 다 선다.
  for (const slot of ['due', 'grace', 'overdue']) {
    if (!new RegExp(`slot === '${slot}'`).test(block)) {
      violations.push(`${PAGE} — '${slot}' 자리가 화면에서 사라졌다. 그 건들이 소리 없이 안 보이게 된다.`)
    }
  }

  // ⓒ 합성 mute 키 금지.
  if (/receipt:summary|receipt:all/.test(block)) {
    violations.push(`${PAGE} — 합성 mute 키다. 한 번 끄면 다음 달 기한까지 영구 침묵한다. 건별 키를 전부 실어라.`)
  }
  const muteLines = block.match(/muteKeys:[^\n]*/g) ?? []
  if (muteLines.length < 3) {
    violations.push(`${PAGE} — 알림 줄 셋 중 muteKeys 가 없는 줄이 있다(${muteLines.length}개). 끄지 못하는 알림은 상시 소음이 된다.`)
  }
  for (const l of muteLines) {
    if (!/\.map\(/.test(l)) violations.push(`${PAGE} — muteKeys 가 건별 키 매핑이 아니다: ${l.trim().slice(0, 60)}`)
  }

  // ⓓ 고정 일수 창 금지.
  if (/86400000/.test(block)) {
    violations.push(`${PAGE} — 현금영수증 조회창에 고정 일수가 되살아났다. 창이 있으면 발급 없이도 요약 숫자가 줄어든다(인수 컷오프 기준으로 넓힌 이유).`)
  }
  if (!/lookFrom\s*=\s*acquisitionDate/.test(block)) {
    violations.push(`${PAGE} — 조회창이 인수 컷오프(acquisitionDate) 기준이 아니다.`)
  }
}

// ⓔ 사용자 노출 문자열의 '§' 금지 — 앱 코드 전역(주석은 제외).
const walk = (dir, out) => {
  let names
  try { names = readdirSync(dir) } catch { return out }
  for (const name of names) {
    if (name === 'node_modules' || name.startsWith('.')) continue
    const full = join(dir, name)
    if (statSync(full).isDirectory()) { walk(full, out); continue }
    if (/\.tsx?$/.test(name)) out.push(full)
  }
  return out
}
// 줄 끝 주석을 정규식으로 지우려는 시도는 포기했다 — 이 저장소는 주석 안에 따옴표를 자주 쓰고
// (`// … '과거 내역 검색'(전 기간 서버)과 별개`) 거기서 매칭이 끊긴다. 대신 **문자열 리터럴만**
// 본다. 화면에 나가는 것은 결국 리터럴이고, 주석의 `v2.0 §06` 은 리터럴 밖이라 안 걸린다.
const STRINGS = /(['"`])(?:\\.|(?!\1)[^\\])*\1/g
for (const f of walk('app', walk('components', walk('lib', [])))) {
  stripComments(readFileSync(f, 'utf8')).split('\n').forEach((line, i) => {
    if (!line.includes('§')) return
    for (const lit of line.match(STRINGS) ?? []) {
      if (!lit.includes('§')) continue
      violations.push(`${f}:${i + 1} 사용자에게 보이는 문자열에 '§' 가 있다. 법령은 조문식('제81조의9')으로 적는다.`)
      break
    }
  })
}

console.log(`[현금영수증 알림 축] 위반 ${violations.length}건`)
for (const v of violations.slice(0, 15)) console.error(`  - ${v}`)
if (violations.length > 15) console.error(`  ... 외 ${violations.length - 15}건`)
process.exit(violations.length > 0 ? 1 : 0)
