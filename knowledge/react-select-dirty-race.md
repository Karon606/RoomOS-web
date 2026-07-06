# 컨트롤드 select 첫 변경 유실 — dirty onInput 리렌더 경합 (신고 6f264a8f, 2026-07-07 해결)

## 증상
지출 등록 등에서 카테고리 셀렉트의 **첫 번째 변경만 무시**되고 두 번째부터 정상. 브라우저 무관(Safari·Chrome).

## 근본 원인 (진단 칩 이벤트 로그로 확정: `input:청소용역비 → change:부식비`)
브라우저는 셀렉트 커밋 시 input → change 를 **별개 태스크**로 쏜다. 폼의
`onInput={() => setDirty(true)}` 가 input 시점에 리렌더를 일으키면, React 가 컨트롤드
select 의 DOM 값을 **아직 옛 상태값으로 복원**한다. 이어 도착한 change 는 복원된 옛 값을
들고 오고, onChange 는 옛 값으로 setState → 변경 무효. dirty 가 false→true 인 **첫 1회만**
리렌더가 발생하므로 첫 변경만 깨진다.

## 왜 자동화로 재현이 안 됐나
puppeteer `page.select()` 는 input·change 를 한 태스크에서 연속 디스패치 → 사이에
리렌더가 낄 틈이 없음. **실사용 재현이 안 되는 이벤트 버그는 태스크 경계를 의심할 것.**

## 수정 (전 폼 공통 규칙)
`onInput={() => requestAnimationFrame(() => setDirty(true))}` — rAF 는 input·change 태스크가
모두 끝난 뒤 실행되어 제스처 사이에 리렌더가 끼지 않는다. onChange 쪽 dirty 는 대상
핸들러와 같은 배치라 그대로 둔다. 적용 8곳(지출 등록·수정·구매처, 고객 상세·등록·수정·모달, 요청).
**새 폼에서 dirty 추적 + 컨트롤드 select 조합을 쓸 때 반드시 이 패턴.**

## 진단 기법 (재사용 가치)
?debug=1 게이트로 대상 요소에 네이티브 이벤트 로그(mousedown/focus/input/change/blur + 값)를
화면에 찍는 칩 — 상태 vs DOM vs 이벤트 순서를 운영자 스크린샷 한 장으로 판별.
단, 로그 setState 자체가 리렌더를 유발해 이런 경합류 버그를 **악화**시킬 수 있음(이번에 그 악화가
오히려 결정적 증거가 됨).
