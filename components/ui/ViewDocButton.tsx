// 보관된 서류를 앱 안에서 여는 정본 버튼 — 브라우저 PDF 뷰어가 뜨고 거기서 인쇄·저장·확대가 된다.
//
// 왜 필요한가: 종전에는 파일명이 구글 드라이브 링크를 겸해 앱 밖으로 나갔다. 데스크톱에서 '보내기'는
// 공유 시트가 없어 다운로드로만 떨어지므로, 앱 안에 서류를 여는 길이 아예 없었다. 운영자가 계약서를
// 프린터로 뽑지 못한 원인이다(2026-08-01 지적). 인쇄는 새 동사를 만들지 않고 뷰어 안에서 해결한다.
//
// 라벨은 여기서만 정한다 — label prop 을 두지 않는다. 호출부가 이름을 덮어쓰던 구조가 '공유'와
// '보내기'로 갈라지는 사고를 냈다(SendDocButton 주석 참조).
//
// /api/doc-file 은 Content-Disposition 을 붙이지 않아 브라우저가 인라인으로 렌더한다. attachment 를
// 붙이면 '보기'가 조용히 '저장'이 되어 지금 문제가 그대로 재발하므로 그 헤더를 추가하지 말 것.
// 권한은 이 라우트가 영업장 소유를 검증한다 — '보내기'와 같은 통로라 역할별 차이가 생기지 않는다.

import { BtnLink } from '@/components/ui/Btn'

export function ViewDocButton({ driveFileId, className }: {
  driveFileId: string
  className?: string
}) {
  return (
    <BtnLink
      href={`/api/doc-file?id=${encodeURIComponent(driveFileId)}`}
      target="_blank"
      rel="noreferrer"
      variant="primary"
      size="sm"
      className={className}
    >
      보기
    </BtnLink>
  )
}
