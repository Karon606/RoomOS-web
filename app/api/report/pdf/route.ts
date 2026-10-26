// 결산 보고서(연간)를 PDF 로 뽑는 관문. 아이폰 홈화면 앱의 공유 시트 인쇄가 받는 바이트다. 아무것도 저장하지 않는다.
//
// 왜 있나(신고 2e41ddb1, "결산보고서에서 pdf버튼은 눌러도 아예 반응이 없어"). 아이폰 홈화면 앱
// (display: standalone)에서는 window.print() 가 아무 일도 하지 않는다. 그 환경의 유일한 인쇄 운반로는
// 공유 시트의 [프린트]이고(lib/useDocPrint 정본), 시트에 넘길 PDF 가 필요하다. 이 라우트가 그것을 만든다.
// 그 밖의 환경은 이 라우트를 부르지 않는다. 화면을 window.print() 로 찍는 종전 그대로다.
//
// **부르는 때는 탭 한 번뿐이다.** 화면이 열릴 때 미리 만들지 않는다. chromium 콜드가 비싸서
// (knowledge/vercel-usage.md) 아무도 인쇄하지 않는 방문에 CPU 를 태우지 않는다. 같은 연도를 다시
// 누르면 화면이 받은 바이트를 다시 쓴다(useShareSheetPrint 의 열쇠별 캐시).
//
// **아무것도 저장하지 않는다.** prisma 쓰기도 uploadToDrive 도 없다. 되돌릴 상태가 없으므로
// 적용취소도 없다(번역본 검수 종이 라우트와 같은 경계).
//
// **영업장 경계는 관문 하나다.** 숫자는 화면이 받는 정본(getAnnualReport)이 관문의 영업장(쿠키)으로
// 계산한다. 질의문자열의 propertyId 는 범위를 정하는 데 쓰지 않고 **대조에만** 쓴다. 다른 탭에서
// 영업장을 바꾸면 쿠키가 바뀌어, 화면은 A 영업장인데 종이는 B 영업장 숫자로 나간다. 화면이 그린
// 영업장과 관문의 영업장이 다르면 409 로 멈추고 새로고침을 부탁한다.
//
// **연도는 화면과 같은 파서(parseReportYear)와 같은 출처(getAvailableYears, 자료가 있는 연도)로 본다.**
// 올해는 자료가 아직 없어도 받는다. 화면의 기본 연도가 올해라 그 종이가 막히면 안 된다.

import { NextResponse } from 'next/server'
import puppeteer from 'puppeteer-core'
import chromium from '@sparticuz/chromium'
import prisma from '@/lib/prisma'
import { createClient } from '@/lib/supabase/server'
import { getPropertyAccess } from '@/lib/auth/propertyAccess'
import { canReadScope } from '@/lib/auth/routeScope'
import { getAnnualReport, getAvailableYears } from '@/app/(app)/report/actions'
import { getPretendardBase64 } from '@/lib/contractPrintHtml'
import { driveImageDataUrl } from '@/lib/google-drive'
import { printPageNumberFooterTemplate } from '@/lib/printBrandHtml'
import { buildReportPrintHtml } from '@/lib/reportPrintHtml'
import { parseReportYear, isReportYearAllowed } from '@/lib/reportShared'
import { kstMonthStr } from '@/lib/kstDate'
import { fmtDateKor } from '@/lib/fmtDate'

// puppeteer + chromium 은 nodejs runtime 필수. 콜드 스타트 고려해 maxDuration 60s.
export const runtime = 'nodejs'
export const maxDuration = 60
export const dynamic = 'force-dynamic'

/** setContent 대기 상한. 계약서 라우트와 같은 15초다. 재료가 Pretendard 한 벌로 같다. */
const SET_CONTENT_TIMEOUT_MS = 15000

type Timings = Record<string, number>
async function step<T>(t: Timings, key: string, fn: () => Promise<T>): Promise<T> {
  const at = Date.now()
  try { return await fn() } finally { t[key] = Date.now() - at }
}

const fail = (status: number, error: string, code?: string) =>
  NextResponse.json({ ok: false, error, ...(code ? { code } : {}) }, { status })

/** 다른 탭에서 영업장을 바꾼 뒤의 답. 화면이 그대로 토스트로 띄운다. */
const PROPERTY_CHANGED_MESSAGE = '다른 영업장으로 바뀌었습니다. 화면을 새로고침한 뒤 다시 눌러 주세요.'

export async function GET(req: Request) {
  // 로그에는 숫자와 연도만 남긴다. 영업장 식별자·금액을 넣지 않는다.
  const timings: Timings = {}
  const startedAt = Date.now()
  let year = ''
  let retried = false
  const logTimings = (result: string) => console.log('[report/pdf]', JSON.stringify({
    result, year, retried, total: Date.now() - startedAt, ...timings,
  }))

  try {
    // ── 관문. 결산 보고서 화면·엑셀 내보내기와 같은 규칙이다(로그인 · 영업장 소속 · 금액 읽기).
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return fail(401, '인증이 필요합니다.')
    const access = await getPropertyAccess()
    if (!access) return fail(403, '접근 권한이 없습니다.')
    if (!canReadScope(access.role, 'money')) return fail(403, '접근 권한이 없습니다.')

    const params = new URL(req.url).searchParams
    if (params.get('propertyId') !== access.propertyId) {
      logTimings('property-changed')
      return fail(409, PROPERTY_CHANGED_MESSAGE, 'PROPERTY_CHANGED')
    }
    const parsedYear = parseReportYear(params.get('year'))
    if (!parsedYear) return fail(400, '연도가 올바르지 않습니다.')
    year = parsedYear
    const years = await step(timings, 'years', () => getAvailableYears())
    if (!isReportYearAllowed(year, years, kstMonthStr().slice(0, 4))) {
      logTimings('year-out-of-range')
      return fail(400, '기록이 있는 연도만 PDF 로 만들 수 있습니다.')
    }

    const [summary, property, pretendardBase64] = await Promise.all([
      step(timings, 'report', () => getAnnualReport(year)),
      step(timings, 'db', () => prisma.property.findUnique({
        where: { id: access.propertyId },
        select: { name: true, phone: true, businessInfo: true, logoDriveFileId: true },
      })),
      step(timings, 'font', () => getPretendardBase64()),
    ])
    // 한글 글꼴이 없으면 종이가 통째로 네모가 된다. 그 종이를 화면이 캐시해 다시 누를 때마다 같은
    // 네모를 내보내게 되므로, 여기서 멈추고 다시 시도하게 한다.
    if (!pretendardBase64) {
      logTimings('font-unavailable')
      return fail(503, '글꼴을 불러오지 못해 PDF 를 만들지 않았습니다. 잠시 후 다시 시도해 주세요.')
    }

    // 머리띠 재료. 사업자정보는 지금 영업장 설정값이고(계약서처럼 서명 시점 박제가 아니다), 상호가
    // 비면 영업장 이름을 쓴다(입실료 납부 확인서 lib/rentReceiptIssue 와 같은 규칙). 로고를 못 읽으면
    // 빈 칸으로 둔다(계약서와 같은 규칙, driveImageDataUrl 은 실패에 null).
    const biz = (property?.businessInfo as { name?: string; registrationNo?: string; ceoName?: string; address?: string } | null) ?? {}
    const businessInfo = {
      name: biz.name || property?.name || '', registrationNo: biz.registrationNo ?? '',
      ceoName: biz.ceoName ?? '', address: biz.address ?? '',
    }
    const logoImageUrl = property?.logoDriveFileId
      ? await step(timings, 'logo', () => driveImageDataUrl(property.logoDriveFileId!))
      : null
    const html = buildReportPrintHtml(summary, {
      brand: { businessInfo, phone: property?.phone ?? null, logoImageUrl },
      todayMonth: kstMonthStr(),
      printedOn: fmtDateKor(new Date()),
      pretendardBase64,
    })

    // ── 렌더. 골격은 계약서·번역본 라우트 그대로다. 런치 인자·waitUntil 'load'·document.fonts.ready.
    // 외부 참조가 0 건이라 'load' 가 정당하다(scripts/check-print-selfcontained.ts 축 1-d).
    const countPdfPages = (buf: Buffer) => (buf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) || []).length
    const renderPdf = async (attempt: number): Promise<Buffer> => {
      const k = (name: string) => attempt === 1 ? name : `${name}_r${attempt}`
      chromium.setGraphicsMode = false
      const browser = await step(timings, k('launch'), async () => puppeteer.launch({
        args: chromium.args,
        defaultViewport: { width: 1123, height: 794, deviceScaleFactor: 2 },  // A4 가로 96dpi @ 2x
        executablePath: await chromium.executablePath(),
        headless: true,
      }))
      try {
        const page = await browser.newPage()
        await step(timings, k('setContent'), () => page.setContent(html, { waitUntil: 'load', timeout: SET_CONTENT_TIMEOUT_MS }))
        await step(timings, k('fontsReady'), () => page.evaluateHandle('document.fonts.ready'))
        // 여백은 §26 A4 정본(상 18 · 좌우 20 · 하 20mm). 표가 최대 9칸(전년 칸이 없으면 8칸)이라 가로로 세운다.
        const print = async (withPageNumber: boolean) => Buffer.from(await page.pdf({
          format: 'A4', landscape: true, printBackground: true, preferCSSPageSize: false,
          margin: { top: '18mm', right: '20mm', bottom: '20mm', left: '20mm' },
          ...(withPageNumber ? {
            displayHeaderFooter: true,
            headerTemplate: '<div></div>',
            footerTemplate: printPageNumberFooterTemplate(pretendardBase64, businessInfo.name, 20),
          } : {}),
        }))
        // 한 장이면 번호 없이 끝낸다(§26 "페이지 번호는 2p 이상만"). 넘치면 번호를 붙여 한 번 더 찍는다.
        // 다시 찍기가 비싸지 않은 이유는 launch 와 setContent 가 이미 끝났고 같은 page 를 쓰기 때문이다.
        const plain = await step(timings, k('pdf'), () => print(false))
        if (countPdfPages(plain) <= 1) return plain
        return await step(timings, k('pdfNumbered'), () => print(true))
      } finally {
        await browser.close().catch(() => {})
      }
    }

    let pdfBuffer: Buffer
    try {
      pdfBuffer = await renderPdf(1)
    } catch (e) {
      retried = true
      console.warn('[report/pdf] 렌더 1차 실패, 1회 재시도:', (e as Error).message)
      pdfBuffer = await renderPdf(2)
    }

    logTimings('ok')
    return new NextResponse(new Uint8Array(pdfBuffer), {
      headers: {
        'Content-Type': 'application/pdf',
        // 파일 이름은 화면이 정한다(공유 시트에 넘기는 이름). 여기는 일반명이다.
        'Content-Disposition': 'inline; filename="annual-report.pdf"',
        'Cache-Control': 'no-store',
      },
    })
  } catch (e) {
    console.error('[report/pdf] 실패:', (e as Error).message)
    logTimings('error')
    return fail(500, '결산 보고서 PDF 를 만들지 못했습니다. 잠시 후 다시 시도해 주세요.')
  }
}
