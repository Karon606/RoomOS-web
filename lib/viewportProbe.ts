// 오류신고에 함께 담는 화면 기하 계측 — **기하와 요소의 종류만** 담는다.
//
// 왜 필요한가. 2026-09-08 신고("일부가 깨져보이는 현상", "이번엔 키보드가 안떠")는 재현 로그가
// 없어 원인을 추측으로만 좁혔다. 반투명하게 겹친 모습이 등장 모션의 첫 프레임과 일치한다는
// 것까지가 확실하고, 어느 경로로 거기서 멎었는지는 모른다. 다음 재현 한 번에 그것을 사실로
// 바꾸려고 제출 시점의 상태를 함께 담는다.
//
// **개인정보 경계 — 여기서 지킨다.**
//   담는 것: visualViewport 기하, layout viewport 크기, 키보드 표식(data-kbd-open), 모달 CSS
//            변수 넷의 계산값, 열린 모달 수와 등장 모션 클래스 잔존 수, 포커스 요소의
//            태그·id·name·type.
//   안 담는 것: 입력값(value)·placeholder·본문 텍스트·연락처·이름. 무엇을 적었나가 아니라
//            어떤 종류의 칸에 서 있었나만 알면 된다. 이 경계는 scripts/check-kbd-canonical.mjs
//            가 지킨다(이 파일에 값 읽기가 새로 들어오면 그물이 막는다).

/** 소수 둘째 자리까지만 — vv 는 서브픽셀로 오는데 그 자릿수는 판독에 쓸모가 없다. */
function num(v: number | undefined): string {
  return typeof v === 'number' ? String(Math.round(v * 100) / 100) : '—'
}

/** 신고 본문 뒤에 덧붙일 한 덩이. 브라우저 밖이면 빈 문자열이다(서버 렌더 안전). */
export function viewportProbe(): string {
  if (typeof window === 'undefined' || typeof document === 'undefined') return ''
  const out: string[] = []
  const vv = window.visualViewport
  out.push(vv
    ? `vv h=${num(vv.height)} w=${num(vv.width)} top=${num(vv.offsetTop)} pageTop=${num(vv.pageTop)} scale=${num(vv.scale)}`
    : 'vv 미지원')
  out.push(`inner h=${window.innerHeight} w=${window.innerWidth} dpr=${num(window.devicePixelRatio)}`)

  const root = document.documentElement
  out.push(`kbd-open=${root.hasAttribute('data-kbd-open') ? 'y' : 'n'}`)

  // 모달 변수 넷은 오버레이·패널에 명령형으로 찍히고 아래로 상속된다. 그래서 가장 위 패널에서
  // 읽으면 --kbd-inset(html)까지 한 번에 잡힌다. 모달이 없으면 root 에서 읽는다.
  const panels = document.querySelectorAll<HTMLElement>('[data-modal-panel]')
  const topPanel = panels.length > 0 ? panels[panels.length - 1] : null
  const cs = getComputedStyle(topPanel ?? root)
  const cssVar = (name: string) => cs.getPropertyValue(name).trim() || '—'
  out.push(`vars kbd-inset=${cssVar('--kbd-inset')} vvh=${cssVar('--modal-vvh')}`
    + ` vv-top=${cssVar('--modal-vv-top')} vv-bottom=${cssVar('--modal-vv-bottom')}`)

  // 등장 모션 클래스가 남아 있으면 모션이 시작만 하고 안 끝난 것이다 — 이번 신고의 지문.
  const stuck = document.querySelectorAll('.anim-overlay-in, .anim-panel-in').length
  out.push(`modal open=${panels.length} 등장모션잔존=${stuck}`)

  // 포커스 요소는 **종류만.** 값은 읽지 않는다.
  const a = document.activeElement as (HTMLElement & { name?: string; type?: string }) | null
  out.push(a
    ? `focus ${a.tagName}${a.id ? ' id=' + a.id : ''}${a.name ? ' name=' + a.name : ''}${a.type ? ' type=' + a.type : ''}`
    : 'focus 없음')
  return out.join('\n')
}
