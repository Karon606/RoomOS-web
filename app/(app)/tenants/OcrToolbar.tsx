'use client'

// 입주자 등록 폼 상단에 얹는 OCR 도우미.
// [계약서] 또는 [신분증] 클릭 → 파일 선택 → Gemini 분석 → 추출된 필드를 폼에 채움.
// 폼 안 controlled state 는 부모가 setter 로 채우고, uncontrolled <input name="X"> 들은
// 본 컴포넌트가 React 내부 setter 트릭으로 채운다.

import { useRef, useState } from 'react'
import { AiQuotaHint } from '@/components/ui/AiQuotaHint'
import { notifyAiQuota } from '@/lib/aiQuotaToast'
import { Btn } from '@/components/ui/Btn'
import { pushToast } from '@/lib/saveStatus'
import { fileToOcrImage } from '@/lib/ocrImage'
import {
  analyzeContractWithGemini, analyzeIdCardWithGemini,
  type ContractOcrResult, type IdCardOcrResult,
} from '@/app/(app)/tenants/actions'


// React controlled input 의 value 를 프로그래매틱하게 바꾸려면
// 네이티브 setter 호출 + input/change 이벤트 디스패치가 필요.
//
// :not(:disabled) 로 좁히는 이유 — 수정 창은 계약마다 폼을 한 벌씩 들고 지금 고르지 않은 것을
// fieldset[disabled] 로 숨긴다(LeaseEditForms). 이름이 같은 칸이 문서에 여럿 있게 되므로,
// 그냥 첫 번째를 잡으면 화면에 보이지도 않는 폼에 OCR 결과가 들어간다. 살아 있는 폼은 하나뿐이다.
export function setInputByName(name: string, value: string | undefined | null) {
  if (!value) return false
  const el = document.querySelector<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(`[name="${name}"]:not(:disabled)`)
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
      const { b64, mime } = await fileToOcrImage(f, 'document')
      const res = await analyzeContractWithGemini(b64, mime)
      if (!res.ok) { pushToast('error', res.error); return }
      void notifyAiQuota()
      const filled = Object.values(res.data).filter(v => v != null && v !== '').length
      if (filled === 0) { pushToast('error', '계약서에서 추출할 정보를 찾지 못했습니다.'); return }
      onContract(res.data)
      pushToast('success', `계약서에서 ${filled}개 항목 채움`)
    } catch (err) {
      // catch 가 없으면 전송 실패가 unhandled rejection 으로 새어 **아무 말도 안 나온다**
      // (긴급 신고 2026-09-03). 서버가 구분해 주는 오류는 위 res.error 가 이미 말하므로
      // 여기는 전송·미상 실패 전담이다.
      pushToast('error', (err as Error).message || '계약서 분석 중 통신 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.')
    } finally { setBusy(null) }
  }

  const handleId = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    e.target.value = ''
    if (!f) return
    setBusy('id')
    try {
      // 원본을 그대로 보내면 큰 사진에서 탭이 죽고 등록 폼 입력이 통째로 날아간다(lib/ocrImage).
      const { b64, mime } = await fileToOcrImage(f, 'document')
      const res = await analyzeIdCardWithGemini(b64, mime)
      if (!res.ok) { pushToast('error', res.error); return }
      void notifyAiQuota()
      const filled = Object.values(res.data).filter(v => v != null && v !== '').length
      if (filled === 0) { pushToast('error', '신분증에서 추출할 정보를 찾지 못했습니다.'); return }
      onIdCard(res.data)
      pushToast('success', `신분증에서 ${filled}개 항목 채움`)
    } catch (err) {
      pushToast('error', (err as Error).message || '신분증 분석 중 통신 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.')
    } finally { setBusy(null) }
  }

  // 토글로 접고 펴기 — 신분증 사진 강요하는 느낌 완화 (사용자 피드백 2026-06-01)
  const [open, setOpen] = useState(false)

  return (
    <div className="rounded-xl mb-3"
      style={{ background: 'var(--canvas)', border: '1px solid var(--warm-border)' }}>
      <button type="button"
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center justify-between px-3 py-2"
        aria-expanded={open}>
        <span className="text-[0.6875rem] font-medium" style={{ color: 'var(--warm-mid)' }}>
          사진으로 자동 채우기 (선택)
        </span>
        <span className="text-[0.6875rem]" style={{ color: 'var(--warm-muted)' }}>{open ? '접기 ▴' : '펼치기 ▾'}</span>
      </button>
      {open && (
        <div className="px-3 pb-3 flex items-center gap-2 flex-wrap">
          <Btn variant="secondary" size="sm" disabled={busy !== null}
            onClick={() => contractRef.current?.click()}>
            {busy === 'contract' ? '분석 중…' : '계약서'}
          </Btn>
          <Btn variant="secondary" size="sm" disabled={busy !== null}
            onClick={() => idRef.current?.click()}>
            {busy === 'id' ? '분석 중…' : '신분증'}
          </Btn>
          <AiQuotaHint />
          {/* capture 미지정 — 촬영뿐 아니라 앨범/파일의 기존 스캔본도 올릴 수 있게(촬영 강제 X) */}
          <input ref={contractRef} type="file" accept="image/*" className="hidden" onChange={handleContract} />
          <input ref={idRef} type="file" accept="image/*" className="hidden" onChange={handleId} />
          <p className="text-[0.65625rem] basis-full mt-0.5" style={{ color: 'var(--warm-muted)' }}>
            ※ 추출 결과는 자동으로 들어가니 반드시 확인 후 저장하세요.
          </p>
        </div>
      )}
    </div>
  )
}
