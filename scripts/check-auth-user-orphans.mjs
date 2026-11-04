// 고아 계정 감지: 로그인 계정(auth.users)은 있는데 앱 users 행이 없는 사람 — 읽기 전용. 발견 시 exit 1(수정은 하지 않는다).
//
// 왜 있나(2026-11-04 운영자 승인 '추천대로', 구관기 님 이메일 가입)
//   행이 없는 계정은 게이트가 대기로 보고 /pending 에 세우는데, 관리자 목록은 users 표만 읽어 그 사람이 안 보인다.
//   '승인할 대상이 없는 대기자'가 된다. 원인 둘(인증 링크가 콜백을 안 거침, 로그인 직후 동기화 액션이 proxy 307 로 미실행)을 봉합했고,
//   계정 관문(getAccessContext)이 행이 없는 신원을 보면 정본 lib/auth/ensureAppUser 로 만든다. 이 감지망은 그래도 생기는 어긋남을 본다.
//
// 판정
//   ① 고아: auth.users 에 있는데 public.users 에 같은 id 가 없다. 기준선(BASELINE) 밖이면 실패.
//      기준선 계정이 다시 로그인하면 관문이 행을 만들어 고아가 아니게 된다. 그러면 '기준선이 낡았다'로 알린다(실패 아님, 지우라는 안내).
//   ② 경고(실패 아님): DB 칸 isSuperAdmin=true 인데 env SUPER_ADMIN_EMAILS 밖인 계정. 관리자 화면에서 준 권한이다.
//      허용 목록(ADMIN_ALLOW)에 없으면 이름(이메일 앞부분)을 적는다. 운영자가 본인이 준 것인지 확인한다.
// 개인정보: 이메일은 앞부분만 찍는다.
//
// 실행: node --env-file=.env.local scripts/check-auth-user-orphans.mjs
import pg from 'pg'

// 2026-11-04 기준 고아 1건. 구관기 님 이메일 계정(같은 사람이 Google 로 다시 가입해 행이 따로 있다). 지울지 둘지는 운영자 결정 대기.
const BASELINE = new Set(['ef2df750-d630-475b-8b42-651fe4bf536f'])
// DB 칸으로 준 스테이음 관리자 중 env 밖인데 운영자가 본인이라고 확인한 계정 id. 2026-11-04 기준 0명(DB 관리자 둘은 env 에도 있는 운영자 본인 계정).
const ADMIN_ALLOW = new Set([])

const mask = (e) => (e ? `${String(e).split('@')[0].slice(0, 4)}…` : '(이메일 없음)')

async function main() {
  const c = new pg.Client({ connectionString: process.env.DATABASE_URL })
  await c.connect()
  try {
    await c.query('BEGIN READ ONLY')
    const orphans = (await c.query(
      `select a.id, a.email, a.created_at, a.last_sign_in_at, a.raw_app_meta_data->>'provider' as provider
         from auth.users a left join public.users u on u.id = a.id where u.id is null order by a.created_at`,
    )).rows
    const admins = (await c.query(`select id, email from public.users where "isSuperAdmin" = true`)).rows
    await c.query('ROLLBACK')

    const env = (process.env.SUPER_ADMIN_EMAILS ?? '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean)
    const fresh = orphans.filter(o => !BASELINE.has(o.id))
    const stale = [...BASELINE].filter(id => !orphans.some(o => o.id === id))
    const dbOnly = admins.filter(a => !env.includes(String(a.email).toLowerCase()) && !ADMIN_ALLOW.has(a.id))

    console.log(`[고아 계정] 로그인 계정 중 앱 행 없음 ${orphans.length}건 (기준선 ${BASELINE.size}) / 새 고아 ${fresh.length}건`)
    for (const o of fresh) console.log(`  - ${o.id.slice(0, 8)} ${mask(o.email)} ${o.provider ?? '?'} 가입 ${o.created_at?.toISOString?.() ?? o.created_at}`)
    for (const id of stale) console.log(`  · 기준선이 낡았다: ${id.slice(0, 8)} 는 이제 행이 있다(BASELINE 에서 지운다)`)
    if (dbOnly.length) {
      console.log(`  경고: env 밖에서 DB 로 준 스테이음 관리자 ${dbOnly.length}명(운영자 확인 뒤 ADMIN_ALLOW 에 id 를 올린다)`)
      for (const a of dbOnly) console.log(`    · ${a.id.slice(0, 8)} ${mask(a.email)}`)
    }
    if (fresh.length) process.exit(1)
  } finally {
    await c.end()
  }
}

main().catch(e => { console.error(e); process.exit(1) })
