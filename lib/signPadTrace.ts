// 서명 패드 계측 — 패드를 한 번 열 때마다 입력 경로·획·끊김·동시 터치를 수로만 모아 sessionStorage 에 두고, 오류신고가 '[서명 패드]' 로 덧붙인다.
//
// 왜 있나(2026-10-26 운영자 승인, 신고 c6eb427d "일부 나이있는 사람들은 어떻게 터치했는지 몰라도 인식이 잘 안되는 것 같은데").
// 패널 가설은 다섯이다(둘째 손가락·손날이 패드 밖에 닿아 브라우저가 핀치로 가져감, 손바닥이 먼저 닿음, 가벼운 접촉이 토막 획,
// 패드가 작음, 빠른 획이 가늚). 1단계 처방을 넣은 뒤에도 남는 것이 무엇인지는 다음 신고 한 번이 말해 줘야 한다. 그래서
// 운영자 기기(대면 서명은 운영자 폰·태블릿에서 받는다)에 마지막 몇 번의 패드 세션을 남긴다. 2단계(손바닥 허용)는 이 계측을 보고 정한다.
//
// **개인정보 경계.** 담는 것은 수뿐이다. 획 수, 끊김(pointercancel·touchcancel) 수, 동시 터치 최대 수, 포인터 종류별 누름 수,
// 패드 밖 누름 수, 총 획 길이(px, 반올림), 거절 수, 화면·패드 크기, 배율, 결과. **획 좌표·서명 이미지·이름·계약 정보는 안 담는다.**
// 이 경계는 scripts/check-sign-pad-input.mjs 가 지킨다(toData·toDataURL·points 를 이 파일이 읽으면 그물이 막는다).

export type PadPath = 'pointer' | 'touch'
export type PadOutcome = 'saved' | 'closed'

export type PadSession = {
  /** 연 시각(ms). 오래된 세션은 덧붙이지 않는다(PAD_TRACE_TTL_MS). */
  at: number
  /** signature_pad 가 받는 이벤트 경로. 라이브러리는 UA 에 Macintosh 가 있는 터치 기기(iPad)만 touch, 나머지는 pointer 다. */
  path: PadPath
  vw: number; vh: number
  padW: number; padH: number
  /** 핀치 배율(visualViewport.scale). 1 보다 크면 확대한 채 서명했다. */
  zoom: number
  strokes: number
  /** 획이 브라우저에 빼앗긴 수. 패드 밖 두 번째 터치가 핀치로 읽히면 여기 선다. */
  cancels: number
  /** 한 순간 화면에 닿은 터치 수의 최대(손바닥·손날·둘째 손가락). */
  multiMax: number
  /** 포인터 종류별 누름 수 — touch·pen·mouse. */
  touchDowns: number; penDowns: number; mouseDowns: number
  /** 패드(캔버스) 밖, 모달·배경에서 시작된 누름 수. */
  outsideDowns: number
  /** 확인을 누른 순간의 총 획 길이(px, 반올림). 60 미만이면 거절된다(lib/signatureInk). */
  inkPx: number
  rejectsEmpty: number
  rejectsShort: number
  outcome: PadOutcome
}

export const PAD_TRACE_KEY = 'signPadTrace'
export const PAD_TRACE_MAX = 5
export const PAD_TRACE_TTL_MS = 6 * 3600 * 1000

/** 한 세션 한 줄. 사람이 읽는 순서로 경로·결과 먼저, 끊김·동시 터치가 그 다음이다. */
export function padTraceLine(s: PadSession, now: number): string {
  const ago = Math.max(0, Math.round((now - s.at) / 60000))
  return [
    `${ago}분 전`,
    s.path,
    s.outcome === 'saved' ? '확인' : '닫음',
    `획${s.strokes}`,
    `끊김${s.cancels}`,
    `동시${s.multiMax}`,
    `밖${s.outsideDowns}`,
    `t${s.touchDowns}/p${s.penDowns}/m${s.mouseDowns}`,
    `잉크${s.inkPx}px`,
    `거절 빈${s.rejectsEmpty} 짧${s.rejectsShort}`,
    `화면${s.vw}x${s.vh}`,
    `패드${s.padW}x${s.padH}`,
    `배율${Math.round(s.zoom * 100) / 100}`,
  ].join(' ')
}

/** 덧붙일 글. 최근 TTL 안의 세션만 새 것부터. 없으면 빈 문자열(신고에 머리를 안 단다). */
export function padTraceText(list: readonly PadSession[], now: number): string {
  const live = list.filter(s => now - s.at <= PAD_TRACE_TTL_MS).sort((a, b) => b.at - a.at)
  return live.map(s => padTraceLine(s, now)).join('\n')
}

/** 새 세션을 앞에 얹고 PAD_TRACE_MAX 개만 남긴다. 순수(저장은 부르는 쪽). */
export function pushPadSession(list: readonly PadSession[], s: PadSession): PadSession[] {
  return [s, ...list].slice(0, PAD_TRACE_MAX)
}

export function readPadTrace(): PadSession[] {
  try {
    const raw = typeof sessionStorage !== 'undefined' ? sessionStorage.getItem(PAD_TRACE_KEY) : null
    const v = raw ? JSON.parse(raw) : []
    return Array.isArray(v) ? (v as PadSession[]) : []
  } catch { return [] }
}

export function writePadSession(s: PadSession): void {
  try {
    sessionStorage.setItem(PAD_TRACE_KEY, JSON.stringify(pushPadSession(readPadTrace(), s)))
  } catch { /* 사생활 모드·저장 거부여도 서명은 그대로 받는다 */ }
}
