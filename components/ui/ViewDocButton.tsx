// 보관된 서류를 앱 안에서 여는 정본 버튼 — 앱 안 뷰어(/doc/[fileId])로 보낸다.
//
// 종전에는 /api/doc-file 을 target="_blank" 로 열었다. 목적지가 순수 PDF 응답이라 우리 마크업이
// 0바이트고, 돌아가기 버튼을 넣을 자리가 없었다. 복귀를 브라우저 크롬에 맡긴 설계인데
// 홈화면 앱(standalone)에는 주소창도 뒤로가기도 없어 편도가 됐다(신고 f12c265b·083239c3).
// **앱 안에서 이어서 할 동작은 앱 안 라우트로 보낸다. 새 탭으로 내보내지 않는다.**
//
// 라벨은 여기서만 정한다 — label prop 을 두지 않는다. 호출부가 이름을 덮어쓰던 구조가 '공유'와
// '보내기'로 갈라지는 사고를 냈다(SendDocButton 주석 참조).
//
// /api/doc-file 은 Content-Disposition 을 붙이지 않아 브라우저가 인라인으로 렌더한다. attachment 를
// 붙이면 '보기'가 조용히 '저장'이 되어 지금 문제가 그대로 재발하므로 그 헤더를 추가하지 말 것.
// 권한은 뷰어 라우트와 그 API 양쪽이 영업장 소유를 검증한다.

import { BtnLink } from '@/components/ui/Btn'
import { type DocFrom, docFromQuery } from '@/lib/docNav'

// 복귀 목적지는 **열거 키**로만 받는다. 경로를 받으면 오픈 리디렉트가 되고,
// 라벨을 받으면 크롬 안에 임의 문자열이 그려진다. 키에서 라벨·경로로 옮기는 표는 lib/docNav 정본이다.
export type DocViewerFrom = DocFrom

export function ViewDocButton({ driveFileId, from, tenantId, className }: {
  driveFileId: string
  /** 어느 화면에서 열었는지 — 뷰어의 복귀 링크 문구가 이걸로 정해진다. 없으면 홈으로 돌아간다. */
  from?: DocViewerFrom
  /** from='tenant' 일 때 돌아갈 고객. */
  tenantId?: string
  className?: string
}) {
  return (
    <BtnLink
      href={`/doc/${encodeURIComponent(driveFileId)}${docFromQuery(from, tenantId)}`}
      variant="primary"
      size="sm"
      className={className}
    >
      보기
    </BtnLink>
  )
}
