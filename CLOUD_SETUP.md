# O'live 계정 기반 클라우드 저장 설정

앱 쪽 구현은 끝나 있으며, 아래 외부 서비스 설정을 마치면 Google 로그인이 활성화됩니다. 로그인하지 않은 상태와 오프라인 상태에서도 기존 `localStorage` 기록은 계속 동작합니다.

## 1. Supabase 프로젝트

1. Supabase에서 새 프로젝트를 만듭니다.
2. SQL Editor에서 `supabase/001_cloud_sync.sql` 전체를 실행합니다.
3. Project Settings > API에서 **Project URL**과 **Publishable key**를 복사합니다.
4. `cloud-config.js`의 `supabaseUrl`, `supabasePublishableKey`에 붙여 넣습니다.
5. Authentication > URL Configuration에서 실제 배포 주소를 Site URL로 등록하고, 다음 주소들을 Redirect URLs에 추가합니다.
   - 실제 배포 주소(예: `https://music.example.com/index.html`)
   - 로컬 확인 주소: `http://127.0.0.1:8765/`
   - 직접 파일 경로로 여는 경우: `http://127.0.0.1:8765/index.html`

`service_role` 또는 secret key는 브라우저 코드에 절대로 넣지 마세요. 이 앱은 공개 가능한 publishable key와 사용자 로그인 토큰만 사용하며, 데이터 접근은 SQL의 RLS 정책과 보안 함수가 제한합니다.

## 2. Google 로그인

1. Google Cloud Console에서 OAuth 동의 화면을 구성합니다.
2. Web application 유형의 OAuth Client ID를 만듭니다.
3. Supabase Authentication > Providers > Google에 Client ID와 Client Secret을 입력합니다.
4. Google의 Authorized JavaScript origins에 앱의 origin을 추가합니다.
5. Google의 Authorized redirect URIs에는 Supabase Google Provider 화면에 표시된 callback URL을 그대로 추가합니다.

## 정식 공개 URL

GitHub Pages 배포 주소는 다음 값을 사용합니다.

- 앱: `https://olivemusic.github.io/O-live/`
- 앱 소개: `https://olivemusic.github.io/O-live/about.html`
- 개인정보처리방침: `https://olivemusic.github.io/O-live/privacy.html`
- 이용약관: `https://olivemusic.github.io/O-live/terms.html`

Supabase Authentication > URL Configuration:

- Site URL: `https://olivemusic.github.io/O-live/`
- Redirect URLs:
  - `https://olivemusic.github.io/O-live/`
  - `https://olivemusic.github.io/O-live/index.html`

Google 인증 플랫폼 > 브랜딩:

- 애플리케이션 홈페이지: `https://olivemusic.github.io/O-live/about.html`
- 애플리케이션 개인정보처리방침 링크: `https://olivemusic.github.io/O-live/privacy.html`
- 애플리케이션 서비스 약관 링크: `https://olivemusic.github.io/O-live/terms.html`

Google OAuth 웹 클라이언트:

- 승인된 JavaScript 원본: `https://olivemusic.github.io`
- 승인된 리디렉션 URI:
  `https://mowbkjoccuylfisbypvi.supabase.co/auth/v1/callback`

브랜딩 인증을 제출하기 전 Google Search Console에서 배포 주소의 소유권을 확인합니다.

## 3. 동작 방식

- 로그인 전: 지금처럼 기기 안에 날짜별 기록을 저장합니다.
- 첫 로그인: 이 기기의 기존 기록을 계정에 한 번만 합산합니다.
- 로그인 후: 답을 누르는 즉시 화면과 로컬 캐시를 갱신하고, 개별 답변 이벤트를 클라우드에 전송합니다.
- 오프라인: 답변을 대기열에 저장했다가 온라인 복귀·앱 재진입 때 자동 전송합니다.
- 중복 방지: 각 답변 UUID와 기기 설치 UUID를 서버에서 기억하므로 재시도해도 점수가 두 번 더해지지 않습니다.
- 로그아웃: 계정 기록은 화면에서 분리하고, 다시 로그인하면 클라우드에서 복원합니다.
