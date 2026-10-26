// window.print() 호출이 정본 인쇄 분기 안에서만 사는지 지키는 감지망. 읽기 전용, 위반이면 exit 1 (2026-10-26, 신고 2e41ddb1).
//
// 왜 필요한가. 아이폰 홈화면 앱(display: standalone)에서는 window.print() 가 아무 일도 하지 않는다
// (신고 2523aa1e). 정본은 lib/useDocPrint 의 분기 하나다.
//   if (!printNeedsShareSheet()) { window.print(); return }   그 밖은 useShareSheetPrint 로 공유 시트
// 서류 뷰어와 발급 이력 목록은 이 분기로 옮겼는데 결산 보고서의 [인쇄]만 맨 window.print() 로 남아,
// 운영자가 쓰는 홈화면 앱에서 버튼이 아예 반응하지 않았다(2e41ddb1). 같은 모양이 새로 들어와도
// 데스크톱에서는 멀쩡해 눈에 안 띈다. 그래서 호출 자리를 구조로 본다.
//
//   축 1. app·components·lib 에서 브라우저 인쇄 함수를 가리키는 모든 자리는 조건이 정확히
//          `!printNeedsShareSheet()` 인 if 문의 참 갈래 안에서 **곧바로 호출**되어야 한다.
//          가리키는 자리란 다음 넷이다.
//            window.print · window['print'] (globalThis·self·document.defaultView 도 같다,
//            (window as Window).print · (window).print · window!.print 처럼 괄호·as·! 로 감싸도 같다)
//            const { print } = window 같은 구조 분해
//            지역 이름이 없는 맨 print (전역 인쇄 함수)
//          변수에 담기(const p = window.print), 넘기기(onClick={window.print}), bind 는 곧바로 호출이
//          아니라서 분기 안이어도 위반이다. 지역에서 선언한 print(라우트의 page.pdf 래퍼 등)는 세지 않는다.
//   축 2. 그 파일은 printNeedsShareSheet 를 '@/lib/useDocPrint' 에서 가져오고 useShareSheetPrint 를
//          부른다(거짓 갈래의 운반로가 실제로 있다).
//
// 주석 속 window.print() 는 세지 않는다(TypeScript 구문 트리로 본다).
// 실행: node scripts/check-print-branch.mjs
import ts from 'typescript'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const SCAN_ROOTS = ['app', 'components', 'lib']
const PRINT_OWNERS = new Set(['window', 'globalThis', 'self'])
const NAME = 'print'

function walk(dir, out = []) {
  let entries
  try { entries = readdirSync(dir) } catch { return out }
  for (const e of entries) {
    if (e === 'node_modules' || e.startsWith('.')) continue
    const p = join(dir, e)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (/\.(tsx?|jsx?|mjs)$/.test(p)) out.push(p)
  }
  return out
}

/** 괄호·as·satisfies·!·<T> 를 벗긴다. (window as Window).print() 같은 우회가 이름만 감싸 빠지지 않게. */
function unwrap(n) {
  while (ts.isParenthesizedExpression(n) || ts.isAsExpression(n) || ts.isNonNullExpression(n)
    || ts.isTypeAssertionExpression(n) || (ts.isSatisfiesExpression && ts.isSatisfiesExpression(n))) n = n.expression
  return n
}
/** window · globalThis · self, 그리고 document.defaultView(창 객체를 가리키는 다른 이름). */
function isOwner(n) {
  const u = unwrap(n)
  if (ts.isIdentifier(u)) return PRINT_OWNERS.has(u.text)
  return ts.isPropertyAccessExpression(u) && u.name.text === 'defaultView'
    && ts.isIdentifier(unwrap(u.expression)) && unwrap(u.expression).text === 'document'
}

/** window.print · window['print'] */
const isOwnerPrintAccess = (n) =>
  (ts.isPropertyAccessExpression(n) && n.name.text === NAME && isOwner(n.expression))
  || (ts.isElementAccessExpression(n) && isOwner(n.expression)
    && ts.isStringLiteralLike(n.argumentExpression) && n.argumentExpression.text === NAME)

/** 이름 자리(선언·속성 이름·타입)가 아니라 값을 읽는 자리의 식별자인가. */
function isValueIdentifier(n) {
  const p = n.parent
  if (!p) return false
  if (ts.isPropertyAccessExpression(p) && p.name === n) return false
  if (ts.isQualifiedName(p) || ts.isTypeReferenceNode(p)) return false
  if ((ts.isVariableDeclaration(p) || ts.isFunctionDeclaration(p) || ts.isFunctionExpression(p)
    || ts.isParameter(p) || ts.isClassDeclaration(p) || ts.isPropertyAssignment(p)
    || ts.isPropertyDeclaration(p) || ts.isMethodDeclaration(p) || ts.isPropertySignature(p)
    || ts.isMethodSignature(p) || ts.isGetAccessor(p) || ts.isSetAccessor(p) || ts.isEnumMember(p)
    || ts.isInterfaceDeclaration(p) || ts.isTypeAliasDeclaration(p) || ts.isLabeledStatement(p)
    || ts.isJsxAttribute(p) || ts.isImportClause(p) || ts.isNamespaceImport(p)) && p.name === n) return false
  if (ts.isBindingElement(p) && (p.name === n || p.propertyName === n)) return false
  if (ts.isImportSpecifier(p) || ts.isExportSpecifier(p)) return false
  return true
}

/** 바인딩 이름(식별자·구조 분해)이 print 를 선언하는가. */
function bindsName(nameNode) {
  if (!nameNode) return false
  if (ts.isIdentifier(nameNode)) return nameNode.text === NAME
  if (ts.isObjectBindingPattern(nameNode) || ts.isArrayBindingPattern(nameNode)) {
    return nameNode.elements.some(el => !ts.isOmittedExpression(el) && bindsName(el.name))
  }
  return false
}

function statementsDeclare(statements) {
  for (const st of statements) {
    if (ts.isVariableStatement(st) && st.declarationList.declarations.some(d => bindsName(d.name))) return true
    if ((ts.isFunctionDeclaration(st) || ts.isClassDeclaration(st)) && st.name?.text === NAME) return true
    if (ts.isImportDeclaration(st) && st.importClause) {
      const c = st.importClause
      if (c.name?.text === NAME) return true
      const nb = c.namedBindings
      if (nb && ts.isNamespaceImport(nb) && nb.name.text === NAME) return true
      if (nb && ts.isNamedImports(nb) && nb.elements.some(e => e.name.text === NAME)) return true
    }
  }
  return false
}

/** 이 식별자가 닿는 범위에 지역 print 선언이 있는가(있으면 전역 인쇄 함수가 아니다). */
function hasLocalBinding(n) {
  for (let cur = n.parent; cur; cur = cur.parent) {
    if (ts.isFunctionLike(cur)) {
      if (cur.parameters?.some(pr => bindsName(pr.name))) return true
      if ((ts.isFunctionExpression(cur) || ts.isFunctionDeclaration(cur)) && cur.name?.text === NAME) return true
    }
    if (ts.isBlock(cur) || ts.isSourceFile(cur) || ts.isModuleBlock(cur) || ts.isCaseClause(cur) || ts.isDefaultClause(cur)) {
      if (statementsDeclare(cur.statements)) return true
    }
    if ((ts.isForStatement(cur) || ts.isForOfStatement(cur) || ts.isForInStatement(cur))
      && cur.initializer && ts.isVariableDeclarationList(cur.initializer)
      && cur.initializer.declarations.some(d => bindsName(d.name))) return true
    if (ts.isCatchClause(cur) && bindsName(cur.variableDeclaration?.name)) return true
  }
  return false
}

/** const { print } = window · const { print: p } = globalThis */
function isOwnerDestructure(n) {
  if (!ts.isBindingElement(n)) return false
  const key = n.propertyName ?? n.name
  if (!ts.isIdentifier(key) || key.text !== NAME) return false
  const pattern = n.parent
  const decl = pattern?.parent
  return !!decl && ts.isVariableDeclaration(decl) && decl.name === pattern && !!decl.initializer && isOwner(decl.initializer)
}

/** 호출이 `if (!printNeedsShareSheet())` 의 참 갈래 안에 있는가. 가장 가까운 if 문들을 거슬러 본다. */
function insideCanonBranch(node) {
  let child = node
  for (let cur = node.parent; cur; child = cur, cur = cur.parent) {
    if (ts.isFunctionLike(cur)) return false   // 분기 밖에서 만든 함수에 감싸 두는 우회를 막는다
    if (!ts.isIfStatement(cur) || cur.thenStatement !== child) continue
    const c = cur.expression
    if (ts.isPrefixUnaryExpression(c) && c.operator === ts.SyntaxKind.ExclamationToken
      && ts.isCallExpression(c.operand) && ts.isIdentifier(c.operand.expression)
      && c.operand.expression.text === 'printNeedsShareSheet' && c.operand.arguments.length === 0) return true
  }
  return false
}

/** 가리키는 자리가 곧바로 호출되고 그 호출이 정본 분기 안인가. */
function calledInCanonBranch(ref) {
  const call = ref.parent
  return !!call && ts.isCallExpression(call) && call.expression === ref && insideCanonBranch(call)
}

const violations = []
let calls = 0
const files = SCAN_ROOTS.flatMap(r => walk(r))
for (const file of files) {
  const src = readFileSync(file, 'utf8')
  if (!/\bprint\b/.test(src)) continue
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true,
    file.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
  let fileHasRef = false
  const flag = (n, why) => {
    const line = sf.getLineAndCharacterOfPosition(n.getStart()).line + 1
    violations.push(`${file}:${line} 의 ${n.getText().slice(0, 60)} ${why}. 아이폰 홈화면 앱에서는 브라우저 인쇄가 아무 일도 하지 않는다. `
      + "lib/useDocPrint 의 if (!printNeedsShareSheet()) { window.print(); return } 와 useShareSheetPrint 를 쓴다")
  }
  const visit = (n) => {
    let ref = null
    if (isOwnerPrintAccess(n)) ref = n
    else if (ts.isIdentifier(n) && n.text === NAME && isValueIdentifier(n) && !hasLocalBinding(n)) ref = n
    if (ref) {
      fileHasRef = true
      if (calledInCanonBranch(ref)) calls++
      else flag(ref, ts.isCallExpression(ref.parent) && ref.parent.expression === ref
        ? '가 정본 분기 밖에서 불린다' : '를 곧바로 부르지 않고 담거나 넘긴다')
    } else if (isOwnerDestructure(n)) {
      fileHasRef = true
      flag(n, '로 인쇄 함수를 꺼내 담는다')
    }
    ts.forEachChild(n, visit)
  }
  visit(sf)
  if (!fileHasRef) continue
  if (!/import\s*\{[^}]*\bprintNeedsShareSheet\b[^}]*\}\s*from\s*['"]@\/lib\/useDocPrint['"]/.test(src)) {
    violations.push(`${file} 는 브라우저 인쇄를 부르는데 printNeedsShareSheet 를 '@/lib/useDocPrint' 에서 가져오지 않는다. 판정을 따로 만들면 두 벌이 된다`)
  }
  if (!/\buseShareSheetPrint\s*\(/.test(src)) {
    violations.push(`${file} 는 브라우저 인쇄를 부르는데 useShareSheetPrint 를 안 부른다. 홈화면 앱 갈래의 운반로가 없다`)
  }
}

if (calls === 0) violations.push('정본 분기 안의 window.print() 를 하나도 못 찾았다. 서류 뷰어에는 있어야 한다. 경로가 어긋났거나 판정이 깨졌다')

if (violations.length) {
  console.error(`\n[인쇄 분기] 파일 ${files.length}개 · 정본 호출 ${calls}곳 / 위반 ${violations.length}건`)
  for (const v of violations) console.error('  - ' + v)
  process.exit(1)
}
console.log(`[인쇄 분기] 파일 ${files.length}개 · window.print() ${calls}곳 전부 정본 분기 안 / 위반 0건`)
