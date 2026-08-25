// 발신 주소 정본(lib/mailFrom) 회귀 — 실행: npx tsx scripts/test-mail-from.ts
//
// 여기서 고정하는 것 셋(2026-08-26 운영자 요구, 영업장별 발신 주소).
//   · **도메인은 고정이다** — 영업장이 정하는 것은 앞부분뿐이고, 전체 주소를 붙여넣어도
//     앞부분만 남는다(지메일 주소로 보내면 반송된다는 사실을 코드가 대신 막는다).
//   · **발신 주소 때문에 메일이 안 나가지 않는다** — 이상한 값은 no-reply 로 떨어진다.
//     그것이 오늘까지의 전 발송과 같은 동작이라 회귀 위험이 0이다.
//   · **허용 문자 집합이 곧 보안선이다** — CR/LF·따옴표·꺾쇠가 남으면 발신 헤더에 다른 줄을
//     끼워 넣을 수 있다. 정규화가 그 문자들을 통째로 지운다.
import {
  normalizeMailFromLocal, isReservedMailLocal, buildMailFromAddress,
  MAIL_FROM_DOMAIN, MAIL_FROM_LOCAL_MAX,
} from '../lib/mailFrom'

let pass = 0
const fails: string[] = []
function eq(name: string, got: unknown, want: unknown) {
  if (got === want) { pass++; return }
  fails.push(`${name}: 기대 ${String(want)} / 실제 ${String(got)}`)
}

// ── 정규화 ─────────────────────────────────────────────────────────
eq('앞뒤 공백', normalizeMailFromLocal('  thestayjegi  '), 'thestayjegi')
eq('대문자는 소문자로', normalizeMailFromLocal('TheStay.Jegi'), 'thestay.jegi')
eq('전체 주소를 붙여넣어도 앞부분만', normalizeMailFromLocal('thestayjegi@gmail.com'), 'thestayjegi')
eq('우리 도메인을 붙여넣어도 앞부분만', normalizeMailFromLocal('thestayjegi@stayeum.com'), 'thestayjegi')
eq('허용 문자만 남는다', normalizeMailFromLocal('the stay!jegi#1'), 'thestayjegi1')
eq('한글은 통째로 사라진다', normalizeMailFromLocal('제기역점'), '')
eq('점·하이픈·밑줄은 남는다', normalizeMailFromLocal('the-stay_jegi.1'), 'the-stay_jegi.1')
eq('연속 점은 하나로', normalizeMailFromLocal('a..b'), 'a.b')
eq('앞뒤 점 제거', normalizeMailFromLocal('.abc.'), 'abc')
eq('상한 절단', normalizeMailFromLocal('a'.repeat(40)).length, MAIL_FROM_LOCAL_MAX)
// 절단 자리에 점이 걸리면 앞뒤 점 규칙이 다시 걸린다(절단 후 재정리).
eq('절단 뒤 끝점도 정리', normalizeMailFromLocal('a'.repeat(MAIL_FROM_LOCAL_MAX - 1) + '.bbb'), 'a'.repeat(MAIL_FROM_LOCAL_MAX - 1))
eq('빈 값', normalizeMailFromLocal(''), '')
eq('null', normalizeMailFromLocal(null), '')
eq('undefined', normalizeMailFromLocal(undefined), '')
eq('공백뿐', normalizeMailFromLocal('   '), '')

// 헤더 주입 — 줄바꿈·꺾쇠·따옴표가 남으면 발신 줄에 다른 헤더를 끼울 수 있다.
// '@' 뒤가 먼저 잘려 도메인까지 사라진다 — 주입하려던 주소가 통째로 못 남는다.
eq('줄바꿈 제거', normalizeMailFromLocal('abc\r\nBcc: evil@x.com'), 'abcbccevil')
eq('꺾쇠·따옴표 제거', normalizeMailFromLocal('a"b<c>d'), 'abcd')

// ── 예약어 ─────────────────────────────────────────────────────────
eq('no-reply 는 예약', isReservedMailLocal('no-reply'), true)
eq('postmaster 는 예약', isReservedMailLocal('postmaster'), true)
eq('stayeum 은 예약(플랫폼 정체성)', isReservedMailLocal('stayeum'), true)
eq('support 는 예약', isReservedMailLocal('support'), true)
eq('일반 이름은 예약 아님', isReservedMailLocal('thestayjegi'), false)

// ── 조립 ───────────────────────────────────────────────────────────
eq('설정값이 있으면 그 주소', buildMailFromAddress('thestayjegi'), `thestayjegi@${MAIL_FROM_DOMAIN}`)
eq('대문자 입력도 소문자 주소', buildMailFromAddress('TheStayJegi'), `thestayjegi@${MAIL_FROM_DOMAIN}`)
eq('전체 주소 입력도 우리 도메인으로', buildMailFromAddress('thestayjegi@gmail.com'), `thestayjegi@${MAIL_FROM_DOMAIN}`)
// 폴백 — 오늘까지의 전 발송과 같은 주소가 나온다(무회귀 계약)
eq('null 은 기본', buildMailFromAddress(null), `no-reply@${MAIL_FROM_DOMAIN}`)
eq('빈 값은 기본', buildMailFromAddress(''), `no-reply@${MAIL_FROM_DOMAIN}`)
eq('공백뿐이면 기본', buildMailFromAddress('   '), `no-reply@${MAIL_FROM_DOMAIN}`)
eq('한글만이면 기본', buildMailFromAddress('제기역점'), `no-reply@${MAIL_FROM_DOMAIN}`)
eq('예약어면 기본', buildMailFromAddress('postmaster'), `no-reply@${MAIL_FROM_DOMAIN}`)
eq('예약어 대문자도 기본', buildMailFromAddress('Support'), `no-reply@${MAIL_FROM_DOMAIN}`)

console.log(`\n발신 주소 정본 회귀: ${pass} 통과 / ${fails.length} 실패`)
for (const f of fails) console.log('  - ' + f)
if (fails.length > 0) process.exit(1)
