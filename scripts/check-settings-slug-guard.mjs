// 환경설정 저장 무회귀 그물 — 읽기 전용, 위반 시 exit 1.
//
// 왜 이 그물이 필요한가. updatePropertySettings 는 예전에 기본정보 폼 하나를 FormData 통짜로 받아
// Property 를 update 했다. 2026-08-18 IA 1단계에서 슬러그 입력이 **웹사이트 탭**으로 떠나자
// "폼에 없는 필드를 확인 없이 읽으면 null 이 된다"는 함정이 드러났다 — 운영자가 기본정보에서
// 영업장명 한 글자만 고쳐 저장하는 순간 소개 페이지 주소가 조용히 지워졌다.
// 2026-08-19 IA 2단계에서 요금·서류 필드가 요금·정책·계약서·서류 탭으로 흩어지면서 같은 함정이
// 필드 수만큼 늘었다. 그래서 이 그물도 슬러그 한 축에서 **이동 필드 전수**로 넓혔다.
//
// 데이터가 아니라 소스의 모양을 본다 — 오늘 DB 를 봐서는 알 수 없고, 발현은 다음 저장 클릭이다.
//   축 ⓐ 저장 패치 정본이 칼럼마다 formData.has 가드를 쥐고 있는가.
//   축 ⓑ 슬러그를 쓸 전용 출구(updatePublicSlug)가 있는가 — 가드만 남기면 저장할 길이 사라진다.
//   축 ⓒ 폼에 name="publicSlug" 입력이 되살아나지 않았는가(되살리면 두 출구가 갈린다).
//   축 ⓓ 폼이 보내는 필드가 전부 가드 목록 안에 있는가(새 칸이 그물 밖에서 태어나지 않게).
//   축 ⓔ 체크박스마다 같은 이름의 hidden '0' 짝이 있는가(없으면 체크를 풀 길이 사라진다).
//   축 ⓕ 통짜 저장이 패치 정본만 쓰는가(formData 를 직접 다시 읽으면 두 번째 저장 경로가 생긴다).
import { readFileSync } from 'fs'

const ACTIONS = 'app/(app)/settings/actions.ts'
const FORM    = 'app/(app)/settings/SettingsForm.tsx'
const TAB     = 'app/(app)/settings/WebsiteTab.tsx'
const PATCH   = 'lib/propertySettingsPatch.ts'

// 환경설정 폼이 저장하는 Property 칼럼 전수. 담당 탭은 2026-08-19 확정 재편 지도.
// 칸을 새로 만들면 여기에 먼저 적고 정본에 가드를 단다 — 축 ⓓ 가 순서를 강제한다.
const GUARDED = [
  // 기본정보
  'name', 'address', 'phone', 'acquisitionDate', 'prevOwnerCutoffDate', 'contactLeadDays',
  // 요금·정책
  'defaultDeposit', 'defaultCleaningFee', 'reservationDepositMode', 'refundPenaltyPct',
  'refundClauseInContract', 'cleaningFeeInDeposit',
  // 계약서·서류
  'defaultAreaM2', 'bankAccount', 'disposalEnabled', 'disposalDays', 'disposalTitle', 'disposalBody',
  // 웹사이트(전용 출구가 정주소, 통짜 경로는 옛 번들 대비로만 남아 있다)
  'publicSlug',
]

const violations = []
const fail = (axis, msg, fix) => violations.push({ axis, msg, fix })

const read = path => {
  try { return readFileSync(path, 'utf8') } catch { return null }
}
// 주석을 공백으로 지운다 — 주석에 적힌 설명이 그물에 걸리면 안 된다.
// 블록 주석은 주석으로만 읽히는 자리에서만 연다. 종전에는 슬래시별표를 무조건 주석 시작으로 봤는데,
// SettingsForm 안의 accept="image/*" 가 가짜 주석을 열어 다음 별표슬래시까지가 통째로 지워졌다 —
// 기본정보 폼 전체(영업장명·주소·보증금·전용면적)가 그물의 시야 밖이었다(2026-08-19 발견,
// 축 ⓒ 가 1단계 이후 줄곧 눈을 감고 있었다는 뜻이다).
// 여는 자리는 둘뿐이다. ① 중괄호 바로 뒤(JSX 주석) ② 줄 첫머리. 문자열 속 슬래시별표는 어느 쪽도 아니다.
const strip = s => s
  .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, m => m.replace(/[^\n]/g, ' '))
  .replace(/^[ \t]*\/\*[\s\S]*?\*\//gm, m => m.replace(/[^\n]/g, ' '))
  .replace(/(^|[^:])\/\/[^\n]*/g, (_, p) => p)

// ── 축 ⓐ · ⓕ ────────────────────────────────────────────────────────
const patchRaw = read(PATCH)
if (!patchRaw) {
  fail('ⓐ', `${PATCH} 를 읽을 수 없다`, '경로가 바뀌었으면 이 스크립트의 상수를 함께 옮긴다.')
} else {
  const src = strip(patchRaw)
  const at = src.indexOf('export function buildPropertySettingsPatch')
  if (at === -1) {
    fail('ⓐ', `${PATCH} 에서 buildPropertySettingsPatch 를 못 찾았다`, '함수 이름이 바뀌었으면 이 스크립트도 함께 고친다.')
  } else {
    const body = src.slice(at)
    const naked = GUARDED.filter(f => !body.includes(`formData.has('${f}')`))
    if (naked.length > 0) {
      fail('ⓐ', `${PATCH} 가 필드 존재 확인 없이 쓰는 칼럼 ${naked.length}개 — ${naked.join(', ')}`,
        "formData.has('<필드>') 일 때만 그 칼럼을 쓴다. 탭마다 폼이 달라 확인 없이 읽으면 옆 탭 값이 저장 한 번에 null 로 덮인다.")
    }
  }
}

const actionsRaw = read(ACTIONS)
if (!actionsRaw) {
  fail('ⓑ', `${ACTIONS} 를 읽을 수 없다`, '경로가 바뀌었으면 이 스크립트의 상수를 함께 옮긴다.')
} else {
  const src = strip(actionsRaw)

  // 축 ⓕ — 통짜 저장은 패치 정본만 쓴다
  const at = src.indexOf('export async function updatePropertySettings')
  if (at === -1) {
    fail('ⓕ', `${ACTIONS} 에서 updatePropertySettings 를 못 찾았다`, '함수 이름이 바뀌었으면 이 스크립트도 함께 고친다.')
  } else {
    const next = src.indexOf('\nexport ', at + 1)
    const body = src.slice(at, next === -1 ? src.length : next)
    if (!body.includes('buildPropertySettingsPatch')) {
      fail('ⓕ', `${ACTIONS} updatePropertySettings 가 패치 정본을 쓰지 않는다`,
        `저장 해석은 ${PATCH} 한 곳이다. 여기서 다시 조립하면 가드 밖의 두 번째 경로가 생긴다.`)
    }
    if (/formData\.(get|has|getAll)\(/.test(body)) {
      fail('ⓕ', `${ACTIONS} updatePropertySettings 가 formData 를 직접 읽는다`,
        '읽기는 패치 정본에 맡긴다. 여기서 꺼내 쓴 필드는 has 가드 밖이라 옆 탭 값을 덮는다.')
    }
  }

  // 축 ⓑ — 전용 출구
  if (!src.includes('export async function updatePublicSlug')) {
    fail('ⓑ', `${ACTIONS} 에 updatePublicSlug 가 없다`,
      '가드만 남기면 슬러그를 저장할 길이 사라진다. 웹사이트 탭의 저장 출구를 되살린다.')
  }
}

// ── 축 ⓒ · ⓓ · ⓔ ────────────────────────────────────────────────────
const formRaw = read(FORM)
if (!formRaw) {
  fail('ⓒ', `${FORM} 를 읽을 수 없다`, '경로가 바뀌었으면 이 스크립트의 상수를 함께 옮긴다.')
} else {
  const src = strip(formRaw)

  if (/name=["']publicSlug["']/.test(src)) {
    fail('ⓒ', `${FORM} 에 name="publicSlug" 입력이 있다`,
      '소개 페이지 주소의 자리는 웹사이트 탭 하나다. 폼에 되살리려면 통짜 저장 가드와 함께 설계를 다시 정한다.')
  }

  // 축 ⓓ — 폼이 보내는 필드는 전부 가드 목록 안에 있어야 한다
  const posted = [...new Set([...src.matchAll(/\bname="([A-Za-z][A-Za-z0-9_]*)"/g)].map(m => m[1]))]
  const unguarded = posted.filter(f => !GUARDED.includes(f))
  if (unguarded.length > 0) {
    fail('ⓓ', `${FORM} 이 그물 밖 필드를 보낸다 — ${unguarded.join(', ')}`,
      `칸을 새로 만들었으면 이 스크립트의 GUARDED 에 적고 ${PATCH} 에 formData.has 가드를 단다.`)
  }

  // 축 ⓔ — 체크박스는 hidden '0' 짝이 있어야 한다
  const boxes = [...new Set([...src.matchAll(/type="checkbox"[^>]*?\bname="([A-Za-z][A-Za-z0-9_]*)"/g)].map(m => m[1]))]
  const orphan = boxes.filter(f => !new RegExp(`type="hidden"\\s+name="${f}"\\s+value="0"`).test(src))
  if (orphan.length > 0) {
    fail('ⓔ', `${FORM} 의 체크박스에 hidden '0' 짝이 없다 — ${orphan.join(', ')}`,
      '꺼진 체크박스는 FormData 에 안 실린다. 짝이 없으면 그 부재가 "이 탭 소관 아님"으로 읽혀 체크를 풀 길이 사라진다.')
  }
}

// 축 ⓑ 뒷받침 — 웹사이트 탭이 전용 출구를 실제로 부르는가
const tabRaw = read(TAB)
if (!tabRaw) {
  fail('ⓑ', `${TAB} 를 읽을 수 없다`, '웹사이트 탭이 사라졌으면 슬러그 저장 출구부터 다시 짠다.')
} else if (!strip(tabRaw).includes('updatePublicSlug(')) {   // 임포트만 남고 호출이 끊긴 경우도 잡는다
  fail('ⓑ', `${TAB} 가 updatePublicSlug 를 부르지 않는다`,
    '탭에 입력만 있고 저장 출구가 끊기면 운영자가 저장했다고 믿고 나간다.')
}

if (violations.length > 0) {
  console.error(`[환경설정 저장] 위반 ${violations.length}건`)
  for (const v of violations) {
    console.error(`  축 ${v.axis} · ${v.msg}`)
    console.error(`      조치: ${v.fix}`)
  }
  process.exit(1)
}
console.log(`[환경설정 저장] 축 ⓐ 필드 가드 ${GUARDED.length}종 · ⓑ 전용 출구 · ⓒ 옛 입력 부활 · ⓓ 폼 필드 전수 · ⓔ 체크박스 짝 · ⓕ 단일 저장 경로 / 위반 0건`)
