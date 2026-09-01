// 서류 변수 사전 정본 — 계약서·동의서·문자·메일의 치환 변수와, 변수 없이 종이에 직접 박히는
// 영업장 값의 목록을 한 벌로 든다(운영자 승인 2026-09-01, 패널 설계).
//
// 왜 사전이 따로 있나. 치환 문법이 네 벌(계약서 {{영문}}, 동의서 {{한글}}, 문자 { }, 메일 { })이고
// 원천 편집 자리가 세 탭에 흩어져 있어, "이 변수는 어디서 고치나"를 코드를 읽어야만 알 수 있었다.
// 이 사전은 **설명서일 뿐 값 저장소가 아니다** — 값의 정본은 각 DB 필드이고, 허브 화면은 같은
// 필드를 편집하는 또 하나의 문이다. 사전이 실제 치환 코드와 갈리면 감지망
// (check-doc-variable-registry)이 잡는다.

import type { SettingsTab } from '@/app/(app)/settings/tabs'
import type { ContractData } from '@/lib/contractData'
import { buildRefundClause, cleaningFeeVars } from '@/lib/contract'
import { roomLabel } from '@/lib/tenantAddress'
import { maskForeignRegNo } from '@/lib/foreignRegNo'

export type DocVariableEntry = {
  /** 치환 키(표기 기호 제외). direct 는 사람이 부르는 이름이다. */
  key: string
  /** 화면 표기 — '{{name}}', '{이름}', '(직접 인쇄)' */
  shown: string
  grammar: 'doc' | 'consent' | 'msg' | 'direct'
  /** property = 영업장 값(허브에서 수정), perContract = 계약마다 다름(미리보기 대상), derived = 계산 결과 */
  kind: 'property' | 'perContract' | 'derived'
  label: string
  /** 원천 설명 — 어느 데이터에서 오나 */
  source: string
  /** 영업장 값일 때 — 고치는 자리(탭·앵커). 계약별·파생은 비운다. */
  editTab?: SettingsTab
  editAnchor?: string
  editLabel?: string
  note?: string
}

/** 문안(값이 아니라 문서) — 허브에서는 편집으로 점프만 한다. 편집기를 복제하면 그 순간 두 벌이다. */
export type DocTemplateEntry = { key: string; label: string; editTab: SettingsTab; editAnchor: string }

export const DOC_VARIABLES: readonly DocVariableEntry[] = [
  // ── 계약서 본문 {{영문}} ─────────────────────────────────────
  { key: 'name', shown: '{{name}}', grammar: 'doc', kind: 'perContract', label: '성명', source: '고객 정보의 이름 + 계약서의 표기 선택(한글·영문·현지)' },
  { key: 'phone', shown: '{{phone}}', grammar: 'doc', kind: 'perContract', label: '연락처', source: '고객 정보의 대표 연락처' },
  { key: 'birth', shown: '{{birth}}', grammar: 'doc', kind: 'perContract', label: '생년월일', source: '고객 정보. 외국인등록번호가 있으면 그 번호가 대신 찍힌다' },
  { key: 'job', shown: '{{job}}', grammar: 'doc', kind: 'perContract', label: '직업', source: '고객 정보' },
  { key: 'gender', shown: '{{gender}}', grammar: 'doc', kind: 'perContract', label: '성별', source: '고객 정보' },
  { key: 'smoking', shown: '{{smoking}}', grammar: 'doc', kind: 'perContract', label: '흡연 여부', source: '고객 정보' },
  { key: 'deposit', shown: '{{deposit}}', grammar: 'doc', kind: 'perContract', label: '보증금', source: '계약 정보(계약서 표시값을 고쳤으면 그 값)' },
  { key: 'rentFee', shown: '{{rentFee}}', grammar: 'doc', kind: 'perContract', label: '월 이용료', source: '계약 정보(계약서 표시값을 고쳤으면 그 값)' },
  { key: 'checkInDate', shown: '{{checkInDate}}', grammar: 'doc', kind: 'perContract', label: '입실일', source: '계약 정보' },
  { key: 'checkOutDate', shown: '{{checkOutDate}}', grammar: 'doc', kind: 'perContract', label: '퇴실 예정일', source: '계약 정보' },
  { key: 'roomNo', shown: '{{roomNo}}', grammar: 'doc', kind: 'perContract', label: '호실', source: '계약 정보' },
  { key: 'emergencyContact', shown: '{{emergencyContact}}', grammar: 'doc', kind: 'perContract', label: '비상연락망', source: '고객 정보의 비상연락처들' },
  { key: '환불규정', shown: '{{환불규정}}', grammar: 'doc', kind: 'property', label: '퇴실 환불 규정 문구', source: '공정위 기준 고정 문구 + 자동 표시 토글', editTab: 'pricing', editAnchor: 'dv-refund-policy', editLabel: '요금·정책 탭 · 퇴실 환불 규정' },
  { key: '청소비', shown: '{{청소비}}', grammar: 'doc', kind: 'derived', label: '청소비 금액 문구', source: '계약의 청소비 금액에서 만든 문장' },
  { key: '청소비조항', shown: '{{청소비조항}}', grammar: 'doc', kind: 'derived', label: '청소비 조항 문장', source: '계약의 청소비 금액에서 만든 문장' },
  { key: '청소비공제', shown: '{{청소비공제}}', grammar: 'doc', kind: 'derived', label: '청소비 공제 문구', source: '계약의 청소비 금액에서 만든 문장' },
  { key: '단기요금표', shown: '{{단기요금표}}', grammar: 'doc', kind: 'derived', label: '단기 입실 요금표', source: '단기 입실 정책(영업장)과 그 방 월세로 계산', editTab: 'pricing', editAnchor: 'dv-short-stay', editLabel: '요금·정책 탭 · 단기 입실 정책' },
  { key: '일정', shown: '{{일정}}', grammar: 'doc', kind: 'perContract', label: '거주 호실 일정 문장', source: '그 계약의 호실 일정에서 만든 문장(문안은 거주 호실 일정 특약에서)' },
  // ── 임의처분 동의서 {{한글}} ─────────────────────────────────
  { key: '성명', shown: '{{성명}}', grammar: 'consent', kind: 'perContract', label: '성명', source: '계약서와 같은 표기' },
  { key: '호실', shown: '{{호실}}', grammar: 'consent', kind: 'perContract', label: '호실', source: '계약 정보' },
  { key: '연락처', shown: '{{연락처}}', grammar: 'consent', kind: 'perContract', label: '연락처', source: '고객 정보' },
  { key: '미납일수', shown: '{{미납일수}}', grammar: 'consent', kind: 'property', label: '미납 기준일', source: '동의서 카드의 미납 기준일', editTab: 'contract', editAnchor: 'dv-disposal', editLabel: '계약서·서류 탭 · 임의처분 동의서' },
  { key: '영업장명', shown: '{{영업장명}}', grammar: 'consent', kind: 'property', label: '상호(등기)', source: '사업자 정보의 상호', editTab: 'contract', editAnchor: 'dv-biz-info', editLabel: '계약서·서류 탭 · 사업자 정보', note: '문자·메일의 {영업장명}과 다른 값입니다. 그쪽은 영업장 이름(간판)입니다.' },
  { key: '대표', shown: '{{대표}}', grammar: 'consent', kind: 'property', label: '대표자', source: '사업자 정보의 대표자', editTab: 'contract', editAnchor: 'dv-biz-info', editLabel: '계약서·서류 탭 · 사업자 정보' },
  // ── 문자·메일 {단괄호} ───────────────────────────────────────
  { key: '이름', shown: '{이름}', grammar: 'msg', kind: 'perContract', label: '성명', source: '고객 정보' },
  { key: '호수', shown: '{호수}', grammar: 'msg', kind: 'perContract', label: '호실', source: '계약 정보' },
  { key: '미납금액', shown: '{미납금액}', grammar: 'msg', kind: 'derived', label: '미납 금액', source: '보낼 때 청구 엔진이 계산' },
  { key: '납기일', shown: '{납기일}', grammar: 'msg', kind: 'derived', label: '납기일', source: '보낼 때 계산' },
  { key: '경과일수', shown: '{경과일수}', grammar: 'msg', kind: 'derived', label: '경과 일수', source: '보낼 때 계산' },
  { key: '계좌번호', shown: '{계좌번호}', grammar: 'msg', kind: 'property', label: '입금 계좌', source: '서류 자동채움 값의 입금 계좌번호', editTab: 'contract', editAnchor: 'dv-doc-defaults', editLabel: '계약서·서류 탭 · 서류 자동채움 값' },
  { key: '영업장명', shown: '{영업장명}', grammar: 'msg', kind: 'property', label: '영업장 이름(간판)', source: '기본정보의 영업장명', editTab: 'basic', editAnchor: 'dv-basic-property', editLabel: '기본정보 탭 · 영업장명', note: '동의서의 {{영업장명}}(상호)과 다른 값입니다.' },
  { key: '서류목록', shown: '{서류목록}', grammar: 'msg', kind: 'derived', label: '보낼 서류 목록', source: '보낼 파일에서 만든다' },
  { key: '서류요약', shown: '{서류요약}', grammar: 'msg', kind: 'derived', label: '보낼 서류 요약', source: '보낼 파일에서 만든다' },
  // ── 변수 없이 서류에 직접 인쇄되는 영업장 값 ─────────────────
  { key: '상호', shown: '(직접 인쇄)', grammar: 'direct', kind: 'property', label: '상호', source: '계약서·동의서·영수증 하단 사업자 표기', editTab: 'contract', editAnchor: 'dv-biz-info', editLabel: '계약서·서류 탭 · 사업자 정보' },
  { key: '사업자번호', shown: '(직접 인쇄)', grammar: 'direct', kind: 'property', label: '사업자등록번호', source: '계약서 하단·실거주 확인서 임대인 칸', editTab: 'contract', editAnchor: 'dv-biz-info', editLabel: '계약서·서류 탭 · 사업자 정보' },
  { key: '대표자', shown: '(직접 인쇄)', grammar: 'direct', kind: 'property', label: '대표자', source: '계약서 하단 사업자 표기', editTab: 'contract', editAnchor: 'dv-biz-info', editLabel: '계약서·서류 탭 · 사업자 정보' },
  { key: '사업장주소', shown: '(직접 인쇄)', grammar: 'direct', kind: 'property', label: '사업장 주소(등록증 표기)', source: '계약서 하단 사업자 표기', editTab: 'contract', editAnchor: 'dv-biz-info', editLabel: '계약서·서류 탭 · 사업자 정보' },
  { key: '영업장주소', shown: '(직접 인쇄)', grammar: 'direct', kind: 'property', label: '영업장 주소(건물 소재지)', source: '실거주 확인서 소재지·입주자 주소', editTab: 'basic', editAnchor: 'dv-basic-property', editLabel: '기본정보 탭 · 주소', note: '사업장 주소(등록증 표기)와 다른 사실입니다. 합치지 않습니다.' },
  { key: '영업장전화', shown: '(직접 인쇄)', grammar: 'direct', kind: 'property', label: '영업장 전화', source: '계약서 헤더·푸터', editTab: 'basic', editAnchor: 'dv-basic-property', editLabel: '기본정보 탭 · 대표 연락처' },
  { key: '전용면적', shown: '(직접 인쇄)', grammar: 'direct', kind: 'property', label: '영업장 전용면적', source: '실거주 확인서 면적 칸', editTab: 'contract', editAnchor: 'dv-doc-defaults', editLabel: '계약서·서류 탭 · 서류 자동채움 값' },
]

export const DOC_TEMPLATES: readonly DocTemplateEntry[] = [
  { key: 'contractBody', label: '계약서 본문', editTab: 'contract', editAnchor: 'dv-contract-template' },
  { key: 'subLease', label: '추가 호실 특약', editTab: 'contract', editAnchor: 'dv-addendum-subLease' },
  { key: 'shortStay', label: '단기 입실 특약', editTab: 'contract', editAnchor: 'dv-addendum-shortStay' },
  { key: 'earlyCheckout', label: '조기 퇴실 시 요금 적용', editTab: 'contract', editAnchor: 'dv-addendum-earlyCheckout' },
  { key: 'roomSchedule', label: '거주 호실 일정 특약', editTab: 'contract', editAnchor: 'dv-addendum-roomSchedule' },
  { key: 'consentBody', label: '임의처분 동의서 본문', editTab: 'contract', editAnchor: 'dv-disposal' },
  { key: 'docMail', label: '서류 메일 문안', editTab: 'contract', editAnchor: 'dv-doc-mail' },
  { key: 'smsUnpaid', label: '미납 안내 문자 템플릿', editTab: 'data', editAnchor: 'dv-sms-unpaid' },
  { key: 'smsNotice', label: '단체 공지 문자 템플릿', editTab: 'data', editAnchor: 'dv-sms-notice' },
  { key: 'smsPersonal', label: '입주자 문자 템플릿', editTab: 'data', editAnchor: 'dv-sms-personal' },
]

// ── 계약별 변수 미리보기 ─────────────────────────────────────
//
// 실제 계약 하나를 골라 "이 계약서에는 이렇게 채워진다"를 보여 주는 값. 치환의 정본은
// 화면(ContractView)과 인쇄(contractPrintHtml)의 맵이고, 이 함수는 그 규칙을 미리보기용으로
// 옮긴 것이다 — 키 목록이 갈리면 감지망이 잡는다. 외국인등록번호는 **항상 마스킹**한다.
// 종이에는 전체가 찍히지만 미리보기는 확인 용도라 평문을 들 이유가 없다.

const dot = (s: string | null) => (s ? s.replaceAll('-', '.') : '')

export function previewDocVars(d: ContractData): Record<string, string> {
  return {
    name: d.tenant.name,
    phone: d.tenant.primaryPhone ?? '',
    birth: d.tenant.foreignRegNo || d.tenant.hasForeignRegNo
      ? maskForeignRegNo(d.tenant.foreignRegNo ?? '')
      : dot(d.tenant.birthdate),
    job: d.tenant.job ?? '',
    gender: d.tenant.gender,
    smoking: d.tenant.smoking ? '흡연' : '비흡연',
    deposit: d.lease ? d.lease.depositAmount.toLocaleString() : '',
    rentFee: d.lease ? d.lease.rentAmount.toLocaleString() : '',
    checkInDate: dot(d.lease?.moveInDate ?? null),
    checkOutDate: dot(d.lease?.expectedMoveOut ?? null),
    roomNo: roomLabel(d.lease?.roomNo),
    emergencyContact: d.tenant.emergencyContacts
      .map(c => [c.name, c.relation ? `(${c.relation})` : '', c.phone].filter(Boolean).join(' ')).join(', '),
    환불규정: d.refundClauseInContract ? buildRefundClause() : '(자동 표시 꺼짐)',
    ...cleaningFeeVars(d.lease?.cleaningFee),
    단기요금표: d.shortStayRateTable || '(단기 정책 꺼짐)',
    일정: d.roomScheduleText ?? '(호실 일정 없음)',
  }
}

export function previewConsentVars(d: ContractData): Record<string, string> {
  return {
    성명: d.tenant.name,
    호실: roomLabel(d.lease?.roomNo),
    연락처: d.tenant.primaryPhone ?? '',
    미납일수: String(d.disposalConsent.days),
    영업장명: d.businessInfo.name || '',
    대표: d.businessInfo.ceoName || '',
  }
}
