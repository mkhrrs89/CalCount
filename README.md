# Calory Local (Cloudflare Pages) — local-only calorie log with photo estimation

This app stores **only text** in your browser (IndexedDB):
- Food Library (reusable foods you eat often)
- Daily Log entries

Food photos are used **only** to send to the estimator endpoint and are never stored by this app.

## Deploy (Cloudflare Pages)

1. Create a new Cloudflare Pages project from this repo.
2. Build settings:
   - Framework preset: **None**
   - Build command: *(empty)*
   - Build output directory: *(empty / root)*

Cloudflare Pages Functions auto-detect the `functions/` directory.

## Environment variables (Cloudflare Pages)

Set these in: Pages → Settings → Environment variables

- `OPENAI_API_KEY` (required)
- `OPENAI_MODEL` (optional; default is `gpt-4o-mini`)
- `ALLOWED_ORIGIN` (optional; if set, only requests from that exact Origin will be allowed)

## Notes on privacy / retention

This app does not store images. However, OpenAI API requests may be retained for abuse monitoring according to OpenAI's policies.
