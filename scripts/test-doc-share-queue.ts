// 서류 다중 보내기 준비 큐 회귀 테스트 — 실행: npx tsx scripts/test-doc-share-queue.ts
//
// 여기서 고정하는 것 넷(2026-08-17, 서류 묶음 발송 1단계).
//   · **1페이지 경로 무회귀** — 한 장짜리 서류와 PDF 원본은 파일 수도 파일명도 종전 그대로다.
//     이 축이 깨지면 영수증·확인서·계약서 다건 보내기 세 화면이 함께 흔들린다. 나머지 셋보다 먼저다.
//   · 다페이지 확장 — 사진 변환이 페이지마다 한 장을 내고, 그 장수가 파일 수에 그대로 반영된다.
//   · 준비 전 파일 수는 최소 한 장으로 세고, 변환이 끝나면 실제 장수로 확정된다.
//   · 캐시·재시도 — 준비된 항목은 다시 받지 않고, 한 번 실패는 재시도하며, 두 번 실패만 실패로 남는다.

import { DocShareQueue, shareFileNames } from '../lib/docShareQueue'

let pass = 0
let fail = 0
function eq(name: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  if (a === e) { pass++; return }
  fail++
  console.error(`FAIL ${name}\n  기대: ${e}\n  실제: ${a}`)
}

const bytes = (n: number) => new ArrayBuffer(n)
const png = (n: number) => new Blob([new Uint8Array(n)], { type: 'image/png' })

/** 큐가 요청한 항목 전부를 성공·실패로 확정할 때까지 기다린다(세마포어·재시도 포함). */
async function settle(q: DocShareQueue, ids: string[]) {
  for (let i = 0; i < 200; i++) {
    const s = q.state(ids)
    if (s.done + s.failed.length >= ids.length) return s
    await new Promise(r => setTimeout(r, 5))
  }
  throw new Error('큐가 확정되지 않았다')
}

async function queueTests() {
  // ── 무회귀 축 ── 한 장짜리 사진 변환.
  {
    const q = new DocShareQueue(async () => [png(10)])
    q.enqueue([{ id: 'a', fetchBytes: async () => bytes(4), toPng: true }], () => {})
    const s = await settle(q, ['a'])
    eq('무회귀 · 한 장 사진은 파일 1개', s.blobs.get('a')?.length, 1)
    eq('무회귀 · 한 장 사진의 파일 수', s.fileCount, 1)
    eq('무회귀 · 준비 완료 수', s.done, 1)
    eq('무회귀 · 실패 없음', s.failed, [])
  }
  // ── 무회귀 축 ── PDF 원본은 변환기를 아예 거치지 않는다.
  {
    let converted = 0
    const q = new DocShareQueue(async () => { converted++; return [png(10)] })
    q.enqueue([{ id: 'a', fetchBytes: async () => bytes(1234), toPng: false }], () => {})
    const s = await settle(q, ['a'])
    eq('무회귀 · PDF 원본은 파일 1개', s.blobs.get('a')?.length, 1)
    eq('무회귀 · PDF 원본은 변환기 미호출', converted, 0)
    eq('무회귀 · PDF 원본 크기 보존', s.blobs.get('a')?.[0].size, 1234)
  }

  // ── 다페이지 확장 ──
  {
    const q = new DocShareQueue(async () => [png(1), png(2), png(3)])
    q.enqueue([{ id: 'c', fetchBytes: async () => bytes(4), toPng: true }], () => {})
    const s = await settle(q, ['c'])
    eq('다페이지 · 페이지마다 한 장', s.blobs.get('c')?.length, 3)
    eq('다페이지 · 파일 수는 장수의 합', s.fileCount, 3)
    eq('다페이지 · 항목 수는 그대로 1', s.done, 1)
  }
  {
    // 한 장짜리와 여러 장짜리를 섞어도 파일 수는 장수의 합이다(묶음 발송의 실제 모양).
    // 변환기가 낼 장수는 바이트 길이로 가른다 — 영수증 1장, 계약서 4장.
    const pageOf: Record<number, number> = { 11: 1, 44: 4 }
    const q = new DocShareQueue(async b => Array.from({ length: pageOf[b.byteLength] ?? 1 }, () => png(1)))
    q.enqueue([
      { id: 'r', fetchBytes: async () => bytes(11), toPng: true },
      { id: 'k', fetchBytes: async () => bytes(44), toPng: true },
    ], () => {})
    const s = await settle(q, ['r', 'k'])
    eq('혼합 · 파일 수 = 1 + 4', s.fileCount, 5)
    eq('혼합 · 항목 수는 2', s.done, 2)
  }

  // ── 준비 전 계수 ──
  {
    const q = new DocShareQueue(async () => [png(1), png(1)])
    const s = q.state(['x', 'y'])
    eq('준비 전 · 파일 수는 최소 한 장으로', s.fileCount, 2)
    eq('준비 전 · 완료 0', s.done, 0)
  }

  // ── 캐시·재시도 ──
  {
    let fetched = 0
    const q = new DocShareQueue(async () => [png(1)])
    const item = { id: 'a', fetchBytes: async () => { fetched++; return bytes(4) }, toPng: true }
    q.enqueue([item], () => {})
    await settle(q, ['a'])
    q.enqueue([item], () => {})
    await settle(q, ['a'])
    eq('캐시 · 준비된 항목은 다시 받지 않는다', fetched, 1)
  }
  {
    let tries = 0
    const q = new DocShareQueue(async () => [png(1)])
    q.enqueue([{ id: 'a', toPng: true, fetchBytes: async () => { tries++; if (tries === 1) throw new Error('일시 실패'); return bytes(4) } }], () => {})
    const s = await settle(q, ['a'])
    eq('재시도 · 한 번 실패는 두 번째 시도로 성공', s.done, 1)
    eq('재시도 · 시도 횟수 2', tries, 2)
  }
  {
    const q = new DocShareQueue(async () => [png(1)])
    q.enqueue([{ id: 'a', toPng: true, fetchBytes: async () => { throw new Error('계속 실패') } }], () => {})
    const s = await settle(q, ['a'])
    eq('실패 · 두 번 실패하면 실패로 남는다', s.failed, ['a'])
    eq('실패 · 준비된 Blob 없음', s.blobs.has('a'), false)
  }
}

function fileNameTests() {
  const 김 = { personName: '김상혁', docLabel: '실거주확인서', dateStr: '2026.08.01' }
  const 박 = { personName: '박서준', docLabel: '입실료납부확인서', dateStr: '2026.08.02' }

  // ── 무회귀 축 ── 한 장짜리 파일명은 장 번호가 붙지 않는다.
  eq('무회귀 · 한 장은 종전 파일명', shareFileNames([김], [1], 'png'), ['김상혁_실거주확인서.png'])
  eq('무회귀 · 여러 항목 한 장씩', shareFileNames([김, 박], [1, 1], 'png'),
    ['김상혁_실거주확인서.png', '박서준_입실료납부확인서.png'])
  eq('무회귀 · pages 가 비어도 한 장 취급', shareFileNames([김], [], 'pdf'), ['김상혁_실거주확인서.pdf'])

  // ── 이름 충돌 접미(종전 규칙) ──
  const 김2 = { ...김, dateStr: '2026.07.01' }
  eq('충돌 · 같은 이름·서류는 발급일 접미', shareFileNames([김, 김2], [1, 1], 'png'),
    ['김상혁_실거주확인서_2026.08.01.png', '김상혁_실거주확인서_2026.07.01.png'])

  // ── 다페이지 접미 ──
  const 계약 = { personName: '김상혁', docLabel: '계약서', dateStr: '2026.08.13' }
  eq('다페이지 · 장 번호 접미', shareFileNames([계약], [3], 'png'),
    ['김상혁_계약서_1.png', '김상혁_계약서_2.png', '김상혁_계약서_3.png'])
  eq('다페이지 · 충돌 접미와 함께', shareFileNames([계약, { ...계약, dateStr: '2026.07.13' }], [2, 1], 'png'),
    ['김상혁_계약서_2026.08.13_1.png', '김상혁_계약서_2026.08.13_2.png', '김상혁_계약서_2026.07.13.png'])
  eq('다페이지 · 한 장짜리와 섞여도 순서 유지', shareFileNames([김, 계약], [1, 2], 'png'),
    ['김상혁_실거주확인서.png', '김상혁_계약서_1.png', '김상혁_계약서_2.png'])
}

void queueTests()
  .then(fileNameTests)
  .then(() => {
    console.log(`\n서류 보내기 큐 회귀: ${pass} 통과 / ${fail} 실패`)
    if (fail > 0) process.exit(1)
  })
