<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->
## 세션 시작 규칙
세션 시작 시 항상 프로젝트 루트의 Work_log.md를 먼저 읽고
마지막 작업 상태를 파악한 후 작업을 이어간다.

## 작업 검증 규칙 (필수)
모든 개발 작업(기능 추가·버그 수정 등)은 프로젝트 루트의 loop.md를 **항상 참고**한다.
"구현 완료"라고 말하기 전에 loop.md의 1~4번 기준(필수 통과·측정·평가·인간 호출)을 스스로 점검하고,
통과하지 못하면 스스로 원인을 분석해 수정한 뒤, loop.md 5번에 따라 최종 증거 보고서를 제출한다.
특히 loop.md 4번(DB 스키마·인증/권한·결제 로직·기획 충돌)에 해당하면 임의 수정하지 말고 운영자에게 먼저 확인한다.