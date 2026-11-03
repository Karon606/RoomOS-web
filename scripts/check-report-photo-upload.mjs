// 오류신고 창의 사진 첨부 흐름 감지망(2026-11-03 신고 4·7, 운영자 승인 '추천대로'). 실행: node scripts/check-report-photo-upload.mjs
//
// 왜 필요한가. 갤럭시 PWA 에서 신고 사진이 '1장은 업로드하지 못했어요' 토스트만 남기고 빠졌다. 원인 셋이 겹쳤다.
//   · 고른 File 을 보낼 때 처음 읽었다. 안드로이드 File 은 사진 앱 손잡이라 몇 분 뒤 읽으면 깨진다.
//   · catch 가 원인을 버렸다. 신고에는 실패 장수만 남아 다음 사람이 무엇도 가를 수 없었다.
//   · 사진이 실패해도 신고를 먼저 저장하고 창을 닫았다. 다시 보내면 같은 신고가 둘이 된다.
//
// 잡는 것.
//   ⓐ 고르는 핸들러가 메모리 사본(pinPickedFile)을 만들고 줄인다(fileToUploadPhoto). 읽기 실패는 그 자리 안내(PICK_READ_FAIL).
//      이미지가 아닌 파일(형식을 확장자로 채운 뒤에도)은 그 자리에서 거절한다(isUploadablePhoto · PHOTO_TYPE_FAIL).
//   ⓑ 한 장 올리기는 두 번까지 시도하고 실패마다 단계(session|put)와 원인을 남긴다. 원인을 버리는 catch 가 없다.
//      PUT 에는 상한이 있고(lib/driveUpload xhr.timeout) 넘으면 원인 줄에 'timeout' 이 남는다.
//   ⓒ 실패한 사진이 남아 있으면 신고를 저장하지 않고 창을 닫지 않는다(실패 판정이 submitErrorReport 보다 앞).
//      도중에 닫으면 진행 상태를 비우고 finally 는 창 차례가 같을 때만 상태를 건드린다. 서버 액션이 던지면 토스트로 알리고 글·사진은 둔다.
//   ⓓ 실패 계측 [사진 첨부] 블록이 메모 뒤에 실리고 키보드 표 예산에서 그 길이를 뺀다.
//   ⓔ 취소·보내기는 Modal footer 이고 키보드에 접히지 않는다(collapseFooterOnKeyboard·kbd-collapse 없음).
//   ⓕ 실패 발끝은 [사진 빼고 보내기] 좌 · [사진 다시 올리기] 우(400px 미만은 위아래, 주 동작이 위), 안내 한 줄은 role=alert.
//      다시 올리는 동안에도 실패 발끝 틀을 지키고(failFrame) 장수는 그때그때 센다(failedCount). 두 버튼은 올리거나 고르는 중엔 막힌다.
//      기본 발끝(취소 / 신고 보내기)은 형제 모달처럼 늘 나란히다(위아래는 실패 발끝뿐).
//   ⓖ 진행은 버튼 '올리는 중 n/N'(320px 한 줄 실측) 과 썸네일 덮개 스피너다(퍼센트 막대 없음).
//   ⓗ 누르는 자리 44px(§09): 썸네일 삭제 w-11 h-11, '+ 사진 선택' min-h-11. 형제 사진 격자 셋(호실 추가 미리보기·호실 수정 사진·
//      공용 사진)의 삭제도 같은 문법(상시 노출, 누르는 자리 44px, 보이는 원 24px)이다(2026-11-03 운영자 추천 승인).
// 한계. 소스 가드라 존재만 본다. 사본·줄임의 뜻은 진리표 scripts/test-upload-image.ts 가 진다.
import { readFileSync } from 'node:fs'

// accept="image/*" 의 '/*' 가 주석 시작으로 먹히지 않게 먼저 바꿔 둔다.
const strip = s => s.replace(/image\/\*/g, 'image/STAR').replace(/\/\*[\s\S]*?\*\//g, '').split('\n').map(l => l.replace(/^\s*\/\/.*$/, '')).join('\n')
const src = strip(readFileSync('components/ErrorReportButton.tsx', 'utf8'))
const fails = []
const need = (name, cond, hint) => { if (!cond) fails.push(`${name}${hint ? `. ${hint}` : ''}`) }
const between = (a, b) => { const i = src.indexOf(a); if (i < 0) return ''; const j = src.indexOf(b, i + a.length); return src.slice(i, j < 0 ? undefined : j) }

// ⓐ
const pick = between('const onPickImages = async', '\n  const removeImage')
need('ⓐ 고르는 핸들러 본문', pick.length > 0)
need('ⓐ 고르는 순간 메모리 사본', /pinned = await pinPickedFile\(f\)/.test(pick), '보낼 때 처음 읽으면 안드로이드에서 깨진다')
need('ⓐ 고르는 순간 줄인다', /await fileToUploadPhoto\(pinned\)/.test(pick) && /from '@\/lib\/uploadImage'/.test(src))
need('ⓐ 읽기 실패는 그 자리 안내', /unreadable > 0 \? \(unreadable === 1 \? PICK_READ_FAIL/.test(pick) && /\{pickNote && <p role="alert"/.test(src))
need('ⓐ 이미지가 아니면 그 자리에서 거절', /if \(!isUploadablePhoto\(file\)\) \{ unsupported\+\+; continue \}/.test(pick) && /unsupported > 0 \? PHOTO_TYPE_FAIL/.test(pick))
need('ⓐ 상한은 줄인 뒤 크기로', /if \(file\.size > MAX_IMAGE_BYTES\)/.test(pick))

// ⓑ
const up = between('const uploadShot = async', '\n  const submit = async')
need('ⓑ 두 번까지 시도', /for \(let attempt = 0; attempt < 2; attempt\+\+\)/.test(up))
need('ⓑ 세션 실패 원인', /fails\.push\(`session \$\{session\.error\}`/.test(up))
need('ⓑ PUT 실패 원인과 단계', /fails\.push\(`\$\{stage\} \$\{\(err as Error\)\?\.message/.test(up) && /stage = 'put'/.test(up))
{
  const drive = strip(readFileSync('lib/driveUpload.ts', 'utf8'))
  need("ⓑ PUT 상한과 'timeout' 원인", /xhr\.timeout = timeoutMs/.test(drive) && /xhr\.ontimeout = \(\) => settle\(\(\) => reject\(new Error\(`업로드 timeout\(/.test(drive), "망이 멈추면 '올리는 중' 이 영원히 돈다")
}
need('ⓑ 원인을 버리는 catch 없음', !/catch\s*\{\s*failed/.test(src) && !/failedImages/.test(src), "실패 장수만 남기면 신고로 가를 수 없다")

// ⓒ
const sub = between('const submit = async (dropFailed = false)', '\n  const failedCount')
const failAt = sub.indexOf("if (failedNow > 0) { setFailFrame(true); return }")
const saveAt = sub.indexOf('await submitErrorReport(')
need('ⓒ 실패가 남으면 저장하지 않는다', failAt > 0 && saveAt > failAt, '사진 일부만 붙은 신고가 먼저 저장되면 다시 보낼 때 신고가 둘이 된다')
need('ⓒ 실패 경로에 창 닫기 없음', !/closeModal\(\)/.test(sub.slice(0, saveAt < 0 ? sub.length : saveAt)))
need('ⓒ 업로드 도중 닫았으면 저장하지 않는다', /const r = await uploadShot\(im\)\s*\n\s*if \(gen !== genRef\.current\) return/.test(sub) &&
  /await submitErrorReport\([\s\S]*?\}\)\s*\n\s*if \(gen !== genRef\.current\) return/.test(sub), '닫은 창의 신고가 뒤늦게 저장되면 취소가 거짓말이 된다')

// ⓓ
need('ⓒ 서버 액션이 던지면 알리고 글·사진은 둔다', /\} catch \(err\) \{\s*\n\s*if \(gen === genRef\.current\) pushToast\('error', humanError\(err,/.test(sub))
need('ⓒ finally 는 창 차례가 같을 때만', /\} finally \{\s*\n\s*if \(gen === genRef\.current\) \{ setPending\(false\); setProgress\(null\) \}/.test(sub))
need('ⓒ 닫으면 진행 상태를 비운다', /const closeModal = \(\) => \{ genRef\.current\+\+; clearImages\(\); setPending\(false\); setProgress\(null\); setOpen\(false\) \}/.test(src))
need('ⓓ [사진 첨부] 블록이 메모 바로 뒤', /\[note\.trim\(\), photoBlock, probe &&/.test(sub))
need('ⓓ 키보드 표 예산에서 사진 블록을 뺀다', /REPORT_NOTE_MAX - note\.trim\(\)\.length - probe\.length - pad\.length - photoBlock\.length/.test(sub))
need('ⓓ 화면 기하는 첫 await 전에', sub.indexOf('viewportProbe()') > 0 && sub.indexOf('viewportProbe()') < sub.indexOf('await '))

// ⓔ
need('ⓔ 버튼이 Modal footer', /footer=\{failFrame \? \(/.test(src))
need('ⓔ 키보드에 접히지 않는다', !/collapseFooterOnKeyboard|kbd-collapse/.test(src), '보내기가 이 창의 저장 버튼이다(§27.1)')

// ⓕ
need('ⓕ 실패 장수는 그때그때 센다', /const failedCount = images\.filter\(im => im\.status === 'failed'\)\.length/.test(src) && !/failNotice/.test(src))
need('ⓕ 실패 안내 한 줄', /<p role="alert" className=\{`text-xs text-\[var\(--danger-fg\)\] break-keep\$\{failedCount === 0 \? ' invisible' : ''\}`\}>\s*사진 \{failedCount\}장을 올리지 못했어요\. 다시 올리거나 빼고 보내 주세요\./.test(src))
need('ⓕ 빼고 보내기 좌 · 다시 올리기 우(좁으면 다시 올리기가 위), 올리거나 고르는 중엔 막힘', /<div className="flex flex-col-reverse gap-2 min-\[400px\]:flex-row">\s*<Btn type="button" variant="secondary" onClick=\{\(\) => void submit\(true\)\} disabled=\{pending \|\| preparing\} fullWidth>사진 빼고 보내기<\/Btn>\s*<Btn type="button" variant="primary" onClick=\{\(\) => void submit\(\)\} disabled=\{pending \|\| preparing\} fullWidth>\{pending \? sendLabel : '사진 다시 올리기'\}<\/Btn>/.test(src) &&
  /if \(failedNow > 0\) \{ setFailFrame\(true\); return \}/.test(src))
need('ⓕ 기본 발끝은 형제처럼 나란히', /\) : \(\s*<div className="flex gap-2">\s*<Btn type="button" variant="secondary" onClick=\{closeModal\}/.test(src), '위아래 배치는 실패 발끝에만 쓴다')
need('ⓕ 실패 썸네일 안쪽 테두리와 띠가 한 빨강', /outline-2 -outline-offset-2 outline-\[var\(--danger-solid\)\]/.test(src) && /bg-\[var\(--danger-solid\)\][^"]*text-\[var\(--on-solid\)\]">올리지 못함<\/span>/.test(src))

// ⓖ
need('ⓖ 진행 장수 버튼(320px 한 줄)', /`올리는 중 \$\{progress\.cur\}\/\$\{progress\.total\}`/.test(src))
need('ⓖ 사진 위 글자·아이콘은 --on-solid(순백 금지, §28)', !/#fff|text-white/i.test(src.slice(src.indexOf('<Modal'))))
need('ⓖ 퍼센트 막대 없음', !/onProgress|percent|%\}/.test(src))
need('ⓖ 덮개 스피너', /im\.status === 'uploading' && \(\s*<div className="absolute inset-0 grid place-items-center bg-black\/40"/.test(src))

// ⓗ
need('ⓗ 썸네일 삭제 44px', /aria-label="사진 삭제"\s*className="absolute top-0 right-0 w-11 h-11/.test(src))
need("ⓗ '+ 사진 선택' 44px", /min-h-11 items-center px-2 text-xs text-\[var\(--tc-text\)\]/.test(src))

for (const [file, n] of [['app/(app)/room-manage/RoomManageClient.tsx', 2], ['app/(app)/room-manage/PropertyPhotosManager.tsx', 1]]) {
  const t = strip(readFileSync(file, 'utf8'))
  const del = [...t.matchAll(/aria-label="사진 삭제"\s*className="([^"]*)"/g)].map(m => m[1])
  need(`ⓗ ${file.split('/').pop()} 사진 삭제 ${n}곳 44px 상시 노출`, del.length === n && del.every(c => /w-11 h-11/.test(c) && !/opacity-0|w-5 h-5|w-6 h-6/.test(c)),
    '보이는 원만 누르는 자리면 터치에서 빗나가고, hover 에만 보이면 터치 기기에서 안 보인다')
}

console.log(`\n[신고창 사진 첨부] 위반 ${fails.length}건`)
for (const f of fails) console.log('  - ' + f)
if (fails.length > 0) process.exit(1)
