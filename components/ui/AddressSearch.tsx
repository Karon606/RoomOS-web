'use client'

import Script from 'next/script'
import { useEffect, useRef, useState } from 'react'
import { Modal } from './Modal'

// 다음(카카오) 우편번호 서비스 — 무료, API 키 불필요
const POSTCODE_SRC = 'https://t1.daumcdn.net/mapjsapi/bundle/postcode/prod/postcode.v2.js'

type DaumPostcodeData = {
  zonecode: string          // 우편번호
  roadAddress: string       // 도로명 주소
  jibunAddress: string      // 지번 주소
  userSelectedType: 'R' | 'J'
}

type DaumPostcode = new (opts: {
  oncomplete: (data: DaumPostcodeData) => void
  width?: string | number
  height?: string | number
}) => { embed: (el: HTMLElement) => void }

declare global {
  interface Window {
    daum?: { Postcode: DaumPostcode }
  }
}

type Props = {
  label?: string
  required?: boolean
  address: string                       // 우편번호 + 기본 주소
  detail: string                        // 상세주소
  onAddressChange: (v: string) => void
  onDetailChange: (v: string) => void
}

const inputStyle: React.CSSProperties = {
  background: 'var(--canvas)',
  border: '1px solid var(--warm-border)',
  color: 'var(--warm-dark)',
}
const inputCls = 'w-full px-3 py-2.5 rounded-sm text-sm outline-none transition-colors focus:border-[var(--persimmon)] focus:shadow-[0_0_0_3px_rgba(160,60,46,0.12)]'

export function AddressSearch({
  label,
  required,
  address,
  detail,
  onAddressChange,
  onDetailChange,
}: Props) {
  const [ready, setReady] = useState(false)
  const [open, setOpen]   = useState(false)
  const layerRef  = useRef<HTMLDivElement>(null)
  const onPickRef = useRef(onAddressChange)
  onPickRef.current = onAddressChange

  // 레이어가 열리면 우편번호 위젯을 임베드
  useEffect(() => {
    if (!open || !layerRef.current || !window.daum?.Postcode) return
    const el = layerRef.current
    el.innerHTML = ''
    new window.daum.Postcode({
      oncomplete: data => {
        const base = data.userSelectedType === 'R' ? data.roadAddress : data.jibunAddress
        onPickRef.current(`(${data.zonecode}) ${base}`)
        setOpen(false)
      },
      width: '100%',
      height: '100%',
    }).embed(el)
  }, [open])

  // 레이어가 열린 동안 배경 스크롤 잠금
  useEffect(() => {
    if (!open) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = prev }
  }, [open])

  return (
    <div>
      <Script
        src={POSTCODE_SRC}
        strategy="afterInteractive"
        onReady={() => setReady(true)}
        onError={() => console.error('우편번호 서비스 로드 실패')}
      />

      {label && (
        <label className="block text-xs font-medium mb-1 px-1" style={{ color: 'var(--warm-dark)' }}>
          {label}
          {required
            ? <span style={{ color: 'var(--persimmon)' }}> *</span>
            : <span style={{ color: 'var(--warm-muted)' }}> (선택)</span>}
        </label>
      )}

      <div className="flex gap-2">
        <input
          type="text"
          readOnly
          placeholder="주소 검색을 눌러주세요"
          value={address}
          onClick={() => ready && setOpen(true)}
          className={`${inputCls} cursor-pointer`}
          style={inputStyle}
        />
        <button
          type="button"
          disabled={!ready}
          onClick={() => setOpen(true)}
          className="shrink-0 px-3 py-2.5 rounded-lg text-sm font-medium transition-opacity disabled:opacity-50 whitespace-nowrap"
          style={{ background: 'var(--persimmon-l)', color: 'var(--persimmon)', border: '1px solid var(--warm-border)' }}
        >
          {ready ? '주소 검색' : '불러오는 중'}
        </button>
      </div>

      {address && (
        <input
          type="text"
          placeholder="상세주소 (동·호수 등)"
          value={detail}
          onChange={e => onDetailChange(e.target.value)}
          autoComplete="address-line2"
          className={`${inputCls} mt-2`}
          style={inputStyle}
        />
      )}

      {/* v2.0 §13 공용 Modal — backdrop·radius·ESC·포커스트랩·애니메이션 정본 상속.
          z=260(z-modal-2): 등록 폼 등 페이지 모달 안에서 열려도 그 위에 뜬다. */}
      <Modal open={open} onClose={() => setOpen(false)} title="주소 검색" width="md" z={260}>
        <div ref={layerRef} className="overflow-hidden rounded-b-2xl" style={{ height: 'min(520px, 72vh)' }} />
      </Modal>
    </div>
  )
}
