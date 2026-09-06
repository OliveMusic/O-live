# O'live 계정 기반 클라우드 저장 설정

앱 쪽 구현은 끝나 있으며, 아래 외부 서비스 설정을 마치면 Google 로그인이 활성화됩니다. 로그인하지 않은 상태와 오프라인 상태에서도 기존 `localStorage` 기록은 계속 동작합니다.

## 1. Supabase 프로젝트

1. Supabase에서 새 프로젝트를 만듭니다.
2. SQL Editor에서 아래 파일을 번호 순서대로 각각 한 번 실행합니다.
   - `supabase/001_cloud_sync.sql`
   - `supabase/002_preferences_and_deletion.sql`
   - `supabase/003_sync_event_retention.sql`
   - `supabase/004_ear_score_breakdown.sql`
   - `supabase/005_schema_contract.sql`
   - `supabase/006_recordings.sql`
   - `supabase/007_recording_waveforms.sql`
   마지막 파일까지 실행해야 앱의 클라우드 상태가 `DB-007` 없이 정상으로 표시됩니다.
3. Project Settings > API에서 **Project URL**과 **Publishable key**를 복사합니다.
4. `cloud-config.js`의 `supabaseUrl`, `supabasePublishableKey`에 붙여 넣습니다.
5. Authentication > URL Configuration에서 실제 배포 주소를 Site URL로 등록하고, 다음 주소들을 Redirect URLs에 추가합니다.
   - 실제 배포 주소(예: `https://music.example.com/index.html`)
   - 로컬 확인 주소: `http://127.0.0.1:8765/`
   - 직접 파일 경로로 여는 경우: `http://127.0.0.1:8765/index.html`

`service_role` 또는 secret key는 브라우저 코드에 절대로 넣지 마세요. 이 앱은 공개 가능한 publishable key와 사용자 로그인 토큰만 사용하며, 데이터 접근은 SQL의 RLS 정책과 보안 함수가 제한합니다.

`006_recordings.sql`은 비공개 `practice-recordings` 버킷, 계정당 최대 50개·250MiB,
파일당 최대 5분·15MiB 제한과 사용자별 접근 정책을 함께 만듭니다.
`007_recording_waveforms.sql`은 녹음별 작은 파형 요약을 저장해 다른 기기에서도 바로 표시합니다.

### 계정 직접 삭제 Edge Function

계정 삭제에는 관리자 권한이 필요하므로 브라우저가 아니라 Supabase Edge Function에서만 처리합니다.
Supabase CLI를 설치하고 로그인한 뒤 프로젝트 루트에서 다음 명령을 실행합니다.

```sh
supabase login
supabase link --project-ref mowbkjoccuylfisbypvi
supabase functions deploy delete-account
```

녹음 기능을 추가한 뒤에는 기존 함수도 위 명령으로 다시 배포해야 합니다. 배포된 함수는 로그인 사용자의
JWT를 확인하고 비공개 녹음 파일을 먼저 지운 뒤 그 사용자 계정만 삭제합니다.
`SUPABASE_SERVICE_ROLE_KEY`는 Supabase가 호스팅된 함수 환경에 자동으로 제공하며,
`cloud-config.js`나 GitHub 저장소에는 절대로 복사하지 않습니다.

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
- 설정 동기화: 메트로놈·튜너·스케일·청음·리듬·잼 설정과 사용자 패턴을 자동 저장합니다.
- 녹음: 로그인한 사용자가 최대 5분 녹음을 확인한 뒤 직접 저장하며, 최대 50개를 다른 기기에서 재생·다운로드할 수 있습니다.
- 오프라인: 답변을 대기열에 저장했다가 온라인 복귀·앱 재진입 때 자동 전송합니다.
- 중복 방지: 각 답변 UUID와 기기 설치 UUID를 서버에서 기억하므로 재시도해도 점수가 두 번 더해지지 않습니다.
- 로그아웃: 계정 기록은 화면에서 분리하고, 다시 로그인하면 클라우드에서 복원합니다.
- 클라우드 데이터 삭제: 비공개 녹음 파일, 기록과 설정을 지우고 계정은 유지합니다.
- 계정 삭제: Edge Function이 비공개 녹음 파일을 지운 뒤 Supabase 계정과 연결된 데이터를 함께 삭제합니다.
