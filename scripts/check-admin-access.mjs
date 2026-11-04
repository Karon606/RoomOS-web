// 스테이음 관리자 페이지(가입자·승인·권한) 배선 감지망. 실패 시 exit 1.
// 실행: node scripts/check-admin-access.mjs
//
// 왜(2026-11-04 운영자 승인 '추천대로'). 가입자 카드의 [운영자 지정]이 바로 눌려 남에게 플랫폼 슈퍼관리자가 걸렸고(확인창·적용취소·
// 감사 기록 없음), 낱말 '운영자'가 이 앱의 사용자(고시원 운영자)와 겹쳤다. 고친 모양이 다시 무너지지 않게 글자로 붙잡는다.
//   ⓐ 낱말: 플랫폼 권한 자리에 '운영자 지정·해제·운영자 승인·운영자 페이지' 금지, 사이드바·영업장 선택 링크는 '스테이음 관리자'.
//   ⓑ 관문: app/admin/actions.ts 의 내보낸 함수는 첫 문장이 requireSuperAdmin(첫 DB 호출 전).
//   ⓒ 감사 기록: 권한·상태 쓰기는 changeAccess 를 거치고, 그 안에서 같은 트랜잭션으로 writeAudit. 적용취소도 기록한다.
//   ⓓ 권한 주기는 카드 '관리' 메뉴 구분선 아래(바로 누를 수 없다), 파괴 단계 확인창 + '이 사람이 볼 수 있게 되는 것' 목록.
//   ⓔ 본인 카드는 버튼 없음(진리표 isSelf), 화면이 isSelf 를 넘긴다. 토스트 적용취소가 undoAdminUserChange 를 부른다.
import { readFileSync } from 'node:fs'

let fail = 0
const ok = (name, cond) => { if (!cond) { fail++; console.log(`  실패 ${name}`) } }
const read = (f) => readFileSync(f, 'utf8')
const strip = (s) => s.replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\s\/\/ .*$/gm, '')

// ⓐ 낱말
const LABEL_FILES = [
  'app/admin/users/UsersClient.tsx', 'app/admin/layout.tsx', 'app/admin/AdminNav.tsx', 'app/admin/actions.ts',
  'app/pending/page.tsx', 'app/(auth)/login/EmailLoginForm.tsx', 'app/property-select/page.tsx', 'components/layout/Sidebar.tsx',
]
for (const f of LABEL_FILES) {
  const s = strip(read(f))
  ok(`ⓐ ${f}: '운영자 지정·해제' 낱말 없음`, !/운영자 (지정|해제)/.test(s))
  ok(`ⓐ ${f}: '운영자 승인·운영자 페이지·운영자에게' 없음`, !/운영자 (승인|페이지)|운영자에게/.test(s))
}
{
  const sb = strip(read('components/layout/Sidebar.tsx'))
  const links = sb.match(/<Link href="\/admin"[\s\S]*?<\/Link>/g) ?? []
  ok('ⓐ 사이드바 관리자 링크 둘', links.length === 2)
  ok("ⓐ 사이드바 관리자 링크는 '스테이음 관리자'", links.every(l => l.includes('스테이음 관리자') && !/>\s*운영자\s*</.test(l) && !/>운영자</.test(l)))
  ok("ⓐ 영업장 선택의 관리자 링크는 '스테이음 관리자 ›'", strip(read('app/property-select/page.tsx')).includes('스테이음 관리자 ›'))
  ok("ⓐ 정본 낱말 상수", read('lib/adminAccess.ts').includes("export const PLATFORM_ADMIN_LABEL = '스테이음 관리자'"))
}

// ⓑ 관문
const act = strip(read('app/admin/actions.ts'))
{
  const fns = [...act.matchAll(/export async function (\w+)\([^)]*\)[^{]*\{\n([\s\S]*?)\n\}/g)]
  ok('ⓑ 내보낸 함수가 있다', fns.length >= 8)
  for (const [, name, body] of fns) {
    const first = body.split('\n').map(l => l.trim()).find(Boolean) ?? ''
    ok(`ⓑ ${name}: 첫 문장이 requireSuperAdmin`, /^(const \w+ = )?await requireSuperAdmin\(\)$/.test(first))
  }
}

// ⓒ 감사 기록
{
  const ca = act.slice(act.indexOf('async function changeAccess('), act.indexOf('// ── 승인 상태 변경'))
  ok('ⓒ changeAccess 는 한 트랜잭션 안에서 읽고·막고·쓰고·기록한다',
    /return prisma\.\$transaction\(async \(tx\) => \{/.test(ca) && /tx\.user\.findUnique/.test(ca) && /const block = adminChangeBlock\(kind[\s\S]*?if \(block\) return \{ ok: false as const, error: block \}/.test(ca)
    && /tx\.user\.update/.test(ca) && /await writeAudit\(tx, adminId, userId, action, before, after\)/.test(ca))
  const body = (n) => act.slice(act.indexOf(`export async function ${n}(`), act.indexOf('\nexport ', act.indexOf(`export async function ${n}(`) + 1))
  ok('ⓒ setUserStatus 는 changeAccess 로만 쓴다', /changeAccess\(admin\.userId, userId, 'status', 'SET_STATUS'/.test(body('setUserStatus')) && !/prisma\.user\.update/.test(body('setUserStatus')))
  ok('ⓒ setSuperAdmin 은 changeAccess 로만 쓴다(GRANT·REVOKE)', /'grant', 'GRANT_SUPER_ADMIN'/.test(body('setSuperAdmin')) && /'revoke', 'REVOKE_SUPER_ADMIN'/.test(body('setSuperAdmin')) && !/prisma\.user\.update/.test(body('setSuperAdmin')))
  const ud = body('undoAdminUserChange')
  ok('ⓒ 적용취소: 서명 대조 · 쓴 직후 그대로 · 기록', /verifyUndoBody\(ADMIN_USER_UNDO_DOMAIN/.test(ud) && /sameSnap\(snapOf\(cur\), u\.after\)/.test(ud) && /writeAudit\(tx, admin\.userId, u\.userId, 'UNDO'/.test(ud))
  ok('ⓒ 감사 표 정본', /model AdminAuditLog \{/.test(read('prisma/schema.prisma')) && /CREATE TABLE IF NOT EXISTS "admin_audit_logs"/.test(read('prisma/migrate_admin_audit.sql')))
}

// ⓓ 권한 주기 자리와 확인창
{
  const lib = read('lib/adminAccess.ts')
  const ca = lib.slice(lib.indexOf('export function cardActions('), lib.indexOf('export function adminChangeBlock('))
  ok("ⓓ 권한 주기는 승인됨 카드의 구분선 아래뿐", /return \{ primary: \[\], manage: \['toPending'\], danger: \['revokeApproval', 'grantAdmin'\] \}/.test(ca)
    && (ca.match(/'grantAdmin'/g) ?? []).length === 1)
  const ui = strip(read('app/admin/users/UsersClient.tsx'))
  ok('ⓓ 카드는 진리표로 버튼을 세운다', /cardActions\(\{ status: u\.status, dbAdmin: u\.isSuperAdmin, envAdmin: u\.envAdmin, isSelf: u\.isSelf \}\)/.test(ui))
  ok('ⓓ 관리 메뉴로 묶는다', /<ManageMenu items=\{menu\}/.test(ui) && /danger: acts\.danger\.includes\(k\)/.test(ui))
  ok('ⓓ setSuperAdmin(…, true) 는 확인창을 지난 뒤에만', /if \(key === 'grantAdmin'\) \{\s*const ok = await confirmDialog\(\{[\s\S]*?level: 'danger'[\s\S]*?impactTitle: '이 사람이 볼 수 있게 되는 것'[\s\S]*?impact: grantImpact\(/.test(ui)
    && /if \(ok\) run\(u\.id, \(\) => setSuperAdmin\(u\.id, true\)/.test(ui) && (ui.match(/setSuperAdmin\(u\.id, true\)/g) ?? []).length === 1)
  const row = ui.slice(ui.indexOf('const acts = cardActions('), ui.indexOf('})()}', ui.indexOf('const acts = cardActions(')))
  ok('ⓓ 카드 발끝은 Btn·ManageMenu 뿐(raw <button> 없음)', row.length > 0 && !/<button\b/.test(row) && /<Btn key=\{k\} size="sm"/.test(row))
  ok('ⓓ 확인창 영향 목록 머리를 바꿀 수 있다', /impactTitle\?: string/.test(read('components/ui/ConfirmDialog.tsx')))
}

// ⓔ 본인 카드·적용취소 배선
{
  const lib = read('lib/adminAccess.ts')
  ok('ⓔ 진리표: 본인이면 아무것도 없다', /if \(r\.isSelf\) return none/.test(lib))
  ok('ⓔ 화면이 본인 여부를 서버에서 받아 넘긴다', /isSelf: u\.id === me\.userId/.test(read('app/admin/users/page.tsx')))
  ok('ⓔ 토스트 적용취소', /undoAdminUserChange\(undo\)/.test(read('app/admin/users/UsersClient.tsx')))
}

if (fail) { console.log(`\ncheck-admin-access: 실패 ${fail}`); process.exit(1) }
console.log('check-admin-access: 통과')
