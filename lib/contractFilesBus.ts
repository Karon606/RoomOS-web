// 계약서 파일 목록 갱신 신호 — 목록 **밖에서** 용도가 바뀌었을 때 열려 있는 패널을 다시 읽게 한다.
//
// 왜 필요한가. 계약서를 발급하면 화면이 입주자 정보로 넘어가고, 그 뒤에 발급 토스트의
// [적용취소]가 눌린다. 그 시점에 계약서 파일 패널은 이미 마운트돼 제 목록을 들고 있어서,
// 서버만 되돌리면 운영자는 "되돌렸습니다" 토스트와 여전히 '보관용'이라 적힌 행을 **동시에**
// 본다(디자이너 패스 2026-08-26). §27.1 즉시 반영이 깨지는 자리다.
//
// 패널은 제 안의 동작에는 이미 reload() 를 태우고 있다. 여기서 다루는 것은 그 밖에서 일어난
// 변경뿐이라, 신호 하나면 되고 무엇이 바뀌었는지는 싣지 않는다(패널이 다시 읽으면 그만이다).
// 모듈 스코프 pub/sub 은 이 저장소의 기존 문법이다(lib/saveStatus, ConfirmDialog).

const listeners = new Set<() => void>()

/** 목록 밖에서 계약서 파일을 바꿨다 — 열려 있는 패널이 다시 읽는다. */
export function notifyContractFilesChanged(): void {
  listeners.forEach(l => l())
}

/** 패널이 마운트되는 동안 신호를 듣는다. 반환값을 정리 함수로 쓴다. */
export function subscribeContractFiles(cb: () => void): () => void {
  listeners.add(cb)
  return () => { listeners.delete(cb) }
}
