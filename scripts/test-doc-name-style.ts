// 서류 성명 표기 이어받기 회귀 — 실행: npx tsx scripts/test-doc-name-style.ts
//
// 여기서 고정하는 것 넷(운영자 확정 2026-08-29).
//   · **한 사람의 서류는 같은 표기로 나간다** — 계약서를 영문으로 뽑았으면 실거주 확인서도 영문이
//     기본이다. 두 종이가 다른 이름을 달면 제출처에서 같은 사람 것으로 안 읽힌다.
//   · **손으로 고른 것이 국적 추정보다 세다** — 외국인이어도 한글로 내기로 정했으면 그 결정이 이어진다.
//   · **외국인은 영문이 기본** — 다만 영문 이름이 없으면 고를 수 없으니 한글로 떨어진다.
//   · **파일 이름도 표기를 따라간다** — 이름만 로마자이고 서류명이 한글이면 절반은 못 읽는 파일이 된다.
import {
  resolveDocNameStyle, docNameStyleConflict, isKoreanNationality, DEFAULT_DOC_NAME_STYLE,
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

console.log(`\n서류 성명 표기 회귀: ${pass} 통과 / ${fails.length} 실패`)
for (const f of fails) console.log('  - ' + f)
if (fails.length > 0) process.exit(1)
