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
- 현재 디자인은 임시(퍼시몬 카드형). 로고·브랜드 확정 후 일괄 재디자인 예정.
- 디자인 변경 시 이 파일들을 먼저 수정하고 → 대시보드에 다시 붙여넣는다.

## 발송 인프라

- 발송: Resend (커스텀 SMTP로 Supabase에 연결)
- 발신 주소: `no-reply@stayeum.com`
- 도메인 인증(DKIM/SPF/DMARC): Cloudflare DNS에 설정 완료
