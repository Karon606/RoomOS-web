# 되돌리기·삭제 전수 감사 (2026-07-10)

원칙(운영자, 자동메모리 rollback-always-required): **데이터를 저장하는 기능에는 무조건 되돌리기와 삭제가 있어야 한다.**
감사 결과: 저장(쓰기) 기능 약 92개 중 삭제 경로 있음 약 66개, 되돌리기(토스트 적용취소·서버 역함수) 있음 약 20개. 공백 12건 발견.

## 2026-07-10 구현 완료 (높음 4건 + 부속 1건)
- 귀속월 단건 이동·연체 일괄 반영: 스냅샷 undo + 토스트 적용취소 (accrual-check undoTargetMonthMoves)
- 보증금 반환 기록: undoDepositReturn(반환 이력 + 미반환분 부가수입 동시 삭제) + 기록 직후 토스트 '반환기록 취소'
- 납입일 영구 변경: undoChangeDueDay(납입일·일할 정산 필드 원복 + 조정 기록 삭제) + 토스트 적용취소
- 예정 가격 즉시 적용: undoApplyScheduledRent(월세·예약 필드·계약별 금액 스냅샷 복원) + 토스트 적용취소

## 잔여 백로그 (구현 순서 제안)
| 심각도 | 기능 | 위치 | 메모 |
|---|---|---|---|
| 중 | 입주자/호실 일괄 수정 undo | tenants/actions.ts batchUpdateTenants · room-manage/actions.ts batchUpdateRooms | 일괄 수납(batchRecordRentPayment)과 같은 스냅샷 패턴 적용 |
| 중 | 요청 완료 해제 | tenants/actions.ts resolveTenantRequest | resolvedAt null 복원 액션 + UI '완료 해제' |
| 중 | 입고 확인·일괄 확인·재고 이동 전용 undo | inventory/actions.ts confirmReceipt·confirmAllPending·transferLocationStock | 생성 stockCheck 삭제로 부분 원복만 가능 — 분할 지출 원복 포함 전용 역함수 필요 |
| 낮음 | 배치도 저장 버전 이력 | floor-plan/actions.ts saveFloorPlan | 직전 1개 스냅샷이라도 |
| 낮음 | 정기지출 묶기 해제 | settings/actions.ts groupRecurringExpenses | ungroup 액션 |
| 낮음 | 무상 자산 추가 삭제 | assets/actions.ts addFreeAsset | 0원 지출 행 전용 삭제 |
| 낮음 | 가입요청 승인/거절 원복 | settings/memberActions.ts | 멤버 제거/재승인으로 대체 가능해 후순위 |
| 참고 | 예약 인상 자동 적용(applyScheduledRents) | room-manage/actions.ts | 페이지 진입 시 자동 실행 — 예약의 '이행'이라 undo 대상 아님. 잘못 예약했으면 적용 전 예약 수정, 적용 후엔 월세 수정으로 원복. checkoutWithDepositRefund 내부 반환 기록도 동일 패턴 필요(후속) |

## 규칙 (신규 기능 공통)
새 저장 기능을 만들 때는 별도 언급이 없어도 삭제와 되돌리기를 기본 포함한다(운영자 지시 2026-07-09, 신고 1f99d83c).
패턴: ① 단건 등록 → 전용 delete 액션 ② 파괴적 변경/일괄 → 이전 값 스냅샷 반환 + 토스트 적용취소 ③ 병합류 → 스냅샷 저장 + 역함수.
