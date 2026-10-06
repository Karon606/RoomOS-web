// 단체 공지 예시 템플릿 — 모든 영업장이 저장 없이 고를 수 있는 본보기. 저장한 템플릿 뒤에 덧붙인다.
//
// 공지 템플릿은 영업장별 DB 행(SmsTemplate kind 'notice')뿐이고 코드에 둔 문구가 없었다(2026-10-06 확인).
// 예시를 DB 에 심으면 영업장마다 쓰기가 필요하고 이미 저장한 목록과 섞인다. 그래서 코드에 두고
// 고르는 자리에서만 합친다 — 저장 목록은 한 줄도 안 바뀐다(멀티테넌트).
//
// '기본'이라 부르지 않는다(웹디자이너 패스 2026-10-06). 설정에서 관리하는 템플릿과 다른 것이고, 설정 목록에도
// 안 보인다. 발송 화면 드롭다운의 묶음 제목도 '예시 문구'다.
//
// 본문 규칙. 단체 공지는 배치 전체가 한 본문을 공유해 치환이 없다 — {이름}·{영업장명} 같은 표기를
// 쓰지 않는다(가이드 §29). 영업장 이름을 박지 않는 것도 같은 이유다(멀티테넌트, 하드코딩 금지).
// 달·날짜·실수·계좌는 운영자가 고쳐 쓰는 자리라 본보기 값으로 둔다.

export type NoticeTemplateOption = { id: string; name: string; body: string; example: boolean }

export const NOTICE_TEMPLATE_EXAMPLES: readonly { key: string; name: string; body: string }[] = [
  {
    key: 'first-come',
    name: '선착순 입실 안내',
    body: '9월에 입실 문의 주신 분께 먼저 안내드립니다. 10월 15일부터 입실 가능한 방이 2실 생겼습니다. 입실을 원하시면 이 문자로 회신해 주세요. 예약금 입금이 확인된 순서로 예약이 확정됩니다. 입금 계좌 OO은행 000-00-0000 홍길동',
  },
]

/**
 * 저장한 템플릿 + 예시 템플릿. 같은 이름이나 같은 본문을 이미 저장했으면 예시는 빼고(운영자 것이 이긴다),
 * 저장 목록의 순서·내용은 그대로 둔다.
 */
export function withNoticeTemplateExamples(saved: readonly { id: string; name: string; body: string }[]): NoticeTemplateOption[] {
  const names = new Set(saved.map(s => s.name.trim()))
  const bodies = new Set(saved.map(s => s.body.trim()))
  return [
    ...saved.map(s => ({ id: s.id, name: s.name, body: s.body, example: false })),
    ...NOTICE_TEMPLATE_EXAMPLES
      .filter(d => !names.has(d.name) && !bodies.has(d.body))
      .map(d => ({ id: `example:${d.key}`, name: d.name, body: d.body, example: true })),
  ]
}
