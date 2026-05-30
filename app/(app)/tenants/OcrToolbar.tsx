'use client'

// 입주자 등록 폼 상단에 얹는 OCR 도우미.
// [📄 계약서] 또는 [🪪 신분증] 클릭 → 파일 선택 → Gemini 분석 → 추출된 필드를 폼에 채움.
// 폼 안 controlled state 는 부모가 setter 로 채우고, uncontrolled <input name="X"> 들은
// 본 컴포넌트가 React 내부 setter 트릭으로 채운다.

import { useRef, useState } from 'react'
import { Btn } from '@/components/ui/Btn'
import { pushToast } from '@/lib/saveStatus'
import {
  analyzeContractWithGemini, analyzeIdCardWithGemini,
  type ContractOcrResult, type IdCardOcrResult,
} from '@/app/(app)/tenants/actions'

// 파일 → base64 (data URL prefix 제거)
async function fileToBase64(f: File): Promise<{ b64: string; mime: string }> {
  const buf = await f.arrayBuffer()
  let binary = ''
  const bytes = new Uint8Array(buf)
  for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i])
  return { b64: btoa(binary), mime: f.type || 'image/jpeg' }
}

// React controlled input 의 value 를 프로그래매틱하게 바꾸려면
// 네이티브 setter 호출 + input/change 이벤트 디스패치가 필요.
export function setInputByName(name: string, value: string | undefined | null) {
  if (!value) return false
  const el = document.querySelector<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(`[name="${name}"]`)
  if (!el) return false
  const proto = el instanceof HTMLSelectElement
    ? HTMLSelectElement.prototype
    : el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set
  if (!setter) return false
  setter.call(el, value)
  el.dispatchEvent(new Event('input', { bubbles: true }))
  el.dispatchEvent(new Event('change', { bubbles: true }))
  return true
}

export function OcrToolbar({ onContract, onIdCard }: {
  onContract: (data: ContractOcrResult) => void
  onIdCard: (data: IdCardOcrResult) => void
}) {
  const contractRef = useRef<HTMLInputElement>(null)
  const idRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState<'contract' | 'id' | null>(null)

  const handleContract = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    e.target.value = ''
    if (!f) return
    setBusy('contract')
    try {
      const { b64, mime } = await fileToBase64(f)
      const res = await analyzeContractWithGemini(b64, mime)
      if (!res.ok) { pushToast('error', res.error); return }
      const filled = Object.values(res.data).filter(v => v != null && v !== '').length
      if (filled === 0) { pushToast('error', '계약서에서 추출할 정보를 찾지 못했습니다.'); return }
      onContract(res.data)
      pushToast('success', `계약서에서 ${filled}개 항목 채움`)
    } finally { setBusy(null) }
  }

  const handleId = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    e.target.value = ''
    if (!f) return
    setBusy('id')
    try {
      const { b64, mime } = await fileToBase64(f)
      const res = await analyzeIdCardWithGemini(b64, mime)
      if (!res.ok) { pushToast('error', res.error); return }
      const filled = Object.values(res.data).filter(v => v != null && v !== '').length
      if (filled === 0) { pushToast('error', '신분증에서 추출할 정보를 찾지 못했습니다.'); return }
      onIdCard(res.data)
      pushToast('success', `신분증에서 ${filled}개 항목 채움`)
    } finally { setBusy(null) }
  }

  return (
    <div className="rounded-xl p-3 mb-3 flex items-center gap-2 flex-wrap"
      style={{ background: 'var(--canvas)', border: '1px solid var(--warm-border)' }}>
      <p className="text-[0.6875rem] font-medium mr-1" style={{ color: 'var(--warm-mid)' }}>
        📷 사진으로 자동 채우기
      </p>
      <Btn variant="secondary" size="sm" disabled={busy !== null}
        onClick={() => contractRef.current?.click()}>
        {busy === 'contract' ? '분석 중...' : '📄 계약서'}
      </Btn>
      <Btn variant="secondary" size="sm" disabled={busy !== null}
        onClick={() => idRef.current?.click()}>
        {busy === 'id' ? '분석 중...' : '🪪 신분증'}
      </Btn>
      <input ref={contractRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={handleContract} />
      <input ref={idRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={handleId} />
      <p className="text-[0.5625rem] basis-full mt-0.5" style={{ color: 'var(--warm-muted)' }}>
        ※ 추출 결과는 자동으로 들어가니 반드시 확인 후 저장하세요.
      </p>
    </div>
  )
}
