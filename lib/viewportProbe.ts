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

// ── 열었을 때의 스냅샷 ─────────────────────────────────────────────
//
// 왜 한 번 더 재나(2026-09-17). 사진을 붙이려면 사진 앱을 다녀와야 하고, 그 왕복이
// visibilitychange 를 일으켜 useSettleEntrance 의 settle() 과 useVisibleBand 의 resync() 를 둘 다
// 깨운다. **제출 시점에는 화면이 이미 스스로 나아 있다.** 그래서 화면이 깨진 신고(bf0a6fff)와
// 멀쩡한 신고(be42800d)의 계측 블록이 한 글자도 다르지 않았다. 신고창이 뜬 그 순간을 따로 담아야
// 다음 재현이 증거를 남긴다.
//
// **시간으로 마감하지 않는다.** 벽시계 추정은 2026-09-08 결정이 금지한 바로 그 함정이다. 여기서는
// 지금 도는 애니메이션의 finished 를 기다린다 — "얼마나 지났나"가 아니라 "실제로 끝났나"를 신호로
// 쓴다. 도는 것이 하나도 없으면(모션 축소 설정·숨은 채 마운트·이미 굳음) 기다릴 것이 없으므로 rAF
// 두 번 뒤에 잰다. 첫 rAF 는 방금 붙은 노드의 스타일이 계산되기를, 둘째는 그것이 한 번 그려지기를
// 기다리는 자리다. 둘 다 "무엇이 일어났는가"를 보는 신호다.

/** 가장 위 모달의 오버레이·패널 — 계측이 쓰는 표식 두 개와 같은 손잡이다. */
function topModalParts(): HTMLElement[] {
  const pick = (sel: string) => {
    const all = document.querySelectorAll<HTMLElement>(sel)
    return all.length > 0 ? [all[all.length - 1]] : []
  }
  return [...pick('[data-modal-overlay]'), ...pick('[data-modal-panel]')]
}

/**
 * 등장 모션이 **끝났음을 확인한 뒤** 한 번 재서 넘긴다. 반환값은 취소 함수다(언마운트 정리용).
 * 브라우저 밖이면 아무것도 안 한다.
 */
export function probeAfterEntrance(onProbe: (probe: string) => void): () => void {
  if (typeof window === 'undefined' || typeof document === 'undefined') return () => { /* noop */ }
  let cancelled = false
  const rafs: number[] = []
  const fire = () => { if (!cancelled) onProbe(viewportProbe()) }

  const running: Animation[] = []
  for (const el of topModalParts()) {
    if (typeof el.getAnimations !== 'function') continue
    for (const anim of el.getAnimations()) if (anim.playState === 'running') running.push(anim)
  }
  if (running.length > 0) {
    // finished 는 애니메이션이 중간에 취소되면(등장 클래스를 떼는 settle 이 바로 그 일을 한다)
    // 거부된다 — 그것도 '끝났다'의 한 갈래라 allSettled 로 받는다.
    //
    // 끝난 것을 안 직후에 바로 재지 않고 한 프레임을 더 기다린다. animationend 는 같은 프레임의
    // 렌더링 단계에서 rAF 콜백보다 **먼저** 나가므로, 다음 rAF 에서 재면 useSettleEntrance 가
    // 신고창 제 등장 클래스를 이미 걷은 뒤다. 안 기다리면 신고창 자신의 모션이 '잔존'으로 세어져
    // 아래 굳은 모달의 지문을 가린다. 이것도 시간이 아니라 순서를 쓰는 신호다.
    void Promise.allSettled(running.map(a => a.finished)).then(() => {
      if (!cancelled) rafs.push(requestAnimationFrame(fire))
    })
  } else {
    rafs.push(requestAnimationFrame(() => { rafs.push(requestAnimationFrame(fire)) }))
  }
  return () => { cancelled = true; for (const id of rafs) cancelAnimationFrame(id) }
}

/** 토큰의 이름 — 'h=812' 의 'h', 'kbd-open=n' 의 'kbd-open'. 값이 없는 토큰은 그 자신이다. */
function tokenName(tok: string): string {
  const at = tok.indexOf('=')
  return at < 0 ? tok : tok.slice(0, at)
}

/**
 * 그 줄에서 **달라진 열쇠**의 이름들. 'modal open=2 등장모션잔존=0' 이면 'modal 등장모션잔존'
 * 처럼 어느 값이 갈렸는지까지 짚는다.
 *
 * 줄 이름만 짚던 종전에는 이 계측이 겨누는 바로 그 값이 2 에서 0 으로 갈려도 머리줄이
 * '달라진 줄: modal' 이라고만 적었고, 변수 넷이 든 vars 줄도 무엇이 바뀌었든 'vars' 하나로
 * 접혔다(디자이너 검수 2026-09-17). 짚어 준다는 약속이 가장 중요한 두 줄에서만 안 지켜졌다.
 *
 * 줄 모양 자체가 바뀌면(토큰 수가 다름 — 'vv h=…' 이 'vv 미지원' 이 되는 경우) 열쇠를 짝지을
 * 수 없으므로 머리말 하나로 답한다. 없는 말을 지어내는 것보다 덜 말하는 편이 낫다.
 */
function changedNames(before: string | undefined, after: string | undefined): string[] {
  const a = (before ?? '').split(/\s+/).filter(Boolean)
  const b = (after ?? '').split(/\s+/).filter(Boolean)
  const src = b.length > 0 ? b : a
  // 머리말 — 'vv'·'modal' 처럼 = 가 없는 첫 토큰. 'kbd-open=n' 같은 줄은 머리말이 없다.
  const head = src[0] && !src[0].includes('=') ? src[0] : ''
  const fallback = head || tokenName(src[0] ?? '')
  if (a.length !== b.length) return [fallback]
  const names: string[] = []
  for (let i = 0; i < b.length; i++) {
    if (a[i] === b[i]) continue
    // 값이 없는 토큰(태그명 같은 것)은 이름이 곧 값이라 머리말로 답한다.
    const name = b[i].includes('=')
      ? (head ? `${head} ${tokenName(b[i])}` : tokenName(b[i]))
      : fallback
    if (!names.includes(name)) names.push(name)
  }
  return names.length > 0 ? names : [fallback]
}

/**
 * 두 스냅샷을 **나란히** 적는다. 같으면 한 덩이로 접고, 다르면 둘 다 펴고 달라진 열쇠를 짚는다.
 * 줄 문법은 viewportProbe 그대로다 — 읽는 눈과 scripts/ 의 그물이 같은 것을 본다.
 *
 * 스냅샷이 하나뿐이어도 **머리줄을 단다**(디자이너 검수 2026-09-17). 라벨 없는 한 덩이는 옛 형식
 * 신고와 생김새가 같아, 읽는 쪽이 '두 번 재는 기능이 없던 때의 신고'인지 '이번 신고인데 열었을
 * 때를 못 잰 것'인지 가를 수 없었다. 그 둘은 다음 재현에서 볼 곳이 서로 다르다.
 */
export function probeReport(openedProbe: string | null, submitProbe: string): string {
  if (!submitProbe) return ''
  if (!openedProbe) return `제출할 때만\n${submitProbe}`
  if (openedProbe === submitProbe) return `열었을 때·제출할 때 같음\n${submitProbe}`
  const a = openedProbe.split('\n')
  const b = submitProbe.split('\n')
  const changed: string[] = []
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if (a[i] === b[i]) continue
    for (const name of changedNames(a[i], b[i])) {
      if (!changed.includes(name)) changed.push(name)
    }
  }
  return `열었을 때\n${openedProbe}\n제출할 때 (달라진 줄: ${changed.join(' · ')})\n${submitProbe}`
}
