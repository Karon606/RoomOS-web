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
  eq('기본 제목은 무엇이 왔는지부터', r.subject, '계약서 및 입실료 납부 확인서 송부')
  ok('본문에 인사', r.text.includes('안녕하세요. 더스테이 제기역점입니다.'))
  ok('첨부 상자에 건수', r.html.includes('첨부한 서류 2건'))
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
  ok('첨부 상자는 여전히 프레임 몫', r.html.includes('첨부한 서류 2건'))
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

// ── 봉투 자립 ──────────────────────────────────────────────────────────
// 메일은 나가면 못 되돌린다. 외부 주소를 하나라도 물고 나가면 수신함이 막거나(이미지 차단),
// 원격 로드가 열람 추적으로 읽히거나, 그 주소가 죽는 날 과거 발송분이 통째로 깨진다.
// 서류 쪽에는 같은 축의 그물이 이미 있다(check-print-selfcontained). 메일에도 건다.
{
  const r = renderDocMail(DOC_MAIL_DEFAULT, DATA)
  const urls = [...r.html.matchAll(/(?:src|href)\s*=\s*"([^"]*)"/g)].map(m => m[1])
    .concat([...r.html.matchAll(/url\(([^)]*)\)/g)].map(m => m[1].replace(/['"]/g, '')))
  ok('바깥 주소를 물고 나가지 않는다', urls.every(u => /^(cid:|data:)/.test(u)), urls.join(' , '))
  ok('http 문자열 자체가 없다', !/https?:\/\//.test(r.html))
}

// ── 푸터 서명 ──────────────────────────────────────────────────────────
// 종이 푸터를 봉투로 옮긴 자리다. 신원번호가 실린 서류를 보내면서 사업자 정보가 하나도 없으면
// 처음 받는 사람이 피싱과 가릴 근거가 발신자 주소뿐이다.
{
  const r = renderDocMail(DOC_MAIL_DEFAULT, {
    ...DATA,
    signature: { registrationNo: '718-08-03079', ceoName: '홍길동', address: '서울 동대문구 왕산로16길 9' },
  })
  ok('사업자등록번호', r.html.includes('사업자등록번호 718-08-03079'))
  ok('대표는 같은 줄에', r.html.includes('사업자등록번호 718-08-03079 · 대표 홍길동'))
  ok('주소와 전화도 같은 줄에', r.html.includes('서울 동대문구 왕산로16길 9 · 02-000-0000'))
  ok('plain text 에도 서명', r.text.includes('사업자등록번호 718-08-03079 · 대표 홍길동'))
  // 영업장이 먼저, stayeum 이 나중. 자리가 지위를 만든다.
  ok('영업장 서명이 stayeum 보다 앞에 온다',
    r.html.indexOf('사업자등록번호') < r.html.indexOf('made with'))
}
{
  // 사업자 정보를 아직 안 채운 영업장 — 상호 한 줄만 서고 빈 줄이 안 생긴다.
  const r = renderDocMail(DOC_MAIL_DEFAULT, { ...DATA, signature: null })
  ok('서명이 없으면 사업자 줄도 없다', !r.html.includes('사업자등록번호'))
  ok('그래도 stayeum 은 남는다', r.html.includes('made with'))
}

// ── 푸터 로고 ──────────────────────────────────────────────────────────
{
  const r0 = renderDocMail(DOC_MAIL_DEFAULT, DATA)
  ok('로고가 없으면 img 가 하나도 없다', !r0.html.includes('<img'))

  const r = renderDocMail(DOC_MAIL_DEFAULT, { ...DATA, logo: { src: 'cid:property-logo', px: 40 } })
  ok('넘긴 src 를 그대로 쓴다', r.html.includes('src="cid:property-logo"'))
  // 아웃룩 워드 엔진은 CSS width 를 무시한다 — 속성이 실제 방어선이다.
  ok('크기를 속성으로도 박는다', r.html.includes('width="40" height="40"'))
  // 바로 옆에 영업장명이 글자로 있다. alt 에 이름을 또 넣으면 차단 시 두 번 뜬다.
  ok('alt 는 비운다', r.html.includes('alt=""'))
  ok('로고는 푸터 몫이라 헤더보다 뒤에 온다',
    r.html.indexOf('<img') > r.html.indexOf('border-bottom:2px solid'))
  ok('plain text 는 로고를 모른다', !r.text.includes('cid:') && !r.text.includes('img'))
}
{
  // 운영자가 고급 모드에서 인라인 자산을 참조할 길이 없어야 한다.
  const r = renderDocMail(
    { ...DOC_MAIL_DEFAULT, mode: 'html', bodyHtml: '<p>본문 <img src="cid:property-logo"></p>' },
    DATA,
  )
  ok('본문 HTML 은 여전히 img 를 못 만든다', !r.html.includes('<img'))
}

// ── 서류 이름 ──────────────────────────────────────────────────────────
// 파일명은 파일명이지 서류 이름이 아니다. 둘을 짝지어 그린다.
{
  const r = renderDocMail(DOC_MAIL_DEFAULT, DATA)
  ok('서류 이름이 상자에 선다', r.html.includes('계약서'))
  ok('파일명도 함께', r.html.includes('김테스트 계약서 2026.08.01.pdf'))
  ok('plain text 는 이름과 파일명을 한 줄에',
    r.text.includes('- 계약서 (김테스트 계약서 2026.08.01.pdf)'))
}

// ── 제목 요약 ──────────────────────────────────────────────────────────
// 잠금화면 앞자리를 '무엇이 왔는가'에 쓴다. 영업장명은 발신자 자리에 이미 떠 있다.
{
  const sub = (titles: string[]) => renderDocMail(DOC_MAIL_DEFAULT, { ...DATA, docTitles: titles }).subject
  eq('한 건은 이름 그대로', sub(['계약서']), '계약서 송부')
  eq('두 건은 및 으로 잇는다', sub(['계약서', '실거주 확인서']), '계약서 및 실거주 확인서 송부')
  eq('세 건부터는 외 N건', sub(['계약서', '실거주 확인서', '보증금 영수증']), '계약서 외 2건 송부')
  eq('네 건도 같은 꼴', sub(['가', '나', '다', '라']), '가 외 3건 송부')
  eq('서류를 못 세면 무난한 말로', sub([]), '서류 송부')
  // 영업장명을 앞에 붙이고 싶은 영업장은 환경설정에서 넣는다 — 변수가 살아 있어야 한다.
  eq('영업장명 변수도 계속 쓴다',
    renderDocMail({ ...DOC_MAIL_DEFAULT, subject: '[{영업장명}] {서류요약} 송부' }, DATA).subject,
    '[더스테이 제기역점] 계약서 및 입실료 납부 확인서 송부')
}

console.log(`\n서류 메일 문안 회귀: ${pass} 통과 / ${fails.length} 실패`)
for (const f of fails) console.log('  - ' + f)
if (fails.length > 0) process.exit(1)
