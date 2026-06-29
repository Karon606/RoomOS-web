<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->
## 세션 시작 규칙
세션 시작 시 항상 프로젝트 루트의 Work_log.md(최근 진행, 시간순)와
knowledge/INDEX.md(지식 베이스 지도, 주제별)를 먼저 읽고 작업 상태·도메인 사실을 파악한 후 이어간다.
- Work_log = "무엇을 했나", knowledge/ = "무엇이 참인가". 추론하지 말고 knowledge/ 노트를 사실로 쓴다.
- 중요한 도메인 규칙·의사결정이 생기면 knowledge/ 에 노트로 적립한다(특히 §4 결제·계약·재고 규칙, 결정 근거).
- knowledge/ 는 Obsidian Vault(마크다운 + [[위키링크]]). 코드가 진실이며 노트의 file:line 은 시점 기록이라 단정 전 확인.

## 작업 검증 규칙 (필수)
모든 개발 작업(기능 추가·버그 수정 등)은 프로젝트 루트의 loop.md를 **항상 참고**한다.
"구현 완료"라고 말하기 전에 loop.md의 1~4번 기준(필수 통과·측정·평가·인간 호출)을 스스로 점검하고,
통과하지 못하면 스스로 원인을 분석해 수정한 뒤, loop.md 5번에 따라 최종 증거 보고서를 제출한다.
특히 loop.md 4번(DB 스키마·인증/권한·결제 로직·기획 충돌)에 해당하면 임의 수정하지 말고 운영자에게 먼저 확인한다.