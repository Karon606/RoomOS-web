// 현금영수증 화면의 축과 어휘를 지키는 감지망. 읽기 전용, 위반 시 exit 1.
//
// 파일 이름은 기한 알림에서 출발했지만 ⓔ 부터는 화면 어휘까지 본다 — ⓔ 가 이미 저장소 전역을
// 훑는 문자열 규칙이라, 같은 결의 규칙을 새 파일로 흩기보다 여기 붙인다.
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
//   ⓕ 목록 제목(h1~h6)에 '기록' 이 안 선다. 2026-09-17 운영자 결정(b233a72f)이 어휘를 갈랐다 —
//      '기록' = 버튼 동사, '이력'·'내역' = 목록 명사. 그때 전수가 현금영수증 탭을 놓쳐 한 화면에서
//      제목 '발행 기록'과 버튼 '일괄 발행 기록'이 같은 낱말을 썼고, 운영자가 다시 지적했다
//      (신고 249f98cc). 손으로 센 전수는 또 놓친다.
//      보는 범위는 h1~h6 **엘리먼트**다. Modal·EmptyState 의 title 프로프는 안 본다 — 이 저장소의
//      모달 제목은 대개 동작 이름('일괄 발행 기록')이라 같은 자로 재면 정상을 위반으로 만든다.
//      면제 명단을 두지 않는다. 걸린 자리는 낱말을 고치거나, 왜 예외인지를 여기 적을 일이다.
//   ⓖ 현금영수증 발행 내역 행이 **무엇을 발행했나**를 말한다(신고 249f98cc). 발행 목록만 침묵해
//      머리 합계가 무엇으로 이뤄졌는지 알 길이 없던 자리다. 배선 넷을 다 본다 — 서버 select ·
//      반환 타입 · 중계 타입 · 실제로 찍는 줄. 낱말만 보면 select 를 지워도 통과한다.
//      **후보 목록과 낱말이 갈리는 것이 이제 의도다**(운영자 확정 2026-09-21). 후보는 발행하지
//      않을 몫을 '제외'라 적고, 발행 내역은 이미 발행한 사실을 '포함'이라 적는다. 같은 낱말을
//      쓰라고 조이면 규칙이 바뀐 자리를 그물이 되돌려 놓는다.
//   ⓗ 머리 합계가 제 목록을 이름과 건수로 지목한다. '이 달 발행 16건' 바로 밑에 '발행 내역이
//      없는 입금 15건'이 깔려 머리와 다음 목록이 반대를 말하던 자리다(신고 249f98cc).
//
// 실행: node scripts/check-receipt-alert-axis.mjs
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const PAGE = 'app/(app)/dashboard/getDashboardData.ts'
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

// ⓕ 목록 제목(h1~h6)에 '기록' 금지 — 앱 코드 전역.
//
// 제목은 이 저장소에서 늘 한 줄에 선다(h 여는 태그와 닫는 태그가 같은 줄). 여러 줄로 쓴 제목이
// 생기면 이 그물이 조용히 못 보게 되므로, 그때는 아래 추출을 고쳐야 한다.
// 제목 안에 박힌 InfoHint 는 **제목이 아니라 설명 모달**이라 먼저 걷어낸다. 안 걷으면 설명
// 본문의 '점검: 실제 수량을 세서 기록' 같은 문장이 제목으로 읽혀 정상 셋이 붉게 섰다(실측).
const HEADING = /<h[1-6][^>]*>([\s\S]*?)<\/h[1-6]>/g
const dropHints = s => s.replace(/<InfoHint[\s\S]*?<\/InfoHint>/g, ' ')
let titleFiles = 0
for (const f of walk('app', walk('components', []))) {
  const src = stripComments(readFileSync(f, 'utf8'))
  titleFiles += 1
  for (const m of src.matchAll(HEADING)) {
    const label = dropHints(m[1])
    if (!label.includes('기록')) continue
    const lineNo = src.slice(0, m.index).split('\n').length
    violations.push(`${f}:${lineNo} 목록 제목에 '기록' 이 있다: ${label.replace(/\s+/g, ' ').trim().slice(0, 40)} — 제목은 명사('이력'·'내역'), '기록'은 버튼 동사다(2026-09-17 운영자 결정).`)
  }
}

// ⓖ·ⓗ 현금영수증 탭 — 발행 내역 행의 구성 표기와 머리 합계의 지목.
const TAB = 'components/rooms/CashReceiptTab.tsx'
const SRV = 'app/(app)/rooms/actions.ts'
const RELAY = 'app/(app)/rooms/RoomsClient.tsx'
{
  const tab = stripComments(readFileSync(TAB, 'utf8'))
  const srvAll = stripComments(readFileSync(SRV, 'utf8'))
  const relay = stripComments(readFileSync(RELAY, 'utf8'))

  // ⓖ-1 서버가 구성 칸을 실어 온다. 함수 몸통만 본다 — 다른 조회의 select 에 걸리면 헛통과한다.
  const fnStart = srvAll.indexOf('export async function getCashReceiptTabRows')
  const fnEnd = srvAll.indexOf('\nfunction readAlertMuteRows', fnStart)
  const srv = fnStart < 0 ? '' : srvAll.slice(fnStart, fnEnd < 0 ? undefined : fnEnd)
  if (!srv) {
    violations.push(`${SRV} — getCashReceiptTabRows 를 못 찾았다. 구조가 바뀌었으면 이 그물도 같이 고쳐야 한다.`)
  } else {
    for (const col of ['inclDeposit', 'inclCleaning']) {
      if (!new RegExp(`${col}:\\s*true`).test(srv)) {
        violations.push(`${SRV} — getCashReceiptTabRows 의 cashReceipt select 에 ${col} 가 없다. 화면이 '왜 이 금액인가'를 못 말한다.`)
      }
      // 실어만 오고 안 돌려주면 화면에 닿지 않는다.
      if (!new RegExp(`${col}:\\s*l\\.${col}`).test(srv)) {
        violations.push(`${SRV} — ${col} 가 issued 행으로 안 나간다. select 만 남고 길이 끊겼다.`)
      }
    }
  }

  // ⓖ-2 중계 타입이 그 칸을 들고 간다.
  const relayType = relay.slice(relay.indexOf('type CashReceiptIssued'), relay.indexOf('type CashReceiptIssued') + 300)
  for (const col of ['inclDeposit', 'inclCleaning']) {
    if (!relayType.includes(col)) {
      violations.push(`${RELAY} — CashReceiptIssued 타입에 ${col} 가 없다. 서버가 실어도 탭까지 안 간다.`)
    }
  }

  // ⓖ-3 발행 내역 행이 구성을 찍는다. 낱말만이 아니라 그 값이 찍는 줄에 닿는지까지.
  //
  // **후보 목록과 낱말이 갈리는 것이 이제 의도다**(운영자 확정 2026-09-21). 후보는 '보증금
  // 50,000원 제외'라 적고 발행 내역은 '보증금 포함'이라 적는다. 두 목록이 말하는 사실이
  // 반대이기 때문이다 — 후보의 큰 숫자는 이용료 몫이라 보증금이 빠져 있고, 발행 줄의 금액은
  // 실제로 보증금을 넣어 끊은 예외 발행이다. 검사가 보는 것은 발행 행 쪽 문법 하나라 그대로 산다.
  for (const [col, label] of [['inclDeposit', '보증금 포함'], ['inclCleaning', '청소비 포함']]) {
    if (!new RegExp(`r\\.${col}\\s*\\?\\s*'${label}'`).test(tab)) {
      violations.push(`${TAB} — 발행 내역 행이 ${col} 를 '${label}'로 안 찍는다. 발행 내역은 '포함', 후보 목록은 '제외'다(운영자 확정 2026-09-21).`)
    }
  }
  const metaLine = tab.split('\n').find(l => l.includes('발행 {fmtMD(r.issuedYmd)}'))
  if (!metaLine) {
    violations.push(`${TAB} — 발행 내역 행의 메타 줄을 못 찾았다. 마크업이 바뀌었으면 이 그물도 같이 고쳐야 한다.`)
  } else if (!/incl\.join\(/.test(metaLine)) {
    violations.push(`${TAB} — 구성 문자열을 만들어만 두고 메타 줄에 안 붙였다. 화면에 안 나오면 없는 것과 같다.`)
  }

  // ⓗ **머리가 센 목록이 머리 바로 밑에 온다**(운영자 재지적 2026-09-22).
  //
  // 종전 검사는 머리에 '발행 내역 …{issuedCount}' 를 적는 **안내 줄**을 요구했다. 그 요구가
  // 곧 순서가 틀렸다는 자백이었다 — 자리가 맞으면 가리킬 말이 필요 없다. 1차 수정이 안내만
  // 붙이고 순서를 안 바꿨고, 운영자가 같은 말을 두 번 했다. 이제 자리 자체를 본다.
  if (!tab.includes('발행 내역 ({issuedCount}건)')) {
    violations.push(`${TAB} — 발행 내역 제목에 건수가 없다. 머리의 '({issuedCount}건)' 과 같은 수라야 둘이 한 쌍으로 읽힌다.`)
  }
  {
    const issuedAt = tab.indexOf('발행 내역 ({issuedCount}건)')
    const candAt = tab.indexOf('발행 내역이 없는 입금 ({candidates.length}건)')
    if (issuedAt < 0 || candAt < 0) {
      violations.push(`${TAB} — 두 목록 제목 중 하나를 못 찾았다. 마크업이 바뀌었으면 이 그물부터 고친다(침묵 통과 금지).`)
    } else if (issuedAt > candAt) {
      violations.push(`${TAB} — 머리가 센 '발행 내역'보다 미발행 목록이 먼저 온다. 머리의 숫자와 바로 다음 목록이 반대를 말한다(신고 249f98cc).`)
    }
    // 두 목록을 세그먼트로 갈랐으므로(운영자 결정 2026-09-22) **처음 보이는 쪽**도 못박는다.
    // 기본을 미발행으로 돌리면 머리 합계와 첫 화면이 다시 반대를 말한다.
    if (!/useState<'issued' \| 'open'>\('issued'\)/.test(tab)) {
      violations.push(`${TAB} — 목록 스위치의 기본이 발행 쪽이 아니다. 머리 합계가 세는 목록이 먼저 보여야 한다.`)
    }
    // 머리 합계는 보고 있는 목록의 합계다(운영자 지시 2026-09-22). 발행 쪽은 issuedSum, 미발행 쪽은
    // openSum 을 든다. 한쪽만 남으면 스위치를 넘겼을 때 위 숫자와 아래 목록이 다른 집합을 말한다.
    const headEnd2 = tab.indexOf('<SegmentedControl')
    const head2 = headEnd2 < 0 ? '' : tab.slice(0, headEnd2)
    if (!/seg === 'issued' \?/.test(head2) || !/fmtWon\(issuedSum\)/.test(head2) || !/fmtWon\(openSum\)/.test(head2)) {
      violations.push(`${TAB} — 머리 합계가 스위치를 안 따른다. 발행 쪽은 issuedSum, 미발행 쪽은 openSum 을 들어야 한다.`)
    }
  }
}

console.log(`[현금영수증 화면 축] 제목 훑은 파일 ${titleFiles}개 · 위반 ${violations.length}건`)
for (const v of violations.slice(0, 15)) console.error(`  - ${v}`)
if (violations.length > 15) console.error(`  ... 외 ${violations.length - 15}건`)
process.exit(violations.length > 0 ? 1 : 0)
