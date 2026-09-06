// 안내 문안 사전 회귀 — 매핑·보간·병기·폴백을 진리표로 못박는다.
import {
  SIGN_LANGS, SIGN_LANG_LABEL, asSignLang, signLangForNationality, t, bi, subLangOf, type SignLang,
} from '../lib/signGuideText'

let pass = 0
const fails: string[] = []
const eq = (name: string, got: unknown, want: unknown) => {
  if (JSON.stringify(got) === JSON.stringify(want)) pass++
  else fails.push(`${name}: 기대 ${JSON.stringify(want)} / 실제 ${JSON.stringify(got)}`)
}

// ── 국적 매핑. 기본값일 뿐이고 피커에서 바꿀 수 있다(김명화님 케이스). ──
eq('대한민국은 ko', signLangForNationality('대한민국'), 'ko')
eq("'한국' 표기 변형도 ko", signLangForNationality('한국'), 'ko')
eq('Korea 표기도 ko', signLangForNationality('Korea'), 'ko')
eq('미기재는 ko', signLangForNationality(null), 'ko')
eq('빈 문자열도 ko', signLangForNationality('  '), 'ko')
eq('베트남은 vi', signLangForNationality('베트남'), 'vi')
eq('방글라데시는 bn', signLangForNationality('방글라데시'), 'bn')
eq('러시아는 ru', signLangForNationality('러시아'), 'ru')
eq('카자흐스탄은 ru(공용어)', signLangForNationality('카자흐스탄'), 'ru')
eq('우즈베키스탄은 ru(공용어)', signLangForNationality('우즈베키스탄'), 'ru')
eq('일본은 ja', signLangForNationality('일본'), 'ja')
eq('중국은 zh', signLangForNationality('중국'), 'zh')
eq('대만도 zh', signLangForNationality('대만'), 'zh')
eq('레바논은 en 폴백(RTL 미지원 결정)', signLangForNationality('레바논'), 'en')
eq('모르는 외국 국적은 en', signLangForNationality('브라질'), 'en')

// ── 화이트리스트 파서 — 스냅샷 값은 외부 데이터다 ──
eq('정상 코드 통과', asSignLang('vi'), 'vi')
eq('모르는 코드 거부', asSignLang('fr'), undefined)
eq('비문자열 거부', asSignLang(3), undefined)
eq('옛 링크(키 없음) 거부 - 부르는 쪽이 ko 폴백', asSignLang(undefined), undefined)

// ── 보간 ──
eq('숫자 치환', t('ko', 'progress.some', { n: 1, total: 3, left: 2 }), '서명 1 / 3 · 2곳 더 서명해 주세요.')
eq('제목 치환', t('vi', 'toast.signedDoc', { title: '차량 등록 동의서' }), 'Đã nhận chữ ký 차량 등록 동의서')
eq('모르는 변수는 원문 유지', t('ko', 'progress.some', { n: 1 }), '서명 1 / {total} · {left}곳 더 서명해 주세요.')

// ── 병기(bi). 한국어 정본 줄이 항상 앞선다 ──
{
  const s = bi('vi', 'pad.errShort')
  eq('병기 첫 줄은 한국어', s.split('\n')[0], '서명이 너무 짧습니다. 성함을 이어서 그려 주세요.')
  eq('병기 둘째 줄은 선택 언어', s.split('\n')[1], 'Chữ ký quá ngắn. Vui lòng ký đầy đủ tên của bạn.')
}
eq('한국어를 골라도 부속 줄은 영어다(부속 줄은 언제나 선다)', subLangOf('ko'), 'en')
eq('그 밖은 제 언어', subLangOf('bn'), 'bn')

// bi 는 항상 한글을 포함한다 — humanError(한글 없는 문자열을 폴백으로 갈아치움)를 지나는 보증.
{
  let all = true
  for (const lang of SIGN_LANGS) {
    for (const key of ['err.submitFail', 'pad.errComm', 'err.saveFail'] as const) {
      if (!/[가-힣]/.test(bi(lang, key))) { all = false; fails.push(`bi(${lang}, ${key}) 에 한글이 없다`) }
    }
  }
  if (all) pass++
}

// ── 사전 품질 — 전 언어 전 키가 비지 않고, 보간 변수 집합이 한국어와 같다 ──
{
  const koVars = (key: string) => [...t('ko', key as never).matchAll(/\{(\w+)\}/g)].map(m => m[1]).sort().join(',')
  let ok = true
  const keys = ['gate.title','gate.hint','gate.birthLabel','gate.placeholder','gate.submit','gate.submitting','gate.netFail','gate.privacy',
    'inactive.title','inactive.body','submitted.title','submitted.body',
    'err.locked','err.birthMismatch','err.cookieExpired','err.badRequest','err.badImage','err.imageTooLarge','err.disposalOff',
    'err.saveFail','err.signFirst','err.disposalLeft','err.docLeft','err.submitFail',
    'bar.readAndSign','bar.allSaved','cta.sign','progress.done1','progress.doneN','progress.none1','progress.noneN','progress.some',
    'cta.submit','cta.submitting','pill.allDone','pad.titleContract','pad.titleDoc','pad.subRemote',
    'pad.clear','pad.cancel','pad.confirm','pad.saving','pad.close','pad.errEmpty','pad.errShort','pad.errComm',
    'toast.signedContract','toast.signedDoc','remain.title1','remain.titleN','remain.msg','remain.go',
    'submit.confirmTitle','submit.confirmMsg','submit.confirmLabel','submit.errComm','done.title','done.body',
    'native.label','native.hint','doc.contract','doc.disposal','doc.generic','common.cancel','sms.body'] as const
  for (const lang of SIGN_LANGS) {
    for (const key of keys) {
      const v = t(lang, key)
      if (!v || !v.trim()) { ok = false; fails.push(`${lang}.${key} 가 비었다`) }
      const vars = [...v.matchAll(/\{(\w+)\}/g)].map(m => m[1]).sort().join(',')
      if (vars !== koVars(key)) { ok = false; fails.push(`${lang}.${key} 보간 변수가 한국어와 다르다: [${vars}] vs [${koVars(key)}]`) }
    }
  }
  if (ok) pass++
}

console.log(`\n안내 문안 사전 회귀: ${pass} 통과 / ${fails.length} 실패`)
for (const f of fails.slice(0, 10)) console.error(`  - ${f}`)
process.exit(fails.length > 0 ? 1 : 0)
