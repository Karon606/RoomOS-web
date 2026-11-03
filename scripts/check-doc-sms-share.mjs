// 서류 문자 시트의 안드로이드 공유 흐름을 지키는 소스 그물 — 읽기 전용, 위반 시 exit 1
//
// 신고 5·6(2026-11-03 운영자 승인). 안드로이드 문자 시트의 주 버튼 '문자 보내기'는 문구를 클립보드에
// 복사한 뒤 공유 창에 사진만 싣는다. 아이폰과 공유를 못 하는 기기는 종전 흐름(사진 저장 + sms: 링크)이다.
//   ⓐ 갈림은 `isAndroid() && canShareFiles()` 하나다(아이폰·PC 는 종전 흐름, 미지원 기기는 sms: 로 넘어감)
//   ⓑ 공유 흐름의 주 버튼은 share.sendWithText(body) 를 부르고, 이력(handOff)은 결과가 'shared' 일 때만 남긴다
//   ⓒ 주 버튼은 준비 완료(ready: done 이 선택 수 이상이고 실패 0) 또는 실패(다시 시도) 때만 켜지고,
//      공유 중(sharing)에는 막힌다. 준비 중·실패 표시는 주 버튼 한 곳이다
//   ⓓ 종전 흐름은 그대로 산다 — sms: 링크(singleSmsHref)와 그 클릭의 handOff, 저장 버튼 share.save
//   ⓔ useDocShare: 공유 창에는 파일만 간다(shareFiles 에 인자 하나), 클립보드 복사가 shareFiles 앞이다,
//      sendWithText 를 돌려주고 send 는 인자를 받지 않는다(알약이 클릭 이벤트를 첫 인자로 넘긴다)
//   ⓕ lib/shareFile shareFiles 의 share 호출은 { files } 뿐이다(files 와 text 동시 금지, 카카오톡 실패 이력)
//   ⓖ 시트의 사용자 노출 문자열에 em dash · 느낌표가 없다(가이드 §29)
//   ⓗ 제스처 유지 — 클릭부터 share 까지 await 는 clipboard.writeText 하나뿐이다. 시트 shareAndLog 는
//      sendWithText 앞에 await·setTimeout 이 없고, 훅 deliver 는 shareFiles 앞에 다른 await·setTimeout 이 없다
//      (사이에 대기가 끼면 사용자 활성이 만료돼 공유 창이 NotAllowedError 로 거부된다)
//   ⓘ 이력은 한 번만 — handOff 는 맨 앞에서 logged 가드로 돌아가고 바로 setLogged(true) 한다
//
// 실행: node scripts/check-doc-sms-share.mjs
import fs from 'node:fs'

const read = f => fs.readFileSync(new URL(`../${f}`, import.meta.url), 'utf8')
// 주석은 지운다. 주석 속 설명 문장이 판정을 흔들면 안 된다.
const strip = raw => raw
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^[^\S\n]*\/\/.*$/gm, '')
  .replace(/([^:'"`])\/\/[^\n'"`]*$/gm, '$1')

const SHEET = 'components/doc/TenantDocSmsComposeSheet.tsx'
const HOOK = 'lib/useDocShare.ts'
const SHARE = 'lib/shareFile.ts'
const sheet = strip(read(SHEET))
const hook = strip(read(HOOK))
const shareLib = strip(read(SHARE))
const fails = []
const must = (ok, msg) => { if (!ok) fails.push(msg) }

/** name = ... 의 오른쪽 식(줄 끝까지). */
const rhs = (src, name) => (src.match(new RegExp(`const ${name} = ([^\\n]+)`)) ?? [])[1] ?? ''
/** 함수 본문(중괄호 짝). start 는 여는 중괄호 앞 아무 위치. */
function body(src, start) {
  const open = src.indexOf('{', start)
  if (open < 0) return ''
  let d = 0
  for (let i = open; i < src.length; i++) {
    if (src[i] === '{') d++
    else if (src[i] === '}' && --d === 0) return src.slice(open, i + 1)
  }
  return ''
}

// ⓐ
must(/import \{[^}]*\bcanShareFiles\b[^}]*\} from '@\/lib\/shareFile'/.test(sheet), 'ⓐ 시트가 canShareFiles 를 가져오지 않는다')
must(/^isAndroid\(\) && canShareFiles\(\)$/.test(rhs(sheet, 'shareFlow').trim()), `ⓐ shareFlow 가 'isAndroid() && canShareFiles()' 가 아니다: ${rhs(sheet, 'shareFlow')}`)
const ia = sheet.indexOf('function isAndroid()')
must(ia >= 0 && /return \/Android\/i\.test\(navigator\.userAgent\)/.test(body(sheet, ia)), 'ⓐ isAndroid 가 UA 의 Android 를 보지 않는다')

// ⓑ
const sal = sheet.indexOf('const shareAndLog')
must(sal >= 0, 'ⓑ shareAndLog 가 없다')
const salBody = sal >= 0 ? body(sheet, sal) : ''
must(/await share\.sendWithText\(body\)/.test(salBody), 'ⓑ shareAndLog 가 share.sendWithText(body) 를 기다리지 않는다')
must(/if \(r === 'shared'\) handOff\(\)/.test(salBody), "ⓑ 이력(handOff)이 'shared' 결과에만 묶여 있지 않다")
must((salBody.match(/handOff\(\)/g) ?? []).length === 1, 'ⓑ shareAndLog 안에서 handOff 가 한 번이 아니다')
must(/if \(sharing\) return/.test(salBody) && /setSharing\(true\)/.test(salBody) && /finally \{\s*setSharing\(false\)/.test(salBody),
  'ⓑ 공유 중 재진입 가드(sharing)와 finally 해제가 없다')
const shareBtn = sheet.match(/\{shareFlow \? \(\s*<Btn([\s\S]*?)<\/Btn>/)
must(!!shareBtn, 'ⓑ 공유 흐름 주 버튼(shareFlow ? <Btn ...>)을 못 찾았다')
if (shareBtn) {
  must(/onClick=\{\(\) => void shareAndLog\(\)\}/.test(shareBtn[1]), 'ⓑ 공유 흐름 주 버튼이 shareAndLog 를 부르지 않는다')
  must(!/handOff/.test(shareBtn[1]), 'ⓑ 공유 흐름 주 버튼이 누르는 순간 handOff 를 부른다(이력은 공유 성공 시점)')
  must(/문자 보내기/.test(shareBtn[1]), "ⓑ 공유 흐름 주 버튼 라벨이 '문자 보내기' 가 아니다")
  // ⓒ
  const dis = (shareBtn[1].match(/disabled=\{([^}]*)\}/) ?? [])[1] ?? ''
  for (const t of ['!canSend', '!(ready || failed)', 'tooMany', 'sharing']) must(dis.includes(t), `ⓒ 주 버튼 disabled 에 ${t} 가 없다: ${dis}`)
  must(/failed \? '서류 준비 실패 · 다시 시도' : ready \? '문자 보내기' : '서류 준비 중…'/.test(shareBtn[1]), 'ⓒ 주 버튼이 준비 중·실패를 이름으로 말하지 않는다')
}
const ready = rhs(sheet, 'ready')
must(/share\.done >= docTitles\.length/.test(ready) && /share\.failedCount === 0/.test(ready), `ⓒ ready 가 '선택 수 준비 완료 + 실패 0' 이 아니다: ${ready}`)
must(/^share\.failedCount > 0$/.test(rhs(sheet, 'failed').trim()), 'ⓒ failed 가 share.failedCount > 0 이 아니다')
must(/disabled=\{shareFlow \? !ready \|\| tooMany :/.test(sheet), 'ⓒ 공유 흐름의 보조 저장 버튼이 준비 완료 전에 켜진다')

// ⓓ
must(/<BtnLink[^>]*href=\{singleSmsHref\(phone\.value, body\)\}/.test(sheet), 'ⓓ 종전 흐름의 sms: 링크가 사라졌다')
must(/onClick=\{e => \{ if \(blockSmsIfStaging\(e\)\) return; handOff\(\) \}\}/.test(sheet), 'ⓓ 종전 흐름 링크의 handOff 가 사라졌다')
must(/onClick=\{\(\) => void share\.save\(\)\}/.test(sheet), 'ⓓ 서류 사진 저장 버튼(share.save)이 사라졌다')
must(/\{!shareFlow && saveBlock\}/.test(sheet) && /\{shareFlow && saveBlock\}/.test(sheet), 'ⓓ 저장 버튼이 두 흐름 모두에 서지 않는다')

// ⓔ
const dl = hook.indexOf('const deliver = useCallback')
must(dl >= 0, 'ⓔ useDocShare 에 deliver 가 없다')
const dlBody = dl >= 0 ? body(hook, hook.indexOf('=>', dl)) : ''
const sf = dlBody.match(/shareFiles\(([^)]*)\)/)
must(!!sf && sf[1].trim() === 'files', `ⓔ deliver 가 공유 창에 파일만 넘기지 않는다: shareFiles(${sf?.[1] ?? '?'})`)
const clip = dlBody.indexOf('navigator.clipboard.writeText(text)')
must(clip >= 0 && sf && clip < dlBody.indexOf(sf[0]), 'ⓔ 클립보드 복사가 공유 창 앞에 있지 않다(뒤에 두면 제스처가 소비된다)')
must(/return result/.test(dlBody), 'ⓔ deliver 가 공유 결과를 돌려주지 않는다')
must(/const send = useCallback\(\(\) => deliver\(shareTextRef\.current\)/.test(hook), 'ⓔ send 가 인자 없이 훅의 shareText 로 deliver 를 부르지 않는다')
must(/const sendWithText = useCallback\(\(text: string\) => deliver\(text\)/.test(hook), 'ⓔ sendWithText 가 없다')
must(/return \{[^}]*\bsendWithText\b[^}]*\}/.test(hook), 'ⓔ useDocShare 가 sendWithText 를 돌려주지 않는다')

// ⓕ
const shares = [...shareLib.matchAll(/nav\.share\(([^)]*)\)/g)].map(m => m[1].replace(/\s+/g, ' ').trim())
must(shares.length > 0, 'ⓕ shareFile 에서 nav.share 호출을 못 찾았다')
for (const a of shares) must(/^\{ files(: \[file\])? \}$/.test(a), `ⓕ nav.share 에 files 외의 값이 실린다: ${a}`)

// ⓗ
{
  const pre = salBody.slice(0, Math.max(0, salBody.indexOf('share.sendWithText(')))
  must(salBody.includes('share.sendWithText('), 'ⓗ shareAndLog 에서 sendWithText 를 못 찾았다')
  must(!/\bawait\b/.test(pre.replace(/await\s*$/, '')) && !/setTimeout|requestAnimationFrame|\.then\(/.test(pre),
    'ⓗ shareAndLog 가 sendWithText 앞에서 기다린다(제스처 만료)')
  const sfAt = sf ? dlBody.indexOf(sf[0]) : -1
  const hp = sfAt >= 0 ? dlBody.slice(0, sfAt) : ''
  const awaits = (hp.match(/\bawait\b[^\n;]*/g) ?? []).map(a => a.trim())
  const extra = awaits.filter(a => !/^await navigator\.clipboard\.writeText\(text\)$/.test(a) && !/^await shareFiles\(files\)$/.test(a) && a !== 'await')
  must(sfAt >= 0 && extra.length === 0 && (hp.match(/\bawait\b/g) ?? []).length === 2,
    `ⓗ deliver 가 공유 창 앞에서 클립보드 말고도 기다린다: ${JSON.stringify(awaits)}`)
  must(!/setTimeout|requestAnimationFrame|\.then\(/.test(hp), 'ⓗ deliver 가 공유 창 앞에서 타이머·then 을 쓴다')
}

// ⓘ
{
  const ho = sheet.indexOf('const handOff = () =>')
  const hb = ho >= 0 ? body(sheet, ho) : ''
  must(/^\{\s*if \(logged\) return\s*setLogged\(true\)/.test(hb), 'ⓘ handOff 맨 앞에 logged 가드와 setLogged(true) 가 없다(중복 기록)')
}

// ⓖ
const strs = [...sheet.matchAll(/'([^'\n]*)'|`([^`\n]*)`|>([^<>{}\n]*[가-힣][^<>{}\n]*)</g)].map(m => m[1] ?? m[2] ?? m[3])
const jsxText = sheet.split('\n').filter(l => /^\s+[가-힣'"]/.test(l)).map(l => l.trim())
for (const t of [...strs, ...jsxText]) {
  if (/[가-힣]/.test(t) && /—|!/.test(t.replace(/!==?|!\w|!\(/g, ''))) fails.push(`ⓖ 사용자 문자열에 em dash 또는 느낌표: ${t}`)
}

if (fails.length) {
  console.error(`check-doc-sms-share: 위반 ${fails.length}건`)
  for (const f of fails) console.error('  - ' + f)
  process.exit(1)
}
console.log('check-doc-sms-share: 통과 (안드로이드 공유 흐름·이력 시점·준비 게이트·종전 흐름·파일만 공유·문구)')
