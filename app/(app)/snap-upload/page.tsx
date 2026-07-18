// 찍어 올리기(스테이음 Lab) — 사진을 올리면 AI가 분류하는 실험 기능. 대시보드에서 이전(운영자 지시 2026-07-19).
// 원래 비전(물건 사진에서 개수까지 세어 재고 반영)은 인식 신뢰도가 부족해 보류 — 아이디어가 익으면 여기서 재개.
import { requireRouteAccess } from '@/lib/auth/requireRouteAccess'
import { PendingReceiptSection } from '@/components/dashboard/PendingReceiptSection'

export default async function SnapUploadPage() {
  await requireRouteAccess()   // 클라 내비 뒷문 차단(제한 스태프)
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold" style={{ color: 'var(--warm-dark)' }}>찍어 올리기</h1>
        <p className="mt-1 text-xs" style={{ color: 'var(--warm-muted)' }}>
          실험 기능입니다. 인식 정확도가 아직 낮아 정식 지출 등록은 지출 관리의 영수증 첨부를 권장합니다.
        </p>
      </div>
      <PendingReceiptSection />
    </div>
  )
}
