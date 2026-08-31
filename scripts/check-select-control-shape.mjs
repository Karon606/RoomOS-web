// 선택 컨트롤이 좁은 칸에 갇히는 것을 잡는 감지망 — 읽기 전용, 위반 시 exit 1.
//
// 왜 필요한가. 입주자 폼이 국적·직업·흡연을 모바일에서도 3열로 세웠다. 아이폰 390px 에서 모달
// 여백을 빼면 본문이 318px, 셋으로 나누면 한 칸이 98px 이다. 국적 트리거의 고정물(좌우 여백 24,
// 국기 18, 간격 8, 화살표 14, 여백 8)을 빼면 글자 자리가 26px 밖에 안 남는다. 14px 글씨로 한 글자
// 반이라 '대한민국'이 네 줄로 쪼개졌다(2026-08-31 운영자 실기).
//
// 드롭다운 패널이 트리거 폭을 물려받는 구조라 그 안의 '직접 추가' 입력칸은 실제 폭이 20px 남짓
// 이었다. 글자를 쳐도 안 보인다는 지적이 그것이다.
//
// 축은 셋이다.
//   ⓐ 폼의 셀렉트가 모바일 3열에 서지 않는다(sm: 접두 없는 grid-cols-3 안).
//   ⓑ 값이 넘칠 때 줄바꿈 대신 말줄임으로 받는다(트리거에 truncate).
//   ⓒ 목록 같은 도메인 값을 localStorage 에 담지 않는다 — 기기를 바꾸면 사라진다.
//
// 실행: node scripts/check-select-control-shape.mjs
import { readFileSync } from 'node:fs'
import { execSync } from 'node:child_process'

const violations = []

// ⓐ 모바일 3열 안의 셀렉트.
{
  const files = execSync(
    "grep -rl 'grid-cols-3' app components --include='*.tsx' || true",
    { encoding: 'utf8' },
  ).trim().split('\n').filter(Boolean)
  const SELECT = /<(CountrySelect|JobSelect|SelectField|select)\b/
  for (const f of files) {
    const lines = readFileSync(f, 'utf8').split('\n')
    lines.forEach((line, i) => {
      // sm:grid-cols-3 은 넓은 화면 전용이라 대상이 아니다. 접두 없는 것만 본다.
      if (!/(?<!sm:)(?<!md:)(?<!lg:)grid-cols-3/.test(line)) return
      // 그 블록 안 12줄을 본다 — 한 행의 칸 셋이 그 안에 다 든다.
      const block = lines.slice(i, i + 12).join('\n')
      if (SELECT.test(block)) {
        violations.push(`${f}:${i + 1} — 모바일 3열에 선택 컨트롤이 선다. 칸이 98px 라 값이 세로로 쪼개진다. grid-cols-2 sm:grid-cols-3 을 쓴다.`)
      }
    })
  }
}

// ⓑ 트리거가 말줄임을 쓰는가.
{
  const src = readFileSync('components/ui/CountrySelect.tsx', 'utf8')
  const trigger = src.match(/<button[\s\S]*?<\/button>/)
  if (!trigger) violations.push('components/ui/CountrySelect.tsx — 트리거를 못 찾았다.')
  else {
    // 존재만 보면 성글다 — 선택된 값과 안내 문구가 각각 다른 span 이라, 한쪽만 남아도 통과했다
    // (역주입에서 실제로 통과했다). 폭을 늘려 잡는 자리(flex-1)를 **전부** 본다.
    const spans = trigger[0].match(/className="[^"]*flex-1[^"]*"/g) ?? []
    if (spans.length === 0) violations.push('components/ui/CountrySelect.tsx — 트리거에서 값 자리를 못 찾았다.')
    for (const cls of spans) {
      if (!/truncate/.test(cls)) {
        violations.push('components/ui/CountrySelect.tsx — 트리거 값 자리가 말줄임을 안 쓴다. 좁은 칸에서 값이 세로로 쪼개진다.')
        break
      }
    }
  }
}

// ⓒ 도메인 목록의 로컬 저장.
{
  const hits = execSync(
    "grep -rn \"localStorage.setItem\" app components lib --include='*.ts' --include='*.tsx' || true",
    { encoding: 'utf8' },
  ).trim().split('\n').filter(Boolean)
  // 뷰 상태(정렬·열 폭·접힘 따위)는 로컬이 맞다. 목록·카테고리처럼 다른 기기에서도 보여야 하는
  // 값만 잡는다. 새 키가 생기면 여기 판단을 한 번 거치게 하는 것이 이 축의 목적이다.
  const DOMAIN_HINT = /custom_jobs|categories|options|jobs/i
  for (const h of hits) {
    if (DOMAIN_HINT.test(h)) {
      violations.push(`${h.split(':').slice(0, 2).join(':')} — 목록성 값을 브라우저에 담는다. 기기를 바꾸면 사라진다. 영업장 설정에 둔다.`)
    }
  }
}

// ⓓ 팝업이 트리거 폭에 묶여 있지 않은가 (2026-08-31).
//    트리거의 형제로 absolute + w-full 로 그리면 두 가지가 깨진다. 좁은 칸에서는 팝업 안의
//    검색칸·입력칸이 같이 눌리고, 모달 안에서는 아래쪽 칸에서 연 팝업이 바닥에서 잘린다.
//    자리 산출은 usePopoverAnchor 정본 한 곳이 한다 — 사본을 만들면 언젠가 갈린다.
{
  for (const f of ['components/ui/CountrySelect.tsx', 'components/ui/DatePicker.tsx']) {
    const src = readFileSync(f, 'utf8')
    if (!/usePopoverAnchor\s*[<(]/.test(src)) {
      violations.push(`${f} — 팝업 자리를 정본(usePopoverAnchor)으로 안 센다. 손으로 재면 두 벌이 갈린다.`)
    }
    if (!/createPortal\(/.test(src)) {
      violations.push(`${f} — 팝업을 화면 기준으로 안 띄운다. 모달 안 아래쪽 칸에서 열면 바닥에서 잘린다.`)
    }
    // 폭을 트리거에 묶는 옛 문법이 남아 있으면 잡는다.
    if (/absolute[^"']*z-\[var\(--z-dropdown\)\][^"']*w-full/.test(src)) {
      violations.push(`${f} — 팝업 폭이 트리거에 묶여 있다. 좁은 칸에서 그 안 입력칸이 함께 눌린다.`)
    }
  }
}

console.log(`[선택 컨트롤 폭] 축 ⓐ 모바일 3열 금지 · ⓑ 말줄임 · ⓒ 목록의 로컬 저장 금지 · ⓓ 팝업 자리 정본 / 위반 ${violations.length}건`)
if (violations.length > 0) {
  console.error('')
  for (const v of violations) console.error(`  - ${v}`)
  console.error('')
  console.error('  좁은 칸에 갇힌 선택 컨트롤은 값이 세로로 쪼개지고, 그 안의 입력칸은 글자가 안 보인다.')
  process.exit(1)
}
