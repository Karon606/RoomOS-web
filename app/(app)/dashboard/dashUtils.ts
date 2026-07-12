// 대시보드 공용 순수 유틸 — DashboardClient·모달 등 여러 컴포넌트가 공유.

export const fmtRoomNo = (no: string | null | undefined) =>
  no ? (/^\d+$/.test(no) ? `${no}호` : no) : '—'
