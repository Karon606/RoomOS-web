// 서류 메일 푸터 로고 조달 — Drive 에 있는 영업장 로고를 메일에 실을 바이트로 가져온다.
//
// **메일에는 바이트를 심는다. 주소를 심지 않는다.**
//
// 링크로 걸면 안 되는 이유가 하나 결정적이다. 환경설정에서 로고를 새로 올리면 finalizeLogo 가
// 이전 Drive 파일을 휴지통으로 보낸다. 링크였다면 로고를 한 번 바꾸는 순간 **과거에 보낸 메일이
// 전부 깨진 이미지**가 된다. 나간 메일은 되돌릴 수 없다. 바이트를 넣으면 파일을 지우든 권한을
// 거두든 이미 간 메일은 5년 뒤에도 그대로 뜬다.
//
// 그 밖에도 링크는 세 가지가 걸린다. 수신함 상당수가 외부 이미지를 기본 차단하고, 열 때마다
// Drive 에 열람 신호가 남으며(서류 메일에 붙일 성질이 아니다), lib/docMail 머리의 "외부 이미지
// 의존 금지" 원칙을 정면으로 어긴다.
//
// **여기서 하는 fetch 는 발송 시점의 서버 조회다.** 메일 안에 외부 참조가 남지 않으므로 그 원칙과
// 충돌하지 않는다.
//
// 리사이즈는 Drive 에 시킨다. 40px 로 그릴 자리에 1509px 원본을 실을 이유가 없고, sharp 는
// next 의 optional dependency 라 배포 번들에 들어간다는 보장이 없다. 썸네일 URL 이 이미
// 리사이즈된 PNG 를 준다(w160 기준 4.5KB, 첨부 상한의 0.03%).

import { buildDriveThumbnailUrl, downloadDriveBytes, sniffImageMime } from './google-drive'

/** 본문에서 이 이름으로 참조한다(cid:). */
export const DOC_MAIL_LOGO_CID = 'property-logo'
/** 푸터에 그릴 크기(CSS px). 서명 옆 배지 크기다. */
export const DOC_MAIL_LOGO_PX = 40
/** 받아 올 픽셀 폭 — 표시 40px 의 4배. 레티나 2배에 여유를 둔다. */
const FETCH_PX = 160
/** 이보다 크면 로고로 안 본다. 원본 폴백이 커도 이 선에서 끊는다. */
const MAX_BYTES = 200 * 1024

export type DocMailLogoAsset = { bytes: Buffer; contentType: string }

// sniffImageMime 은 못 알아본 바이트에 application/octet-stream 을 돌려준다. 그것까지 받으면
// 로고 자리에 무엇이든 실릴 수 있다 — 이미지로 판정된 것만 통과시킨다.
const isImage = (mime: string) => mime.startsWith('image/')

/**
 * 메일에 실을 로고 바이트 — **실패는 null 이다.**
 *
 * 로고 때문에 서류가 안 나가는 경로를 만들지 않는다. 발신 주소가 이상하면 no-reply 로 떨어지는
 * 것과 같은 축이다. 반대로 도장은 실패하면 발급을 막는데(rent-receipt/generate), 도장은 법적
 * 효력의 근거이고 로고는 장식이라 판정이 다르다.
 *
 * 썸네일을 먼저 친다(리사이즈된 작은 PNG). 그 길은 로고에 공개 읽기 권한이 붙어 있다는 데
 * 기대는데(finalizeLogo 가 붙이고 knowledge/public-asset-exposure 가 승인한 자산이다), 언젠가
 * 그 권한이 거둬지면 조용히 사라지므로 인증된 원본 다운로드를 폴백으로 둔다.
 */
export async function fetchDocMailLogo(fileId: string | null | undefined): Promise<DocMailLogoAsset | null> {
  const id = fileId?.trim()
  if (!id) return null

  try {
    const res = await fetch(buildDriveThumbnailUrl(id, FETCH_PX))
    if (res.ok) {
      const bytes = Buffer.from(await res.arrayBuffer())
      const mime = sniffImageMime(bytes)
      if (isImage(mime) && bytes.byteLength <= MAX_BYTES) return { bytes, contentType: mime }
    }
  } catch { /* 썸네일 실패 — 아래 원본으로 */ }

  try {
    const bytes = await downloadDriveBytes(id)
    const mime = sniffImageMime(bytes)
    if (isImage(mime) && bytes.byteLength <= MAX_BYTES) return { bytes, contentType: mime }
  } catch { /* 원본도 실패 — 로고 없이 보낸다 */ }

  return null
}

/** 미리보기용 data URI — 확인 화면 iframe 은 cid: 를 못 그린다(수신함만 안다). */
export function logoDataUri(asset: DocMailLogoAsset): string {
  return `data:${asset.contentType};base64,${asset.bytes.toString('base64')}`
}
