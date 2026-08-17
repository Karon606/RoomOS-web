// 서류 다중 '보내기' 준비 큐 — driveFileId 키 Blob 캐시 + 변환 큐(클라이언트 전용).
// 선택 즉시 백그라운드로 PDF fetch·(필요 시) PNG 변환을 미리 돌려, 사용자가 '보내기'를 탭하는
// 순간 제스처 만료 없이 곧바로 share() 를 호출하도록 준비한다(lib/shareFile.ts 제스처 규칙 참조).
// 체크 해제 시 취소는 하지 않는다 — 캐시를 유지해 재선택 시 즉시 준비됨.

import { pdfToPngBlobs } from './pdfToPng'

export type DocShareItem = {
  id: string                          // driveFileId (캐시 키)
  fetchBytes: () => Promise<ArrayBuffer>
  toPng: boolean                      // true=PNG 변환(사진), false=PDF 원본
}

export type DocShareState = {
  done: number                        // 준비 완료 수
  total: number                       // 요청한 총 수
  failed: string[]                    // 재시도까지 실패한 id
  // 항목 하나가 파일 여러 개일 수 있다 — 사진 변환은 **페이지마다 한 장**이다(계약서가 여러 장).
  // 한 장짜리 서류(영수증·확인서)와 PDF 원본은 길이 1 배열이라 종전 경로와 결과가 같다.
  blobs: Map<string, Blob[]>
  // 실제로 공유 시트에 넘어갈 파일 수. 아직 준비 안 된 항목은 최소 한 장으로 세고,
  // 변환이 끝나면 실제 장수로 확정된다(준비 전에는 페이지 수를 알 방법이 없다).
  fileCount: number
}

// 동시 실행 상한 세마포어 — fetch 2, PNG 변환 1(저사양 폰 메모리 보호).
class Semaphore {
  private active = 0
  private waiters: (() => void)[] = []
  constructor(private max: number) {}
  acquire(): Promise<void> {
    if (this.active < this.max) { this.active++; return Promise.resolve() }
    return new Promise<void>(resolve => this.waiters.push(() => { this.active++; resolve() }))
  }
  release() { this.active--; this.waiters.shift()?.() }
}

export class DocShareQueue {
  private blobs = new Map<string, Blob[]>() // 완료 Blob(항목당 1개 이상)
  private failed = new Set<string>()        // 재시도까지 실패
  private started = new Set<string>()       // 진행 중/완료(중복 착수 방지)
  private fetchSem = new Semaphore(2)
  private pngSem = new Semaphore(1)

  // 변환기를 인자로 받는 이유는 하나다 — 회귀 테스트가 브라우저 없이 이 큐의 규칙(1페이지 무회귀·
  // 다페이지 확장·재시도)을 잠글 수 있게 하려는 것이다. 앱은 기본값(pdfToPngBlobs)만 쓴다.
  constructor(private toPngBlobs: (bytes: ArrayBuffer) => Promise<Blob[]> = pdfToPngBlobs) {}

  // 요청 항목의 준비를 보장. 캐시에 있거나 진행 중이면 건너뛴다. 실패 항목은 재요청 시 다시 시도.
  enqueue(items: DocShareItem[], onChange: () => void) {
    for (const item of items) {
      if (this.blobs.has(item.id)) continue
      if (this.started.has(item.id) && !this.failed.has(item.id)) continue
      this.failed.delete(item.id)
      this.started.add(item.id)
      void this.process(item, onChange)
    }
  }

  private async process(item: DocShareItem, onChange: () => void) {
    // 재시도 1회(총 2회 시도) 후 실패 기록.
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        await this.fetchSem.acquire()
        let bytes: ArrayBuffer
        try { bytes = await item.fetchBytes() } finally { this.fetchSem.release() }
        let blobs: Blob[]
        if (item.toPng) {
          await this.pngSem.acquire()
          try { blobs = await this.toPngBlobs(bytes) } finally { this.pngSem.release() }
        } else {
          blobs = [new Blob([bytes], { type: 'application/pdf' })]
        }
        this.blobs.set(item.id, blobs)
        onChange()
        return
      } catch {
        if (attempt === 1) { this.failed.add(item.id); onChange() }
      }
    }
  }

  // 현재 선택 집합의 준비 상태.
  state(ids: string[]): DocShareState {
    const blobs = new Map<string, Blob[]>()
    let fileCount = 0
    for (const id of ids) {
      const b = this.blobs.get(id)
      if (b) { blobs.set(id, b); fileCount += b.length }
      else fileCount += 1
    }
    return { done: blobs.size, total: ids.length, failed: ids.filter(id => this.failed.has(id)), blobs, fileCount }
  }
}

/**
 * 첨부 파일명 정본 — `{이름}_{서류명}`, 같은 이름이 둘 이상이면 발급일 접미, 여러 장이면 `_1`.. 접미.
 *
 * **한 장짜리에는 장 번호를 붙이지 않는다.** 영수증·확인서 다건 보내기와 계약서 PDF 다건은 늘 한 장이라
 * 이 규칙이 곧 종전 파일명 그대로다(다페이지 확장의 무회귀 계약).
 *
 * pages 는 entries 와 같은 순서·길이여야 하고, 반환 배열은 항목 순서 안에서 장 순서로 평탄화된다 —
 * 호출부가 Blob 배열을 같은 순서로 평탄화해 짝지으면 된다.
 */
export function shareFileNames(
  entries: { personName: string; docLabel: string; dateStr: string }[],
  pages: number[],
  ext: string,
): string[] {
  const baseCount = new Map<string, number>()
  for (const e of entries) {
    const b = `${e.personName}_${e.docLabel}`
    baseCount.set(b, (baseCount.get(b) ?? 0) + 1)
  }
  const out: string[] = []
  entries.forEach((e, i) => {
    const base = `${e.personName}_${e.docLabel}`
    const stem = (baseCount.get(base) ?? 0) > 1 ? `${base}_${e.dateStr}` : base
    const n = Math.max(1, pages[i] ?? 1)
    for (let p = 1; p <= n; p++) out.push(`${stem}${n > 1 ? `_${p}` : ''}.${ext}`)
  })
  return out
}
