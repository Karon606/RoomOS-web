# 스테이음 이메일 템플릿

Supabase 인증 메일 템플릿 원본. 대시보드(Authentication → Emails → Templates)에만
저장되면 버전 관리가 안 되므로 여기에 원본을 보관한다.

## 적용 방법

각 HTML 파일 내용을 **그대로** 복사해서 Supabase 대시보드의 해당 템플릿
**Body(메시지 본문)** 칸에 붙여넣고, 제목은 아래 표의 값으로 설정한다.

| 파일 | Supabase 템플릿 | 제목 | 치환 변수 |
|------|----------------|------|----------|
| `confirm-signup.html` | Confirm sign up | `[스테이음] 이메일 인증을 완료해 주세요` | `{{ .ConfirmationURL }}` |
| `reset-password.html` | Reset password | `[스테이음] 비밀번호 재설정 안내` | `{{ .ConfirmationURL }}` |
| `reauthentication.html` | Reauthentication | `[스테이음] 본인 확인 코드` | `{{ .Token }}` |
| `change-email.html` | Change email address | `[스테이음] 이메일 주소 변경 확인` | `{{ .ConfirmationURL }}`, `{{ .NewEmail }}` |
| `invite-user.html` | Invite user | `[스테이음] 스테이음에 초대되었습니다` | `{{ .ConfirmationURL }}` |

Magic link 템플릿은 앱에서 미사용이라 기본값 유지.

## 주의

- `{{ .ConfirmationURL }}`, `{{ .Token }}`, `{{ .NewEmail }}` 등 `{{ }}` 변수는
  Supabase가 발송 시 실제 값으로 치환한다. **절대 수정·삭제하지 말 것.**
- reauthentication은 다른 템플릿과 구조가 다르다 — 링크/버튼이 아니라
  6자리 코드(`{{ .Token }}`)를 표시한다.
- 디자인은 **서류 메일 프레임(lib/docMail.ts)과 같은 언어**다(2026-08-30 재디자인).
  크림 바탕 #FBF6EF · 잉크 #1F1A17 · 테라코타 #A03C2E · 라벨 배경 #F2ECE3 · 괘선 #D8CFC4.
  카드로 감싸지 않고 머리 밑줄 하나로 여는 구조이며, 순백은 안 쓴다(§26 은 인쇄에만 순백을 허용한다).
  토큰을 바꿀 일이 생기면 lib/docMail.ts 를 먼저 고치고 이 파일들을 맞춘다 — 두 벌이 갈리면
  같은 영업장에서 나가는 메일이 서로 다른 브랜드로 보인다.
- 버튼은 `<a>` 가 아니라 배경색을 가진 `<td>` 안에 넣는다. 아웃룩 워드 엔진이 a 태그의 padding 을
  무시해서, a 에만 색을 주면 글자만 남고 버튼이 사라진다.
- 웹폰트를 쓰지 않는다. 수신함 대부분이 막고, 막히면 폰트 스택 첫 항목으로 떨어진다.
- 디자인 변경 시 이 파일들을 먼저 수정하고 → 대시보드에 다시 붙여넣는다.

## 발송 인프라

- 발송: Resend (커스텀 SMTP로 Supabase에 연결)
- 발신 주소: `no-reply@stayeum.com`
- 도메인 인증(DKIM/SPF/DMARC): Cloudflare DNS에 설정 완료
