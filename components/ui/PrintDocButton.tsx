'use client'

// 발급 이력 목록의 [인쇄] — 보관된 서류를 목록에서 바로 인쇄한다.
//
// 왜 필요한가(신고 71753b36) — 종전에는 [보기]로 뷰어에 들어가야 인쇄가 있었다.
// 인쇄는 §30 이 등재한 여섯 번째 동사이고, 목록에서 가장 자주 하는 일 중 하나다.
//
// 운반로는 만들지 않는다. lib/useDocPrint 가 뷰어와 공유하는 분기 그대로다.
//   ① 아이폰 홈화면 앱 — 공유 시트를 여기서 바로 연다. 탭 직후 제스처를 그대로 쓰므로
//      뷰어를 거칠 이유가 없고, 운영자가 실제로 쓰는 환경이 이쪽이다.
//   ② 그 밖 — window.print() 는 '지금 화면'을 찍는다. 목록에서 부르면 목록이 인쇄되므로
//      종이가 우리 DOM 인 뷰어로 넘기고(print=1) 거기서 같은 window.print() 가 걸린다.
//      새 탭이 아니라 앱 안 라우트 이동이다(§27.7).

import { BtnLink } from '@/components/ui/Btn'
import { type DocFrom, docFromQuery } from '@/lib/docNav'
import { printNeedsShareSheet, useShareSheetPrint } from '@/lib/useDocPrint'

export function PrintDocButton({ driveFileId, fileName, from, tenantId, className }: {
  driveFileId: string
  /** 확장자 없이 — 공유 시트에 넘길 파일 이름. */
  fileName: string
  /** 뷰어로 넘어갈 때 돌아올 목적지(lib/docNav 정본). */
  from?: DocFrom
  tenantId?: string
  className?: string
}) {
  const printViaSheet = useShareSheetPrint(driveFileId, fileName)

  const q = docFromQuery(from, tenantId)
  const href = `/doc/${encodeURIComponent(driveFileId)}${q ? `${q}&print=1` : '?print=1'}`

  return (
    <BtnLink
      href={href}
      variant="secondary"
      size="sm"
      className={className}
      onClick={e => {
        // 공유 시트가 유일한 운반로인 환경이면 이동하지 않고 그 자리에서 연다.
        // 판정은 클라이언트에서만 가능해 href 를 서버에서 가를 수 없다 — 이동을 여기서 막는다.
        if (!printNeedsShareSheet()) return
        e.preventDefault()
        void printViaSheet()
      }}
    >
      인쇄
    </BtnLink>
  )
}
