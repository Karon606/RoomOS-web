'use client'

// 전역 '오류·개선 신고' 플로팅 버튼 — 문제나 개선 아이디어를 직전 동작 자취 + 메모 + 사진으로 신고.
// 위치 이동: 꾹 누른 뒤(롱프레스) 끌면 원하는 곳으로 옮길 수 있고, 그 위치가 저장됨(모바일서 다른 UI 가림 방지).
// 짧게 탭 = 신고창 열기. (탭/이동 구분: 350ms 이상 누르면 이동 모드)
import { useState, useRef, useEffect } from 'react'
import { submitErrorReport, createErrorReportImageSession } from '@/app/(app)/errorReports'
import { uploadFileToDriveSession } from '@/lib/driveUpload'
import { pinPickedFile, PICK_READ_FAIL } from '@/lib/pickedFile'
import { fileToUploadPhoto, isUploadablePhoto, PHOTO_TYPE_FAIL } from '@/lib/uploadImage'
import { getCrumbs, lastError } from '@/lib/errorBreadcrumbs'
import { viewportProbe, probeAfterEntrance, probeReport, sentinelRect } from '@/lib/viewportProbe'
import { kbdTraceFreeze, kbdTraceTable, REPORT_NOTE_MAX, type KbdTraceFrozen } from '@/lib/kbdTrace'
import { readPadTrace, padTraceText } from '@/lib/signPadTrace'
import { Modal } from '@/components/ui/Modal'
import { Btn } from '@/components/ui/Btn'
import { pushToast, humanError } from '@/lib/saveStatus'

const STORAGE_KEY = 'errorReportBtnPos'
const BTN_SIZE = 48          // w-12 h-12
const EDGE = 8               // 화면 가장자리 최소 여백
const LONG_PRESS_MS = 350    // 이 시간 이상 누르면 '이동 모드'
const MOVE_CANCEL = 8        // 이동 모드 진입 전 이만큼 움직이면(스크롤 등) 취소
const MAX_IMAGES = 3         // 첨부 사진 최대 장수
const MAX_IMAGE_BYTES = 10 * 1024 * 1024   // 장당 10MB(줄인 뒤 크기로 잰다)
const FAIL_LINE_MAX = 300                  // 실패 원인 한 줄 상한(Drive 응답 본문이 길다)

// 첨부 사진 한 장. file 은 고르는 순간 만든 메모리 사본을 줄인 것이다(정본 lib/pickedFile, lib/uploadImage).
// 업로드가 실패해도 신고창은 닫지 않고 글·사진을 그대로 둔다. 실패 기록(fails)은 [사진 첨부] 블록으로 신고에 실린다.
type Shot = {
  id: string
  file: File
  url: string
  pickedAt: number
  orig: { type: string; size: number; ext: string }
  converted: boolean
  status: 'ready' | 'uploading' | 'done' | 'failed'
  fileId?: string
  fails: string[]
}

const kb = (n: number) => n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)}MB` : `${Math.round(n / 1024)}KB`
const extOf = (name: string) => (/\.([^.\\/]+)$/.exec(name)?.[1] ?? '').toLowerCase()

/**
 * [사진 첨부] 계측 블록(2026-11-03, 신고 4·7). 실패가 하나라도 있었을 때만 싣는다.
 * 한 장에 한 줄(결과 · 보낸 형식·크기·확장자 · 원본 · 고른 뒤 초)과 실패마다 단계(session|put)와 원인 한 줄.
 * 값만 담고 사진 내용은 담지 않는다.
 */
function shotsReport(shots: readonly Shot[], dropped: readonly Shot[], now: number): string {
  const all = [...shots.map(s => ({ s, dropped: false })), ...dropped.map(s => ({ s, dropped: true }))]
  if (!all.some(({ s }) => s.fails.length > 0)) return ''
  return all.map(({ s, dropped: d }, i) => {
    const head = `${i + 1}. ${d ? '뺌' : s.status === 'done' ? '올림' : '못 올림'} ${s.file.type || '(형식 없음)'} ${kb(s.file.size)} .${extOf(s.file.name) || '?'}` +
      ` (원본 ${s.orig.type || '(형식 없음)'} ${kb(s.orig.size)} .${s.orig.ext || '?'}${s.converted ? ', 줄임' : ''}) 고른 뒤 ${Math.round((now - s.pickedAt) / 1000)}초`
    return [head, ...s.fails.map(f => `   실패 ${f}`)].join('\n')
  }).join('\n')
}

export default function ErrorReportButton() {
  const [open, setOpen] = useState(false)
  const [note, setNote] = useState('')
  const [pending, setPending] = useState(false)
  // 첨부 사진. 업로드는 '신고 보내기' 시점에 수행(선택 시점 업로드는 취소 시 고아 파일이 남는다).
  // 바이트는 고르는 순간 메모리로 옮겨 둔다. 안드로이드 File 은 사진 앱 손잡이라 보낼 때 읽으면 깨졌다(신고 4·7).
  const [images, setImages] = useState<Shot[]>([])
  const fileInputRef = useRef<HTMLInputElement>(null)
  const imagesRef = useRef<Shot[]>([])
  const droppedRef = useRef<Shot[]>([])        // 실패 기록을 남긴 채 뺀 사진(계측 블록에만 쓴다)
  const [preparing, setPreparing] = useState(false)
  const [pickNote, setPickNote] = useState('')  // 그 자리 안내(읽기 실패는 다시 고르라고)
  const [progress, setProgress] = useState<{ cur: number; total: number } | null>(null)
  // 실패 발끝 틀을 세웠는가. 다시 올리거나 빼고 보내는 동안에도 내리지 않는다(발끝 모양이 오가며 창이 뛰지 않게,
  // 독립 디자이너 검수). 장수는 이 값이 아니라 그때그때 images 에서 센다(failedCount).
  const [failFrame, setFailFrame] = useState(false)
  // 열기·닫기마다 올린다. 업로드 도중 닫았거나 다시 열었으면 그 차례의 신고는 저장하지 않는다.
  const genRef = useRef(0)
  const [snapshot, setSnapshot] = useState<{ url: string; err: string | null; crumbs: { t: string; type: string; detail: string }[] }>({ url: '', err: null, crumbs: [] })

  // 이동(드래그) 상태 — pos=null 이면 기본 위치(우하단). 저장된 위치 있으면 그 좌표 사용.
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null)
  const [grabbing, setGrabbing] = useState(false)
  const btnRef = useRef<HTMLButtonElement>(null)
  const draggingRef = useRef(false)        // 이동 모드 진입 여부
  const movedRef = useRef(false)           // 실제로 옮겼는지
  const suppressClickRef = useRef(false)   // 이동 직후 뒤따르는 click(모달 열기) 억제
  const timerRef = useRef<number | null>(null)
  const pointerIdRef = useRef<number | null>(null)
  const startRef = useRef({ px: 0, py: 0, bx: 0, by: 0 })

  const clamp = (p: { x: number; y: number }) => {
    if (typeof window === 'undefined') return p
    const maxX = window.innerWidth - BTN_SIZE - EDGE
    // 하단 내비게이션 영역 제외 — 버튼(z 380)이 탭 바(z 100) 위에 얹혀 터치를 삼키던 문제(신고 63101912).
    // 저장된 옛 위치도 로드 시 이 clamp를 거치므로 자동 교정된다. 데스크톱은 내비가 없어(height 0) 제외 없음.
    const nav = document.querySelector('[data-bottom-nav]')
    const navRect = nav?.getBoundingClientRect()
    const navReserve = navRect && navRect.height > 0 ? Math.max(0, window.innerHeight - navRect.top) : 0
    const maxY = window.innerHeight - BTN_SIZE - EDGE - navReserve
    // 위쪽은 막지 않는다. 헤더 높이로도 옮길 수 있다(2026-10-27 운영자 지시. 상단 흐림은 헤더 고정으로 해결돼 위치 제한이 불필요).
    return { x: Math.max(EDGE, Math.min(p.x, maxX)), y: Math.max(EDGE, Math.min(p.y, maxY)) }
  }

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (raw) {
        const p = JSON.parse(raw)
        if (typeof p?.x === 'number' && typeof p?.y === 'number') setPos(clamp(p))
      }
    } catch { /* noop */ }
    // 화면 회전·리사이즈 시 버튼이 화면 밖으로 나가지 않게 재보정
    const onResize = () => setPos(prev => (prev ? clamp(prev) : prev))
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  // 신고창이 뜬 그 순간의 화면 기하 — 제출 시점 계측과 나란히 싣는다(2026-09-17).
  // 사진을 붙이려면 사진 앱을 다녀와야 하고 그 왕복이 visibilitychange 로 settle()·resync() 를
  // 깨워서, 제출할 때는 화면이 이미 나아 있다. 깨진 신고와 멀쩡한 신고의 계측이 한 글자도 다르지
  // 않았던 것이 그래서다(bf0a6fff 대 be42800d). 언제 재는지는 정본 probeAfterEntrance 가 정한다 —
  // 벽시계가 아니라 등장 모션이 실제로 끝났는지를 신호로 쓴다. 메모리에만 두고 최근 한 번만 남긴다.
  const openedProbeRef = useRef<string | null>(null)
  useEffect(() => {
    if (!open) return
    openedProbeRef.current = null
    return probeAfterEntrance(p => { openedProbeRef.current = p })
  }, [open])

  // 직전 키보드 세션(키보드 가림 패널 0단계, 2026-10-13) — 신고창을 여는 순간 링버퍼를 얼린다.
  // 신고창의 메모 칸이 키보드를 다시 띄우면 그 세션이 직전 세션을 밀어내기 때문이다. 값만 담는다
  // (경계는 lib/kbdTrace 머리말). 메모리에만 두고 최근 한 번만 남긴다.
  // 누른 그 순간의 센티널(H·T0)도 같은 줄에 싣는다. 메모 칸이 autoFocus 라 열린 뒤의 계측은 전부
  // 신고창 자기 세션이고, 원래 칸이 아직 포커스를 쥐고 팬 상태가 남은 때는 누른 이 순간뿐이다.
  const traceRef = useRef<KbdTraceFrozen | null>(null)

  // 미리보기 objectURL 정리 — 언마운트 시 남은 것 일괄 해제(선택 취소·삭제 때는 개별 해제)
  useEffect(() => { imagesRef.current = images }, [images])
  useEffect(() => () => { imagesRef.current.forEach(im => URL.revokeObjectURL(im.url)) }, [])

  const clearTimer = () => { if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null } }

  const onPointerDown = (e: React.PointerEvent<HTMLButtonElement>) => {
    const rect = btnRef.current?.getBoundingClientRect()
    startRef.current = { px: e.clientX, py: e.clientY, bx: rect?.left ?? 0, by: rect?.top ?? 0 }
    pointerIdRef.current = e.pointerId
    movedRef.current = false
    draggingRef.current = false
    clearTimer()
    timerRef.current = window.setTimeout(() => {
      // 꾹 누름 → 이동 모드 진입(시각 신호 + 포인터 캡처로 손가락이 버튼 밖으로 나가도 추적)
      draggingRef.current = true
      setGrabbing(true)
      try { if (pointerIdRef.current != null) btnRef.current?.setPointerCapture(pointerIdRef.current) } catch { /* noop */ }
    }, LONG_PRESS_MS)
  }

  const onPointerMove = (e: React.PointerEvent<HTMLButtonElement>) => {
    const dx = e.clientX - startRef.current.px
    const dy = e.clientY - startRef.current.py
    if (!draggingRef.current) {
      if (Math.hypot(dx, dy) > MOVE_CANCEL) clearTimer()   // 이동 모드 전 움직임 = 탭/스크롤 → 진입 취소
      return
    }
    e.preventDefault()
    movedRef.current = true
    setPos(clamp({ x: startRef.current.bx + dx, y: startRef.current.by + dy }))
  }

  const endDrag = (e: React.PointerEvent<HTMLButtonElement>) => {
    clearTimer()
    if (draggingRef.current) {
      draggingRef.current = false
      setGrabbing(false)
      try { btnRef.current?.releasePointerCapture(e.pointerId) } catch { /* noop */ }
      // 이동 모드였으면(움직였든 아니든) 뒤따르는 click(모달)은 억제 — '탭=열기 / 길게=이동' 명확히
      suppressClickRef.current = true
      setTimeout(() => { suppressClickRef.current = false }, 60)
      if (movedRef.current) {
        setPos(prev => {
          if (prev) { try { localStorage.setItem(STORAGE_KEY, JSON.stringify(prev)) } catch { /* noop */ } }
          return prev
        })
      }
    }
  }

  const openModal = () => {
    if (suppressClickRef.current) return   // 이동 직후 click 무시
    traceRef.current = kbdTraceFreeze(sentinelRect())
    // 여는 순간의 맥락을 고정(이후 이동해도 신고엔 '그 순간'이 담김)
    setSnapshot({
      url: typeof window !== 'undefined' ? window.location.href : '',
      err: lastError(),
      crumbs: getCrumbs(),
    })
    setNote('')
    clearImages()
    genRef.current++
    setOpen(true)
  }

  const clearImages = () => {
    droppedRef.current = []
    setPickNote('')
    setFailFrame(false)
    setImages(prev => { prev.forEach(im => URL.revokeObjectURL(im.url)); return [] })
  }

  // 닫으면 진행 상태도 비운다. 도중에 닫은 업로드는 gen 이 달라 결과를 버리고, 그 finally 는 새 창의 상태를 건드리지 않는다.
  const closeModal = () => { genRef.current++; clearImages(); setPending(false); setProgress(null); setOpen(false) }

  // 고르는 그 순간 메모리 사본(정본 lib/pickedFile)을 만들고 줄여 둔다(lib/uploadImage fileToUploadPhoto, 긴 변 2048 · 0.85).
  // 읽기가 깨지면 그 자리에서 다시 고르라고 말한다. 보낼 때까지 미루면 이미 쓴 글과 함께 할 일이 늘어난다.
  const onPickImages = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const picked = Array.from(e.target.files ?? [])
    e.target.value = ''   // 같은 파일 재선택도 change 가 발생하도록
    if (picked.length === 0) return
    const gen = genRef.current
    setPickNote('')
    setPreparing(true)
    try {
      const added: Shot[] = []
      let overSize = 0
      let overCount = false
      let unreadable = 0
      let unsupported = 0
      for (const f of picked) {
        if (imagesRef.current.length + added.length >= MAX_IMAGES) { overCount = true; break }
        let pinned: File
        try { pinned = await pinPickedFile(f) } catch { unreadable++; continue }
        const { file, converted } = await fileToUploadPhoto(pinned)
        // 형식이 비면 확장자로 채운 뒤에도 이미지가 아니면 고르는 자리에서 거절한다(서버의 이미지 형식 문에서 걸릴 파일).
        if (!isUploadablePhoto(file)) { unsupported++; continue }
        if (file.size > MAX_IMAGE_BYTES) { overSize++; continue }
        added.push({
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          file, url: URL.createObjectURL(file), pickedAt: Date.now(),
          orig: { type: f.type, size: pinned.size, ext: extOf(f.name) },
          converted, status: 'ready', fails: [],
        })
      }
      // 고르는 사이 창을 닫았으면 담지 않는다(닫힌 창에 사진이 남는다).
      if (gen !== genRef.current) { added.forEach(a => URL.revokeObjectURL(a.url)); return }
      if (added.length > 0) setImages(prev => [...prev, ...added])
      setPickNote([
        unreadable > 0 ? (unreadable === 1 ? PICK_READ_FAIL : `사진 ${unreadable}장을 읽지 못했어요. 다시 골라 주세요.`) : '',
        unsupported > 0 ? PHOTO_TYPE_FAIL : '',
      ].filter(Boolean).join(' '))
      if (overSize > 0) pushToast('info', `사진 ${overSize}장은 10MB를 넘어 제외했어요.`)
      if (overCount) pushToast('info', `사진은 최대 ${MAX_IMAGES}장까지 첨부할 수 있어요.`)
    } finally { setPreparing(false) }
  }

  const removeImage = (id: string) => setImages(prev => {
    const target = prev.find(im => im.id === id)
    if (target) {
      URL.revokeObjectURL(target.url)
      // 실패 기록이 있는 사진은 빼도 계측에는 남긴다(왜 못 올렸는지가 이 신고의 증거일 수 있다).
      if (target.fails.length > 0) droppedRef.current = [...droppedRef.current, target]
    }
    return prev.filter(im => im.id !== id)
  })

  // 한 장 올리기. 세션 또는 PUT 이 깨지면 한 번 더 시도한다(새 세션부터, 끊긴 세션 주소는 다시 못 쓴다).
  // 실패마다 단계와 원인을 남긴다. 종전에는 catch 가 원인을 버려 신고 4·7 이 '몇 장 실패' 말고는 아무것도 남기지 못했다.
  const uploadShot = async (im: Shot): Promise<{ id: string } | { fails: string[] }> => {
    const fails: string[] = []
    for (let attempt = 0; attempt < 2; attempt++) {
      let stage: 'session' | 'put' = 'session'
      try {
        const session = await createErrorReportImageSession({
          fileName: im.file.name,
          mimeType: im.file.type || 'application/octet-stream',
          fileSize: im.file.size,
          origin: window.location.origin,
        })
        if (!session.ok) { fails.push(`session ${session.error}`.slice(0, FAIL_LINE_MAX)); continue }
        stage = 'put'
        return { id: await uploadFileToDriveSession(session.uploadUrl, im.file) }
      } catch (err) {
        fails.push(`${stage} ${(err as Error)?.message ?? String(err)}`.slice(0, FAIL_LINE_MAX))
      }
    }
    return { fails }
  }

  // 보내기. 사진이 전부 올라가거나(또는 실패한 사진을 빼고 보내기로 했을 때)만 신고를 저장한다.
  // 실패하면 창을 닫지 않고 글·사진을 그대로 둔 채 [사진 다시 올리기]·[사진 빼고 보내기] 를 세운다.
  // 사진 일부만 붙은 신고가 먼저 저장되고 다시 보내면 같은 신고가 둘이 되던 길을 막는다.
  const submit = async (dropFailed = false) => {
    if (pending) return
    const gen = genRef.current
    setPending(true)
    // 화면 기하는 **첫 await 전에** 잰다. 사진 업로드는 초 단위라 그 사이 키보드가 닫히면
    // 정작 알고 싶은 그 순간의 기하가 아니라 업로드가 끝난 뒤의 기하가 담긴다.
    // 열었을 때의 스냅샷과 나란히 적는다 — 둘이 다르면 정본 probeReport 가 달라진 줄을 짚는다.
    const probe = probeReport(openedProbeRef.current, viewportProbe())
    // 서명 패드 계측(신고 c6eb427d). 이 탭에서 최근 6시간 안에 연 패드 세션의 수만 담는다(좌표·이미지 없음, lib/signPadTrace 머리말).
    // 대면 서명은 계약서 화면(앱 셸 밖이라 신고 버튼이 없다)에서 받고, 돌아와 입주자 화면에서 신고하므로 탭 저장소로 넘긴다.
    const padText = padTraceText(readPadTrace(), Date.now())
    const pad = padText ? `[서명 패드]\n${padText}` : ''
    try {
      // 빼고 보내기면 실패한 사진을 내려놓되 실패 기록은 계측에 남긴다.
      let shots = imagesRef.current.map(im => ({ ...im }))
      if (dropFailed) {
        const out = shots.filter(im => im.status === 'failed')
        out.forEach(im => URL.revokeObjectURL(im.url))
        droppedRef.current = [...droppedRef.current, ...out]
        shots = shots.filter(im => im.status !== 'failed')
        setImages(shots)
      }
      const todo = shots.filter(im => im.status !== 'done')
      for (const [i, im] of todo.entries()) {
        setProgress({ cur: i + 1, total: todo.length })
        im.status = 'uploading'
        setImages(shots.map(x => ({ ...x })))
        const r = await uploadShot(im)
        if (gen !== genRef.current) return
        if ('id' in r) { im.status = 'done'; im.fileId = r.id }
        else { im.status = 'failed'; im.fails = [...im.fails, ...r.fails].slice(-4) }
        setImages(shots.map(x => ({ ...x })))
      }
      setProgress(null)
      const failedNow = shots.filter(im => im.status === 'failed').length
      if (failedNow > 0) { setFailFrame(true); return }   // 창은 그대로, 발끝이 다시 올리기·빼고 보내기로 바뀐다

      // 계측을 메모 **뒤에** 덧붙인다(2026-09-08). 운영자가 읽는 문장이 먼저고 계측은 뒤다 —
      // 메모가 길어 서버에서 잘리더라도 밀려나는 것은 계측 쪽이다.
      // 담는 것과 안 담는 것(개인정보 경계)은 lib/viewportProbe 머리말에 있다. 값은 안 담는다.
      // [사진 첨부] 는 메모 바로 뒤다(이 신고 클래스의 증거라 화면 계측보다 앞에 둔다).
      const photo = shotsReport(shots, droppedRef.current, Date.now())
      const photoBlock = photo ? `[사진 첨부]\n${photo}` : ''
      // 키보드 세션 표는 계측 덩이 맨 끝에 붙는다. 서버가 메모를 REPORT_NOTE_MAX 에서 자르므로 메모·
      // 계측이 쓰고 남은 자리만큼만 싣는다(넘치면 정본이 판정이 그대로인 줄부터 덜어낸다).
      const trace = probe ? kbdTraceTable(traceRef.current, REPORT_NOTE_MAX - note.trim().length - probe.length - pad.length - photoBlock.length - 20) : ''
      const noteWithProbe = [note.trim(), photoBlock, probe && `[화면 계측]\n${[probe, trace].filter(Boolean).join('\n')}`, pad].filter(Boolean).join('\n\n')
      const imageFileIds = shots.flatMap(im => im.fileId ? [im.fileId] : [])

      const res = await submitErrorReport({
        url: snapshot.url,
        userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : undefined,
        breadcrumbs: snapshot.crumbs,
        errorText: snapshot.err ?? undefined,
        userNote: noteWithProbe || undefined,
        imageFileIds: imageFileIds.length > 0 ? imageFileIds : undefined,
      })
      if (gen !== genRef.current) return
      if (res.ok) {
        pushToast('success', '신고가 접수되었습니다. 확인 후 처리할게요.')
        closeModal()
      }
      else { setFailFrame(false); pushToast('error', res.error) }
    } catch (err) {
      // 서버 액션이 망 오류로 던져도 글과 사진은 그대로 두고 알린다(올린 사진은 done 이라 다시 보내도 안 올린다).
      if (gen === genRef.current) pushToast('error', humanError(err, '신고를 보내지 못했어요. 잠시 뒤 다시 보내 주세요.'))
    } finally {
      // 도중에 닫았거나 다시 열었으면 새 창의 상태를 건드리지 않는다(closeModal 이 이미 비웠다).
      if (gen === genRef.current) { setPending(false); setProgress(null) }
    }
  }

  const failedCount = images.filter(im => im.status === 'failed').length
  // 진행 라벨은 짧게 둔다. 기본 발끝은 형제 모달처럼 나란히라 320px 에서 버튼 글자 자리가 87px 남짓이다.
  // 실측(320px, 버튼 119px): '올리는 중… 1/3'·'올리는 중… (1/3)' 은 두 줄(62px)로 접히고 '올리는 중 1/3' 만 한 줄(44px)이다.
  const sendLabel = progress ? `올리는 중 ${progress.cur}/${progress.total}` : pending ? '신고 중…' : '신고 보내기'

  return (
    <>
      <button
        ref={btnRef}
        data-peek-hide
        type="button"
        onClick={openModal}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onContextMenu={e => e.preventDefault()}
        aria-label="오류·개선 신고 (길게 눌러 위치 이동)"
        title="오류·개선 신고. 길게 눌러 끌면 위치를 옮길 수 있어요"
        className={`fixed z-[var(--z-report)] w-12 h-12 rounded-full shadow-lift flex items-center justify-center ${grabbing ? 'scale-110 ring-4 ring-white/60 cursor-grabbing' : 'transition-transform active:scale-95'} ${pos ? '' : 'right-4'}`}
        style={{
          background: 'var(--coral)',
          color: 'var(--on-solid)',
          touchAction: 'none',
          userSelect: 'none',
          WebkitUserSelect: 'none',
          WebkitTouchCallout: 'none',
          // 기본 위치 — 토스트와 같은 회피 계산식(모바일 4.5rem = 하단 내비 위, 데스크톱 24px)
          ...(pos ? { left: pos.x, top: pos.y } : { bottom: 'calc(var(--toast-offset-bottom, 24px) + env(safe-area-inset-bottom))' }),
        }}
      >
        {/* 버그/경고 아이콘 */}
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M12 9v4M12 17h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" />
        </svg>
      </button>

      <Modal open={open} onClose={closeModal} title="오류·개선 신고" subtitle="문제도, 개선 아이디어도 좋아요."
        z={380} dirty={!!note.trim() || images.length > 0}   /* 프리즘(z 320) 등 어떤 화면 위에서도 최상단(신고 e781fcdf) + 작성 중 보호 */
        // 취소·보내기는 발끝(§13 푸터 취소 좌·확인 우)이다. 키보드가 떠도 접지 않는다(푸터 접힘 옵트인을 켜지 않는다).
        // 보내기가 이 창의 저장 버튼이라 글을 쓰는 동안에도 보여야 한다(§27.1).
        // 실패 발끝만 400px 미만에서 위아래로 선다(주 동작이 위). '사진 빼고 보내기' 가 320px 에서 두 줄로 접혔다(스크린샷 확인).
        // 다시 올리거나 빼고 보내는 동안에도 실패 발끝 틀을 지키고, 실패 장수가 0 이 되면 안내 줄은 자리만 지킨다.
        footer={failFrame ? (
          <div className="space-y-2">
            <p role="alert" className={`text-xs text-[var(--danger-fg)] break-keep${failedCount === 0 ? ' invisible' : ''}`}>
              사진 {failedCount}장을 올리지 못했어요. 다시 올리거나 빼고 보내 주세요.
            </p>
            <div className="flex flex-col-reverse gap-2 min-[400px]:flex-row">
              <Btn type="button" variant="secondary" onClick={() => void submit(true)} disabled={pending || preparing} fullWidth>사진 빼고 보내기</Btn>
              <Btn type="button" variant="primary" onClick={() => void submit()} disabled={pending || preparing} fullWidth>{pending ? sendLabel : '사진 다시 올리기'}</Btn>
            </div>
          </div>
        ) : (
          <div className="flex gap-2">
            <Btn type="button" variant="secondary" onClick={closeModal} disabled={pending} fullWidth>취소</Btn>
            <Btn type="button" variant="primary" onClick={() => void submit()} disabled={pending || preparing} fullWidth>
              {sendLabel}
            </Btn>
          </div>
        )}>
        <div className="space-y-3">
          <p className="text-xs text-[var(--warm-muted)]">
            현재 화면과 직전 동작 자취가 자동으로 함께 전송됩니다. 어떤 동작에서 문제가 생겼는지 적어주시면 더 빨리 고칠 수 있어요.
          </p>
          <textarea
            value={note}
            onChange={e => setNote(e.target.value)}
            rows={4}
            autoFocus
            // iOS QuickType 의 주소·연락처 자동완성 대신 맞춤법 교정을 유도(운영자 요청). autoComplete off 로
            // 폼 자동완성을 끄고 spellCheck/autoCorrect 로 교정 활성 — 단 iOS 연락처 제안 완전 차단은 보장 안 됨.
            autoComplete="off"
            autoCorrect="on"
            autoCapitalize="sentences"
            spellCheck={true}
            placeholder="예: 수납 저장을 눌렀더니 금액이 0으로 바뀌었어요. 예: 고객 목록에서 방 번호로 바로 찾을 수 있으면 좋겠어요."
            className="w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-3 py-2 text-sm text-[var(--warm-dark)] outline-none focus:border-[var(--coral)] resize-none"
          />

          {/* 사진 첨부 — 선택 사항이라 빈 드롭존 없이 텍스트 버튼만 상시 노출 */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-[var(--warm-mid)]">사진 첨부 (선택)</span>
              {/* 누르는 자리 44px(§09). 글자 크기는 그대로 두고 높이와 좌우 여백만 넓힌다. */}
              <button type="button" onClick={() => fileInputRef.current?.click()} disabled={preparing || pending}
                className="-mr-2 inline-flex min-h-11 items-center px-2 text-xs text-[var(--tc-text)] disabled:opacity-50">
                {preparing ? '사진 준비 중…' : '+ 사진 선택'}
              </button>
            </div>
            <input ref={fileInputRef} type="file" accept="image/*" multiple onChange={e => void onPickImages(e)} className="hidden" />
            {pickNote && <p role="alert" className="text-xs text-[var(--danger-fg)] break-keep">{pickNote}</p>}
            {images.length > 0 && (
              <div className="grid grid-cols-3 gap-2">
                {images.map(im => (
                  <div key={im.id} className={`relative aspect-square rounded-lg overflow-hidden bg-[var(--canvas)]${im.status === 'failed' ? ' outline-2 -outline-offset-2 outline-[var(--danger-solid)]' : ''}`}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={im.url} alt="" className="w-full h-full object-cover" />
                    {/* 올리는 중은 덮개 스피너만(퍼센트 막대 없음). 진행 장수는 보내기 버튼이 말한다. */}
                    {im.status === 'uploading' && (
                      <div className="absolute inset-0 grid place-items-center bg-black/40" aria-hidden="true">
                        <svg className="animate-spin [animation-duration:0.8s]" width="20" height="20" viewBox="0 0 24 24" fill="none"
                          stroke="var(--on-solid)" strokeWidth="2.5" strokeLinecap="round"><path d="M12 3a9 9 0 1 0 9 9" /></svg>
                      </div>
                    )}
                    {/* 실패 테두리는 안쪽 outline(본문 정렬선을 넘지 않는다)이고 아래 띠와 같은 --danger-solid 다(다크에서 두 빨강이 갈리지 않게). */}
                    {im.status === 'failed' && (
                      <span className="absolute inset-x-0 bottom-0 bg-[var(--danger-solid)] py-0.5 text-center text-[0.6875rem] font-medium text-[var(--on-solid)]">올리지 못함</span>
                    )}
                    {/* 모바일 사용이 많아 삭제 버튼은 상시 노출(hover 로 숨기지 않음). 누르는 자리는 44px(§09), 보이는 원은 24px. */}
                    <button
                      type="button"
                      onClick={() => removeImage(im.id)}
                      disabled={pending}
                      aria-label="사진 삭제"
                      className="absolute top-0 right-0 w-11 h-11 flex items-start justify-end p-1 text-[var(--on-solid)] disabled:opacity-50"
                    >
                      <span className="w-6 h-6 bg-black/70 rounded-full flex items-center justify-center">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                          <path d="M18 6 6 18M6 6l12 12" />
                        </svg>
                      </span>
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* 자동 캡처 맥락 미리보기 */}
          <details className="rounded-lg bg-[var(--canvas)] border border-[var(--warm-border)] px-3 py-2">
            <summary className="cursor-pointer text-[0.6875rem] font-semibold text-[var(--warm-mid)]">함께 보내는 정보 보기</summary>
            <div className="mt-2 space-y-1 text-[0.65625rem] text-[var(--warm-muted)] break-all">
              <div><span className="text-[var(--warm-mid)]">화면:</span> {snapshot.url || '—'}</div>
              {snapshot.err && <div><span className="text-[var(--danger-fg)]">최근 에러:</span> {snapshot.err}</div>}
              <div className="text-[var(--warm-mid)] mt-1">직전 동작:</div>
              <ul className="space-y-0.5">
                {snapshot.crumbs.length === 0 ? <li>—</li> : snapshot.crumbs.slice(-8).reverse().map((c, i) => (
                  <li key={i}>· [{c.type}] {c.detail}</li>
                ))}
              </ul>
            </div>
          </details>
        </div>
      </Modal>
    </>
  )
}
