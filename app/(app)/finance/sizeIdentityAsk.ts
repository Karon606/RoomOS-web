// 규격이 다른 구매를 같은 품목으로 둘지 묻는 창 한 벌(지출 등록·지출 수정·대기 영수증 승인). 판정 정본은 lib/sizeIdentity
//
// 답은 셋이다. 'split' 은 이번 구매를 '{품명} {규격}' 으로 나누고, 'keep' 은 같은 품목으로 둔다(서버가 다시 나누지 않게 sizeKeep 으로
// 싣는다), null 은 취소(저장 중단)다. 이력이 물리 단위 한 규격뿐이면 옛 카드도 '{품명} {옛 규격}' 으로 개명하자고 말한다(renameOldTo).
// 개명은 지출 등록에서만 한다(수정·승인은 그 자리에서 옛 행 이름이 바뀌면 저장과 엇갈린다, renameOld:false 면 이번 구매만 나눈다).
import { choiceDialog } from '@/components/ui/ConfirmDialog'
import { isConvertibleUnit } from '@/lib/units'
import { sizeIdentityAsks, groupSizes, sizeText } from '@/lib/sizeIdentity'
import { withParticle } from '@/lib/koParticle'

export type SizeCardInfo = { cardId: string; trackUnit: string; specUnit: string | null; qtyUnit: string | null; specHistory: { value: number; unit: string; count: number }[] }
export type SizeAnswer = { kind: 'silent' } | { kind: 'keep' } | { kind: 'split'; label: string; renameOldTo: string | null }

export async function askSizeIdentity(
  it: { label: string; specValue: string | number | null | undefined; specUnit: string | null | undefined; qtyUnit: string | null | undefined },
  card: SizeCardInfo | undefined,
  opts: { renameOld: boolean },
): Promise<SizeAnswer | null> {
  const label = (it.label ?? '').trim()
  if (!card || !sizeIdentityAsks(it, card, card.specHistory)) return { kind: 'silent' }
  const sizes = groupSizes(card.specHistory)
  const nowText = sizeText(Number(it.specValue), (it.specUnit ?? '').trim())
  // 옛 규격이 수량 단위('1개')면 그것은 크기가 아니다. 옛 카드를 '세탁조크리너 1개' 로 개명하지 않고 이번 구매만 나눈다.
  const single = sizes.length === 1 ? sizes[0] : null
  const only = opts.renameOld && single && isConvertibleUnit(single.unit) ? single : null
  const oldText = only ? sizeText(only.value, only.unit) : ''
  const lead = single
    ? (isConvertibleUnit(single.unit) ? `지금까지 이 품목은 ${sizeText(single.value, single.unit)} 규격으로만 등록했습니다. ` : '지금까지 이 품목은 개수로만 등록했습니다. ')
    : `이 품목은 여러 규격(${sizes.map(s => sizeText(s.value, s.unit)).join(', ')})을 같은 품목으로 관리하고 있습니다. `
  const choice = await choiceDialog({
    title: `'${label}' ${withParticle(label, '을/를').slice(label.length)} ${nowText} 규격으로 저장할까요?`,
    message: only
      ? `${lead}서로 다른 품목으로 관리하려면 구분을 품명에 표시합니다. 나누면 이번 구매는 '${label} ${nowText}' 로, 기존 품목과 지출은 '${label} ${oldText}' 로 나뉩니다.`
      : `${lead}나누면 이번 구매만 '${label} ${nowText}' 로 분리되고, 기존 품목은 그대로 둡니다.`,
    confirmLabel: only ? '규격별로 나누기' : `'${label} ${nowText}' 로 분리`,
    altLabel: '같은 품목으로',
    level: 'caution',
  })
  if (choice === null || choice === 'back') return null
  if (choice === 'alt') return { kind: 'keep' }
  return { kind: 'split', label: `${label} ${nowText}`, renameOldTo: only ? `${label} ${oldText}` : null }
}
