// 운영/테스트 환경 분리가 조용히 무너지는 걸 잡는 감지망 (2026-08-03, 테스트 서버 도입).
//
// 이 축이 무너지는 방식은 늘 조용하다. 에러도 경고도 없이 테스트 사이트가 실기기로 알림을 보내거나,
// 테스트 배너가 안 뜬 채 운영과 똑같은 화면이 뜬다. 테스트 DB 가 운영 데이터 복사본이라
// 화면만으로는 두 사이트를 구별할 수 없어서, 표시가 사라지면 알아챌 방법이 없다.
//
// 소스만 읽는다. DB 도 운영자 계정 작업도 안 본다 — 그런 조건으로 걸면 착수가 끝날 때까지
// 영구 빨간불이 된다(knowledge/regression-nets.md).
import { readFileSync, readdirSync, statSync } from 'fs'
import { join } from 'path'

const violations = []
const read = f => { try { return readFileSync(f, 'utf8') } catch { return null } }

// 주석을 지운 뒤 매칭한다 — 같은 문자열이 주석에 있어서 통과해버린 전례가 있다(open.kakao.com).
const stripComments = s => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1')

function walk(dir, out = []) {
  let entries
  try { entries = readdirSync(dir) } catch { return out }
  for (const e of entries) {
    if (e === 'node_modules' || e === '.next' || e.startsWith('.')) continue
    const p = join(dir, e)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (/\.(ts|tsx)$/.test(p)) out.push(p)
  }
  return out
}
const SRC = [...walk('app'), ...walk('lib'), ...walk('components')]

// ── 1. 판정 정본 ──────────────────────────────────────────────
// 발송 차단과 화면 표시가 갈리면 최악의 조합이 생긴다 — 배너는 없는데 발송은 막힌 상태.
const ENV_CANON = 'lib/env.ts'
const envSrc = read(ENV_CANON)
if (!envSrc) {
  violations.push('[소스] 환경 판정 정본 lib/env.ts 가 사라졌다 — 발송 차단과 테스트 표시가 각자 판정하게 된다')
} else {
  if (!/export function isLiveEnv\(\)/.test(envSrc) || !/export function isStagingEnv\(\)/.test(envSrc)) {
    violations.push('[소스] lib/env 의 판정 함수가 사라졌다 — 부르는 쪽이 각자 환경변수를 읽게 된다')
  }
  // 부정형('테스트면 막기')으로 되돌아가면 변수 누락이 곧 실발송이 된다
  if (!/process\.env\.VERCEL_ENV === 'production'/.test(envSrc)) {
    violations.push("[소스] lib/env 가 VERCEL_ENV === 'production' 으로 운영을 판정하지 않는다 — 수동 플래그로 되돌아가면 깜빡한 순간 실제 발송이 기본값이 된다")
  }
}
for (const f of SRC) {
  if (f === ENV_CANON) continue
  const s = stripComments(read(f) ?? '')
  if (/process\.env\.VERCEL_ENV|process\.env\.STAGING|process\.env\.NEXT_PUBLIC_STAGING|process\.env\.STAYEUM_FORCE_LIVE/.test(s)) {
    violations.push(`[소스] ${f} 가 환경 판정 변수를 직접 읽는다 — 판정이 정본 밖으로 복제됐다. 정본을 고쳐도 여기는 안 따라온다`)
  }
}

// ── 2. 웹푸시 발송 문 ─────────────────────────────────────────
// 문이 둘이면 차단이 한쪽만 덮는다. 실제로 settings/pushActions 가 web-push 를 직접 들고 있었다.
const PUSH_CANON = 'lib/pushSend.ts'
for (const f of SRC) {
  if (f === PUSH_CANON) continue
  const s = stripComments(read(f) ?? '')
  // import 형태를 본다 — 'web-push' 부분 문자열은 주석·설명에도 나온다
  if (/from ['"]web-push['"]/.test(s) || /import\(['"]web-push['"]\)/.test(s)) {
    violations.push(`[소스] ${f} 가 web-push 를 직접 가져온다 — 초크포인트(lib/pushSend)를 건너뛰어 테스트 사이트에서 실기기로 알림이 나간다`)
  }
  if (/webpush\.sendNotification\(/.test(s)) {
    violations.push(`[소스] ${f} 가 webpush.sendNotification 을 직접 부른다 — 테스트 사이트 차단 밖이라 운영자 실기기로 진짜 푸시가 발송된다`)
  }
}

// ── 3. 차단 위치 — 함수 첫 문장이어야 한다 ────────────────────
// 거리로 근사하면 안 된다. 가드를 세 번째 줄로 밀어도 시그니처와 가까워 그대로 통과한다(2026-08-03 교훈).
{
  const s = read(PUSH_CANON)
  const at = s ? s.indexOf('export async function sendToSubscriptions') : -1
  const open = at < 0 ? -1 : s.indexOf('{', s.indexOf(')', at))
  if (!s || at < 0 || open < 0) {
    violations.push('[소스] sendToSubscriptions 본문을 읽지 못했다 — 발송 차단 대조가 건너뛰어졌다. 감지망을 고쳐야 한다')
  } else {
    // 중괄호 깊이 1 의 첫 실행문을 집는다(주석 제거 후)
    const body = stripComments(s.slice(open + 1))
    const first = body.split('\n').map(l => l.trim()).find(l => l.length > 0) ?? ''
    if (!/^if \(isStagingEnv\(\)\)/.test(first)) {
      violations.push('[소스] sendToSubscriptions 의 첫 문장이 테스트 사이트 가드가 아니다 — 앞에 붙는 코드가 차단 밖에서 돌고, 가드가 통째로 사라져도 조용하다')
    }
  }
}

// ── 4. 테스트 표시 ────────────────────────────────────────────
{
  const banner = read('components/layout/StagingBanner.tsx')
  const root = read('app/layout.tsx')
  if (!banner) {
    violations.push('[소스] StagingBanner 가 사라졌다 — 운영과 똑같이 생긴 테스트 사이트를 구별할 단서가 없어진다')
  } else {
    // 마운트만 보면 알맹이가 빠져도 통과한다 — 표시 분기를 따로 본다
    if (!/isStagingEnv\(\)/.test(stripComments(banner))) {
      violations.push('[소스] StagingBanner 의 표시 분기가 사라졌다 — 마운트돼 있어도 아무것도 안 뜨거나 운영에까지 뜬다')
    }
    if (/'use client'|"use client"/.test(banner)) {
      violations.push('[소스] StagingBanner 가 클라이언트 컴포넌트가 됐다 — 브라우저에서는 환경변수가 빈 값이라 표시가 조용히 사라진다')
    }
  }
  if (!root || !/<StagingBanner/.test(root)) {
    violations.push('[소스] 루트 레이아웃에서 StagingBanner 마운트가 사라졌다 — 로그인·서명 화면에서 테스트 사이트인지 알 수 없다')
  }
  if (!root || !/data-env=/.test(root)) {
    violations.push('[소스] 루트 레이아웃의 data-env 가 사라졌다 — 띠 높이 예약이 풀려 셸 상단이 덮인다')
  }
  const css = read('app/globals.css') ?? ''
  if (!/--sysbar-h: 0px/.test(css) || !/\[data-env='staging'\]/.test(css)) {
    violations.push('[소스] --sysbar-h 높이 예약이 사라졌다 — 테스트 사이트에서 띠가 헤더 버튼을 덮는다')
  }
  // 셸 크롬 높이 규약 — 여기 합산을 빠뜨리면 화면 꽉 채우는 편집기 하단이 잘린다.
  // 선언이 둘이다(기본 + md 브레이크포인트). 하나만 보면 다른 하나가 빠져도 통과한다(실측).
  const shellDecls = css.match(/--shell-content-h:[^;]*;/g) ?? []
  if (shellDecls.length < 2) {
    violations.push('[소스] --shell-content-h 선언을 다 찾지 못했다 — 셸 높이 대조가 건너뛰어졌다. 감지망을 고쳐야 한다')
  } else if (shellDecls.some(d => !d.includes('var(--sysbar-h)'))) {
    violations.push('[소스] --shell-content-h 선언 중 --sysbar-h 를 빼지 않는 것이 있다 — 그 화면 폭에서 도면 편집기 하단이 잘린다')
  }
}

// ── 5. 문자 문 ────────────────────────────────────────────────
// 문자는 서버가 보내지 않지만, 테스트 DB 가 운영 복사본이라 진짜 입주자 번호가 채워진 채로
// 메시지앱이 열린다. sms: 를 조립하는 파일은 반드시 가드를 거쳐야 한다.
// 조립 지점이 넷인데 정본 헬퍼를 쓰는 건 하나뿐이라, 지금은 '가드 참조'로 본다.
{
  const SMS_CANON = 'lib/smsHref.ts'
  const canon = read(SMS_CANON)
  if (!canon || !/export function blockSmsIfStaging\(/.test(canon)) {
    violations.push('[소스] blockSmsIfStaging 가드가 사라졌다 — 테스트 사이트에서 진짜 입주자 번호로 메시지앱이 열린다')
  }
  for (const f of SRC) {
    if (f === SMS_CANON) continue
    const s = stripComments(read(f) ?? '')
    // 주석에 sms: 설명이 많은 파일들이라 문자열 리터럴 안의 조립만 본다
    if (!/`sms:|`sms:\/\/|'sms:|"sms:/.test(s)) continue
    if (!/blockSmsIfStaging\(/.test(s)) {
      violations.push(`[소스] ${f} 가 가드 없이 sms: 링크를 만든다 — 테스트 사이트에서 실제 입주자 번호로 메시지앱이 열린다`)
    }
  }
}

// ── 6. Drive 업로드 폴더 ──────────────────────────────────────
// 업로드 문이 parents 를 잃으면 에러가 아니라 드라이브 루트로 간다(조용한 실패).
{
  const DRIVE_CANON = 'lib/google-drive.ts'
  for (const f of SRC) {
    if (f === DRIVE_CANON) continue
    const s = stripComments(read(f) ?? '')
    if (/from ['"]googleapis['"]/.test(s)) {
      violations.push(`[소스] ${f} 가 googleapis 를 직접 가져온다 — 업로드 폴더 정본(lib/google-drive)을 우회해 테스트 파일이 운영 폴더에 쌓인다`)
    }
  }
  const s = stripComments(read(DRIVE_CANON) ?? '')
  if (!s) {
    violations.push('[소스] lib/google-drive 를 읽지 못했다 — 업로드 폴더 대조가 건너뛰어졌다. 감지망을 고쳐야 한다')
  } else {
    const uploads = (s.match(/parents:\s*\[FOLDER_ID\]/g) ?? []).length
    if (uploads < 2) {
      violations.push('[소스] Drive 업로드가 parents: [FOLDER_ID] 를 잃었다 — 폴더 지정 없이 올라가 에러 없이 드라이브 루트에 쌓인다')
    }
  }
}

if (violations.length) {
  console.error(`\n[환경 분리] 위반 ${violations.length}건`)
  for (const v of violations) console.error('  - ' + v)
  process.exit(1)
}
console.log('[환경 분리] 위반 0건')
