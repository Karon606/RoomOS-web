// 서버 함수가 인증 문을 지나는지 지키는 전역 감지망. 읽기 전용이고 위반이면 exit 1.
//
// 왜 필요한가. 권한 감사(2026-10-14, stayeum development/오류신고-정비/권한-영업장범위-감사.md)에서
// 세 가지 구멍이 한꺼번에 나왔다. ① 세션 쿠키만 보는 읽기(supabase.auth.getSession 은 쿠키 서명을
// 검증하지 않는다) ② 인증 문이 아예 없는 서버 액션(액션 id 는 공개 정적 청크에 있어 비로그인 POST 로
// 실행된다) ③ 인증 없는 API 라우트. 고친 뒤 새 함수가 같은 모양으로 들어와도 아무 그물이 안 울었다.
//
//   축 ⓐ 서버 파일('use client' 아닌 app·lib·components 파일과 proxy.ts)에서 getSession 이라는 이름 자체를
//        쓰지 않는다(직접 호출·구조 분해·변수 경유 전부).
//   축 ⓑ 'use server' 파일이 내보낸 async 함수(export function·export const·export { } 전부)는 정본 관문을
//        첫 DB·외부 호출보다 먼저 부른다. 또는 사유가 적힌 공개 목록에 있다. 기본 내보내기는 위반이다.
//   축 ⓒ route.ts 의 HTTP 처리기는 정본 관문, 실패하면 닫히는 크론 비밀 확인, 사유가 적힌 공개 목록 중 하나.
//   축 ⓓ 기기로 푸시를 보내는 함수(sendToSubscriptions 호출)는 같은 함수에서 approvedPushRecipients 로
//        거절·대기 계정을 거른다. 또는 본인 기기 시험 발송 목록에 있다.
//
// 인증 문 판정(아래 판정 절).
//   - 정본 이름(GATE_NAMES)은 그 정본 모듈에서 import 했을 때만 정본이다. 같은 파일에 같은 이름을
//     만들어 두면 그 본문을 따로 판정한다.
//   - 정본 문을 부르는 같은 파일 함수·import 함수는 래퍼로 자동 인정한다(getPropertyId 등). 다만 실패가
//     함수 밖으로 새어 나가야 한다(다시 던지지 않는 catch 가 감싸면 래퍼가 아니다).
//   - 호출은 무조건 실행되고(조건문·논리 연산 오른쪽·반복문 본문·안 불리는 중첩 함수 안이 아니고)
//     await 되어야 센다. void 로 버린 호출은 문이 아니다.
//   - getPropertyAccess 처럼 실패 시 null 을 주는 문은 결과를 변수에 담고 같은 함수가 `if (!x)` 로
//     일찍 끝낼 때만 정본이다(구조 분해는 null 이면 던지므로 정본). `?.` 로 바로 꺼내 쓰면 로그인
//     여부만 아는 약한 문으로 친다. null 결과를 그대로 돌려주는 래퍼는 같은 규칙을 부른 쪽에 넘긴다.
//   - 검증되는 Supabase 호출(auth.getClaims·auth.getUser)과 getAccessContext 는 로그인 여부만 아는
//     약한 문이다. 본인 데이터만 다루는 자리(IDENTITY_ONLY)가 아니면 위반이다.
//   - 실패를 catch 로 삼키고 그 뒤로 흘러 나가는 문은 덮는 범위가 그 try 문까지다(geminiKey 사고).
//     redirect 를 빼고 다른 오류만 다시 던지는 catch 도 삼킨 것으로 친다.
//
// 알려진 위반 기준선. 이 그물을 세운 날 이미 있던 위반(P1~P3 로 넘긴 것)은 BASELINE 에 고정한다.
// 새로 늘면 울고, 기준선 항목이 고쳐져 더는 위반이 아니면 그것도 운다(명단에서 지워 기준선을 줄인다).
//
// 아직 못 보는 것. 동적 import·메서드 호출로 부르는 DB 헬퍼(DB 호출 판정은 prisma 참조·fetch·같은 파일과
// import 한 함수까지 따라간다). 영업장 소유 확인(화면 id 를 propertyId 로 거르는지)은 이 그물의 일이 아니다.
//
// 실행: node scripts/check-server-auth-gate.mjs   (--list 면 기준선 포함 전체 목록)
import ts from 'typescript'
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { join, dirname, resolve, relative } from 'node:path'

const ROOT = process.cwd()
const SCAN_ROOTS = ['app', 'lib', 'components']

// 저장소 정본 인증 문. 모듈별로 적는다. 그 모듈에서 import 한 이름만 정본으로 본다.
//   full     실패하면 redirect 또는 throw 로 막는다
//   nullable 실패하면 null 을 준다. 부른 쪽이 null 이면 끝내야 문이 된다
//   identity 로그인 여부만 안다(막지 않는다)
const GATE_NAMES = {
  'lib/auth/propertyAccess.ts': {
    requirePropertyAccess: 'full',     // 영업장 관문(소속·계정 승인 상태)
    getPropertyAccess: 'nullable',     // 같은 관문, 실패 시 null(API 라우트·선택적 컨텍스트)
  },
  'lib/role.ts': {                     // 관문 위의 역할 문
    getMyRole: 'full', requireEdit: 'full', requireOwner: 'full', requireScopeEdit: 'full',
  },
  'lib/auth/access.ts': {
    requireSuperAdmin: 'full',         // 관리자 문
    requireApprovedAccount: 'full',    // 계정 승인 문(영업장 무관). 영업장 선택 전 단계와 사용자 단위 쓰기
    getAccessContext: 'identity',      // 상태를 돌려주기만 하고 막지 않는다
  },
}
// 검증되는 Supabase 신원 호출. getSession 은 여기에 없다(쿠키 서명을 검증하지 않는다).
const VERIFIED_AUTH_CALL = /\.auth\.(getClaims|getUser)$/

// 축 ⓐ 예외(서버 파일에서 getSession 을 판정 아닌 용도로 쓰는 자리). 'file' : '사유'. 지금은 0건이다.
const GET_SESSION_ALLOW = {}

// 축 ⓑ 공개 허용 목록. 로그인 없이 불려야 하는 서버 액션이다. 'file|함수' : '사유'.
const PUBLIC_ACTIONS = {
  'app/sign/[token]/actions.ts|verifyShareBirthdate': '입주자 원격 서명. 256비트 토큰과 생년월일, 원자적 시도 한도가 자격이다(로그인 없음)',
  'app/sign/[token]/actions.ts|submitRemoteSignature': '입주자 원격 서명. 토큰과 HMAC 이름 쿠키가 자격이고 대상은 링크 행에서만 읽는다',
  'app/sign/[token]/actions.ts|finalizeRemoteSubmission': '입주자 원격 서명 제출. 토큰과 HMAC 이름 쿠키가 자격이다',
  'app/property-select/actions.ts|signOut': '로그아웃. 세션을 지우기만 한다',
  'app/profile-setup/actions.ts|skipProfileSetup': '부르는 사람 브라우저에 30일 건너뛰기 쿠키만 심는다(DB 없음)',
}

// 축 ⓒ 공개 라우트. 로그인 없이 불려야 하는 처리기다. 'file|메서드' : '사유'.
const PUBLIC_ROUTES = {
  'app/api/build/route.ts|GET': '배포 식별자만 돌려준다(새 배포 감지용, DB 없음)',
  'app/api/calendar/[token]/route.ts|GET': '캘린더 구독. 캘린더 앱은 쿠키 없이 가져가므로 비밀 토큰이 자격이다',
  'app/api/public/gallery/route.ts|GET': '공개 갤러리. 공개로 표시한 사진만 내준다',
  'app/api/track/closeup/route.ts|POST': '공개 페이지 방문 수집. 레이트리밋만 둔다',
  'app/api/track/cta/route.ts|POST': '공개 페이지 방문 수집. 레이트리밋만 둔다',
  'app/api/track/gallery/route.ts|POST': '공개 페이지 방문 수집. 레이트리밋만 둔다',
  'app/api/track/pageview/route.ts|POST': '공개 페이지 방문 수집. 레이트리밋만 둔다',
  'app/api/track/popup/route.ts|POST': '공개 페이지 방문 수집. 레이트리밋만 둔다',
}

// 신원 호출만으로 충분한 자리. 영업장이 없는 단계이거나 사용자 본인 데이터만 다룬다. 'file|함수' : '사유'.
const IDENTITY_ONLY = {
  'app/(auth)/login/actions.ts|syncUserToDB': '로그인 직후 본인 사용자 행 동기화. 승인 대기 계정도 지나야 하는 문이다',
  'app/profile-setup/actions.ts|saveProfileSetup': '본인 실명·연락처만 쓴다. 영업장을 고르기 전 단계다',
  'app/property-select/actions.ts|getMyProperties': '영업장 선택 전 단계. 본인 소속 목록만 읽는다',
  'app/(app)/settings/pushActions.ts|getMyPushHistory': '사용자 단위 데이터(본인 푸시 기록). 영업장 소속과 무관하다',
  'app/(app)/settings/pushActions.ts|deletePushSubscription': '본인 기기 구독을 지우기만 한다',
  'app/(app)/settings/pushActions.ts|sendTestPush': '본인 기기로만 시험 알림을 보낸다(영업장 데이터 없음)',
  'app/(auth)/callback/route.ts|GET': 'OAuth 콜백. 코드를 세션으로 바꾼 뒤 본인 확인만 한다. 승인 게이트는 그다음 화면(레이아웃)이 본다',
}

// 축 ⓓ 본인 기기 시험 발송. 'file|함수' : '사유'.
const SELF_PUSH = {
  'app/(app)/settings/pushActions.ts|sendTestPush': '부르는 사람 본인 구독으로만 보낸다. 영업장 알림이 아니다',
}

// 알려진 위반 기준선(2026-10-14, P0 봉합 직후). 'file|함수' : '넘긴 단계와 감사 번호'.
// 여기 항목을 고치면 이 명단에서 지운다. 지우지 않으면 '기준선이 낡았다'로 운다.
const BASELINE = {
  'app/(app)/errorReports.ts|createErrorReportImageSession': 'P3 감사 L9. 로그인만 본다. 승인 대기 계정이 앱 Drive 업로드 세션을 받는다',
  'app/(app)/errorReports.ts|submitErrorReport': 'P3 감사 L9. 로그인만 보고 영업장은 ?. 로 꺼낸다(대기 계정도 신고·첨부 연결)',
  'app/api/ai-analysis/route.ts|POST': 'P3 감사 M3. 로그인만 본다. 대기 계정도 공용 Gemini 키를 한도 없이 쓴다(edge 런타임이라 관문 이식 시 nodejs 로)',
  'app/api/market-analyze/route.ts|POST': 'P3 감사 M3. 로그인만 본다. 영업장 소속·승인·월 한도 없음',
  'app/api/naver-places/route.ts|GET': 'P3 감사 M3. 로그인만 본다. 공용 네이버 키',
}

// ── 파일 수집 ───────────────────────────────────────────────────────────
function walk(dir, out = []) {
  let entries
  try { entries = readdirSync(dir) } catch { return out }
  for (const e of entries) {
    if (e === 'node_modules' || e.startsWith('.')) continue
    const p = join(dir, e)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (/\.tsx?$/.test(p) && !/\.d\.ts$/.test(p)) out.push(p)
  }
  return out
}

const sources = new Map()   // 저장소 상대 경로를 키로 SourceFile 을 담는다
function sf(rel) {
  if (sources.has(rel)) return sources.get(rel)
  let text
  try { text = readFileSync(join(ROOT, rel), 'utf8') } catch { sources.set(rel, null); return null }
  const kind = rel.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  const s = ts.createSourceFile(rel, text, ts.ScriptTarget.Latest, true, kind)
  sources.set(rel, s)
  return s
}

/** 주석·빈 줄을 건너뛴 첫 문장이 지시문(directive)이면 그 문자열. */
function directiveOf(s) {
  const first = s.statements[0]
  if (first && ts.isExpressionStatement(first) && ts.isStringLiteral(first.expression)) return first.expression.text
  return null
}

const files = SCAN_ROOTS.flatMap(r => walk(r)).map(p => relative(ROOT, p))
const violations = []
if (files.length === 0) violations.push('검사 대상 파일이 0개다. 스캔 경로가 어긋났다')

// ── 모듈 해석(@/ 와 상대 경로) ────────────────────────────────────────────
function resolveModule(fromRel, spec) {
  let base
  if (spec.startsWith('@/')) base = spec.slice(2)
  else if (spec.startsWith('.')) base = relative(ROOT, resolve(ROOT, dirname(fromRel), spec))
  else return null
  for (const cand of [base, `${base}.ts`, `${base}.tsx`, join(base, 'index.ts'), join(base, 'index.tsx')]) {
    if (/\.tsx?$/.test(cand) && existsSync(join(ROOT, cand)) && statSync(join(ROOT, cand)).isFile()) return cand
  }
  return null
}

const isFnLike = n => !!n && (ts.isArrowFunction(n) || ts.isFunctionExpression(n) || ts.isFunctionDeclaration(n) || ts.isMethodDeclaration(n) || ts.isGetAccessor(n) || ts.isSetAccessor(n) || ts.isConstructorDeclaration(n))
const hasMod = (n, k) => !!n.modifiers?.some(m => m.kind === k)

// ── 파일별 함수표·import 표·내보내기 표 ──────────────────────────────────────
const tables = new Map()
function tableOf(rel) {
  if (tables.has(rel)) return tables.get(rel)
  const s = sf(rel)
  // fns 는 최상위 함수 이름별 본문, imports 는 로컬 이름별 { mod, name }, exports 는 내보낸 이름별 로컬 이름
  const t = { fns: new Map(), imports: new Map(), exports: new Map(), defaults: [] }
  tables.set(rel, t)
  if (!s) return t
  for (const st of s.statements) {
    const exported = hasMod(st, ts.SyntaxKind.ExportKeyword)
    const isDefault = hasMod(st, ts.SyntaxKind.DefaultKeyword)
    if (ts.isFunctionDeclaration(st) && st.body) {
      if (isDefault) { t.defaults.push(st); continue }
      if (!st.name) continue
      t.fns.set(st.name.text, { node: st, body: st.body, async: hasMod(st, ts.SyntaxKind.AsyncKeyword) })
      if (exported) t.exports.set(st.name.text, st.name.text)
    } else if (ts.isVariableStatement(st)) {
      for (const d of st.declarationList.declarations) {
        if (!ts.isIdentifier(d.name) || !d.initializer) continue
        let init = d.initializer
        // cache(async () => …) 같은 래퍼 한 겹은 벗긴다
        if (ts.isCallExpression(init) && init.arguments.length && isFnLike(init.arguments[0])) init = init.arguments[0]
        if (ts.isArrowFunction(init) || ts.isFunctionExpression(init)) {
          t.fns.set(d.name.text, { node: d, body: init.body, async: hasMod(init, ts.SyntaxKind.AsyncKeyword) })
        }
        if (exported) t.exports.set(d.name.text, d.name.text)
      }
    } else if (ts.isExportAssignment(st)) {
      t.defaults.push(st)
    } else if (ts.isExportDeclaration(st) && !st.isTypeOnly && st.exportClause && ts.isNamedExports(st.exportClause)) {
      const mod = st.moduleSpecifier && ts.isStringLiteral(st.moduleSpecifier) ? resolveModule(rel, st.moduleSpecifier.text) : null
      for (const el of st.exportClause.elements) {
        if (el.isTypeOnly) continue
        const local = (el.propertyName ?? el.name).text
        const pub = el.name.text
        if (st.moduleSpecifier) {
          // export { a as b } from 'm' 은 이 파일에서는 import 와 같다
          if (mod) t.imports.set(`__reexport__${pub}`, { mod, name: local })
          t.exports.set(pub, `__reexport__${pub}`)
        } else {
          t.exports.set(pub, local)
        }
      }
    } else if (ts.isImportDeclaration(st) && ts.isStringLiteral(st.moduleSpecifier) && st.importClause?.namedBindings && ts.isNamedImports(st.importClause.namedBindings)) {
      const mod = resolveModule(rel, st.moduleSpecifier.text)
      if (!mod) continue
      for (const el of st.importClause.namedBindings.elements) {
        t.imports.set(el.name.text, { mod, name: (el.propertyName ?? el.name).text })
      }
    }
  }
  return t
}

/** 노드 아래 모든 자손을 소스 순서대로 돈다. */
function each(node, fn) {
  const visit = n => { fn(n); ts.forEachChild(n, visit) }
  ts.forEachChild(node, visit)
}
/** 노드 자신부터 돈다. 화살표 함수의 식 본문(() => requireScopeEdit(…))은 본문 자체가 호출이다. */
function eachIncl(node, fn) { fn(node); each(node, fn) }

/** 괄호·타입 단언을 건너뛴 부모. [건너뛴 뒤의 자식, 부모] */
function climb(n) {
  let p = n.parent
  while (p && (ts.isParenthesizedExpression(p) || ts.isAsExpression(p) || ts.isNonNullExpression(p) || ts.isTypeAssertionExpression(p) || (ts.isSatisfiesExpression && ts.isSatisfiesExpression(p)))) { n = p; p = p.parent }
  return [n, p]
}

/** node 가 root 안의 (즉시 실행이 아닌) 중첩 함수 안에 있는가. */
function insideFunction(node, root) {
  for (let n = node; n && n !== root; n = n.parent) {
    const p = n.parent
    if (p && p !== root && isFnLike(p) && !isIife(p)) return true
  }
  return false
}
function isIife(fn) {
  const [top, gp] = climb(fn)
  return !!gp && ts.isCallExpression(gp) && gp.expression === top
}

const SHORT_CIRCUIT = new Set([
  ts.SyntaxKind.AmpersandAmpersandToken, ts.SyntaxKind.BarBarToken, ts.SyntaxKind.QuestionQuestionToken,
  ts.SyntaxKind.AmpersandAmpersandEqualsToken, ts.SyntaxKind.BarBarEqualsToken, ts.SyntaxKind.QuestionQuestionEqualsToken,
])

/** node 가 root 에 들어오면 반드시 실행되는 자리인가(조건·반복·catch·안 불리는 함수 안이 아닌가). */
function unconditional(node, root) {
  for (let n = node; n && n !== root; n = n.parent) {
    const p = n.parent
    if (!p) return false
    if (ts.isIfStatement(p) && n !== p.expression) return false
    if (ts.isConditionalExpression(p) && n !== p.condition) return false
    if (ts.isBinaryExpression(p) && n === p.right && SHORT_CIRCUIT.has(p.operatorToken.kind)) return false
    if ((ts.isForStatement(p) || ts.isForOfStatement(p) || ts.isForInStatement(p) || ts.isWhileStatement(p) || ts.isDoStatement(p)) && n === p.statement) return false
    if (ts.isCaseClause(p) || ts.isDefaultClause(p) || ts.isCatchClause(p)) return false
    if ((ts.isCallExpression(p) || ts.isPropertyAccessExpression(p) || ts.isElementAccessExpression(p)) && p.questionDotToken && n !== p.expression) return false
    if (p !== root && isFnLike(p) && !isIife(p)) return false
  }
  return true
}

/** 호출 결과가 기다려지는가(await·return·Promise.all 배열·.then 사슬). void 로 버리면 아니다. */
function awaited(call) {
  const [n, p] = climb(call)
  if (!p) return false
  if (ts.isAwaitExpression(p)) return true
  if (ts.isReturnStatement(p)) return true
  if (ts.isArrowFunction(p) && p.body === n) return true
  if (ts.isArrayLiteralExpression(p)) {
    const [, pc] = climb(p)
    if (pc && ts.isCallExpression(pc) && pc.expression.getText() === 'Promise.all') return awaited(pc)
  }
  if (ts.isPropertyAccessExpression(p) && p.name.text === 'then' && p.parent && ts.isCallExpression(p.parent)) return awaited(p.parent)
  return false
}

// ── 인증 문 판정(같은 파일·import 를 따라가는 고정점) ─────────────────────────
const gateMemo = new Map()
function gateKind(rel, name, depth = 0) {
  if (depth > 8) return null
  const key = `${rel}|${name}`
  if (gateMemo.has(key)) return gateMemo.get(key)
  gateMemo.set(key, null)   // 순환 차단
  const t = tableOf(rel)
  let res = null
  const local = t.fns.get(name)
  if (local) res = wrapperKind(rel, local.body, depth + 1)
  else {
    const imp = t.imports.get(name)
    if (imp) res = GATE_NAMES[imp.mod]?.[imp.name] ?? gateKind(imp.mod, imp.name, depth + 1)
  }
  gateMemo.set(key, res)
  return res
}

/** 래퍼 함수의 세기. 밖으로 새는 정본 문이 있으면 full, null 결과를 돌려주면 nullable, 신원만이면 identity. */
function wrapperKind(rel, body, depth) {
  const gs = gatesOf(rel, body, depth)
  if (gs.some(g => g.kind === 'full' && g.propagates)) return 'full'
  if (gs.some(g => g.kind === 'nullableReturn')) return 'nullable'
  if (gs.some(g => g.kind === 'identity' && g.propagates)) return 'identity'
  return null
}

function calleeName(call) {
  const e = call.expression
  if (ts.isIdentifier(e)) return e.text
  return null
}

function endsWithExit(stmt) {
  if (!stmt) return false
  if (ts.isBlock(stmt)) return endsWithExit(stmt.statements[stmt.statements.length - 1])
  if (ts.isReturnStatement(stmt) || ts.isThrowStatement(stmt)) return true
  // redirect()·notFound() 는 돌아오지 않는다
  return ts.isExpressionStatement(stmt) && ts.isCallExpression(stmt.expression)
    && /^(redirect|permanentRedirect|notFound|forbidden|unauthorized)$/.test(stmt.expression.expression.getText())
}

/** catch 블록이 redirect 를 밖으로 다시 던지는가. 무조건 던지거나, NEXT_REDIRECT 를 긍정으로 묻는 if 안에서 던져야 한다. */
function rethrowsRedirect(block) {
  let ok = false
  each(block, n => {
    if (ok || !ts.isThrowStatement(n) || insideFunction(n, block)) return
    if (unconditional(n, block)) { ok = true; return }
    for (let m = n; m && m !== block; m = m.parent) {
      const p = m.parent
      if (p && ts.isIfStatement(p) && p.thenStatement === m) {
        const c = p.expression
        const negated = ts.isPrefixUnaryExpression(c) && c.operator === ts.SyntaxKind.ExclamationToken
        if (/NEXT_REDIRECT|isRedirectError|isNextRouterError/.test(c.getText()) && !negated) ok = true
        break
      }
    }
  })
  return ok
}

/** 인증 문 호출 하나의 실패가 어디까지 막는가. 덮는 범위의 끝 위치와, 함수 밖으로 새는지를 돌려준다. */
function coverOf(call, body) {
  let coverEnd = body.getEnd()
  let propagates = true
  for (let n = call; n && n !== body; n = n.parent) {
    const p = n.parent
    if (!p || !ts.isTryStatement(p) || p.tryBlock !== n || !p.catchClause) continue
    if (rethrowsRedirect(p.catchClause.block)) continue
    propagates = false
    if (!endsWithExit(p.catchClause.block)) coverEnd = Math.min(coverEnd, p.getEnd())
  }
  return { coverEnd, propagates }
}

/** `if (!x …) 끝냄` 이 있으면 그 if 의 위치. 없으면 null. */
function nullExitPos(body, name, after) {
  let pos = null
  const isNullTest = c => {
    if (ts.isParenthesizedExpression(c)) return isNullTest(c.expression)
    if (ts.isBinaryExpression(c) && c.operatorToken.kind === ts.SyntaxKind.BarBarToken) return isNullTest(c.left) || isNullTest(c.right)
    if (ts.isPrefixUnaryExpression(c) && c.operator === ts.SyntaxKind.ExclamationToken && ts.isIdentifier(c.operand) && c.operand.text === name) return true
    if (ts.isBinaryExpression(c) && [ts.SyntaxKind.EqualsEqualsToken, ts.SyntaxKind.EqualsEqualsEqualsToken].includes(c.operatorToken.kind)) {
      return ts.isIdentifier(c.left) && c.left.text === name && /^(null|undefined)$/.test(c.right.getText())
    }
    return false
  }
  each(body, n => {
    if (pos != null || !ts.isIfStatement(n) || n.getStart() < after || insideFunction(n, body)) return
    if (isNullTest(n.expression) && endsWithExit(n.thenStatement)) pos = n.getStart()
  })
  return pos
}

/** null 을 주는 문 호출 하나의 실효 세기. */
function nullableEffective(call, body) {
  let [n, p] = climb(call)
  if (p && ts.isAwaitExpression(p)) [n, p] = climb(p)
  if (p && ts.isVariableDeclaration(p) && p.initializer === n) {
    if (ts.isObjectBindingPattern(p.name) || ts.isArrayBindingPattern(p.name)) return { kind: 'full' }   // null 이면 던진다
    if (ts.isIdentifier(p.name)) {
      const at = nullExitPos(body, p.name.text, p.getEnd())
      if (at != null) return { kind: 'full', pos: at }
      // 변수째 돌려주는 래퍼는 null 을 부른 쪽에 넘긴다
      let returned = false
      each(body, r => {
        if (returned || !ts.isReturnStatement(r) || !r.expression || insideFunction(r, body)) return
        each(r, id => { if (ts.isIdentifier(id) && id.text === p.name.text) returned = true })
        if (ts.isIdentifier(r.expression) && r.expression.text === p.name.text) returned = true
      })
      return { kind: returned ? 'nullableReturn' : 'identity' }
    }
  }
  if (p && ts.isPrefixUnaryExpression(p) && p.operator === ts.SyntaxKind.ExclamationToken) {
    const [n2, p2] = climb(p)
    if (p2 && ts.isIfStatement(p2) && p2.expression === n2 && endsWithExit(p2.thenStatement)) return { kind: 'full' }
  }
  // ?. · ?? · 괄호를 지나 return 에 닿으면 null 을 부른 쪽에 넘기는 래퍼다
  let q = n, r = p
  while (r && (ts.isPropertyAccessExpression(r) || ts.isParenthesizedExpression(r) || ts.isAwaitExpression(r)
    || (ts.isBinaryExpression(r) && r.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken))) { q = r; r = r.parent }
  if (r && (ts.isReturnStatement(r) || (ts.isArrowFunction(r) && r.body === q))) return { kind: 'nullableReturn' }
  return { kind: 'identity' }
}

/** 본문의 실효 인증 문 호출 전부(소스 순서). 무조건 실행되고 기다려지는 호출만 센다. */
function gatesOf(rel, body, depth = 0) {
  const out = []
  eachIncl(body, n => {
    if (!ts.isCallExpression(n)) return
    const name = calleeName(n)
    let kind = name ? gateKind(rel, name, depth) : null
    if (!kind && VERIFIED_AUTH_CALL.test(n.expression.getText())) kind = 'identity'
    if (!kind) return
    if (!unconditional(n, body) || !awaited(n)) return
    let pos = n.getStart()
    if (kind === 'nullable') {
      const e = nullableEffective(n, body)
      kind = e.kind
      if (e.pos != null) pos = e.pos
    }
    out.push({ pos, kind, ...coverOf(n, body) })
  })
  return out.sort((a, b) => a.pos - b.pos)
}

// DB·외부 호출 판정. prisma 참조, fetch 호출, 같은 파일·import 한 그런 함수 호출(인증 문은 제외)을 센다.
// 위치는 호출이 실제로 일어나는 자리(인자를 다 계산한 뒤, 즉 그 호출의 끝)로 잡는다.
// prisma.x.findMany({ where: { propertyId: await getPropertyId() } }) 는 관문이 먼저 돈다.
const dbMemo = new Map()
function touchesDb(rel, name, depth = 0) {
  const key = `${rel}|${name}`
  if (dbMemo.has(key)) return dbMemo.get(key)
  dbMemo.set(key, false)
  const t = tableOf(rel)
  const local = t.fns.get(name)
  let res = false
  if (local) res = sensitivePositions(rel, local.body, depth + 1).length > 0
  else {
    // import 한 함수도 따라간다(같은 저장소 모듈만). 정본 관문 모듈은 판정 대상이 아니다
    const imp = t.imports.get(name)
    if (imp && !GATE_NAMES[imp.mod] && depth < 8) res = touchesDb(imp.mod, imp.name, depth + 1)
  }
  dbMemo.set(key, res)
  return res
}
function enclosingCallEnd(node, body) {
  for (let n = node.parent; n && n !== body.parent; n = n.parent) {
    if (isFnLike(n)) break
    if (ts.isCallExpression(n)) return n.getEnd()
  }
  return node.getStart()
}
function sensitivePositions(rel, body, depth = 0) {
  const out = []
  eachIncl(body, n => {
    if (ts.isIdentifier(n) && n.text === 'prisma') { out.push(enclosingCallEnd(n, body)); return }
    if (ts.isCallExpression(n)) {
      const name = calleeName(n)
      if (name === 'fetch') { out.push(n.getEnd()); return }
      const t = tableOf(rel)
      if (name && depth < 8 && (t.fns.has(name) || t.imports.has(name)) && !gateKind(rel, name) && touchesDb(rel, name, depth)) out.push(n.getEnd())
    }
  })
  return out.sort((a, b) => a - b)
}

function lineOf(rel, pos) {
  return sf(rel).getLineAndCharacterOfPosition(pos).line + 1
}

// 판정 결과: null 이면 통과, 문자열이면 위반 사유. identityOk 면 신원 호출만으로도 통과다.
function judge(rel, body, identityOk) {
  const gs = gatesOf(rel, body)
  if (gs.length === 0) return '인증 문을 부르지 않는다(조건부·await 없는 호출·안 불리는 중첩 함수 안의 호출은 세지 않는다)'
  const g = gs[0]
  const ds = sensitivePositions(rel, body)
  const before = ds.find(d => d < g.pos)
  if (before != null) return `인증 문(${lineOf(rel, g.pos)}행)보다 DB·외부 호출(${lineOf(rel, before)}행)이 먼저다`
  const after = ds.find(d => d > g.coverEnd)
  if (after != null) return `인증 문(${lineOf(rel, g.pos)}행)의 실패를 catch 가 삼키고 그 뒤 ${lineOf(rel, after)}행에서 DB·외부 호출을 한다`
  if (!identityOk && !gs.some(x => x.kind === 'full')) {
    return '로그인 여부(auth.getClaims·getUser·getAccessContext, 또는 null 확인 없는 getPropertyAccess)만 보고 정본 관문을 안 지난다. 거절·대기 계정과 영업장 소속을 못 거른다'
  }
  return null
}

const printer = ts.createPrinter({ removeComments: true })
const printed = (rel, node) => printer.printNode(ts.EmitHint.Unspecified, node, sf(rel))

/** 크론 비밀 확인. 주석을 뺀 본문에서, 비밀이 없으면 닫히는 모양이고 첫 DB·외부 호출 전에 401 을 돌려준다. */
function cronGuardOk(rel, body) {
  const text = printed(rel, body)
  if (!/process\.env\.CRON_SECRET/.test(text)) return false
  const names = ['process\\.env\\.CRON_SECRET', ...[...text.matchAll(/(?:const|let|var)\s+(\w+)\s*=\s*process\.env\.CRON_SECRET\b/g)].map(m => m[1])]
  const failClosed = names.some(nm => new RegExp(`!!\\s*${nm}\\s*&&|!\\s*${nm}\\s*\\|\\||if\\s*\\(\\s*!\\s*${nm}\\s*\\)`).test(text))
  if (!failClosed) return false
  let ret401 = null
  each(body, n => {
    if (ret401 == null && ts.isReturnStatement(n) && !insideFunction(n, body) && /\b401\b/.test(printed(rel, n))) ret401 = n.getStart()
  })
  if (ret401 == null) return false
  return !sensitivePositions(rel, body).some(d => d < ret401)
}

// ── 축 ⓐ getSession ────────────────────────────────────────────────────
let serverFiles = 0
const serverRels = []
for (const rel of [...files, 'proxy.ts']) {
  const s = sf(rel)
  if (!s) continue
  if (directiveOf(s) === 'use client') continue
  serverFiles++
  serverRels.push(rel)
  if (GET_SESSION_ALLOW[rel]) continue
  each(s, n => {
    const hit = (ts.isIdentifier(n) && n.text === 'getSession')
      || (ts.isStringLiteral(n) && n.text === 'getSession' && n.parent && ts.isElementAccessExpression(n.parent))
    if (!hit) return
    violations.push(`ⓐ ${rel}:${lineOf(rel, n.getStart())} 이 getSession 을 쓴다(호출·구조 분해·변수 경유 전부 금지). 쿠키 서명을 검증하지 않는 길이다. 정본 관문(requirePropertyAccess·getPropertyAccess) 또는 auth.getClaims() 로 바꾼다`)
  })
}

// ── 축 ⓑ 'use server' 내보낸 함수 ─────────────────────────────────────────
const found = new Map()   // 'file|함수' 를 키로 위반 사유를 담는다(기준선 대조용)
let actionCount = 0
for (const rel of files) {
  const s = sf(rel)
  if (!s || directiveOf(s) !== 'use server') continue
  const t = tableOf(rel)
  for (const d of t.defaults) {
    violations.push(`ⓑ ${rel}:${lineOf(rel, d.getStart())} 이 기본 내보내기를 쓴다. 서버 액션은 이름을 붙여 내보낸다(이름이 없으면 판정할 수 없다)`)
  }
  for (const [pub, local] of t.exports) {
    const fn = t.fns.get(local)
    const key = `${rel}|${pub}`
    if (!fn) {
      // 함수가 아닌 값의 재수출. 정본 관문 자체(예 getMyRole)면 통과, 아니면 판정할 수 없다
      if (gateKind(rel, local) === 'full') { actionCount++; continue }
      if (t.imports.has(local)) found.set(key, `ⓑ ${rel} ${pub}: 재수출한 함수의 인증 문을 확인할 수 없다`)
      continue
    }
    if (!fn.async) continue
    actionCount++
    if (PUBLIC_ACTIONS[key]) continue
    const why = judge(rel, fn.body, !!IDENTITY_ONLY[key])
    if (why) found.set(key, `ⓑ ${rel}:${lineOf(rel, fn.node.getStart())} ${pub}: ${why}`)
  }
}

// ── 축 ⓒ route.ts 처리기 ───────────────────────────────────────────────
const HTTP = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'])
let routeCount = 0
for (const rel of files) {
  if (!/(^|\/)route\.tsx?$/.test(rel)) continue
  const t = tableOf(rel)
  for (const [pub, local] of t.exports) {
    if (!HTTP.has(pub)) continue
    routeCount++
    const key = `${rel}|${pub}`
    const fn = t.fns.get(local)
    if (!fn) { found.set(key, `ⓒ ${rel} ${pub}: 처리기 본문을 찾지 못했다(재수출). 이 파일 안에서 함수로 내보낸다`); continue }
    if (PUBLIC_ROUTES[key]) continue
    if (cronGuardOk(rel, fn.body)) continue
    const why = judge(rel, fn.body, !!IDENTITY_ONLY[key])
    if (why) found.set(key, `ⓒ ${rel}:${lineOf(rel, fn.node.getStart())} ${pub}: ${why}`)
  }
}

// ── 축 ⓓ 푸시 수신자 ──────────────────────────────────────────────────
let pushSites = 0
for (const rel of serverRels) {
  const t = tableOf(rel)
  for (const [name, fn] of t.fns) {
    let sends = false, filters = false
    each(fn.body, n => {
      if (!ts.isCallExpression(n)) return
      const c = calleeName(n)
      if (c === 'sendToSubscriptions') sends = true
      if (c === 'approvedPushRecipients') filters = true
    })
    if (!sends) continue
    pushSites++
    if (filters || SELF_PUSH[`${rel}|${name}`]) continue
    violations.push(`ⓓ ${rel}:${lineOf(rel, fn.node.getStart())} ${name}: 기기로 푸시를 보내는데 approvedPushRecipients 로 거절·대기 계정을 거르지 않는다(lib/pushSend 정본)`)
  }
}

// ── 기준선 대조 ─────────────────────────────────────────────────────────
let baselined = 0
for (const [key, msg] of found) {
  if (BASELINE[key]) { baselined++; continue }
  violations.push(`${msg}. 정본 관문을 첫머리에 두거나, 정말 그래야 하는 자리면 공개 목록(신원만으로 충분하면 IDENTITY_ONLY)에 사유와 함께 올린다`)
}
for (const key of Object.keys(BASELINE)) {
  if (!found.has(key)) violations.push(`기준선이 낡았다. ${key} 는 더는 위반이 아니다. BASELINE 에서 지운다(${BASELINE[key]})`)
}
for (const key of [...Object.keys(PUBLIC_ACTIONS), ...Object.keys(PUBLIC_ROUTES), ...Object.keys(IDENTITY_ONLY), ...Object.keys(SELF_PUSH)]) {
  const [rel, name] = key.split('|')
  if (!tableOf(rel).exports.has(name)) violations.push(`허용 목록의 ${key} 를 못 찾았다. 이름이 바뀌었거나 지워졌으면 목록도 함께 고친다`)
}

console.log(`[서버 인증 문] 서버 파일 ${serverFiles}개 · 서버 액션 ${actionCount}개 · 라우트 처리기 ${routeCount}개 · 푸시 발송 ${pushSites}곳 검사 / 기준선 ${baselined}건 / 위반 ${violations.length}건`)
if (process.argv.includes('--list')) for (const [, msg] of found) console.log(`  · ${msg}`)
for (const v of violations) console.log(`  - ${v}`)
process.exit(violations.length ? 1 : 0)
