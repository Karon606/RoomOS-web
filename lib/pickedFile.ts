// 고른 파일을 고르는 그 순간 메모리로 옮기는 정본. 나중에 올리는 자리(신고 사진·호실 추가 사진·도장·로고)가 쓴다.
//
// 왜 있나(2026-11-03 신고 4·7, 갤럭시 PWA). 안드로이드 크롬의 <input type=file> 이 돌려주는 File 은
// 바이트가 아니라 사진 앱 쪽 content URI 를 가리키는 손잡이다. 실제로 읽는 것은 PUT 이 바이트를 보내는
// 순간이고, 고른 뒤 글을 쓰고 보내기를 누를 때까지 몇 분이 지나면 그 사이 사진 앱이 원본을 다시 쓰거나
// 권한을 거둬 읽기가 깨진다(크로미움 ERR_UPLOAD_FILE_CHANGED, 크기 0 으로 읽히는 경우도 같은 클래스).
// 그래서 **고르는 그 순간 한 번 읽어** 메모리 사본으로 바꿔 둔다. 그 뒤로는 무엇이 바뀌어도 사본은 그대로다.
//
// 읽기가 그 자리에서 깨지면 그 자리에서 다시 고르라고 말한다. 보내기까지 미뤘다가 실패를 알리면
// 이미 쓴 글과 함께 사람이 할 일이 늘어난다.
//
// 비용. 사본은 원본 크기만큼 메모리를 쓴다(호실 사진 10장 상한, 신고는 3장). 큰 사진을 줄이는 일은
// 이 정본이 하지 않는다. 줄여도 되는 자리는 lib/uploadImage 의 fileToUploadPhoto 가 따로 맡는다.

/** 읽기에 실패했을 때 사람에게 할 말. */
export const PICK_READ_FAIL = '사진을 읽지 못했어요. 다시 골라 주세요.'

/**
 * 고른 파일을 메모리 사본으로 바꾼다. 읽기 실패나 빈 파일은 PICK_READ_FAIL 로 던진다.
 * 이름·형식·수정 시각은 원본 그대로다(저장 이름과 전송 Content-Type 이 되는 값이다).
 */
export async function pinPickedFile(file: File): Promise<File> {
  let buf: ArrayBuffer
  try {
    buf = await file.arrayBuffer()
  } catch {
    throw new Error(PICK_READ_FAIL)
  }
  if (buf.byteLength === 0) throw new Error(PICK_READ_FAIL)
  return new File([buf], file.name, { type: file.type, lastModified: file.lastModified })
}
