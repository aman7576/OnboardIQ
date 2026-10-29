# Deploying OnboardIQ (Vercel + Render)

The frontend runs on **Vercel**. The API needs a long-running server and PostgreSQL, so it runs on **Render**
(a Blueprint creates both). Vercel forwards `/api/*` to the API, so the browser only ever talks to one origin.

## 1. API and database on Render

1. Go to https://dashboard.render.com > **New** > **Blueprint**, connect this GitHub repository.
2. Render reads [`render.yaml`](render.yaml) and creates `onboardiq-api` (Docker) and `onboardiq-db` (PostgreSQL).
3. When asked for `GROQ_API_KEY`, paste your Groq key (leave it empty to switch the chatbot off).
4. Wait for the first deploy. On every start the container applies the migrations and loads the reference data
   (rules, watchlists, occupations), so no manual database step is needed.
5. Open the `onboardiq-api` service > **Environment** and copy **`STAFF_ENROLLMENT_CODE`**. New bank officers need it to
   register at `/officer/register`.
6. Note the service URL, for example `https://onboardiq-api.onrender.com`.

## 2. Frontend on Vercel

1. https://vercel.com/new > import the same repository.
2. Set **Root Directory** to `frontend`. Framework (Vite), build command and output folder are detected.
3. If your Render URL is not `https://onboardiq-api.onrender.com`, edit the `destination` in
   [`frontend/vercel.json`](frontend/vercel.json) and push.
4. Deploy.

## Using it

- Customers register at `/register` and apply.
- Officers register at `/officer/register` with the enrollment code, then sign in at `/officer/login`.
- No demo accounts exist in production.

## Notes

- Render's free web service sleeps after inactivity (first request is slow) and its free PostgreSQL expires after
  about 30 days. For anything lasting, use a paid plan or an external PostgreSQL (set `DATABASE_URL`).
- Uploaded files live on the container disk, which Render clears on redeploy. The extracted text is stored in
  PostgreSQL, so applications and decisions are kept.
- The first OCR request downloads the English language data, so it takes a few extra seconds.
- Changing `EXTRACTION_PROVIDER` back to `mock` only makes sense for the supplied sample documents.
