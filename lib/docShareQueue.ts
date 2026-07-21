// 서류 다중 '보내기' 준비 큐 — driveFileId 키 Blob 캐시 + 변환 큐(클라이언트 전용).
// 선택 즉시 백그라운드로 PDF fetch·(필요 시) PNG 변환을 미리 돌려, 사용자가 '보내기'를 탭하는
// 순간 제스처 만료 없이 곧바로 share() 를 호출하도록 준비한다(lib/shareFile.ts 제스처 규칙 참조).
// 체크 해제 시 취소는 하지 않는다 — 캐시를 유지해 재선택 시 즉시 준비됨.

import { pdfToPngBlob } from './pdfToPng'

export type DocShareItem = {
  id: string                          // driveFileId (캐시 키)
  fetchBytes: () => Promise<ArrayBuffer>
  toPng: boolean                      // true=PNG 변환(사진), false=PDF 원본
}

export type DocShareState = {
  done: number                        // 준비 완료 수
  total: number                       // 요청한 총 수
  failed: string[]                    // 재시도까지 실패한 id
  blobs: Map<string, Blob>            // 요청 id 중 준비된 Blob
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
  private blobs = new Map<string, Blob>()   // 완료 Blob
  private failed = new Set<string>()        // 재시도까지 실패
  private started = new Set<string>()       // 진행 중/완료(중복 착수 방지)
  private fetchSem = new Semaphore(2)
  private pngSem = new Semaphore(1)

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
        let blob: Blob
        if (item.toPng) {
          await this.pngSem.acquire()
          try { blob = await pdfToPngBlob(bytes) } finally { this.pngSem.release() }
        } else {
          blob = new Blob([bytes], { type: 'application/pdf' })
        }
        this.blobs.set(item.id, blob)
        onChange()
        return
      } catch {
        if (attempt === 1) { this.failed.add(item.id); onChange() }
      }
    }
  }

  // 현재 선택 집합의 준비 상태.
  state(ids: string[]): DocShareState {
    const blobs = new Map<string, Blob>()
    for (const id of ids) { const b = this.blobs.get(id); if (b) blobs.set(id, b) }
    return { done: blobs.size, total: ids.length, failed: ids.filter(id => this.failed.has(id)), blobs }
  }
}
