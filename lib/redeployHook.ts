// Vercel Deploy Hook 트리거 — 사진 변경 후 소개 페이지(정적 HTML) 대표 썸네일을 재배포로 반영한다.
// Vercel 은 런타임에 정적 파일을 못 고쳐서, 빌드 시 publish-gallery-thumbs 가 최신 대표를 심는 구조.
// 이 훅을 호출하면 그 빌드가 트리거된다. VERCEL_DEPLOY_HOOK_URL 미설정이면 조용히 넘어간다(로컬·미설정 환경).

export async function triggerRedeploy(): Promise<void> {
  const url = process.env.VERCEL_DEPLOY_HOOK_URL
  if (!url) return
  try {
    // 응답을 기다릴 필요 없음(트리거만) — 실패해도 사진 변경 자체엔 영향 없게 삼킨다.
    await fetch(url, { method: 'POST' })
  } catch {
    /* 훅 실패는 무시 — 다음 배포나 빌드 시 어차피 최신화된다 */
  }
}
