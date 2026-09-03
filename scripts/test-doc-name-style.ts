// 서류 성명 표기 이어받기 회귀 — 실행: npx tsx scripts/test-doc-name-style.ts
//
// 여기서 고정하는 것 넷(운영자 확정 2026-08-29).
//   · **한 사람의 서류는 같은 표기로 나간다** — 계약서를 영문으로 뽑았으면 실거주 확인서도 영문이
//     기본이다. 두 종이가 다른 이름을 달면 제출처에서 같은 사람 것으로 안 읽힌다.
//   · **손으로 고른 것이 국적 추정보다 세다** — 외국인이어도 한글로 내기로 정했으면 그 결정이 이어진다.
//   · **외국인은 영문이 기본** — 다만 영문 이름이 없으면 고를 수 없으니 한글로 떨어진다.
//   · **파일 이름도 표기를 따라간다** — 이름만 로마자이고 서류명이 한글이면 절반은 못 읽는 파일이 된다.
import {
  resolveDocNameStyle, docNameStyleConflict, isKoreanNationality, showsForeignFields, isForeignForDocuments, DEFAULT_DOC_NAME_STYLE,
  asDocNameStyle,
} from '../lib/documentName'
import { docFileLabel, DOC_TYPE_FILE_LABEL, DOC_TYPE_FILE_LABEL_EN } from '../lib/docBundle'

let pass = 0
const fails: string[] = []
function eq(name: string, got: unknown, want: unknown) {
  if (JSON.stringify(got) === JSON.stringify(want)) { pass++; return }
  fails.push(`${name}: 기대 ${JSON.stringify(want)} / 실제 ${JSON.stringify(got)}`)
}

const ALL = ['ko', 'en', 'native'] as const
const KO_ONLY = ['ko'] as const

// ── 국적 판정 ──────────────────────────────────────────────────────
eq('대한민국은 내국인', isKoreanNationality('대한민국'), true)
eq('한국도 내국인', isKoreanNationality('한국'), true)
eq('영문 표기도 내국인', isKoreanNationality('Republic of Korea'), true)
// 비어 있으면 내국인으로 본다 — 종전 거동(전원 한글)이 그대로 유지되어야 한다.
eq('국적이 비면 내국인으로 본다', isKoreanNationality(null), true)
eq('공백만 있어도 내국인', isKoreanNationality('   '), true)
eq('베트남은 외국인', isKoreanNationality('베트남'), false)
eq('우즈베키스탄도 외국인', isKoreanNationality('우즈베키스탄'), false)

// 폼의 외국인 칸 노출 — 서류 판정과 이름 변형은 같은 답, 빈 값만 일부러 다르다.
eq('폼: 대한민국은 칸 숨김', showsForeignFields('대한민국'), false)
eq('폼: 한국도 칸 숨김', showsForeignFields('한국'), false)
eq('폼: Korea 도 칸 숨김', showsForeignFields('Republic of Korea'), false)
eq('폼: 베트남은 칸 노출', showsForeignFields('베트남'), true)
eq('폼: 국적이 비면 칸 노출(서류와 반대, 아직 안 고른 것)', showsForeignFields(null), true)
eq('폼: 공백만 있어도 칸 노출', showsForeignFields('   '), true)

// ── 외국인 판정(국적 OR 외국인등록번호) ────────────────────────────
eq('국적 비한국이면 외국인', isForeignForDocuments({ nationality: '중국' }), true)
eq('국적이 한국이어도 등록번호가 있으면 외국인', isForeignForDocuments({ nationality: '대한민국', hasForeignRegNo: true }), true)
eq('국적을 안 골랐어도 등록번호가 있으면 외국인', isForeignForDocuments({ hasForeignRegNo: true }), true)
eq('국적 한국 + 번호 없음은 내국인', isForeignForDocuments({ nationality: '대한민국' }), false)
eq('국적을 안 골랐고 번호도 없으면 내국인(종전 거동)', isForeignForDocuments({}), false)

// ── 사람 단위 기본 표기(Tenant.docNameStyle) ──────────────────────
// 자리는 형제 서류 아래, 국적 추정 위다(운영자 결정 2026-09-03).
eq('사람 단위 값이 국적 추정을 이긴다',
  resolveDocNameStyle({ tenant: 'ko', nationality: '중국', available: ALL }), 'ko')
eq('사람 단위 값이 없으면 종전대로 국적 추정',
  resolveDocNameStyle({ tenant: null, nationality: '중국', available: ALL }), 'en')
eq('이 서류에 저장된 표기가 사람 단위 값을 이긴다',
  resolveDocNameStyle({ saved: 'en', tenant: 'ko', nationality: '중국', available: ALL }), 'en')
eq('앞 서류가 쓴 표기도 사람 단위 값을 이긴다',
  resolveDocNameStyle({ siblings: ['en'], tenant: 'ko', nationality: '중국', available: ALL }), 'en')
eq('후보에 없는 사람 단위 값은 무시하고 아래로 내려간다',
  resolveDocNameStyle({ tenant: 'en', nationality: '중국', available: KO_ONLY }), 'ko')
eq('사람 단위로 현지를 못박을 수도 있다',
  resolveDocNameStyle({ tenant: 'native', nationality: '베트남', available: ALL }), 'native')
eq('내국인도 사람 단위로 영문을 못박을 수 있다',
  resolveDocNameStyle({ tenant: 'en', nationality: '대한민국', available: ALL }), 'en')
eq('등록번호만으로 외국인이 되면 영문이 기본',
  resolveDocNameStyle({ nationality: null, hasForeignRegNo: true, available: ALL }), 'en')
eq('사람 단위 값이 그 외국인 기본을 덮는다',
  resolveDocNameStyle({ tenant: 'ko', nationality: null, hasForeignRegNo: true, available: ALL }), 'ko')
eq('화이트리스트 밖 값은 asDocNameStyle 가 버린다', asDocNameStyle('KO'), undefined)
eq('빈 문자열도 버린다', asDocNameStyle(''), undefined)

// ── 기본 표기 ──────────────────────────────────────────────────────
// 1순위: 이 서류에 저장된 값. 국적이 무엇이든 이긴다.
eq('저장된 값이 가장 세다',
  resolveDocNameStyle({ saved: 'ko', siblings: ['en'], nationality: '베트남', available: ALL }), 'ko')
// 2순위: 같은 계약의 다른 서류. 계약서를 영문으로 뽑았으면 이 서류도 영문이다.
eq('앞 서류의 표기를 이어받는다',
  resolveDocNameStyle({ siblings: ['en'], available: ALL }), 'en')
eq('형제가 여럿이면 가장 최근 것',
  resolveDocNameStyle({ siblings: ['native', 'en', 'ko'], available: ALL }), 'native')
// 손으로 고른 것이 국적 추정보다 세다 — 외국인이어도 한글로 내기로 했으면 이어진다.
eq('외국인이어도 앞에서 한글을 골랐으면 한글',
  resolveDocNameStyle({ siblings: ['ko'], nationality: '베트남', available: ALL }), 'ko')
// 3순위: 국적.
eq('외국인은 영문이 기본',
  resolveDocNameStyle({ nationality: '베트남', available: ALL }), 'en')
eq('내국인은 한글이 기본',
  resolveDocNameStyle({ nationality: '대한민국', available: ALL }), 'ko')
eq('국적을 모르면 한글', resolveDocNameStyle({ available: ALL }), DEFAULT_DOC_NAME_STYLE)
// 영문 이름을 안 적어 뒀으면 외국인이어도 영문을 못 고른다.
eq('고를 수 없는 표기는 기본값이 안 된다',
  resolveDocNameStyle({ nationality: '베트남', available: KO_ONLY }), 'ko')
eq('저장된 값이 후보에 없으면 아래로',
  resolveDocNameStyle({ saved: 'native', siblings: ['en'], available: ALL.filter(s => s !== 'native') }), 'en')
eq('형제 값이 후보에 없으면 건너뛴다',
  resolveDocNameStyle({ siblings: ['native', 'en'], available: ['ko', 'en'] }), 'en')

// ── 되묻기 ─────────────────────────────────────────────────────────
// 앞이 있는데 다를 때만 묻는다.
eq('앞과 다르면 앞의 표기를 알려준다', docNameStyleConflict('ko', ['en']), 'en')
eq('앞과 같으면 안 묻는다', docNameStyleConflict('en', ['en']), null)
eq('처음 뽑는 서류는 안 묻는다', docNameStyleConflict('en', []), null)
eq('형제가 여럿이면 가장 최근 것과 견준다', docNameStyleConflict('ko', ['native', 'en']), 'native')

// ── 파일 이름 ──────────────────────────────────────────────────────
eq('영문 표기면 영문 이름', docFileLabel('residence', 'en'), 'Proof of Residence')
eq('한글 표기면 한글 이름', docFileLabel('residence', 'ko'), '실거주확인서')
// 현지 표기는 그 나라 글자라 파일명에 섞으면 시스템마다 깨진다 — 서류명은 한글로 둔다.
eq('현지 표기는 서류명을 안 바꾼다', docFileLabel('residence', 'native'), '실거주확인서')
eq('계약서 영문', docFileLabel('contract', 'en'), 'Residence Agreement')
eq('납부 확인서 영문', docFileLabel('rent', 'en'), 'Rent Payment Certificate')
eq('보증금 영수증 영문', docFileLabel('deposit', 'en'), 'Deposit Receipt')
// 계약서와 실거주 확인서가 앞 낱말까지 같으면 파일 목록에서 얼핏 안 갈린다.
eq('계약서와 실거주 확인서는 첫 낱말이 다르다',
  DOC_TYPE_FILE_LABEL_EN.contract.split(' ')[0] === DOC_TYPE_FILE_LABEL_EN.residence.split(' ')[0], false)
eq('네 서류 영문 이름이 서로 다르다',
  new Set(Object.values(DOC_TYPE_FILE_LABEL_EN)).size, 4)
eq('한글 이름은 그대로다', DOC_TYPE_FILE_LABEL.rent, '입실료납부확인서')


// ── 계약서 이어받기 ── 서명 전에는 앞 서류를 잇고, 서명 뒤에는 그때 값을 지킨다(2026-08-30)
//
// 계약서만 이어받기가 빠져 있었다. 발급 순서에서 두 번째라(보증금 영수증 → 계약서 →
// 납부 확인서 → 실거주 확인서) 여기서 끊기면 뒤로도 안 간다.
//
// **서명 뒤에는 안 잇는다.** 표기를 안 고른 채 한글로 서명받은 계약에 나중에 이어받기가
// 걸리면 입주자가 서명한 종이와 화면이 갈린다. lib/contractData 가 signatureSignedAt 으로 가른다.
{
  const both: DocNameStyle[] = ['ko', 'en']
  // 서명 전 — 저장값이 없으면 앞 서류(en)를 잇는다.
  eq('계약서: 서명 전에는 앞 서류를 잇는다',
    resolveDocNameStyle({ saved: undefined, siblings: ['en'], nationality: '대한민국', available: both }), 'en')
  // 저장값이 있으면 그것이 이긴다 — 운영자가 이 계약서에서 이미 골랐다는 뜻이다.
  eq('계약서: 저장값이 앞 서류를 이긴다',
    resolveDocNameStyle({ saved: 'ko', siblings: ['en'], nationality: '베트남', available: both }), 'ko')
  // 서명 뒤 분기는 resolveDocNameStyle 을 아예 안 탄다 — 그 계약은 저장값(없으면 한글)이 그대로다.
  // 여기서는 그 값이 무엇인지만 고정한다.
  eq('계약서: 서명 뒤 저장값 없으면 한글', DEFAULT_DOC_NAME_STYLE, 'ko')
}

// ── 발급본 표기 저장 ── 목록에서 다시 보낼 때 파일 이름이 그 종이를 따라간다(2026-08-30)
//
// 종전에는 목록 화면이 파일 이름을 늘 한글로 조립했다. 발급본이 어떤 표기로 나갔는지 몰랐기
// 때문이다 — 화면은 이미 표기가 적용된 이름만 서버에 보냈고, 서버는 선택 자체를 저장하지 않았다.
// 그래서 영문으로 발급한 서류를 나중에 목록에서 보내면 '이름만 로마자, 서류명은 한글'이 됐다.
//
// 이제 세 발급본 테이블에 nameStyle 을 저장한다. **옛 발급본은 null 이고 한글로 읽는다** —
// 그때 실제로 한글로 나갔으므로 그것이 사실이다. 소급해서 영문으로 바꾸면 종이와 이름이 갈린다.
{
  const asKo = (v: unknown) => asDocNameStyle(v) ?? 'ko'
  eq('옛 발급본(null)은 한글', asKo(null), 'ko')
  eq('옛 발급본(빈 문자열)도 한글', asKo(''), 'ko')
  eq('알 수 없는 값도 한글', asKo('français'), 'ko')
  eq('저장된 en 은 영문', asKo('en'), 'en')
  eq('목록 파일명: 영문 발급본', docFileLabel('contract', asKo('en')), DOC_TYPE_FILE_LABEL_EN.contract)
  eq('목록 파일명: 옛 발급본', docFileLabel('contract', asKo(null)), DOC_TYPE_FILE_LABEL.contract)
  eq('목록 파일명: 보증금 영수증 영문', docFileLabel('deposit', asKo('en')), DOC_TYPE_FILE_LABEL_EN.deposit)
  // 현지 표기는 한글 서류명을 쓴다 — 영문 이름이 아니므로 영문 서류명과 짝이 안 맞는다.
  eq('목록 파일명: 현지 표기는 한글 이름', docFileLabel('residence', asKo('native')), DOC_TYPE_FILE_LABEL.residence)
}
// ── 계약서의 saved 는 '실제로 저장된 오버라이드'다 (긴급 신고 2026-09-03) ──────────
//
// 계약서 표시값은 자동값 위에 오버라이드를 얹은 **병합값**이고 nameStyle 의 자동값은 'ko' 다.
// 그 병합값을 saved 로 넘기면 1순위에서 늘 'ko' 로 끝나 이어받기·사람 단위 값·국적 추정이
// 한 번도 도달하지 못한다. 413호 투창(베트남·영문 이름 보유)의 계약서가 한글로 섰다.
{
  const ctx = { nationality: '베트남', available: ALL } as const
  eq('계약서 · 저장된 오버라이드가 없으면 국적 추정까지 간다',
    resolveDocNameStyle({ ...ctx, saved: undefined }), 'en')
  eq('계약서 · 자동값 ko 를 saved 로 넘기면 1순위에서 끝난다(종전 버그의 재현)',
    resolveDocNameStyle({ ...ctx, saved: 'ko' }), 'ko')
  // 운영자가 실제로 '한글'을 고른 경우는 그대로 존중된다 — 위 두 줄이 같은 답을 내지만
  // 입력이 다르다(안 고름 대 골랐음). 그래서 병합값을 넘기면 안 된다.
  eq('계약서 · 앞 서류가 있으면 그것이 국적 추정보다 세다',
    resolveDocNameStyle({ ...ctx, saved: undefined, siblings: ['ko'] }), 'ko')
  eq('계약서 · 사람 단위 값도 국적 추정보다 세다',
    resolveDocNameStyle({ ...ctx, saved: undefined, tenant: 'ko' }), 'ko')
}

console.log(`\n서류 성명 표기 회귀: ${pass} 통과 / ${fails.length} 실패`)
for (const f of fails) console.log('  - ' + f)
if (fails.length > 0) process.exit(1)
