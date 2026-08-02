// 입실료 납부 확인서 — 브랜드 가이드 v2.0 §26 + Claude Design A5 시안 반영.
// A5 세로, 인쇄전용 토큰(--p-*). pdf-lib 직접 그림.
// 폰트(v2.0 §26): Pretendard(public/fonts) Regular+Bold 임베드.
//   ※ 표준 .otf(CFF)는 pdf-lib 임베드 불가 → otf2ttf로 TTF 변환 후
//     post를 format3(글리프명 제거)+GSUB/GPOS 제거로 정리해야 함.
//     (cidXXXX 글리프명이 남으면 pdf-lib이 CID 폰트로 오인해 하이픈/물결 폭이 깨짐)
//   읽기 실패 시 나눔고딕(v2.0 §26 폴백) + faux-bold.

import { PDFDocument, type PDFFont } from 'pdf-lib'
import fontkit from '@pdf-lib/fontkit'
import { PRINT_RGB, SEAL_MM } from './printTokens'   // v2.0 §26 인쇄 토큰 단일 출처 · v2.0 §26 도장 18mm
import path from 'path'
import { readFile } from 'fs/promises'
import { getNanumGothic } from './residenceCertOverlay'

// 서류 종류 — 레이아웃(§26 A5 규격·좌표)은 두 종류가 동일하고 라벨·문구만 갈린다.
// 보증금은 귀속 월이 없고(1회성) 반환 예정 채무라 '납부'가 아닌 '수령' 어휘를 쓴다.
export type ReceiptKind = 'rent' | 'deposit'

export type RentReceiptFields = {
  issueDate: string      // YYYY-MM-DD (발행일)
  name: string           // 수령인(입주자) 성명
  room: string           // 호실
  period: string         // 거주 기간
  targetMonth: string    // 납부 대상월 (보증금이면 입주 예정일)
  amount: string         // 납부 금액 (숫자 위주 — ₩·한글 자동)
  payDate: string        // 납부일
  payMethod: string      // 납부방법
  note: string           // 비고
  recipientName: string  // 임대인 대표 성명
  kind?: ReceiptKind     // 미지정이면 'rent' — 기존 호출부 무회귀
  preResidence?: boolean // 보증금인데 아직 입주 전 — 예약금 성격이라 반환 조건이 다르다
}

// 입주 전 보증금(=예약금) 안내 — 입실 취소 시 반환되지 않는다는 점이 핵심(운영자 지시 2026-07-31).
// 한 줄을 넘기면 서명줄까지의 §26 최소 간격이 깨지므로 길이를 유지한다.
const DEPOSIT_PRE_NOTICE = '본 영수증은 상기 보증금의 수령 사실을 확인하며, 입실 취소 시 반환되지 않습니다.'

// 종류별 문구 — 표 4행 구조·좌표는 공유(행을 지우면 아래 금액 박스·표2 세로 리듬이 어긋난다).
const COPY: Record<ReceiptKind, { title: string; row4: string; amountLabel: string; dateLabel: string; methodLabel: string; notice: string; signNote: string }> = {
  rent: {
    title: '입실료 납부 확인서',
    row4: '납부 대상월',
    amountLabel: '납부 금액',
    dateLabel: '납 부 일',
    methodLabel: '납부방법',
    // '발행번호로 진위 확인이 가능합니다' 를 내렸다(2026-08-03). 번호가 DB 에 저장되지 않아
    // 대조할 원장이 없다. 미리보기·보내기에도 같은 번호가 찍혀 소비되지 않은 채 밖으로 나간다.
    // 원장화(receiptNo unique + 트랜잭션 채번)는 스키마 변경이라 별도 작업으로 뺐다.
    notice: '본 확인서는 상기 입실료의 납부 사실을 확인합니다. 발행 내역은 사업자에게 문의해 주세요.',
    signNote: '위 입실료의 납부 사실을 확인함',
  },
  deposit: {
    title: '보증금 영수증',
    row4: '입주 예정일',
    amountLabel: '보증금',
    dateLabel: '수 령 일',
    methodLabel: '수령방법',
    notice: '본 영수증은 상기 보증금의 수령 사실을 확인하며, 퇴실 시 미납금·손해배상액을 공제한 잔액을 반환합니다.',
    signNote: '위 보증금의 수령 사실을 확인함',
  },
}

export type RentReceiptBrand = {
  businessName: string
  bizLine1: string       // 사업자등록번호 · 대표
  bizLine2: string       // 주소 · 전화
  receiptNo: string      // 발행번호 (YYYYMMDD-NNN)
}

const MM = 2.83465
const PAGE_W = 148 * MM, PAGE_H = 210 * MM
const L = 14 * MM, R = PAGE_W - 14 * MM

// v2.0 §26 인쇄 토큰 — lib/printTokens.ts 단일 출처 참조(값 동일, 시각 변화 0)
const P_INK = PRINT_RGB.ink
const P_MUTED = PRINT_RGB.inkMuted
const P_TC = PRINT_RGB.tc
const P_LABEL_BG = PRINT_RGB.labelBg
const P_RULE = PRINT_RGB.rule
const P_RULE_STRONG = PRINT_RGB.ruleStrong
const P_AMOUNT_BG = PRINT_RGB.amountBg

const issueKor = (d: string) => { const [y, m, dd] = (d ?? '').split('-').map(Number); return Number.isFinite(y) ? `${y}년 ${m}월 ${dd}일` : (d ?? '') }
const onlyDigits = (s: string) => (s ?? '').replace(/[^0-9]/g, '')
const amountFmt = (a: string) => { const n = onlyDigits(a); if (!n) return a || ''; return /[₩원]/.test(a) ? a : `₩${Number(n).toLocaleString('ko-KR')}` }
const KO_D = ['', '일', '이', '삼', '사', '오', '육', '칠', '팔', '구'], KO_S = ['', '십', '백', '천'], KO_B = ['', '만', '억', '조']
function koreanWon(num: number): string {
  if (!num) return ''
  let s = ''; const groups: number[] = []; let x = num
  while (x > 0) { groups.push(x % 10000); x = Math.floor(x / 10000) }
  for (let g = groups.length - 1; g >= 0; g--) {
    const grp = groups[g]; if (!grp) continue
    const d = [grp % 10, Math.floor(grp / 10) % 10, Math.floor(grp / 100) % 10, Math.floor(grp / 1000) % 10]
    let gs = ''; for (let i = 3; i >= 0; i--) if (d[i]) gs += KO_D[d[i]] + KO_S[i]
    s += gs + KO_B[g]
  }
  return `금 ${s}원정`
}

export async function buildRentReceiptPdf(
  f: RentReceiptFields, brand: RentReceiptBrand,
  logoBytes: Uint8Array | null, stampBytes: Uint8Array | null,
): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  doc.registerFontkit(fontkit)
  let fontR: PDFFont, fontB: PDFFont, faux = false
  try {
    const dir = path.join(process.cwd(), 'public', 'fonts')
    const [rb, bb] = await Promise.all([
      readFile(path.join(dir, 'Pretendard-Regular.ttf')),
      readFile(path.join(dir, 'Pretendard-Bold.ttf')),
    ])
    fontR = await doc.embedFont(new Uint8Array(rb))
    fontB = await doc.embedFont(new Uint8Array(bb))
  } catch {
    fontR = fontB = await doc.embedFont(await getNanumGothic())  // v2.0 §26 폴백
    faux = true
  }
  const page = doc.addPage([PAGE_W, PAGE_H])

  const W = (t: string, s: number, b = false) => (b ? fontB : fontR).widthOfTextAtSize(t || '', s)
  const T = (t: string, x: number, y: number, s = 9.5, c = P_INK, bold = false) => {
    if (!t) return
    const fnt = bold ? fontB : fontR
    page.drawText(t, { x, y, size: s, font: fnt, color: c })
    if (bold && faux) page.drawText(t, { x: x + 0.3, y, size: s, font: fnt, color: c })  // 폴백일 때만 faux-bold
  }
  const TR = (t: string, xEnd: number, y: number, s: number, c = P_INK, bold = false) => T(t, xEnd - W(t, s, bold), y, s, c, bold)
  const fit = (t: string, x: number, y: number, maxW: number, start: number, c = P_INK, bold = false) => {
    let s = start; while (s > 7 && W(t, s, bold) > maxW) s -= 0.5; T(t, x, y, s, c, bold)
  }

  const top = PAGE_H - 12 * MM

  // ── 헤더 ──
  const logoH = 12 * MM
  if (logoBytes && logoBytes.length > 0) {
    try {
      const isPng = logoBytes[0] === 0x89 && logoBytes[1] === 0x50
      const img = isPng ? await doc.embedPng(logoBytes) : await doc.embedJpg(logoBytes)
      const w = Math.min((img.width / img.height) * logoH, logoH)
      page.drawImage(img, { x: L, y: top - logoH, width: w, height: logoH })
    } catch { /* 로고 실패 무시 */ }
  }
  const nameX = L + logoH + 4 * MM
  T(brand.businessName || '영수증', nameX, top - 11, 12, P_INK, true)
  fit(brand.bizLine1, nameX, top - 22, R - nameX, 7.5, P_MUTED)
  fit(brand.bizLine2, nameX, top - 31, R - nameX, 7.5, P_MUTED)
  TR(`발행번호  No. ${brand.receiptNo}`, R, top - 2, 7.5, P_MUTED)
  TR(`발행일  ${issueKor(f.issueDate)}`, R, top - 13, 7.5, P_MUTED)

  const ruleY = top - 15.5 * MM
  page.drawRectangle({ x: L, y: ruleY, width: R - L, height: 1.6, color: P_TC })

  // ── 제목 (좌측) ──
  const copy = COPY[f.kind ?? 'rent']
  const isDepositPre = f.kind === 'deposit' && !!f.preResidence
  const noticeText = isDepositPre ? DEPOSIT_PRE_NOTICE : copy.notice
  let y = ruleY - 6 * MM - 12
  T(copy.title, L, y, 17, P_INK, true)

  // ── 키-값 표 ──
  const labelW = 34 * MM, rowH = 8 * MM
  const drawKV = (rows: { label: string; value: string }[], tableTop: number) => {
    const bottom = tableTop - rowH * rows.length
    rows.forEach((r, i) => {
      const rt = tableTop - rowH * i
      page.drawRectangle({ x: L, y: rt - rowH, width: labelW, height: rowH, color: P_LABEL_BG })
      const by = rt - rowH / 2 - 3.2
      T(r.label, L + 3.5 * MM, by, 9, P_INK)
      fit(r.value, L + labelW + 3.5 * MM, by, R - (L + labelW + 3.5 * MM) - 2 * MM, 9.5, P_INK)
    })
    // 선: 외곽 0.6 / 내부 0.4
    page.drawRectangle({ x: L, y: bottom, width: R - L, height: tableTop - bottom, borderColor: P_RULE_STRONG, borderWidth: 0.6 })
    page.drawLine({ start: { x: L + labelW, y: tableTop }, end: { x: L + labelW, y: bottom }, thickness: 0.4, color: P_RULE })
    for (let i = 1; i < rows.length; i++) {
      const ly = tableTop - rowH * i
      page.drawLine({ start: { x: L, y: ly }, end: { x: R, y: ly }, thickness: 0.4, color: P_RULE })
    }
    return bottom
  }

  y -= 4.5 * MM
  const b1 = drawKV([
    { label: '수령인 (입주자)', value: f.name },
    { label: '호    실', value: f.room },
    { label: '거주 기간', value: f.period },
    { label: copy.row4, value: f.targetMonth },
  ], y)

  // ── 납부 금액 박스 ──
  const boxTop = b1 - 4.5 * MM, boxH = 14 * MM, boxBot = boxTop - boxH
  page.drawRectangle({ x: L, y: boxBot, width: R - L, height: boxH, color: P_AMOUNT_BG, borderColor: P_RULE_STRONG, borderWidth: 0.6 })
  T(copy.amountLabel, L + 5 * MM, boxBot + boxH / 2 - 3.5, 10, P_INK, true)
  TR(amountFmt(f.amount), R - 5 * MM, boxBot + boxH / 2 + 1, 14, P_TC, true)
  const won = koreanWon(Number(onlyDigits(f.amount)))
  if (won) TR(won, R - 5 * MM, boxBot + boxH / 2 - 8, 8, P_MUTED)

  // ── 키-값 표 2 ──
  const b2 = drawKV([
    { label: copy.dateLabel, value: f.payDate },
    { label: copy.methodLabel, value: f.payMethod },
    { label: '비    고', value: f.note },
  ], boxBot - 4.5 * MM)

  // ── 안내 문구 ──
  T(noticeText, L, b2 - 6 * MM, 7.5, P_MUTED)

  // ── 서명 · 도장 (하단 우측) ──
  const signLineY = 26 * MM
  T(copy.signNote, R - 84 * MM, signLineY + 11 * MM, 8, P_MUTED)
  const sigText = `임대인  ${brand.businessName}  대표  ${f.recipientName}`
  if (stampBytes && stampBytes.length > 0) {
    const SEAL = SEAL_MM * MM, sealLeft = R - SEAL, sealCx = R - SEAL / 2
    TR(sigText, sealLeft - 2 * MM, signLineY, 9.5, P_INK)            // 이름 — 도장 왼쪽(가려지지 않게)
    T('(인)', sealCx - W('(인)', 9.5) / 2, signLineY, 9.5, P_INK)     // (인) — 도장이 덮음 (v2.0 §26)
    try {
      const isPng = stampBytes[0] === 0x89 && stampBytes[1] === 0x50
      const img = isPng ? await doc.embedPng(stampBytes) : await doc.embedJpg(stampBytes)
      page.drawImage(img, { x: sealLeft, y: signLineY + 3 - SEAL / 2, width: SEAL, height: SEAL })
    } catch { /* 도장 실패 무시 */ }
  } else {
    TR(sigText + '   (인)', R, signLineY, 9.5, P_INK)
  }

  // ── 푸터 워드마크 ──
  const wmY = 9 * MM
  const preW = W('made with ', 8), stayW = W('stay', 8, true)
  const startX = R - (preW + stayW + W('eum', 8, true))
  T('made with ', startX, wmY, 8, P_MUTED)
  T('stay', startX + preW, wmY, 8, P_INK, true)
  T('eum', startX + preW + stayW, wmY, 8, P_TC, true)

  return await doc.save()
}
