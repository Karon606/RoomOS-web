// 보증금 어휘가 다시 '환불'로 갈리는 것을 잡는 감지망 — 읽기 전용, 위반 시 exit 1.
//
// 왜 필요한가. 보증금은 **반환**이고 이용료는 **환불**이다. 맡아 둔 돈을 돌려주는 것과, 받은
// 대가를 무르는 것은 다른 일이다. 서버 함수 이름도 recordDepositReturn 이다.
//
// 2026-08-30 에 퇴실 경로 셋의 어휘를 맞췄는데 수납 정보 화면이 빠져 있었다. 거기만 '일부 환불',
// '환불 30,000원', '환불 정산 기록'으로 남아 운영자가 다시 지적했다(2026-08-31). 한 번 맞춘
// 어휘가 다시 갈리는 것은 화면이 늘 때마다 생기는 클래스라 그물로 지킨다.
//
// 이용료 환불은 대상이 아니다 — 그쪽은 '환불'이 맞는 낱말이다.
//
// 실행: node scripts/check-deposit-vocab.mjs
import { readFileSync } from 'node:fs'
import { execSync } from 'node:child_process'

const violations = []

// 보증금을 다루는 화면들 — 여기서 '환불'이라는 낱말이 사람에게 보이면 위반이다.
const FILES = [
  'components/entity-modal/widgets/DepositStatusPanel.tsx',
  'components/entity-modal/bodies/TenantBody.tsx',
  'app/(app)/rooms/DepositSection.tsx',
]

for (const f of FILES) {
  scan(f)
}

/**
 * 그 파일에서 사람에게 보이는 '환불'을 찾는다.
 *
 * 주석은 대상이 아니다 — 경위를 적을 때 옛 낱말을 인용해야 한다. 한 줄 주석뿐 아니라 여러 줄
 * 블록 주석도 걸러야 한다(JSX 주석이 대개 여러 줄이라 첫 줄만 보면 안쪽을 놓친다).
 */
function scan(f) {
  const lines = readFileSync(f, 'utf8').split('\n')
  let inBlock = false
  lines.forEach((line, i) => {
    const opens = /\/\*/.test(line)
    const closes = /\*\//.test(line)
    const wasInBlock = inBlock
    if (opens && !closes) inBlock = true
    else if (closes) inBlock = false
    if (wasInBlock || opens) return
    if (/^\s*(\/\/|\*)/.test(line)) return
    // 코드 뒤에 붙은 주석도 떼어 낸다 — 줄 앞만 보면 `setX() // 환불 안 함` 같은 자리를 잡는다.
    const code = line.split('//')[0]
    if (!/환불/.test(code)) return
    // 이용료 환불은 그 낱말이 맞다 — 받은 대가를 무르는 일이다.
    // 이용료 쪽 낱말과, 서버 오류 문자열을 그대로 대조하는 줄은 통과시킨다.
    if (/이용료 환불|이용료를 전액 환불|전액 환불|중도퇴실 환불|rentRefund|finalizeRentRefund|undoRentRefund|총 \$\{|환불 \+ 퇴실|총 환불액 \$|돌려주는 금액입니다|이미 환불 처리된|환불 전 상태|완납 시 환불|환불 창 dirty/.test(line)) return
    violations.push(`${f}:${i + 1} — 보증금을 '환불'이라 부른다. 맡아 둔 돈을 돌려주는 것은 '반환'이다.`)
  })
}

// 새 화면이 생겨도 같은 규칙을 타야 한다 — 보증금 반환 액션을 쓰는 파일은 전부 대상이다.
{
  const users = execSync(
    "grep -rl 'recordDepositReturn\\|undoDepositReturn' app components --include='*.tsx' || true",
    { encoding: 'utf8' },
  ).trim().split('\n').filter(Boolean)
  for (const f of users) {
    if (FILES.includes(f)) continue
    scan(f)
  }
}

console.log(`[보증금 어휘] 검사 파일 ${FILES.length}개 + 반환 액션 사용처 / 위반 ${violations.length}건`)
if (violations.length > 0) {
  console.error('')
  for (const v of violations) console.error(`  - ${v}`)
  console.error('')
  console.error("  보증금은 '반환', 이용료는 '환불'이다. 서버 함수 이름(recordDepositReturn)도 같은 낱말이다.")
  process.exit(1)
}
