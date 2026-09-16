// 참고용 번역본을 검수용 PDF 로 뽑는 관문 — 아무것도 저장하지 않는다.
//
// 쓰임(운영자 오더 2026-09-17). "난 한자를 못읽기 때문에 알수가 없어... 모든 번역본에 대해서는
// pdf로 다운로드 받을 수 있게 해줘." 환경설정에서 편집 중인 번역을 종이로 받아 **읽을 줄 아는
// 사람에게 보내 확인받는** 길이다. 입주자용도 아니고 계약서도 아니다.
//
// **이 라우트는 아무것도 저장하지 않는다.** prisma 의 create·update·delete·upsert 도 uploadToDrive
// 도 없고 읽기 하나뿐이다. 적용취소가 필요 없는 근거가 그것이다 — 되돌릴 상태가 없다.
// 그 사실은 scripts/check-translation-print.mjs 축 4 가 지킨다.
//
// **번역문을 클라이언트에서 받는다.** 계약서 라우트의 규칙("번역 내용은 받지 않는다",
// app/api/contract/generate/route.ts:109~111)에 안 걸리는 이유는 그 규칙이 막는 것이 무엇인지에
// 있다. 그 규칙은 **법적 효력이 있는 종이에 임의 문안을 박는 것**을 막는다. 여기에는 계약도
// 입주자도 금액도 서명도 없고, 만든 종이가 DB 에도 Drive 에도 안 남는다. 한국어 원문·사전의
// 열쇠·조항 순서는 여전히 서버가 DB 에서 읽어 정하고, 이 관문을 부를 수 있는 사람은 이미 본문
// 자체를 고칠 수 있는 OWNER·MANAGER 다. 받는 것은 "저장 전 입력칸"뿐이고, 그것이 이 기능의
// 쓰임 자체다 — 저장본을 읽으면 "저장하기 전에 맞는지 확인"이 앞뒤가 뒤집힌다.
//
// **영업장 경계는 쿠키 하나다.** propertyId 를 몸통에서 받지 않는다. 템플릿·가변 절·환불 토글은
// 서버가 직접 읽는다 — 그래야 다른 영업장의 본문으로 종이를 뽑는 길이 아예 없다.

import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import puppeteer from 'puppeteer-core'
import chromium from '@sparticuz/chromium'
import prisma from '@/lib/prisma'
import { createClient } from '@/lib/supabase/server'
import { requireEdit } from '@/lib/role'
import {
  DEFAULT_CONTRACT_TEMPLATE, propertyContractAddenda, type ContractTemplate,
} from '@/lib/contract'
import { parseShortStayPolicy } from '@/lib/shortStay'
import { asTranslationLang, resolveContractTranslation } from '@/lib/contractTranslation'
import {
  buildContractTranslationPrintHtml, buildTranslationPrintFooterTemplate,
  translationPretendardBase64, translationScriptFontBase64,
} from '@/lib/contractTranslationPrintHtml'

// puppeteer + chromium 은 nodejs runtime 필수. 콜드 스타트 고려해 maxDuration 60s.
export const runtime = 'nodejs'
export const maxDuration = 60
export const dynamic = 'force-dynamic'

/**
 * setContent 대기 상한 — **이 라우트만 25초다**(계약서는 15초). 근거는 재료 크기다.
 * 중국어 간체 종이는 Noto Sans SC 4.2MB + Pretendard 2.1MB 를 base64 로 싣는다(약 8.4MB).
 * 계약서 종이는 Pretendard 한 벌(약 2.7MB)뿐이라 같은 상한으로 잴 수 없다.
 * 25초 x 2회가 maxDuration 60초 예산 안에 든다. 계약서 라우트는 손대지 않는다.
 */
const SET_CONTENT_TIMEOUT_MS = 25000

/** 사전 상한 — 열쇠 수와 바이트 둘 다 본다. 넘으면 종이를 만들다 함수가 죽는 편보다 낫다. */
const MAX_DICT_KEYS = 500
const MAX_DICT_BYTES = 200 * 1024

type Timings = Record<string, number>
async function step<T>(t: Timings, key: string, fn: () => Promise<T>): Promise<T> {
  const at = Date.now()
  try { return await fn() } finally { t[key] = Date.now() - at }
}

const fail = (status: number, error: string, code?: string) =>
  NextResponse.json({ ok: false, error, ...(code ? { code } : {}) }, { status })

/**
 * 글꼴을 못 구했을 때의 단일 답. 부분 성공이 없다는 판정을 한 자리에 둔다.
 *
 * **왜 계약서와 규칙이 다른가.** 계약서 라우트는 글꼴을 못 구해도 발급을 계속한다. 여기는 반대로
 * 종이를 아예 안 만든다 — 한자를 못 읽는 사람이 번역이 맞는지 물어보려고 뽑는 종이라, 글자가
 * 네모로 나가면 이 기능이 존재하는 이유가 정면으로 무너진다. 다음 세션이 알아야 할 것은 그
 * 판단이지 운영자가 알아야 할 것은 아니다 — 그래서 근거는 여기 주석에 두고, 운영자가 받는
 * 문장은 사정과 다음 할 일만 말한다(디자이너 검수 2026-09-17, §15 3줄 경계).
 */
const FONT_UNAVAILABLE_MESSAGE =
  '이 언어의 글꼴을 서버에서 찾지 못해 종이를 만들지 않았습니다. 잠시 후 다시 시도하고, 계속 같으면 알려 주세요.'

export async function POST(req: Request) {
  // 로그에는 숫자와 언어 코드만 남긴다. 개인정보·사전 내용·영업장 식별자를 넣지 않는다
  // (app/api/contract/generate/route.ts:131 과 같은 규칙).
  const timings: Timings = {}
  const startedAt = Date.now()
  let lang = ''
  let retried = false
  const logTimings = (result: string) => console.log('[contract-translation/pdf]', JSON.stringify({
    result, lang, retried, total: Date.now() - startedAt, ...timings,
  }))

  try {
    // ── 인증 3단 — 기존 라우트 글자 그대로다. 여기서 정책을 새로 만들지 않는다.
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return fail(401, '인증이 필요합니다.')
    const cookieStore = await cookies()
    const propertyId = cookieStore.get('selected_property_id')?.value
    if (!propertyId) return fail(400, '영업장이 선택되지 않았습니다.')
    // 한 군데만 다르다 — 기존 라우트는 이 throw 가 최상위 catch 로 떨어져 500 이 된다.
    // 권한 없음은 실패가 아니라 답이므로 여기서 잡아 403 으로 돌려준다(문구는 같다).
    try {
      await requireEdit()
    } catch {
      logTimings('forbidden')
      return fail(403, '수정 권한이 없습니다.')
    }

    // ── 입력 — 클라가 보내는 것은 { lang, dict } 둘뿐이다.
    const body = (await req.json()) as { lang?: unknown; dict?: unknown }
    const parsedLang = asTranslationLang(body.lang)
    if (!parsedLang) return fail(400, '번역 언어가 올바르지 않습니다.')
    lang = parsedLang

    const rawDict = body.dict
    if (!rawDict || typeof rawDict !== 'object' || Array.isArray(rawDict)) {
      return fail(400, '번역 내용이 올바르지 않습니다.')
    }
    const dict = rawDict as Record<string, unknown>
    if (Object.keys(dict).length > MAX_DICT_KEYS
      || Buffer.byteLength(JSON.stringify(dict), 'utf8') > MAX_DICT_BYTES) {
      logTimings('too-large')
      return fail(413, '번역이 너무 많아 종이를 만들 수 없습니다. 문의해 주세요.')
    }

    // ── 나머지는 전부 서버가 DB 에서 읽는다. 미리보기(SettingsForm 의 preview useMemo)와
    //    **같은 인자**로 같은 정본을 부른다 — 인자가 하나라도 다르면 창과 종이가 갈린다.
    const property = await step(timings, 'db', () => prisma.property.findUnique({
      where: { id: propertyId },
      select: {
        contractTemplate: true,
        subLeaseAddendum: true, roomScheduleAddendum: true,
        shortStayPolicy: true, shortStayAddendum: true, earlyCheckoutAddendum: true,
        refundClauseInContract: true,
      },
    }))
    const template = (property?.contractTemplate as ContractTemplate | null) ?? DEFAULT_CONTRACT_TEMPLATE
    const addenda = propertyContractAddenda(property, parseShortStayPolicy(property?.shortStayPolicy).enabled)
    // 미설정은 켜짐이다 — 종이가 그 값을 읽는 규칙과 같다(getContractTranslationSettings).
    const refundClauseInContract = property?.refundClauseInContract ?? true

    const resolved = resolveContractTranslation(
      { enabled: true, langs: { [lang]: { published: true, dict } } },
      template, parsedLang, addenda, refundClauseInContract)
    if (!resolved || resolved.totalCount === 0) {
      logTimings('empty')
      return fail(409, '계약서 본문이 비어 있어 번역할 문장이 없습니다.')
    }

    // ── 글꼴. 부분 성공이 없다 — 하나라도 못 읽으면 종이를 안 만든다(파일 머리 주석).
    let pretendardBase64: string
    let scriptFontBase64: string | null
    try {
      ;[pretendardBase64, scriptFontBase64] = await step(timings, 'font', () => Promise.all([
        translationPretendardBase64(),
        translationScriptFontBase64(parsedLang),
      ]))
    } catch (e) {
      console.error('[contract-translation/pdf] 글꼴 확보 실패:', (e as Error).message)
      logTimings('font-unavailable')
      return fail(503, FONT_UNAVAILABLE_MESSAGE, 'FONT_UNAVAILABLE')
    }

    const html = buildContractTranslationPrintHtml(resolved, {
      source: template, sourceAddenda: addenda, pretendardBase64, scriptFontBase64,
    })

    // ── 렌더. 골격은 계약서 라우트 그대로다 — 런치 인자·waitUntil 'load'·document.fonts.ready.
    // 외부 참조가 0 건이라(글꼴이 전부 data URL) 'load' 가 정당하다. 그 사실은
    // scripts/check-print-selfcontained.ts 축 1 이 지킨다.
    //
    // 장수를 세는 눈도 형제 계약서 라우트와 같은 정본이다(app/api/contract/generate/route.ts).
    const countPdfPages = (buf: Buffer) => (buf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) || []).length
    const renderPdf = async (attempt: number): Promise<Buffer> => {
      const k = (name: string) => attempt === 1 ? name : `${name}_r${attempt}`
      chromium.setGraphicsMode = false
      const browser = await step(timings, k('launch'), async () => puppeteer.launch({
        args: chromium.args,
        defaultViewport: { width: 794, height: 1123, deviceScaleFactor: 2 },  // A4 96dpi @ 2x
        executablePath: await chromium.executablePath(),
        headless: true,
      }))
      try {
        const page = await browser.newPage()
        await step(timings, k('setContent'), () => page.setContent(html, { waitUntil: 'load', timeout: SET_CONTENT_TIMEOUT_MS }))
        await step(timings, k('fontsReady'), () => page.evaluateHandle('document.fonts.ready'))
        // 축소맞춤이 없다 — 이 종이는 몇 장이 되어도 괜찮다(한 장에 들어가야 할 이유가 없다).
        // 대신 꼬리말이 모든 장에 선다. 조판을 줄이는 것보다 읽히는 크기가 먼저다.
        const print = async (withPageNumber: boolean) => Buffer.from(await page.pdf({
          format: 'A4', printBackground: true, preferCSSPageSize: false,
          margin: { top: '16mm', right: '16mm', bottom: '16mm', left: '16mm' },
          displayHeaderFooter: true,
          headerTemplate: '<div></div>',
          // 꼬리말도 그 언어로 간다 — 2장 이후 유일한 표식이라, 머리만 고치면 검수자가 2장부터
          // 아무것도 못 읽는다. 본문 밖 독립 문서라 **그 언어 글꼴을 한 벌 더 싣는다**(재고 정한
          // 것이다. 최악인 zh 가 본문 7.93MB + 꼬리말 7.93MB · setContent 663ms · pdf 571ms 로
          // 위 25초 상한과 maxDuration 60초 예산 안에 든다, 2026-09-17 실측).
          footerTemplate: buildTranslationPrintFooterTemplate(
            parsedLang, pretendardBase64, scriptFontBase64, withPageNumber),
        }))
        // 번호를 붙여 한 번 찍고 장수를 센다. 한 장이면 번호를 걷고 한 번 더 찍는다(§26 "2p 이상만").
        // 번역 전문은 2장 이상이 보통이라 번호 붙인 쪽을 먼저 찍는 편이 두 번 찍는 일이 드물다.
        // 두 번째 찍기가 비싸지 않은 이유는 값이 비싼 launch 와 setContent(8.4MB 글꼴)가 이미
        // 끝났고 같은 page 를 다시 쓰기 때문이다 — 형제 계약서 라우트도 같은 자리에서 다시 찍는다.
        const numbered = await step(timings, k('pdf'), () => print(true))
        if (countPdfPages(numbered) > 1) return numbered
        return await step(timings, k('pdfSinglePage'), () => print(false))
      } finally {
        await browser.close().catch(() => {})
      }
    }

    let pdfBuffer: Buffer
    try {
      pdfBuffer = await renderPdf(1)
    } catch (e) {
      retried = true
      console.warn('[contract-translation/pdf] 렌더 1차 실패 — 1회 재시도:', (e as Error).message)
      pdfBuffer = await renderPdf(2)
    }

    logTimings('ok')
    return new NextResponse(new Uint8Array(pdfBuffer), {
      headers: {
        'Content-Type': 'application/pdf',
        // 파일 이름은 화면이 정한다(SendDocButton 에 넘기는 이름). 여기는 일반명이다 —
        // 응답 헤더에 언어·영업장 단서를 남기지 않는다.
        'Content-Disposition': 'inline; filename="translation-reference.pdf"',
        'Cache-Control': 'no-store',
      },
    })
  } catch (e) {
    console.error('[contract-translation/pdf] 실패:', (e as Error).message)
    logTimings('error')
    return fail(500, '번역본 PDF 를 만들지 못했습니다. 잠시 후 다시 시도해 주세요.')
  }
}
