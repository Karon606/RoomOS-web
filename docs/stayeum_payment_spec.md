# stayeum 미납 관리 기능 구현 스펙

> **작성일**: 2026-07-09
> **작성 목적**: Claude Code 작업 지시용 스펙 + 상용화 후 구현 백로그 기록
> **보관 위치**: 프로젝트 루트 `/docs/` 및 Obsidian Vault에 복사 보관 권장. CLAUDE.md에서 본 문서를 참조하도록 링크 추가.

---

## 0. 프로젝트 컨텍스트

- **서비스**: stayeum — 고시원/원룸텔 운영 관리 웹앱 (더스테이 제기역점에서 운영 중)
- **스택**: Next.js / Vercel / Supabase (GAS 기반 RoomOS에서 마이그레이션 완료)
- **현재 구현된 관련 기능**: 입주자별 납부일 기준 D-Day 알림 (납기일 도래 / 오늘이 납기일 / 납기일 경과) — 홈화면 표시 + 알림
- **문제 상황**: 운영자가 알림만 보고 실제 입금내역 확인 없이 독촉 문자를 보내는 실수 발생 (특히 야간 매너모드 중 입금 놓침)
- **제약 조건**: 수익화 전 단계이므로 **고정비/건당 과금이 발생하는 외부 API는 사용하지 않음** (Phase 2로 이연)

---

## Phase 1 — 지금 구현할 것 (운영비 0원)

### 기능 1: 문자 발송 전 입금내역 확인 스텝

**목적**: 독촉 문자 오발송 방지를 위한 인지 오류 방어막

**요구사항**:
1. 납부일이 1일 이상 경과하고 납부 처리가 안 된 입주자에 대해 홈화면/알림에 "미납" 상태 표시 (기존 기능 유지)
2. 미납 입주자에게 안내 문자를 보내려는 액션(버튼) 클릭 시, 발송 화면으로 바로 가지 않고 **확인 다이얼로그**를 먼저 표시:
   - 문구 예시: "은행 입금내역을 확인하셨나요? 야간에 입금된 내역이 있을 수 있습니다." (경고 아이콘)
   - 버튼: [입금내역 확인했어요 — 문자 작성으로 진행] / [취소]
3. 다이얼로그에서 "확인했어요"를 눌러야만 문자 템플릿 화면으로 진행
4. 확인 시각을 로그로 남김 (`payment_check_confirmed_at`)

**UI 노트**: stayeum 디자인 토큰 준수 — Terracotta(#A03C2E) 주 버튼, Cream 배경, Ink 텍스트. 경고 다이얼로그이므로 아이콘/색상은 과하지 않게.

### 기능 2: 미납 안내 문자 템플릿 + 변수 자동 치환

**목적**: 문자 작성 시 이름/호수/금액 복붙 노가다 제거. API 비용 없이 `sms:` URL scheme으로 운영자 폰의 기본 메시지 앱을 여는 방식.

**요구사항**:
1. **환경설정 페이지에 템플릿 관리 섹션 추가**
   - 템플릿 여러 개 저장 가능 (예: "1차 안내", "2차 안내", "장기 미납")
   - 지원 변수: `{이름}`, `{호수}`, `{미납금액}`, `{납기일}`, `{경과일수}`, `{계좌번호}`
   - 템플릿 예시:
     ```
     [더스테이 제기역점] {이름}님, {호수}호 월 이용료 {미납금액}원의
     납기일({납기일})이 지났습니다. 아래 계좌로 입금 부탁드립니다.
     {계좌번호}
     ```
2. **발송 플로우**:
   - 미납 입주자 카드/행의 [안내문자] 버튼 → 기능 1의 확인 다이얼로그 → 템플릿 선택 → 변수가 치환된 미리보기 표시 → [문자앱으로 보내기] 버튼
   - 버튼은 `sms:{전화번호}?body={인코딩된 본문}` 링크 (iOS는 `sms:{번호}&body=` 구분자 주의 — UA 감지해서 분기)
   - 본문은 URL 인코딩 필수 (`encodeURIComponent`)
3. **발송 이력 기록**: 버튼 클릭 시점에 이력 저장 (실제 발송은 폰에서 이뤄지므로 "발송 시도" 기록임을 UI에 명시)

### DB 스키마 (Phase 2 확장을 미리 고려한 설계)

```sql
-- 문자 템플릿
create table sms_templates (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid references auth.users not null,
  name text not null,              -- "1차 안내" 등
  body text not null,             -- 변수 포함 원문
  sort_order int default 0,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- 문자 발송 이력
create table sms_logs (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid references auth.users not null,
  tenant_id uuid references tenants not null,   -- 입주자 FK (실제 테이블명에 맞출 것)
  template_id uuid references sms_templates,
  rendered_body text not null,     -- 변수 치환 완료된 실제 본문
  overdue_amount int,
  overdue_days int,
  payment_check_confirmed_at timestamptz,  -- 기능1 확인 시각
  sent_via text default 'manual_sms',      -- Phase 2: 'solapi' 등 확장
  created_at timestamptz default now()
);

-- 납입 레코드에 컬럼 추가 (기존 테이블에 alter)
-- payment_confirmed_at timestamptz  : 입금 확인 처리 시각
-- payment_confirmed_by text         : 'manual' | 'codef_auto' (Phase 2 대비)
-- bank_tx_ref text                  : Phase 2에서 CODEF 거래내역 매칭 키 저장용
```

> RLS 정책은 기존 stayeum 패턴(owner_id 기준) 그대로 적용.
> (구현 노트 2026-07-09: 실제 저장소는 Supabase RLS가 아니라 Prisma + propertyId 스코핑 + 서버 액션 권한 체크 패턴을 쓴다. 같은 취지로 propertyId 기준 격리를 적용해 구현함.)

---

## Phase 2 — 상용화 후 구현 백로그 (⚠️ 삭제 금지, 구현 착수 전까지 보존)

### 백로그 A: CODEF API 계좌 거래내역 자동 확인

**배경 (2026-07-09 라운드 기록)**:
- 개인 개발 앱이라 정식 오픈뱅킹 사업자 등록은 현실적으로 어려움
- 가상계좌(PG) 방식은 매칭 정확도 100% + 친절 실시간이지만, PG 계약 + 건당 수수료(200~300원) + 입주자 전원에게 새 계좌 안내 필요 → 기존 계좌 유지 원칙과 충돌하여 기각
- **CODEF 스크래핑 API 채택 결정**: 개인/개인사업자 가입 가능, 기존 은행 계좌 그대로 사용, 건당 수십 원 과금 → 상용화 후 구독료 수가에 반영. "계좌 자동 확인"은 유료 플랜 킬러 기능 후보

**설계 방향 (합의된 내용)**:
1. **폴링 구조**: Vercel Cron으로 CODEF 거래내역 조회 API 주기 호출
   - 비용 최적화: 상시 10분 간격이 아니라 **납부일 전후 며칠 (예: D-2 ~ D+3)만 집중 폴링**, 그 외 기간은 30분~1시간 간격 또는 중단
   - 하루 144회(10분 간격) 폴가동 기준 월 몇천 원~1~2만 원 수준으로 관리 가능
2. **매칭 로직**: 조회된 입금 내역을 `입금자명 + 금액`으로 입주자 DB와 대조
   - 매칭 성공 → 앱 점유자 알림: "**{호수}호 {이름}님이 {월}월 {일}일 {금액}원 입금 완료했습니다. 완료 처리할까요?**" → [완료 처리] 원탭
   - 매칭 실패(입금자명 상이, 금액 불일치 등) → **수동 확인 대기 목록**으로 분리 표시
   - 매칭 시 `bank_tx_ref`에 거래 고유값 저장하여 중복 처리 방지, `payment_confirmed_by = 'codef_auto'`
3. **자동 문자 연계**: 납부일 D+1 경과 & CODEF 조회 결과 미입금 확인 시 → 운영자 **승인 알림** 발송 → 승인 시 Phase 1 템플릿으로 문자 자동 발송 (Solapi/알리고 API, SMS 8~9원, LMS 25원, 발신 번호 사전 등록 필요)
4. Phase 1에서 미리 만들어둔 `payment_confirmed_by`, `bank_tx_ref`, `sms_logs.sent_via` 컬럼을 그대로 활용 → 마이그레이션 최소화

**구현 전 확인사항**: CODEF 수가표/약관 최신화 확인, 계정 등록(커넥티드아이디) 방식, 은행별 지원 여부, 스크래핑 안정성(은행 UI 변경 리스크)

### 백로그 B: 이미지/문서 저장소 마이그레이션 (개인 Google Drive → 전용 스토리지)

**현재 상태**: 방 사진, 계약서 등 이미지/문서가 Supabase가 아닌 **운영자 개인 Google Drive에 연동**되어 저장 중 (무료 유지 목적)

**문제점 (상용화 시)**:
- 개인 계정 종속 → 멀티테넌트(다른 원장님들) 서비스 불가
- Drive API 경유라 로딩 속도 느림, 썸네일/변환 비효율
- 권한/보안 관리가 개인 계정 공유 설정에 의존

**마이그레이션 방향**:
- 1순위 후보: **Supabase Storage** (기존 스택 통합, RLS로 테넌트별 격리, 이미지 변환 지원)
- 대안: Cloudflare R2(이그레스 무료, 이미 Cloudflare DNS 사용 중이라 친화적) + Cloudflare Images
- 작업 항목: ① 기존 Drive 파일 일괄 이전 스크립트 ② DB의 파일 참조(URL/ID) 스키마 전환 ③ 업로드 플로우 교체 ④ 서명 URL 기반 접근 제어 ⑤ 이미지 리사이징/썸네일 파이프라인

---

## Claude Code 전달용 프롬프트

아래를 Claude Code에 그대로 붙여넣어 사용:

```
stayeum 프로젝트에 미납 관리 기능을 추가하려고 해.
먼저 CLAUDE.md와 Work_log.md를 읽고 현재 프로젝트 구조를 파악한 뒤,
/docs/stayeum_payment_spec.md 스펙 문서를 읽고 Phase 1만 구현해줘.

구현 범위 (Phase 1):
1. 미납 입주자에게 안내문자 보내기 전 "입금내역 확인" 다이얼로그 스텝 추가
2. 환경설정에 문자 템플릿 관리(CRUD) 섹션 추가 — 변수 {이름}{호수}{미납금액}{납기일}{경과일수}{계좌번호} 지원
3. 템플릿 선택 → 변수 치환 미리보기 → sms: 링크로 폰 메시지 앱 열기 (iOS/Android 구분자 분기)
4. sms_templates, sms_logs 테이블 생성 + 납입 테이블에 payment_confirmed_at,
   payment_confirmed_by, bank_tx_ref 컬럼 추가 (Phase 2 CODEF 연동 대비용 → 스펙 문서 참조)
5. RLS 정책은 기존 owner_id 패턴 동일 적용

주의사항:
- Phase 2 섹션(CODEF 연동, 스토리지 마이그레이션)은 지금 구현하지 말 것. 단, 스키마는 스펙대로
  확장 가능하게 만들 것
- 디자인은 기존 stayeum 토큰(Terracotta #A03C2E, Camel, Sand, Cream, Ink) 준수
- 작업 완료 후 Work_log.md에 변경사항 기록하고, 스펙 문서의 Phase 2 백로그가
  삭제되지 않도록 유지할 것
```

---

## Obsidian 보관 메모

- 이 문서를 Obsidian Vault의 stayeum 폴더에 복사하고, `#stayeum #백로그 #상용화` 태그 부여 권장
- CLAUDE.md에 다음 한 줄 추가: `상용화 후 백로그는 /docs/stayeum_payment_spec.md Phase 2 섹션 참조 (CODEF 계좌연동, 스토리지 마이그레이션)`
