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
//   ⓕ 가입: signUp·인증 메일 다시 보내기는 emailRedirectTo 로 /callback 에 돌아온다(코드를 교환하는 자리는 콜백뿐).
//   ⓖ 콜백: 코드를 먼저 교환하고, 교환이 실패했을 때만 기존 세션으로 통과한다. 행은 정본 ensureAppUser.
//   ⓗ proxy: 진입 리디렉트는 문서 요청(GET·HEAD)만. 행동은 scripts/test-proxy-entry-redirect.ts.
//   ⓘ 행 보장: 계정 관문(getAccessContext)이 행이 없으면 ensureAppUser, 로그인 동기화도 같은 정본, 인증 쪽에 손수 upsert 없음.
//   ⓙ 대기 화면: 탭 복귀·30초 재확인·[승인 확인], 승인되면 넘어간다. '다시 로그인' 안내 없음.
//   ⓚ 알림: 새 대기 계정 → 스테이음 관리자 푸시(정본 ensureAppUser), 참여 요청 → 소유자 푸시, 거름은 sendToUsers 한 곳.
//      대기 건수는 정본 countPendingSignups 하나를 사이드바·관리자 탭이 같이 쓴다.
//   ⓛ 직원 들이기: 승인 창의 '내 영업장 직원으로도 추가'는 기본 꺼짐, 켜면 승인·역할 줄·감사 기록이 한 트랜잭션, 토큰에 역할 줄.
//      넣을 수 있는 곳은 내가 소유한 영업장, 역할은 소유자 제외. 멤버 초대는 같은 판정(memberJoinState)으로 대기 계정을 알리고 거절 계정은 막는다.
//   ⓜ 가이드 정합(관리자 세 탭): raw <button>·--persimmon 글자·수제 배지 span 없음, 상태는 Badge(승인됨은 배지 없음), 1차 필터는
//      SegmentedControl('전체' 먼저), 탭은 ViewTabs, 빈 상태에 '검색어·필터를 조정' 없음, 이름 자리 '—'·'미입력' 채움 없음.
//      초대코드 쓰기 셋(발급·켜고 끄기·삭제)에 토스트 적용취소, 삭제는 §14 파괴 확인창.
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
  ok("ⓐ 사이드바 관리자 링크는 '스테이음 관리자'", links.every(l => l.includes('adminLinkLabel(adminPendingCount)') && !/운영자/.test(l))
    && /return pending > 0 \? `스테이음 관리자 \(\$\{pending\}\)` : '스테이음 관리자'/.test(sb))
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
  const row = ui.slice(ui.indexOf('const acts = cardActions('), ui.indexOf('</li>', ui.indexOf('const acts = cardActions(')))
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

// ⓕ 가입 인증 링크
{
  const f = strip(read('app/(auth)/login/EmailLoginForm.tsx'))
  ok('ⓕ 콜백 주소 정본', /function emailCallbackUrl\(returnTo\?: string\) \{\s*return `\$\{window\.location\.origin\}\/callback\?returnTo=\$\{encodeURIComponent\(safeReturnTo\(returnTo\)\)\}`/.test(f))
  const su = f.slice(f.indexOf('supabase.auth.signUp({'), f.indexOf('if (error) throw error', f.indexOf('supabase.auth.signUp({')))
  ok('ⓕ signUp 은 emailRedirectTo 로 콜백', su.length > 0 && /emailRedirectTo: emailCallbackUrl\(returnTo\)/.test(su))
  ok('ⓕ 인증 메일 다시 보내기도 콜백', /supabase\.auth\.resend\(\{ type: 'signup', email, options: \{ emailRedirectTo: emailCallbackUrl\(returnTo\) \} \}\)/.test(f))
  ok('ⓕ 로그인 뒤 동기화 실패가 로그인을 막지 않는다', /try \{ await syncUserToDB\(\) \} catch/.test(f))
}
// ⓖ 콜백
{
  const c = strip(read('app/(auth)/callback/route.ts'))
  const iEx = c.indexOf('exchangeCodeForSession(code)'), iPass = c.indexOf('if (existingUser) return toApp()')
  ok('ⓖ 교환이 먼저, 기존 세션 통과는 그 뒤', iEx > 0 && iPass > iEx && (c.match(/existingUser\)/g) ?? []).length === 1)
  ok('ⓖ 교환 성공이면 행 보장 뒤 앱으로', /if \(!error && data\.user\) \{\s*await ensureAppUser\(identityFromAuthUser\(data\.user\), \{ refreshProfile: true \}\)\s*return toApp\(\)/.test(c))
  ok('ⓖ 손수 upsert 없음', !/prisma\./.test(c))
}
// ⓗ proxy
{
  const p = strip(read('proxy.ts'))
  ok('ⓗ 진입 리디렉트는 GET·HEAD 만', /const isDocumentRequest = request\.method === 'GET' \|\| request\.method === 'HEAD'/.test(p) && /if \(isDocumentRequest && \(pathname === '\/' \|\| pathname === '\/login'\)\)/.test(p))
}
// ⓘ 행 보장 정본
{
  const a = strip(read('lib/auth/access.ts'))
  ok('ⓘ 관문은 행이 없을 때 정본으로 만든다', /const ensured = user \? null : await ensureAppUser\(identityFromClaims\(claims as Record<string, unknown>\)\)/.test(a) && /\?\? ensured\?\.status \?\? 'PENDING'/.test(a))
  const sy = strip(read('app/(auth)/login/actions.ts'))
  ok('ⓘ 로그인 동기화도 정본', /await ensureAppUser\(identityFromAuthUser\(user\), \{ extra, refreshProfile: true \}\)/.test(sy) && !/prisma\./.test(sy))
  const e = strip(read('lib/auth/ensureAppUser.ts'))
  ok('ⓘ 정본은 있는 행의 상태·관리자 표식을 안 덮는다', !/isSuperAdmin/.test(e) && !/status: 'PENDING'/.test(e.slice(e.indexOf('prisma.user.create'), e.indexOf('created = true'))))
  ok('ⓘ 같은 이메일 다른 행은 안 만든다', /const sameEmail = await prisma\.user\.findUnique\(\{ where: \{ email: idn\.email \}/.test(e))
}
// ⓙ 대기 화면
{
  const pa = strip(read('app/pending/page.tsx')), pc = strip(read('app/pending/PendingAutoCheck.tsx'))
  ok('ⓙ 대기 화면이 자동 재확인을 품는다', /<PendingAutoCheck initial=/.test(pa) && /승인되면 이 화면이 자동으로 넘어갑니다/.test(pa) && !/다시 로그인/.test(pa))
  ok('ⓙ 30초·탭 복귀·버튼', /PENDING_RECHECK_MS = 30_000/.test(pc) && /addEventListener\('visibilitychange', onVisible\)/.test(pc) && /setInterval\(/.test(pc) && /승인 확인/.test(pc))
  ok("ⓙ 승인이면 앱으로", /if \(s === 'APPROVED'\) \{ window\.location\.replace\('\/dashboard'\); return \}/.test(pc))
  ok('ⓙ 재확인 액션은 본인 상태만', /export async function checkMyAccess\(\): Promise<MyAccessStatus> \{\s*const ctx = await getAccessContext\(\)/.test(strip(read('app/pending/actions.ts'))))
}

// ⓚ 알림·대기 건수
{
  const e = strip(read('lib/auth/ensureAppUser.ts'))
  ok('ⓚ 새 대기 계정이면 스테이음 관리자에게 푸시', /if \(created && status === 'PENDING'\) \{\s*const \{ notifySuperAdmins \} = await import\('@\/lib\/pushSend'\)\s*await notifySuperAdmins\(signupPendingPush\(/.test(e))
  const ps = strip(read('lib/pushSend.ts'))
  ok('ⓚ 발송 거름은 sendToUsers 한 곳(승인·관리자만)', /async function sendToUsers\(candidates: string\[\], payload: OperatorPushPayload\): Promise<void> \{\s*const approved = await approvedPushRecipients\(candidates\)\s*const userIds = candidates\.filter\(id => approved\.has\(id\)\)/.test(ps))
  ok('ⓚ 스테이음 관리자 수신자는 DB 표식 또는 env', /export async function notifySuperAdmins\(/.test(ps) && /OR: \[\{ isSuperAdmin: true \}/.test(ps))
  const pa = strip(read('app/property-select/actions.ts'))
  ok('ⓚ 참여 요청은 소유자에게만', /await notifyPropertyOperators\(property\.id, joinRequestPush\([\s\S]*?\), \{ ownersOnly: true \}\)/.test(pa))
  ok('ⓚ 대기 건수 정본', /export async function countPendingSignups\(\)/.test(read('lib/adminSignups.ts')))
  ok('ⓚ 사이드바 링크 접미', (strip(read('components/layout/Sidebar.tsx')).match(/adminLinkLabel\(adminPendingCount\)/g) ?? []).length === 2
    && /const adminPendingCount = isSuperAdmin \? await countPendingSignups\(\) : 0/.test(strip(read('app/(app)/layout.tsx'))))
  ok('ⓚ 관리자 탭은 ViewTabs 링크 탭 + 가입자 접미', /<ViewTabs/.test(read('app/admin/AdminNav.tsx')) && /t\.id === 'users' && pendingCount > 0/.test(read('app/admin/AdminNav.tsx'))
    && /countPendingSignups\(\)/.test(read('app/admin/layout.tsx')) && !/--persimmon/.test(read('app/admin/AdminNav.tsx')))
}

// ⓛ 직원 들이기
{
  const ap = act.slice(act.indexOf('export async function approveUser('), act.indexOf('\nexport ', act.indexOf('export async function approveUser(') + 1))
  ok('ⓛ 승인은 역할·소유 확인 뒤 한 트랜잭션', /if \(!STAFF_ROLES\.includes\(addMember\.role\)\)/.test(ap) && /myOwnedProperties\(admin\.userId\)\)\.some\(p => p\.id === addMember\.propertyId\)/.test(ap)
    && /const res = await prisma\.\$transaction\(async \(tx\) => \{/.test(ap) && /tx\.userPropertyRole\.create/.test(ap) && /await writeAudit\(tx, admin\.userId, userId, 'APPROVE'/.test(ap)
    && /signAdminUndo\(\{ userId, before, after, \.\.\.\(role \? \{ role \} : \{\}\) \}\)/.test(ap))
  ok("ⓛ 직원 역할 목록에 소유자 없음", /export const STAFF_ROLES: readonly Role\[\] = \['MANAGER', 'STAFF', 'LIMITED_STAFF'\]/.test(read('lib/adminAccess.ts')))
  const ui = strip(read('app/admin/users/UsersClient.tsx'))
  ok('ⓛ 승인·다시 승인은 승인 창으로', /if \(key === 'approve' \|\| key === 'reapprove'\) \{ setApproving\(u\); return \}/.test(ui) && /approveUser\(u\.id, addMember\)/.test(ui))
  ok("ⓛ '내 영업장 직원으로도 추가'는 기본 꺼짐·소유 영업장 있을 때만", /const \[addStaff, setAddStaff\] = useState\(false\)/.test(ui) && /\{myProperties\.length > 0 && \(/.test(ui) && /내 영업장 직원으로도 추가/.test(ui))
  const st = strip(read('app/(app)/settings/actions.ts'))
  const inv = st.slice(st.indexOf('export async function inviteMember('), st.indexOf('\nexport ', st.indexOf('export async function inviteMember(') + 1))
  ok('ⓛ 멤버 초대는 같은 판정, 거절 계정은 역할 줄 전에 막는다', /const joinState = memberJoinState\(/.test(inv) && inv.indexOf("if (joinState === 'blocked') return") > 0
    && inv.indexOf("if (joinState === 'blocked') return") < inv.indexOf('prisma.userPropertyRole.upsert') && /if \(joinState === 'waiting'\) \{[\s\S]*?notifySuperAdmins\(memberInvitePendingPush\(/.test(inv))
  const sf = read('app/(app)/settings/SettingsForm.tsx')   // 주석 걷기를 하지 않는다(accept="image/*" 같은 글자가 주석 걷기를 넘긴다)
  ok('ⓛ 초대 토스트·안내문·제한 스태프', /showToast\(memberInviteToast\(result\.joinState\)\)/.test(sf) && !/Google로 로그인/.test(sf) && /<option value="LIMITED_STAFF">제한 스태프 · 재고 입력 담당, 금액 숨김<\/option>\s*<\/select>\s*<Btn variant="primary" size="md" onClick=\{handleInvite\}>/.test(sf))
  ok('ⓛ 대기 화면이 초대받은 영업장을 보인다', /직원으로 초대했습니다\. 스테이음 팀 승인 뒤 바로 들어갑니다/.test(strip(read('app/pending/page.tsx'))))
}

// ⓜ 가이드 정합
{
  const SCREENS = ['app/admin/users/UsersClient.tsx', 'app/admin/invites/InvitesClient.tsx', 'app/admin/properties/page.tsx', 'app/admin/properties/EnterButton.tsx', 'app/admin/AdminNav.tsx', 'app/pending/page.tsx']
  for (const f of SCREENS) {
    const s = strip(read(f))
    ok(`ⓜ ${f}: raw <button> 없음`, !/<button\b/.test(s))
    ok(`ⓜ ${f}: --persimmon 글자·채움 없음`, !/--persimmon/.test(s))
    ok(`ⓜ ${f}: 수제 배지 span 없음`, !/<span\s+className="text-\[11px\] font-semibold px-1\.5 py-0\.5 rounded"/.test(s))
    ok(`ⓜ ${f}: '—'·'미입력' 채움 없음`, !/'—'|미입력/.test(s))
  }
  const ui = strip(read('app/admin/users/UsersClient.tsx'))
  ok("ⓜ 상태 배지: 승인됨은 없음·대기 info·거절 neutral", /PENDING: \{ label: '승인 대기', tone: 'pale-blue' \},\s*APPROVED: null,\s*REJECTED: \{ label: '거절', tone: 'pale-neutral' \}/.test(ui) && /<Badge tone=\{badge\.tone\}>/.test(ui))
  ok("ⓜ 1차 필터 SegmentedControl, '전체' 먼저", /const FILTERS = \[\s*\{ value: 'ALL', label: '전체' \}/.test(ui) && /<SegmentedControl options=\{FILTERS\}/.test(ui))
  ok('ⓜ 빈 상태 문구', !/검색어나 필터/.test(ui) && /' 가입자가 없습니다`/.test(ui))
  ok('ⓜ 이름이 없으면 이메일이 식별자', /\{u\.name \|\| u\.email\}/.test(ui) && /name: u\.realName \|\| u\.name \|\| '',/.test(read('app/admin/users/page.tsx')))
  ok('ⓜ 연락처·주소는 있을 때만', /\{contact && <p/.test(ui))
  const inv = strip(read('app/admin/invites/InvitesClient.tsx'))
  ok('ⓜ 초대코드 발급·켜고 끄기·삭제 적용취소', /undoCreateInviteCode\(made\)/.test(inv) && /toggleInviteCode\(c\.id, c\.isActive\)/.test(inv) && /restoreInviteCode\(snap\)/.test(inv))
  ok('ⓜ 초대코드 삭제는 파괴 확인창', /level: 'danger',\s*confirmLabel: '삭제'/.test(inv))
  const ia = act.slice(act.indexOf('export async function undoCreateInviteCode('), act.indexOf('// ── 영업장 현황'))
  ok('ⓜ 발급 적용취소는 아무도 안 쓴 코드만', /deleteMany\(\{ where: \{ code, usedCount: 0 \} \}\)/.test(ia))
  ok('ⓜ 되살림은 같은 코드가 있으면 거부', /OR: \[\{ id: snap\.id \}, \{ code: snap\.code \}\]/.test(ia))
}

if (fail) { console.log(`\ncheck-admin-access: 실패 ${fail}`); process.exit(1) }
console.log('check-admin-access: 통과')
