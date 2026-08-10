// 'server-only' 대체 스텁. Next 는 이 모듈을 자기 번들러 별칭으로 해소하지만 tsx 에는 그 별칭이 없다.
// scripts/tsconfig.pii.json 이 이 파일을 가리켜, 순수 로직 테스트가 lib/pii 를 그대로 불러 검증한다.
// 앱 코드는 절대 이 파일을 import 하지 않는다.
export {}
