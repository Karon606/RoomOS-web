// 소개 페이지 주소(슬러그) 무회귀 그물 — 읽기 전용, 위반 시 exit 1.
//
// 왜 이 그물이 필요한가. updatePropertySettings 는 기본정보 폼 전체를 FormData 통짜로 받아
// Property 를 update 한다. 2026-08-18 IA 1단계에서 슬러그 입력을 **웹사이트 탭**으로 옮겼으므로
// 기본정보 폼에는 그 필드가 없다. 통짜 저장이 필드 존재를 확인하지 않고 읽으면 null 이 되고,
// 운영자가 기본정보에서 영업장명 한 글자만 고쳐 저장하는 순간 소개 페이지 주소가 조용히 지워진다
// (마케팅 방문 분석이 빈 상태로 돌아가고, 상담 도구의 소개 페이지 줄이 사라진다).
//
// 데이터가 아니라 소스의 모양을 본다 — 오늘 DB 를 봐서는 알 수 없고, 발현은 다음 저장 클릭이다.
//   축 ⓐ 통짜 저장이 formData.has('publicSlug') 가드를 쥐고 있는가.
//   축 ⓑ 슬러그를 쓸 전용 출구(updatePublicSlug)가 있는가 — 가드만 남기면 저장할 길이 사라진다.
//   축 ⓒ 기본정보 폼에 name="publicSlug" 입력이 되살아나지 않았는가(되살리면 두 출구가 갈린다).
import { readFileSync } from 'fs'

const ACTIONS = 'app/(app)/settings/actions.ts'
const FORM    = 'app/(app)/settings/SettingsForm.tsx'
const TAB     = 'app/(app)/settings/WebsiteTab.tsx'

const violations = []
const fail = (axis, msg, fix) => violations.push({ axis, msg, fix })

const read = path => {
  try { return readFileSync(path, 'utf8') } catch { return null }
}
/** 주석을 공백으로 지운다 — 주석에 적힌 설명이 그물에 걸리면 안 된다. */
const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' '))
  .replace(/(^|[^:])\/\/[^\n]*/g, (_, p) => p)

const actionsRaw = read(ACTIONS)
if (!actionsRaw) {
  fail('ⓐ', `${ACTIONS} 를 읽을 수 없다`, '경로가 바뀌었으면 이 스크립트의 상수를 함께 옮긴다.')
} else {
  const src = strip(actionsRaw)

  // 축 ⓐ — 통짜 저장의 가드
  const at = src.indexOf('export async function updatePropertySettings')
  if (at === -1) {
    fail('ⓐ', `${ACTIONS} 에서 updatePropertySettings 를 못 찾았다`, '함수 이름이 바뀌었으면 이 스크립트도 함께 고친다.')
  } else {
    const next = src.indexOf('\nexport ', at + 1)
    const body = src.slice(at, next === -1 ? src.length : next)
    if (body.includes('publicSlug') && !body.includes("formData.has('publicSlug')")) {
      fail('ⓐ', `${ACTIONS} updatePropertySettings 가 publicSlug 를 필드 존재 확인 없이 쓴다`,
        "formData.has('publicSlug') 일 때만 그 칼럼을 쓴다. 기본정보 폼에는 그 입력이 없어, 확인 없이 읽으면 저장 한 번에 주소가 null 로 덮인다.")
    }
  }

  // 축 ⓑ — 전용 출구
  if (!src.includes('export async function updatePublicSlug')) {
    fail('ⓑ', `${ACTIONS} 에 updatePublicSlug 가 없다`,
      '가드만 남기면 슬러그를 저장할 길이 사라진다. 웹사이트 탭의 저장 출구를 되살린다.')
  }
}

// 축 ⓒ — 기본정보 폼에 입력이 되살아났는가
const formRaw = read(FORM)
if (!formRaw) {
  fail('ⓒ', `${FORM} 를 읽을 수 없다`, '경로가 바뀌었으면 이 스크립트의 상수를 함께 옮긴다.')
} else if (/name=["']publicSlug["']/.test(strip(formRaw))) {
  fail('ⓒ', `${FORM} 에 name="publicSlug" 입력이 있다`,
    '소개 페이지 주소의 자리는 웹사이트 탭 하나다. 기본정보 폼에 되살리려면 통짜 저장 가드와 함께 설계를 다시 정한다.')
}

// 축 ⓑ 뒷받침 — 웹사이트 탭이 전용 출구를 실제로 부르는가
const tabRaw = read(TAB)
if (!tabRaw) {
  fail('ⓑ', `${TAB} 를 읽을 수 없다`, '웹사이트 탭이 사라졌으면 슬러그 저장 출구부터 다시 짠다.')
} else if (!strip(tabRaw).includes('updatePublicSlug')) {
  fail('ⓑ', `${TAB} 가 updatePublicSlug 를 부르지 않는다`,
    '탭에 입력만 있고 저장 출구가 끊기면 운영자가 저장했다고 믿고 나간다.')
}

if (violations.length > 0) {
  console.error(`[소개 페이지 주소] 위반 ${violations.length}건`)
  for (const v of violations) {
    console.error(`  축 ${v.axis} · ${v.msg}`)
    console.error(`      조치: ${v.fix}`)
  }
  process.exit(1)
}
console.log('[소개 페이지 주소] 축 ⓐ 통짜 저장 가드 · 축 ⓑ 전용 출구 · 축 ⓒ 옛 입력 부활 / 위반 0건')
