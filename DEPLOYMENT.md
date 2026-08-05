# LumiX Admin — build & deploy guide

TanStack Start (SSR) + Vite + Nitro. The production build emits **two** things:

- `dist/client` — static assets (JS/CSS/images) served from the CDN
- `dist/server/index.mjs` — the SSR worker, plus a generated `dist/server/wrangler.json`

Never deploy the root `wrangler.jsonc` directly: its `main` points at the raw
`@tanstack/react-start/server-entry` package file, which skips the Vite build
(no route tree, no asset manifest) and produces mismatched client/server bundles.
Nitro even warns: `Wrangler config main is overridden and will be ignored`.
Always deploy the **generated** config.

## 1. Local development

```bash
bun install          # or: npm install
bun run dev          # http://localhost:8080
```

## 2. Environment variables

`.env` (local) needs:

```
VITE_SUPABASE_URL=...
VITE_SUPABASE_PUBLISHABLE_KEY=...
CLOUDINARY_CLOUD_NAME=...
CLOUDINARY_API_KEY=...
CLOUDINARY_API_SECRET=...
CLOUDFLARE_ACCOUNT_ID=...
R2_ACCESS_KEY_ID=...
R2_SECRET_ACCESS_KEY=...
R2_BUCKET_NAME=...
R2_PUBLIC_URL=...
```

`VITE_*` values are inlined into the client bundle at build time — they must be
present **when you run the build**. Everything else is read at runtime inside
server functions and must exist as Worker secrets/vars in production:

```bash
npx wrangler secret put CLOUDINARY_API_SECRET -c dist/server/wrangler.json
npx wrangler secret put R2_SECRET_ACCESS_KEY  -c dist/server/wrangler.json
npx wrangler secret put R2_ACCESS_KEY_ID      -c dist/server/wrangler.json
# non-secret ones (CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, R2_BUCKET_NAME,
# R2_PUBLIC_URL, CLOUDFLARE_ACCOUNT_ID) can go in a [vars] block instead
```

## 3. Build

```bash
bun run build        # or: npm run build
```

## 4. Deploy to Cloudflare Workers (CLI)

```bash
npx wrangler deploy -c dist/server/wrangler.json
```

The generated config already wires `main: index.mjs`, the `ASSETS` binding to
`../client`, `no_bundle: true` and `nodejs_compat`.

## 5. Deploy via Cloudflare dashboard (Workers Builds / Pages)

- Root directory: `/`
- Build command: `bun run build`
- Deploy command: `npx wrangler deploy -c dist/server/wrangler.json`
- Version command: `npx wrangler versions upload -c dist/server/wrangler.json`
- Add every non-`VITE_` variable above as a Worker secret/var in Settings.

## 6. Other platforms

Nitro targets are selectable, so the same source deploys elsewhere:

- **Netlify** — build `bun run build`, functions/publish come from the Nitro output.
- **Vercel** — build `bun run build`; deploy the Nitro output.
- **Node server** — `node dist/server/index.mjs` behind any reverse proxy, with
  `dist/client` served as static files.

## 7. Verify a deployment

1. Open the URL, check the browser console is clean.
2. Hit a nested route directly (deep link) — SSR should render it, not 404.
3. Sign in and load the library grid — confirms Supabase + server functions.
4. Run one upload end to end — confirms Cloudinary + R2 credentials.

## Troubleshooting

`Cannot read properties of undefined (reading 'get')` at `e.stores.matchesId.get()`
means two copies of `@tanstack/react-router` ended up in the bundle (the version
range resolved differently from the one `@tanstack/react-start` pins). Keep the
`overrides` block in `package.json` pinning `@tanstack/react-router` to the exact
version `@tanstack/react-start` depends on, then reinstall and rebuild.
