// 서류 메일 문안 회귀 — 실행: npx tsx scripts/test-doc-mail-render.ts
//
// 여기서 고정하는 것 넷(2026-08-25 운영자 승인 설계).
//   · **미리보기 = 실발송** — 렌더는 renderDocMail 하나뿐이고, 프레임(헤더·첨부 상자·푸터)은
//     어느 모드에서도 프레임 몫이다. 첨부 상자는 실제 첨부 파일명에서만 그려진다.
//   · **변수 치환은 값을 이스케이프해서 넣는다** — 입주자 이름에 태그가 섞여 있어도 HTML 이 되지
//     않는다. 오타 변수는 저장 게이트(findUnknownVars)가 막는다.
//   · **새니타이즈는 allowlist** — script·이벤트 핸들러·img·외부 리소스(url())·javascript: 가
//     저장을 거쳐도 렌더를 거쳐도 살아남지 못한다.
//   · **깨진 값은 기본으로 폴백** — DB 의 docMailTemplate 이 무엇이든 발송 실패를 만들지 않는다.
import {
  parseDocMailTemplate, findUnknownVars, sanitizeDocMailHtml, renderDocMail,
  DOC_MAIL_DEFAULT, DOC_MAIL_LIMITS, type DocMailTemplate,
} from '../lib/docMail'

let pass = 0
const fails: string[] = []
function ok(name: string, cond: boolean, detail = '') {
  if (cond) { pass++; return }
  fails.push(`${name}${detail ? ' — ' + detail : ''}`)
}
function eq(name: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected)
  ok(name, a === e, `기대 ${e} / 실제 ${a}`)
}

const DATA = {
  propertyName: '더스테이 제기역점',
  propertyPhone: '02-000-0000',
  tenantName: '김테스트',
  docTitles: ['계약서', '입실료 납부 확인서'],
  attachmentNames: ['김테스트 계약서 2026.08.01.pdf', '김테스트 입실료 납부 확인서 2026.08.20.pdf'],
}

// ── 기본 문안(널 템플릿) ────────────────────────────────────────────────
{
  const r = renderDocMail(DOC_MAIL_DEFAULT, DATA)
  eq('기본 제목', r.subject, '[더스테이 제기역점] 서류를 보내 드립니다')
  ok('본문에 인사', r.text.includes('안녕하세요. 더스테이 제기역점입니다.'))
  ok('첨부 상자에 건수', r.html.includes('첨부 2건'))
  ok('첨부 상자에 실제 파일명', r.html.includes('김테스트 계약서 2026.08.01.pdf'))
  ok('전화가 있으면 번호 안내', r.text.includes('전화 02-000-0000'))
  ok('푸터 워드마크', r.html.includes('stay') && r.html.includes('eum') && r.text.includes('made with stayeum'))
  ok('헤더에 영업장명', r.html.includes('더스테이 제기역점'))
  const noPhone = renderDocMail(DOC_MAIL_DEFAULT, { ...DATA, propertyPhone: null })
  ok('전화가 없으면 회신 안내', noPhone.text.includes('이 메일에 회신해 주세요'))
  const noAttach = renderDocMail(DOC_MAIL_DEFAULT, { ...DATA, attachmentNames: [] })
  ok('첨부가 없으면 상자를 안 그린다', !noAttach.html.includes('첨부 0건'))
}

// ── 변수 치환 ──────────────────────────────────────────────────────────
{
  const tpl: DocMailTemplate = {
    ...DOC_MAIL_DEFAULT,
    subject: '{영업장명} 안내', bodyText: '{이름} 님, {서류목록}을 보냅니다.',
  }
  const r = renderDocMail(tpl, DATA)
  eq('제목 치환', r.subject, '더스테이 제기역점 안내')
  ok('본문 치환(이름·서류목록)', r.text.includes('김테스트 님, 계약서, 입실료 납부 확인서을 보냅니다.'))
  // 값이 태그를 만들 수 없다 — 이스케이프한 값이 들어간다.
  const evil = renderDocMail(tpl, { ...DATA, tenantName: '<b>주입</b>' })
  ok('이름의 태그는 이스케이프', !evil.html.includes('<b>주입</b>') && evil.html.includes('&lt;b&gt;'))
}

// ── 오타 변수 검출(저장 게이트) ─────────────────────────────────────────
{
  eq('지원 변수는 통과', findUnknownVars('{영업장명} {이름} {서류목록}', 'body'), [])
  eq('오타 변수 검출', findUnknownVars('{입주자멍} 님', 'body'), ['{입주자멍}'])
  eq('제목의 {이름}은 미지원(잠금화면 원칙)', findUnknownVars('{이름} 님 서류', 'subject'), ['{이름}'])
  eq('CSS 중괄호는 변수가 아니다', findUnknownVars('<span style="x">{color:#333}</span>', 'body'), [])
  eq('같은 오타는 한 번만', findUnknownVars('{호실} {호실}', 'body'), ['{호실}'])
}

// ── 새니타이즈 ─────────────────────────────────────────────────────────
{
  ok('script 제거', !sanitizeDocMailHtml('<p>a</p><script>alert(1)</script>').includes('script'))
  ok('이벤트 핸들러 제거', !sanitizeDocMailHtml('<p onclick="x()">a</p>').includes('onclick'))
  ok('img 제거(외부 이미지 금지)', !sanitizeDocMailHtml('<img src="https://x.com/a.png">').includes('img'))
  ok('style 의 url() 제거', !sanitizeDocMailHtml('<div style="background:url(https://x.com/a)">a</div>').includes('url('))
  ok('javascript: href 제거', !sanitizeDocMailHtml('<a href="javascript:alert(1)">a</a>').includes('javascript'))
  ok('iframe 제거', !sanitizeDocMailHtml('<iframe src="https://x.com"></iframe>').includes('iframe'))
  const table = sanitizeDocMailHtml('<table cellpadding="4"><tr><td style="color:#A03C2E;padding:4px" bgcolor="#F2ECE3">셀</td></tr></table>')
  ok('표·스타일·bgcolor 는 남는다', table.includes('<table') && table.includes('color:#A03C2E') && table.includes('bgcolor'))
  ok('mailto 링크는 남는다', sanitizeDocMailHtml('<a href="mailto:a@b.c">메일</a>').includes('mailto:a@b.c'))
  // 태그 불균형은 파서가 재직렬화하며 닫는다 — 프레임 밖으로 새는 열린 태그가 없다.
  const broken = sanitizeDocMailHtml('<td><b>깨짐')
  eq('깨진 마크업은 닫혀서 나온다', (broken.match(/<b>/g) ?? []).length, (broken.match(/<\/b>/g) ?? []).length)
}

// ── 고급(HTML) 모드 렌더 ───────────────────────────────────────────────
{
  const tpl: DocMailTemplate = {
    mode: 'html', subject: null, bodyText: null, closingText: null,
    bodyHtml: '<p style="color:#1F1A17">{이름} 님 <strong>안내</strong></p><script>x()</script>',
  }
  const r = renderDocMail(tpl, DATA)
  ok('HTML 본문이 들어간다', r.html.includes('<strong>안내</strong>'))
  ok('HTML 모드에서도 변수 치환', r.html.includes('김테스트'))
  ok('렌더 직전 새니타이즈(이중 방어)', !r.html.includes('script'))
  ok('첨부 상자는 여전히 프레임 몫', r.html.includes('첨부 2건'))
  ok('plain text 병행이 태그 없이 나온다', r.text.includes('김테스트 님 안내') && !r.text.includes('<strong>'))
}

// ── 파싱 폴백 ──────────────────────────────────────────────────────────
{
  eq('널은 기본', parseDocMailTemplate(null), DOC_MAIL_DEFAULT)
  eq('문자열 쓰레기도 기본', parseDocMailTemplate('junk'), DOC_MAIL_DEFAULT)
  eq('배열도 기본', parseDocMailTemplate([1, 2]), DOC_MAIL_DEFAULT)
  eq('빈 HTML 의 html 모드는 text 로 강등', parseDocMailTemplate({ mode: 'html', bodyHtml: '  ' }).mode, 'text')
  eq('부분 커스터마이즈(제목만)', parseDocMailTemplate({ mode: 'text', subject: '제목' }),
    { mode: 'text', subject: '제목', bodyText: null, closingText: null, bodyHtml: null })
  const long = parseDocMailTemplate({ mode: 'text', subject: 'a'.repeat(999) })
  eq('제목 상한', long.subject?.length, DOC_MAIL_LIMITS.subject)
}

// ── 제목 안전 ──────────────────────────────────────────────────────────
{
  const r = renderDocMail({ ...DOC_MAIL_DEFAULT, subject: '줄바꿈\r\n주입\n시도' }, DATA)
  eq('제목의 CRLF 는 공백으로(헤더 주입 방어)', r.subject, '줄바꿈 주입 시도')
}

console.log(`\n서류 메일 문안 회귀: ${pass} 통과 / ${fails.length} 실패`)
for (const f of fails) console.log('  - ' + f)
if (fails.length > 0) process.exit(1)
