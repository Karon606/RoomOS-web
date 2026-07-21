'use client'

// 서류 다중 '보내기' 오케스트레이션 훅 — 큐 준비·상태 구독·전송(share)을 실거주확인서·납부확인서·계약서
// 3개 목록이 공유한다(선택 상태 관리는 페이지별, 큐·파일명·share 는 공용 — 3벌 복제 방지).
// 자동 share 절대 금지: 준비가 끝나도 사용자가 '보내기'를 탭할 때만 send() 를 호출한다(제스처 만료 재발 방지).

import { useCallback, useEffect, useRef, useState } from 'react'
import { DocShareQueue } from './docShareQueue'
import { shareFiles } from './shareFile'
import { pushToast } from './saveStatus'

export type DocShareEntry = {
  id: string                          // driveFileId
  personName: string                  // 이름(에러 토스트·파일명 기본)
  docLabel: string                    // '실거주확인서' | '입실료납부확인서' | '계약서'
  dateStr: string                     // 발급일/서명일 'YYYY.MM.DD'(파일명 충돌 시 접미)
  fetchBytes: () => Promise<ArrayBuffer>
}

// entries 는 현재 선택 항목을 표시 순서대로. mode 는 png(사진)·pdf.
export function useDocShare(entries: DocShareEntry[], mode: 'png' | 'pdf') {
  const queueRef = useRef<DocShareQueue | null>(null)
  if (!queueRef.current) queueRef.current = new DocShareQueue()
  const queue = queueRef.current
  // 연속 거부 카운트 — 재탭(신선한 제스처)마저 거부되면 실질 공유 불가 기기(주로 PC)로 판정, 무한 안내 방지
  const retryCount = useRef(0)

  const [, setTick] = useState(0)
  const onChange = useCallback(() => setTick(n => n + 1), [])

  // 최신 entries 를 ref 로 — send 클로저의 신선도 보장, 효과 의존성 최소화.
  const entriesRef = useRef(entries)
  entriesRef.current = entries

  const ids = entries.map(e => e.id)
  const idsKey = ids.join(',')

  const toItems = useCallback(
    () => entriesRef.current.map(e => ({ id: e.id, fetchBytes: e.fetchBytes, toPng: mode === 'png' })),
    [mode],
  )

  // 선택이 바뀔 때마다 새 항목만 준비(캐시는 유지). idsKey 로만 재실행.
  useEffect(() => {
    if (ids.length > 0) queue.enqueue(toItems(), onChange)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idsKey, mode])

  const st = queue.state(ids)
  const totalBytes = mode === 'pdf' ? [...st.blobs.values()].reduce((s, b) => s + b.size, 0) : undefined

  const send = useCallback(async () => {
    const es = entriesRef.current
    const s = queue.state(es.map(e => e.id))
    // all-or-nothing: 하나라도 실패면 시트를 열지 않고 재시도 + 이름 특정 토스트.
    if (s.failed.length > 0) {
      queue.enqueue(toItems(), onChange)
      const name = es.find(e => e.id === s.failed[0])?.personName ?? ''
      pushToast('error', `${name}님 서류 변환에 실패했습니다. 다시 시도해 주세요.`)
      return
    }
    if (s.done < es.length) return   // 아직 준비 중(버튼 비활성이지만 방어)

    const ext = mode === 'png' ? 'png' : 'pdf'
    const mime = mode === 'png' ? 'image/png' : 'application/pdf'
    // 파일명 = {이름}_{서류명}, 같은 이름 충돌 시 발급일 접미. 첨부 순서 = 표시 순서 고정.
    const baseCount = new Map<string, number>()
    for (const e of es) { const b = `${e.personName}_${e.docLabel}`; baseCount.set(b, (baseCount.get(b) ?? 0) + 1) }
    const files = es.map(e => {
      const base = `${e.personName}_${e.docLabel}`
      const name = `${(baseCount.get(base) ?? 0) > 1 ? `${base}_${e.dateStr}` : base}.${ext}`
      return new File([s.blobs.get(e.id) as Blob], name, { type: mime })
    })

    const result = await shareFiles(files)
    // 'shared'·'cancelled' 은 무반응(정상). 'retry' 는 재탭 유도, 'unsupported' 는 안내.
    if (result === 'retry') {
      retryCount.current += 1
      if (retryCount.current >= 2) pushToast('error', '이 기기에서는 공유 시트를 열 수 없습니다. 휴대폰에서 이용해 주세요.')
      else pushToast('info', '다시 한 번 눌러 주세요.')
    } else {
      retryCount.current = 0
      if (result === 'unsupported') pushToast('error', '이 기기에서는 파일 공유를 지원하지 않습니다.')
    }
  }, [mode, queue, onChange, toItems])

  return { done: st.done, failedCount: st.failed.length, totalBytes, send }
}
