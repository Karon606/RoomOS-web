// 동반 서류 조판 회귀 — 추가 서류가 없으면 종이가 종전과 **바이트 단위로 같아야 한다.**
//
// 이 단계(D2-3)의 약속은 "배선은 끝났고 화면은 안 바뀐다"이다. 그 약속을 지키는 유일한 증거가
// 서류 0건일 때의 출력이 안 움직인다는 것이다. 동의서 조판을 함수로 뽑았으므로, 뽑기 전과
// 같은 문자열이 나오는지도 여기서 지킨다.
import { buildContractPrintHtml, type PrintContractData } from '../lib/contractPrintHtml'
import { DEFAULT_CONTRACT_TEMPLATE, DEFAULT_DISPOSAL_CONSENT } from '../lib/contract'
import { printedFacts, PRINTED_FACT_KEYS, PRINTED_FACT_LABEL } from '../lib/contractPrintedFacts'
import { nativeNameSubOnPaper } from '../lib/documentName'
import { resolveSignedBody } from '../lib/contract'

let pass = 0
const fails: string[] = []
// 문자열 세기. 정규식 리터럴로 세지 않는다 — 짝이 안 맞는 따옴표가 든 정규식 둘이 한 파일에
// 있으면 eslint 파서가 그 뒤를 통째로 문자열로 읽어 파일이 파싱 오류가 된다(2026-09-06).
const count = (hay: string, needle: string) => hay.split(needle).length - 1

const eq = (name: string, got: unknown, want: unknown) => {
  if (JSON.stringify(got) === JSON.stringify(want)) pass++
  else fails.push(`${name}: 기대 ${JSON.stringify(want)} / 실제 ${JSON.stringify(got)}`)
}

const base = (over: Partial<PrintContractData> = {}): PrintContractData => ({
  smoking: '비흡연',
  template: DEFAULT_CONTRACT_TEMPLATE,
  businessInfo: { name: '더스테이', registrationNo: '123-45-67890', ceoName: '홍길동', address: '서울' },
  phone: '02-000-0000', contractNo: '20260906-001',
  stampImageUrl: null, logoImageUrl: null, pretendardBase64: null,
  refundClauseInContract: true,
  disposalConsent: { ...DEFAULT_DISPOSAL_CONSENT, enabled: false },
  tenant: { name: '김입실', primaryPhone: '010-0000-0000', birthdate: '1990-01-01',
    foreignRegNo: null, gender: '남', job: null },
  lease: null, signDate: '2026-09-06', disposalSignDate: null,
  disposalSignatureImageDataUrl: null,
  ...over,
})
// 세미콜론이 필요하다. 이 저장소는 세미콜론을 안 쓰지만, 화살표 함수가 괄호로 감싼 객체를
// 돌려주는 `=> ({...})` 바로 뒤에 블록 `{` 이 오면 eslint 파서가 파일 전체를 파싱 오류로
// 읽는다(tsc·tsx 는 통과해서 조용히 지나간다, 2026-09-06).
;

// ── 서류 0건이면 종이가 안 움직인다 ─────────────────────────
{
  const none = buildContractPrintHtml(base())
  const emptyArr = buildContractPrintHtml(base({ signDocuments: [] }))
  eq('signDocuments 미지정과 빈 배열이 같다', none === emptyArr, true)
  eq('추가 서류 페이지가 안 생긴다', count(none, 'class="paper disposal"'), 0)
  eq('계약서 한 장', count(none, 'class="paper'), 1)
}

// ── 동의서만 켜면 종전 그대로 두 장 ─────────────────────────
{
  const dcOn = buildContractPrintHtml(base({ disposalConsent: { ...DEFAULT_DISPOSAL_CONSENT, enabled: true } }))
  eq('동의서 켜면 두 장', count(dcOn, 'class="paper'), 2)
  eq('동의서에는 수신인 줄이 있다', dcOn.includes('대표 귀하'), true)
  eq('동의서 서명란 라벨', dcOn.includes('동의자(입실자) 성명'), true)
}

// ── 추가 서류가 붙는다 ──────────────────────────────────────
{
  const withDoc = buildContractPrintHtml(base({
    signDocuments: [{ key: 'aa11', title: '차량 등록 동의서', body: '{{성명}}님은 {{호실}}호 차량을 등록합니다.\n두 번째 문단.' }],
  }))
  eq('계약서 + 추가 서류 두 장', count(withDoc, 'class="paper'), 2)
  eq('제목이 찍힌다', withDoc.includes('차량 등록 동의서'), true)
  eq('변수가 치환된다', withDoc.includes('김입실님은'), true)
  eq('문단이 나뉜다', count(withDoc, 'class="dc-p"'), 2)
  // 수신인 줄은 임의처분 서식 고유다. 추가 서류가 무슨 성격인지 앱은 모른다.
  eq('추가 서류에는 수신인 줄이 없다', withDoc.includes('대표 귀하'), false)
  eq('추가 서류 서명란 라벨', withDoc.includes('입실자 성명'), true)
  eq('서명 없으면 빈 자리', withDoc.includes('(서명 또는 인)'), true)

  const signed = buildContractPrintHtml(base({
    signDocuments: [{ key: 'aa11', title: '차량 등록 동의서', body: 'x' }],
    documentSignatures: { aa11: { image: 'data:image/png;base64,AAA', signedAt: '2026-09-05' } },
  }))
  eq('서명 이미지가 찍힌다', signed.includes('data:image/png;base64,AAA'), true)
  eq('그 서류의 서명일이 찍힌다', signed.includes('2026-09-05'), true)
  eq('서명이 있으면 빈 자리가 없다', signed.includes('(서명 또는 인)'), false)
}

// ── 동의서 + 추가 서류 둘이면 석 장 ────────────────────────
{
  const both = buildContractPrintHtml(base({
    disposalConsent: { ...DEFAULT_DISPOSAL_CONSENT, enabled: true },
    signDocuments: [
      { key: 'aa11', title: '차량 등록 동의서', body: 'a' },
      { key: 'bb22', title: '반려동물 동의서', body: 'b' },
    ],
  }))
  eq('넉 장(계약서 + 동의서 + 추가 둘)', count(both, 'class="paper'), 4)
  // 순서가 중요하다 — 계약서, 동의서, 그다음 추가 서류가 만든 순이다.
  const order = [...both.matchAll(/class="dc-title">([^<]+)</g)].map(m => m[1])
  eq('동의서가 추가 서류보다 앞', order, ['잔여 소지품 임의처분 동의서', '차량 등록 동의서', '반려동물 동의서'])
}

// ── 인쇄 사실 축. 없으면 드리프트가 침묵한다 ────────────────
{
  eq('축 목록에 있다', PRINTED_FACT_KEYS.includes('signDocuments'), true)
  eq('사람이 읽는 이름이 있다', PRINTED_FACT_LABEL.signDocuments, '추가 서류')
  // 서류가 없으면 축이 아예 없어야 한다. 옛 박제·서류 안 쓰는 계약 전건이 여기서 무변동이다.
  eq('서류 없으면 축 없음', printedFacts({ signDocuments: [] }).signDocuments, undefined)
  eq('미지정도 축 없음', printedFacts({}).signDocuments, undefined)
  const a = printedFacts({ signDocuments: [{ key: 'aa11', title: 'T', body: 'B' }] }).signDocuments
  eq('서류가 있으면 축이 선다', typeof a === 'string' && a.includes('T'), true)
  // 제목 한 글자, 문단 한 줄이 바뀌어도 잡혀야 한다.
  eq('제목이 바뀌면 값이 다르다',
    printedFacts({ signDocuments: [{ key: 'aa11', title: 'T2', body: 'B' }] }).signDocuments !== a, true)
  eq('본문이 바뀌면 값이 다르다',
    printedFacts({ signDocuments: [{ key: 'aa11', title: 'T', body: 'B2' }] }).signDocuments !== a, true)
}

// ── 소급 금지. 서명이 끝난 계약서에 새 서류를 끼우지 않는다 ──
{
  const prop = { signDocuments: [{ key: 'aa11', title: '나중에 만든 서류', body: 'x' }] }
  // 옛 박제에는 이 칸이 아예 없다(undefined). live 로 폴백하면 종이에 없던 장이 튀어나온다.
  const old = resolveSignedBody({ signedContractSnapshot: { origin: 'REMOTE_LINK', capturedAt: 'x', template: DEFAULT_CONTRACT_TEMPLATE } }, prop)
  eq('옛 박제는 빈 배열로 읽는다', old.signDocuments, [])
  const withDocs = resolveSignedBody(
    { signedContractSnapshot: { origin: 'REMOTE_LINK', capturedAt: 'x', template: DEFAULT_CONTRACT_TEMPLATE, signDocuments: [{ key: 'bb22', title: '그때 그 서류', body: 'y' }] } }, prop)
  eq('박제에 담긴 그때 목록을 쓴다', (withDocs.signDocuments as Array<{ key: string }>).map(x => x.key), ['bb22'])
  // 서명 전 계약은 지금 목록이다.
  const live = resolveSignedBody({}, prop)
  eq('서명 전이면 지금 목록', live.signDocuments, prop.signDocuments)
}

// ── 본국 표기 이름 병기 (오류신고 cdda7787) ──────────────────
{
  eq('값 있고 그릴 수 있으면 병기', nativeNameSubOnPaper('TRAN THI THU TRANG', 'Trần Thị Thu Trang'), 'Trần Thị Thu Trang')
  eq('키릴도 병기', nativeNameSubOnPaper('KIM', 'Ким Мён Хва'), 'Ким Мён Хва')
  eq('없으면 안 붙는다', nativeNameSubOnPaper('김입실', null), null)
  eq('폰트가 못 그리면 안 붙는다(벵골 문자)', nativeNameSubOnPaper('RAHMAN', 'রহমান'), null)
  eq('한자도 못 그린다', nativeNameSubOnPaper('김명화', '金明花'), null)
  eq('성명이 이미 그 표기면 중복 병기 안 함', nativeNameSubOnPaper('Trần Thị Thu Trang', 'Trần Thị Thu Trang'), null)

  const withNative = buildContractPrintHtml(base({ tenant: { name: 'TRAN THI THU TRANG', primaryPhone: '010', birthdate: '1990-01-01', foreignRegNo: null, gender: '여', job: null, nativeName: 'Trần Thị Thu Trang' } }))
  eq('종이 성명 칸에 병기가 실린다', withNative.includes('Trần Thị Thu Trang'), true)
  const noNative = buildContractPrintHtml(base())
  const bengal = buildContractPrintHtml(base({ tenant: { name: 'RAHMAN', primaryPhone: '010', birthdate: '1990-01-01', foreignRegNo: null, gender: '남', job: null, nativeName: 'রহমান' } }))
  eq('못 그리는 문자는 종이에 안 실린다(네모 방지)', bengal.includes('রহমান'), false)
  eq('값 없으면 sub 스팬 자체가 없다', count(noNative, 'class="sub"'), 0)

  // 인쇄 사실 축 — 종이에 실릴 때만 축이 선다.
  eq('병기 축이 목록에 있다', PRINTED_FACT_KEYS.includes('tenant.nativeName'), true)
  eq('병기가 실리면 축이 선다', printedFacts({ tenant: { name: 'A', nativeName: 'Ким' } })['tenant.nativeName'], 'Ким')
  eq('못 그리면 축도 없다', printedFacts({ tenant: { name: 'A', nativeName: 'রহমান' } })['tenant.nativeName'], undefined)
  eq('없으면 축도 없다', printedFacts({ tenant: { name: 'A' } })['tenant.nativeName'], undefined)
}

// ── 병기 원천 동결 (체크리스트 E) ───────────────────────────
{
  const base_ = { origin: 'REMOTE_LINK' as const, capturedAt: 'x', template: DEFAULT_CONTRACT_TEMPLATE }
  eq('옛 박제(칸 없음)는 undefined — 라이브 폴백 신호',
    resolveSignedBody({ signedContractSnapshot: base_ }, {}).nativeNameFrozen, undefined)
  eq('동결값이 있으면 그대로',
    resolveSignedBody({ signedContractSnapshot: { ...base_, nativeName: 'Trần Thị Thu Trang' } }, {}).nativeNameFrozen, 'Trần Thị Thu Trang')
  eq('null 동결(서명 때 비어 있었음)도 그대로 — 라이브로 안 새어 나간다',
    resolveSignedBody({ signedContractSnapshot: { ...base_, nativeName: null } }, {}).nativeNameFrozen, null)
}

console.log(`\n동반 서류 조판 회귀: ${pass} 통과 / ${fails.length} 실패`)
for (const f of fails) console.error(`  - ${f}`)
process.exit(fails.length > 0 ? 1 : 0)
