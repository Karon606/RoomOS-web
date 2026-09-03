'use client'
// 서류 변수 허브 — 계약서·동의서·문자·메일에 들어가는 변수를 한 화면에서 조망하고,
// 영업장 값은 그 자리에서 고친다(운영자 승인 2026-09-01, 패널 설계).
//
// 원칙. 이 화면은 **같은 DB 필드를 편집하는 또 하나의 문**이다. 저장은 기존 정본 액션
// (updatePropertySettings 부분 저장·saveBusinessInfo)을 그대로 재사용하므로 곳곳의 카드와
// 여기가 별도 동기화 없이 자동으로 양방향이다. 열 때마다 서버에서 새로 읽는다 — 편집 문이
// 둘이 되는 대신 낡은 값을 들고 저장하는 사고를 신선도로 막는다(적대 검토 조건).
// 긴 문안(계약서 본문·특약·문자 템플릿)은 여기서 열지 않는다 — 편집기를 복제하면 두 벌이 된다.

import { useCallback, useEffect, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Modal } from '@/components/ui/Modal'
import { Btn } from '@/components/ui/Btn'
import { confirmDialog } from '@/components/ui/ConfirmDialog'
import { SkeletonRows } from '@/components/ui/Skeleton'
import { pushToast, humanError } from '@/lib/saveStatus'
import { DOC_VARIABLES, DOC_TEMPLATES } from '@/lib/docVariables'
import type { SettingsTab } from './tabs'
import {
  getDocVariableHubData, getDocVariablePreviewTargets, getDocVariablePreview,
  updatePropertySettings, saveBusinessInfo, type DocVariableHubData,
} from './actions'

type Jump = (tab: SettingsTab, anchorId: string) => void

const GROUPS: { grammar: 'doc' | 'consent' | 'msg' | 'direct'; title: string }[] = [
  { grammar: 'doc', title: '계약서 본문 {{ }}' },
  { grammar: 'consent', title: '임의처분 동의서 {{ }}' },
  { grammar: 'msg', title: '문자·메일 { }' },
  { grammar: 'direct', title: '변수 없이 서류에 직접 인쇄' },
]

/** 사전 항목의 현재 값 — 영업장 값만 실제 값을 보이고, 계약별·파생은 배지가 값이다. */
function valueOf(entry: (typeof DOC_VARIABLES)[number], d: DocVariableHubData | null): string | null {
  if (!d || entry.kind !== 'property') return null
  const biz = d.businessInfo
  const byKey: Record<string, string> = {
    '환불규정': d.refundClauseInContract ? '자동 표시 켜짐' : '자동 표시 꺼짐',
    '미납일수': `${d.disposal.days}일`,
    '영업장명': entry.grammar === 'msg' ? d.name : biz.name,
    '대표': biz.ceoName, '대표자': biz.ceoName,
    '계좌번호': d.bankAccount,
    '상호': biz.name, '사업자번호': biz.registrationNo, '사업장주소': biz.address,
    '영업장주소': d.address, '영업장전화': d.phone, '전용면적': d.defaultAreaM2 ? `${d.defaultAreaM2}㎡` : '',
  }
  return byKey[entry.key] ?? null
}

export function DocVariablesOverviewCard({ onJump }: { onJump: Jump }) {
  const [hubOpen, setHubOpen] = useState(false)
  return (
    <div className="rounded-xl p-4 sm:p-5 space-y-3" style={{ background: 'var(--cream)', border: '1px solid var(--warm-border)' }}>
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-[var(--warm-dark)]">서류 변수 한눈에</h3>
        <Btn variant="secondary" size="sm" onClick={() => setHubOpen(true)}>모아 보기</Btn>
      </div>
      <p className="text-xs text-[var(--warm-muted)] -mt-1 leading-relaxed break-keep">
        계약서·동의서·문자·메일에 자동으로 채워지는 값의 목록입니다. 영업장 값은 여기서 고치고,
        문안은 편집기로 건너갑니다. 계약별 값은 실제 계약으로 미리 봅니다. 고친 값은 다음
        발급부터 적용되며, 이미 서명한 계약서와 발급된 서류는 바뀌지 않습니다.
      </p>
      {hubOpen && (
        <DocVariablesHub onClose={() => setHubOpen(false)} onJump={onJump} />
      )}
    </div>
  )
}

// ── 허브 본체 ────────────────────────────────────────────────

type EditRow = {
  id: string; label: string; sub: string
  numeric?: boolean; required?: boolean
  read: (d: DocVariableHubData) => string
  save: (d: DocVariableHubData, v: string) => Promise<void>
}

const bizSave = (patch: (v: string) => Partial<DocVariableHubData['businessInfo']>) =>
  async (d: DocVariableHubData, v: string) => {
    const r = await saveBusinessInfo({ ...d.businessInfo, ...patch(v) })
    if (!r.ok) throw new Error(r.error)
  }
const propSave = (key: string) => async (_d: DocVariableHubData, v: string) => {
  const fd = new FormData()
  fd.append(key, v)
  await updatePropertySettings(fd)   // 부분 저장 정본 — 실려 온 필드만 쓴다(lib/propertySettingsPatch)
}

const EDIT_ROWS: EditRow[] = [
  { id: 'name', label: '영업장 이름', sub: '문자·메일 {영업장명} · 홈 화면의 간판 이름', required: true, read: d => d.name, save: propSave('name') },
  { id: 'bizName', label: '상호', sub: '서류·동의서 {{영업장명}} · 등기 상호 (위 간판 이름과 다른 값)', read: d => d.businessInfo.name, save: bizSave(v => ({ name: v })) },
  { id: 'ceoName', label: '대표자', sub: '계약서 하단·동의서 {{대표}}', read: d => d.businessInfo.ceoName, save: bizSave(v => ({ ceoName: v })) },
  { id: 'registrationNo', label: '사업자등록번호', sub: '계약서 하단·실거주 확인서', read: d => d.businessInfo.registrationNo, save: bizSave(v => ({ registrationNo: v })) },
  { id: 'bizAddress', label: '사업장 주소(등록증 표기)', sub: '계약서 하단 사업자 표기', read: d => d.businessInfo.address, save: bizSave(v => ({ address: v })) },
  { id: 'address', label: '영업장 주소(건물 소재지)', sub: '실거주 확인서 소재지·입주자 주소 (등록증 표기와 다른 사실)', read: d => d.address, save: propSave('address') },
  { id: 'phone', label: '대표 연락처', sub: '계약서 헤더·푸터', read: d => d.phone, save: propSave('phone') },
  { id: 'bankAccount', label: '입금 계좌', sub: '납부 확인서·미납 문자 {계좌번호}', read: d => d.bankAccount, save: propSave('bankAccount') },
  { id: 'defaultAreaM2', label: '영업장 전용면적(㎡)', sub: '실거주 확인서 면적 칸', numeric: true, read: d => d.defaultAreaM2, save: propSave('defaultAreaM2') },
  {
    id: 'disposalDays', label: '미납 기준일', sub: '임의처분 동의서 {{미납일수}}', numeric: true,
    read: d => String(d.disposal.days),
    // 동의서는 칼럼 하나(JSON)라 네 칸이 한 벌로 저장된다 — 나머지 셋은 현재 값 그대로 싣는다.
    save: async (d, v) => {
      const fd = new FormData()
      fd.append('disposalEnabled', d.disposal.enabled ? '1' : '0')
      fd.append('disposalDays', v)
      fd.append('disposalTitle', d.disposal.title)
      fd.append('disposalBody', d.disposal.body)
      await updatePropertySettings(fd)
    },
  },
]

// 형제(SettingsForm)의 입력 클래스에 최소 높이 토큰만 얹었다. 옆에 서는 Btn 이 44px 이라
// py-2.5(42px)면 2px 어긋난다(§09 터치 타겟).
const inputCls = 'w-full px-3 py-2.5 min-h-[var(--input-h-touch)] rounded-sm text-sm outline-none bg-[var(--canvas)] border border-[var(--warm-border)] text-[var(--warm-dark)] focus:border-[var(--coral)] transition-colors'

function DocVariablesHub({ onClose, onJump }: { onClose: () => void; onJump: Jump }) {
  const router = useRouter()
  const [data, setData] = useState<DocVariableHubData | null>(null)
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [pending, startTransition] = useTransition()
  const [targets, setTargets] = useState<{ tenantId: string; leaseTermId: string; label: string }[]>([])
  const [previewKey, setPreviewKey] = useState('')
  const [preview, setPreview] = useState<{ doc: Record<string, string>; consent: Record<string, string> } | null>(null)
  const [previewLoading, setPreviewLoading] = useState(false)

  const reload = useCallback(() => {
    getDocVariableHubData().then(d => { setData(d); setDrafts({}) }).catch(() => pushToast('error', '값을 불러오지 못했습니다.'))
  }, [])
  useEffect(() => {
    reload()
    getDocVariablePreviewTargets().then(setTargets).catch(() => { /* 미리보기는 부가 기능이다 */ })
  }, [reload])

  const runSave = (row: EditRow, value: string, opts?: { silent?: boolean }) => {
    if (!data) return
    const prev = row.read(data)
    startTransition(async () => {
      try {
        await row.save(data, value)
      } catch (e) {
        pushToast('error', humanError(e, '저장에 실패했습니다.'))
        return
      }
      router.refresh()
      reload()
      if (!opts?.silent) {
        pushToast('success', `${row.label} 저장됨`, {
          detail: '다음 발급부터 적용됩니다. 이미 서명한 계약서와 발급된 서류는 바뀌지 않습니다.',
          action: { label: '적용취소', run: () => runSave(row, prev, { silent: true }) },
        })
      } else {
        pushToast('info', `${row.label}을(를) 되돌렸습니다.`)
      }
    })
  }

  const pickPreview = (key: string) => {
    setPreviewKey(key)
    setPreview(null)
    const t = targets.find(x => x.leaseTermId === key)
    if (!t) return
    setPreviewLoading(true)
    getDocVariablePreview(t.tenantId, t.leaseTermId)
      .then(setPreview)
      .catch(() => pushToast('error', '미리보기를 불러오지 못했습니다.'))
      .finally(() => setPreviewLoading(false))
  }

  // v2.0 §12 입력 유실 방지. 행 초안 열 개 중 하나라도 저장값과 다르면 dirty 다.
  // Modal 이 배경클릭을 무시하고 Esc·X 에 확인을 붙인다.
  const dirty = !!data && EDIT_ROWS.some(r => (drafts[r.id] ?? r.read(data)).trim() !== r.read(data).trim())

  // 편집으로 이동은 onClose 가 먼저라 Modal 의 dirty 경로를 타지 않는다. 같은 문구·같은 방식으로
  // 여기서 한 번 묻는다(Modal.requestClose 와 동일한 confirmDialog 호출).
  const jumpToEdit = async (tab: SettingsTab, anchorId: string) => {
    if (dirty) {
      const ok = await confirmDialog({
        title: '작성 중인 내용이 있습니다. 닫을까요?',
        confirmLabel: '닫기', cancelLabel: '계속 작성',
      })
      if (!ok) return
    }
    onClose()
    onJump(tab, anchorId)
  }

  return (
    <Modal open onClose={onClose} dirty={dirty} title="서류 변수" subtitle="영업장 값은 여기서, 문안은 원래 편집기에서">
      <div className="space-y-5">
        {/* 1. 영업장 값 — 같은 필드를 편집하는 또 하나의 문 */}
        <section className="space-y-2">
          <h4 className="text-xs font-semibold text-[var(--warm-dark)]">영업장 값</h4>
          <p className="text-[0.65625rem] text-[var(--warm-muted)] break-keep">고친 값은 다음 발급부터 적용됩니다. 이미 서명한 계약서와 발급된 서류는 바뀌지 않습니다.</p>
          {!data ? (
            <SkeletonRows rows={4} />
          ) : (
            <ul className="space-y-2.5">
              {EDIT_ROWS.map(row => {
                const saved = row.read(data)
                const cur = drafts[row.id] ?? saved
                const rowDirty = cur.trim() !== saved.trim()
                return (
                  <li key={row.id} className="space-y-1">
                    <label className="text-xs font-medium text-[var(--warm-mid)]">{row.label}</label>
                    <p className="text-[0.65625rem] text-[var(--warm-muted)]">{row.sub}</p>
                    <div className="flex items-center gap-2">
                      <input
                        value={cur}
                        inputMode={row.numeric ? 'decimal' : undefined}
                        onChange={e => setDrafts(p => ({ ...p, [row.id]: row.numeric ? e.target.value.replace(/[^0-9.]/g, '') : e.target.value }))}
                        className={inputCls} />
                      {/* 고칠 것이 있는 행만 primary 로 세운다. 열 행 전부가 코랄이면 위계가 사라진다(§10). */}
                      <Btn variant={rowDirty ? 'primary' : 'secondary'} size="sm"
                        disabled={pending || !rowDirty || (row.required && !cur.trim())}
                        onClick={() => runSave(row, cur)}>저장</Btn>
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </section>

        {/* 2. 문안 — 값이 아니라 문서라 원래 편집기로 점프한다 */}
        <section className="space-y-2">
          <h4 className="text-xs font-semibold text-[var(--warm-dark)]">문안</h4>
          <p className="text-[0.65625rem] text-[var(--warm-muted)] break-keep">긴 문안은 원래 편집기 한 곳에서만 고칩니다. 편집기가 둘이 되면 언젠가 갈립니다.</p>
          <ul className="space-y-1">
            {DOC_TEMPLATES.map(t => (
              <li key={t.key} className="flex items-center justify-between gap-2 text-xs text-[var(--warm-dark)]">
                <span>{t.label}</span>
                {/* 이동 손잡이는 정본 Btn(secondary sm = 44px). 라벨의 '›' 는 설정 형제 링크와 같은 문법이다. */}
                <Btn variant="secondary" size="sm" className="shrink-0"
                  onClick={() => void jumpToEdit(t.editTab, t.editAnchor)}>
                  편집으로 이동 ›
                </Btn>
              </li>
            ))}
          </ul>
        </section>

        {/* 3. 계약별 변수 미리보기 — 수정 대상이 아니라 확인 대상이다 */}
        <section className="space-y-2">
          <h4 className="text-xs font-semibold text-[var(--warm-dark)]">계약별 변수 미리보기</h4>
          <p className="text-[0.65625rem] text-[var(--warm-muted)] break-keep">
            성명·호실·일정처럼 계약마다 달라지는 값입니다. 계약을 고르면 그 계약서에 실제로 채워질
            값이 보입니다. 수정은 고객 정보·계약 폼에서 합니다. 외국인등록번호는 여기서 마스킹되어
            보이고, 종이에는 전체가 찍힙니다.
          </p>
          <select value={previewKey} onChange={e => pickPreview(e.target.value)}
            className="w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-3 py-2.5 text-sm text-[var(--warm-dark)] outline-none focus:border-[var(--coral)]">
            <option value="">계약을 고르세요</option>
            {targets.map(t => <option key={t.leaseTermId} value={t.leaseTermId}>{t.label}</option>)}
          </select>
          {previewLoading && <SkeletonRows rows={2} />}
          {/* 묶음 바탕은 --cream-soft. 다크에서 --canvas 는 #000 이라 크림 모달에 검은 구멍이 뚫린다(§28). */}
          {preview && (
            <div className="space-y-3">
              {([['계약서 본문', 'doc'], ['임의처분 동의서', 'consent']] as const).map(([title, g]) => (
                <div key={g} className="rounded-lg px-3 py-2 space-y-1" style={{ background: 'var(--cream-soft)' }}>
                  <p className="text-[0.65625rem] font-semibold text-[var(--warm-mid)]">{title}</p>
                  <ul className="space-y-0.5">
                    {DOC_VARIABLES.filter(v => v.grammar === g).map(v => (
                      <li key={`${v.grammar}|${v.key}`} className="flex items-baseline gap-2 text-[0.6875rem]">
                        <span className="mono shrink-0 text-[var(--warm-muted)]">{v.shown}</span>
                        <span className="text-[var(--warm-dark)] break-all">{(g === 'doc' ? preview.doc : preview.consent)[v.key] || '(미입력)'}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* 4. 전체 사전 — 무엇이 어디서 오나 */}
        <section className="space-y-2">
          <h4 className="text-xs font-semibold text-[var(--warm-dark)]">전체 목록</h4>
          {GROUPS.map(gr => (
            <div key={gr.grammar} className="space-y-1">
              <p className="text-[0.65625rem] font-semibold text-[var(--warm-muted)]">{gr.title}</p>
              <ul className="space-y-0.5">
                {DOC_VARIABLES.filter(v => v.grammar === gr.grammar).map(v => (
                  <li key={`${v.grammar}|${v.key}`} className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-[0.6875rem]">
                    <span className="mono shrink-0 text-[var(--warm-muted)]">{v.shown === '(직접 인쇄)' ? v.label : v.shown}</span>
                    <span className="text-[var(--warm-dark)]">{v.shown === '(직접 인쇄)' ? '' : v.label}</span>
                    {/* 값(또는 그 자리를 대신하는 배지) 뒤에 원천을 잇는다. 계약별·파생은 배지만으로는
                        "어디서 오나"를 말하지 못한다. */}
                    <span className="text-[var(--warm-muted)]">
                      {v.kind === 'perContract' ? '계약마다 다름'
                        : v.kind === 'derived' ? '보낼·뽑을 때 계산'
                        : valueOf(v, data) || '(미입력)'}
                      {' · '}{v.source}
                    </span>
                    {v.editTab && v.editAnchor && (
                      <button type="button" onClick={() => void jumpToEdit(v.editTab!, v.editAnchor!)}
                        className="-my-2 min-h-[44px] inline-flex items-center text-[0.65625rem] underline decoration-dotted underline-offset-2 text-[var(--warm-mid)] hover:text-[var(--warm-dark)]">
                        {v.editLabel ?? '편집으로 이동'} ›
                      </button>
                    )}
                    {v.note && <span className="w-full text-[0.65625rem] text-[var(--warm-muted)] break-keep">{v.note}</span>}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </section>
      </div>
    </Modal>
  )
}
