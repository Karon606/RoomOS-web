# 소프트삭제 패턴 (deletedAt) — 적용취소 인프라

적용하는 모든 삭제엔 적용취소(undo)가 있어야 한다는 원칙에 따라, 되살릴 가치가 있는 데이터는 하드삭제 대신 `deletedAt` 소프트삭제로 처리한다. 이 노트는 그 패턴과 함정을 정본으로 기록한다.

## 적용 현황
- 요청(TenantRequest) — 9f06ddd, 레퍼런스 구현.
- 문서(ContractFile·ResidenceCertFile·RentReceiptFile) — 7f28666. Drive는 영구삭제 대신 휴지통(`trashInDrive`), 복구는 `untrashInDrive`.
- 결제(PaymentRecord·ExtraIncome) — e1d0704(MF-3b). 아래 함정 참고.
- **지출(Expense)은 제외** — 삭제 시 주문·배송비 연쇄정리(`cleanupOrderIfOrphan`)가 얽혀 원복이 복잡. 하드삭제 유지.

## 2단계 마이그레이션 (운영 DB)
`prisma migrate` 안 씀(마이그레이션 폴더 없음, datasource엔 provider만). raw SQL 수동.
1. 운영 DB에 `deletedAt TIMESTAMP(3)` nullable 컬럼 **선추가**(비파괴). 컬럼은 camelCase(`deletedAt`, snake_case 아님). DDL은 `DIRECT_URL`.
2. schema.prisma에 `deletedAt DateTime?` + `npx prisma generate`.
3. 하드삭제 → `update({ where:{id}, data:{ deletedAt: new Date() } })`, 복구 액션 `deletedAt: null`.
4. 모든 조회에서 삭제분 제외, 클라이언트 undo 토스트(`pushToast('success', msg, { action:{ label:'적용취소', run } })`).

## PaymentRecord·ExtraIncome 조회 자동필터 (lib/prisma.ts)
Prisma `$extends` query 익스텐션이 이 2모델의 6개 READ_OP(findMany·findFirst·findFirstOrThrow·count·aggregate·groupBy)에 `deletedAt:null`을 자동 주입. **함정 3가지**.
1. **중첩 관계 조회는 자동필터 안 됨.** `include`/`select`의 `paymentRecords`, 관계필터 `some/every/none`은 수동으로 `deletedAt:null` 추가해야 함(현재 5곳: tenants 2·rooms 1·report 1·leaseStatus some 1). 새 중첩 조회 추가 시 반드시 필터.
2. **findUnique·쓰기는 미필터** — 복구가 소프트삭제분을 찾아야 하므로 의도된 것.
3. **seqNo 채번은 삭제분을 포함해야 함(opt-out).** `@@unique([leaseTermId,targetMonth,seqNo])`는 부분 인덱스가 아니라 삭제행의 seqNo도 점유한다. 채번을 활성행만으로 하면 삭제 후 같은 달 재등록 시 seqNo가 삭제행과 충돌해 P2002로 수납 등록이 막힌다. 그래서 채번 6곳(rooms 728·871·953·1036·1122, tenants 1462)은 where에 `deletedAt: undefined`를 넘겨 자동주입을 opt-out(익스텐션은 `'deletedAt' in where`면 스킵, Prisma는 undefined를 무시해 전체 행 조회) → 삭제행 포함 최대 seqNo로 채번.

미수·완납·통계·리포트 잔액은 저장값 없이 PaymentRecord 조회 합산으로 파생 → 삭제분이 조회에서 빠지면 자동 정정. 삭제·복구 후 `recalculatePayments`가 활성분으로 isPaid 재계산.

## 백업 export
전체 백업(`exportAllData`)은 소프트삭제분을 **제외**한다(익스텐션 + tenantRequest 명시필터). import 쪽 deletedAt 복원이 없어 포함하면 복원 시 삭제행이 되살아나므로, 제외가 일관된 의도.

관련: [[decisions]] · [[open-issues]] · [[domain-billing]]
