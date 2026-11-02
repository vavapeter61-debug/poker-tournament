# Poker Tournament Clock — Realtime MVP

## What it does
- One tournament state stored in Supabase Postgres.
- Admin updates are written through PIN-checked SQL RPC functions.
- Board devices subscribe to Supabase Realtime and receive updates.
- Timer uses an absolute end timestamp (`endsAt`) so devices calculate the same remaining time.
- Public board URL is read-only; admin controls require the PIN.

## 1. Create Supabase project (no existing account needed)
1. Visit https://supabase.com/ and choose **Start your project**.
2. Sign up with an email or GitHub account and verify your email if prompted.
3. Create an organization, then choose **New project**.
4. Give the project a name such as `poker-clock`, create a strong database password, and select a nearby region.
5. Wait for the database to finish provisioning.
6. Open **SQL Editor → New query**, paste the full contents of `schema.sql`, and click **Run**.
7. Open **Project Settings → API** (or the API Keys section). Copy the Project URL and the `anon` / publishable public key.
8. Copy `config.example.js` to `config.js` and fill in those two values.

   Do not paste the database password or `service_role` secret key into `config.js` or share them in chat.


2. Open SQL Editor and run all of `schema.sql`.
3. In Project Settings → API, copy the Project URL and `anon` / publishable key.
4. Copy `config.example.js` to `config.js` and fill in those two values.
5. Do not use the `service_role` key in browser code.

## 2. Run locally
```bash
npm install
npm run dev
```
Open the local Vite URL. Create a tournament using an ID and a PIN (at least 6 characters).

## 3. Deploy
Deploy this folder to a static host such as Netlify or Vercel (Vite project).
For a Git-based deployment, add `config.js` to the deployed source or adapt it to your host's environment-variable build process.
Set the build command to `npm run build` and output directory to `dist`.

## 4. Use
- Admin URL: `https://YOUR-DOMAIN/?id=TOURNAMENT-ID&mode=admin&pin=YOUR-PIN`
- Board URL: copy it from the Admin screen; open it on a TV browser.
- Do not share the admin URL or PIN. The board URL is read-only.

## Important limitations of this MVP
- This is a starter deployment, not a hardened commercial tournament platform.
- Admin PIN is included in the admin URL query string in this MVP; browser history and shared screenshots can expose it. For public tournaments, replace this with Supabase Auth or short-lived server sessions before production.
- The public scoreboard row is readable by anyone who knows/browses the table. Avoid storing personal data.
- Add server-side validation, rate limiting, backup/export, break scheduling, and a proper authenticated admin session before using for high-stakes events.
- Browser background throttling can delay visual refresh, but the remaining time is derived from the end timestamp; on return to foreground it corrects itself.

## 전광판 디자인 및 프라이즈 설정
- 전광판은 블랙 배경, 화이트 텍스트, 골드 강조색을 사용합니다.
- 관리자 화면의 `전광판 중앙 상단 문구`에서 대회명을 수정할 수 있습니다. `참가자 정보 저장` 또는 `상금 구조 저장`을 누르면 저장됩니다.
- 바이인 금액과 총 엔트리를 입력하면 전체 상금이 `바이인 × 총 엔트리`로 자동 계산됩니다. 리엔트리도 총 엔트리에 포함해 주세요.
- `프라이즈 / 상금 배분`에서 `＋ 순위 추가`로 지급 순위를 원하는 만큼 추가할 수 있습니다.
- 각 순위의 지급 비율(%)을 입력하면 지급 금액이 자동 계산됩니다. 배분 비율 합계가 100%인지 화면에서 확인할 수 있습니다.
- 저장된 상금 풀과 순위별 비율/금액은 공개 전광판에도 표시됩니다. 상금은 원 단위 정수로 내림 계산합니다.


## 배경 이미지 및 블라인드 표시
- 관리자 화면의 `전광판 배경`에서 블랙·골드, 카지노 그린, 레드 벨벳, 딥 네이비 기본 배경을 선택할 수 있습니다.
- 이미지 파일을 업로드하면 어두운 오버레이를 적용해 관리자 화면과 전광판 양쪽에서 동일하게 표시합니다.
- 업로드 이미지는 브라우저에서 JPEG로 축소·압축되어 대회 상태에 저장되고 Realtime으로 동기화됩니다. 압축 후 약 600KB를 초과하면 업로드를 거부합니다.
- Ante, Small Blind, Big Blind의 숫자 폰트 크기를 동일하게 맞췄습니다. 블라인드 항목명은 기존 크기를 유지합니다.
