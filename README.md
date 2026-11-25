# Corporate Innovation Action Lab

## Run locally

Use Node.js 22.13 or later. Run `npm ci`, set the values in `.env.local` using `.env.example` as a reference, then run `npm run dev`. The local database is created under `.action-labs/` on first use. It starts with all 12 questions from the Word document.

- `/admin` — sign in, add guests, manage questions, publish a round, and review results.
- `/projector` — open this on the square display in full-screen mode.
- `/guest` — share this link or use the QR code on the lobby screen.

For a rehearsal with phones on the same network, open the projector using the host computer’s LAN address. A QR code created on localhost points to localhost.

## Deploy on Vercel

Use the existing Next.js project and set these sensitive variables for Production:

- `DATABASE_URL` — pooled Neon Postgres connection string.
- `ADMIN_PASSWORD` — moderator sign-in password. The default username is `sajal`, or set `ADMIN_USERNAME`.
- `SETTINGS_ENCRYPTION_KEY` — stable base64-encoded 32-byte key for the Gemini settings.

Redeploy after updating environment variables. Check `/api/health` for a successful database connection before opening the guest link. Hosted deployments require Postgres. Local development can use SQLite.

## Deploy on Render

Connect the repository to Render using `render.yaml`. Set `DATABASE_URL` to the Neon Postgres connection string, and configure `ADMIN_PASSWORD`. The Blueprint generates `SETTINGS_ENCRYPTION_KEY` so the moderator can configure Gemini from Admin. The app creates its event table and seeds the question list when it first connects. A new Neon database starts with an empty guest list. Poll tallies, written response collection, and the projector work without Gemini.


## Gemini and guest settings

In **Admin → Settings**, enter a Gemini API key and model ID. The key is encrypted before it is saved and its value is never returned to the browser. An environment-provided `GEMINI_API_KEY` can serve as a fallback when no key is saved in Admin. For local use, generate `SETTINGS_ENCRYPTION_KEY` with `node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"` and place it in the ignored `.env.local` file. Keep the encryption key stable across deployments.

In **Admin → Guests**, use **Edit** to change a name or reset a password. A password reset signs that guest out of existing sessions.
