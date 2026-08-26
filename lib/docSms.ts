// 서류 문자 문안 정본 — 서류를 문자로 보낼 때 미리 채워지는 본문과 그 변수 치환.
//
// 왜 lib/docMail 과 따로 사는가. 그쪽은 sanitize-html 을 든 **서버 전용** 모듈이라 클라이언트
// 컴포즈가 임포트하면 번들이 통째로 딸려 온다. 문자는 평문 한 통이라 치환만 있으면 되고,
// 그 대가로 정본이 둘이 되는 것을 막으려고 **변수 이름만은 메일과 같은 낱말을 쓴다**
// (`{영업장명}` `{이름}` `{서류목록}` 단괄호). 운영자가 두 화면에서 다른 문법을 외울 이유가 없다.
//
// 저장하지 않는다. 이 문안은 내장 기본값이고, 보내기 직전 고친 것은 그 한 통에만 적용된다
// (메일 컴포즈와 같은 계약). 환경설정에서 문안을 관리하는 자리는 다음 단계다.

import { withEulReul } from './statusReasons'

/**
 * 서류 문자 기본 문안 — 변수는 단괄호, 메일 문안과 같은 낱말을 쓴다.
 *
 * 목적격 조사는 문안에 박지 않고 치환이 붙인다. 서류 이름이 '계약서'(받침 없음)와
 * '보증금 영수증'(받침 있음)으로 갈려서 하나로 박으면 "계약서을"이 그대로 나간다.
 */
export const DOC_SMS_DEFAULT_BODY =
  '안녕하세요. {영업장명}입니다.\n요청하신 {서류목록} 보내 드립니다.'

export type DocSmsVars = {
  propertyName: string
  tenantName: string
  /** '계약서, 실거주 확인서' 처럼 이어 붙인 서류 이름. */
  docList: string
}

/**
 * 변수 치환 — 값이 비면 빈 문자열로 지운다.
 *
 * 없는 값을 `{영업장명}` 그대로 두면 그 중괄호가 입주자 문자에 그대로 도착한다. 문자는 발송
 * 직전에 사람이 읽는 매체라 티가 나지만, 티가 나는 것과 나가는 것은 다른 문제다.
 */
export function renderDocSms(tpl: string, v: DocSmsVars): string {
  return tpl
    .replaceAll('{영업장명}', v.propertyName || '')
    .replaceAll('{이름}', v.tenantName || '')
    // 서류 이름은 받침이 갈려서 조사를 여기서 붙인다(lib/statusReasons 의 '로/으로' 와 같은 축).
    .replaceAll('{서류목록}', v.docList ? withEulReul(v.docList) : '')
}
