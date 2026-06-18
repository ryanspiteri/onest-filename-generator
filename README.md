# ONEST Filename Generator

Ad-creative naming for the ONEST team. Open the [hosted page](https://ryanspiteri.github.io/onest-filename-generator/) and "Install as app" for a floating window.

## What it does

Fill the form once and it produces two matching outputs that both lead with the **creative ID**:

- **Filename**
  - Video: `{ID}_{PRODUCT}_{CONCEPT}_{VARIANT}_{TALENT}_HOOK-{HOOK}_{ASPECT}_{SOURCE}.ext`
  - Static: `{ID}_{PRODUCT}_{CONCEPT}_STATIC_{VERSION}_{ASPECT}.ext`
- **ClickUp task name**: `{ID}_{CONCEPT}`

Because the file and the task share the same leading ID, the Drive Organiser agent can
file the creative and link it back to its board task automatically.

## The creative-ID helper (`worker/`)

The **Get ID** button claims the next number from a Cloudflare Worker backed by a D1
database (`worker/`). D1 serialises writes, so the increment is atomic — two editors
never get the same number. The Worker is the single source of truth for creative IDs.

- `GET /next` — claim the next ID (atomic), returns `{ "id": 59 }`
- `GET /peek` — `{ "current": 58, "next": 59 }` without incrementing

Deploy the page: push to `master` (GitHub Pages serves the root).
Deploy the helper: `cd worker && wrangler deploy`.
