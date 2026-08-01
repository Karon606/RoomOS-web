// 보관된 서류(Drive PDF) 바이트를 앱 도메인으로 받아오는 정본 — 보내기·사진 저장이 공유한다.
// 계약서·확인서·영수증 목록 3화면에 같은 함수가 각자 복사돼 있던 것을 여기로 모았다(2026-08-01).
// 권한은 /api/doc-file 이 영업장 소유로 검증한다.
export const fetchDocBytes = (driveFileId: string) => async (): Promise<ArrayBuffer> => {
  const res = await fetch(`/api/doc-file?id=${encodeURIComponent(driveFileId)}`)
  if (!res.ok) throw new Error('서류를 불러오지 못했습니다.')
  return res.arrayBuffer()
}
