# TCA ↔ Nexus Linker

[![CI](https://github.com/Anthropocene-Laboratory/IPBES-TCA-Nexus-Linker/actions/workflows/ci.yml/badge.svg)](https://github.com/Anthropocene-Laboratory/IPBES-TCA-Nexus-Linker/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)

Web application used by IPBES experts to link the **22 transformative-change actions**
of the IPBES Transformative Change Assessment (TCA, chapter 5) to the **71 response
options** of the IPBES Nexus Assessment (NXS, chapter 5).

The application is an **elicitation instrument, not an inference tool**: it proposes no
candidate matches, ranks nothing and computes no textual similarity. Every recorded link
is an explicit judgement made by a named expert.

## What it does

- Two lists side by side — TCA actions grouped by their five strategies, NXS response
  options grouped by their ten categories — with the verbatim published definitions
  displayed for the action being coded and for any option under inspection.
- Links are **many-to-many** and qualified as **primary** or **secondary**. A coder may
  revise or withdraw their own links at any time, and may attach an optional free-text
  rationale.
- Judgements are stored **individually and attributed** to their author; they are never
  merged or overwritten, so consensus and divergence are both preserved.
- For each action–option pair the interface shows how many coders linked it and flags
  agreement when at least two assigned the same strength.
- A **flow graph** tab aggregates all judgements from TCA actions to NXS categories
  (band thickness = number of expert links); clicking a band lists the contributors.
- **Excel export** — a formatted workbook with a `Links` sheet (one row per judgement)
  and a `Summary by pair` sheet (counts, agreement flag, contributors).
- Search, filters (all / mine / unlinked / agreement), keyword highlighting, collapsible
  categories, keyboard shortcuts (↑/↓, P, S, X) and resizable columns.

## Stack

React + Vite + Tailwind (static front end) · Supabase (PostgreSQL + Realtime) ·
deployed on Vercel.

## Identity model

No login. Each expert enters a **name and an email**; the email is the identity key, so
the same address always maps to one expert regardless of how the name is typed. An
optional **shared access code** (`VITE_ACCESS_CODE`) gates the app.

This is a deliberate choice for a trusted pilot: identity is declarative and could be
misstated. For a collection where attribution must be tamper-proof, switch to Supabase
Auth and bind each link to `auth.uid()`.

---

## Setup

### 1. Supabase

1. Create a project on [supabase.com](https://supabase.com) (free tier is enough).
2. **SQL Editor → New query** → paste [`supabase_schema.sql`](./supabase_schema.sql) → **Run**.
   This creates `experts` and `links`, the row-level-security policies and Realtime.
   ⚠️ It drops and recreates the tables — only run it on a fresh project.
3. **Project Settings → API** → copy the *Project URL* and the *anon public key*.

Migrating an existing database instead of recreating it: run the files in
[`supabase_migrations/`](./supabase_migrations/) in date order. They are additive and
delete no data.

### 2. Configure

Copy `.env.example` to `.env` and fill in:

```
VITE_SUPABASE_URL=https://xxxx.supabase.co
VITE_SUPABASE_ANON_KEY=eyJ...
VITE_ACCESS_CODE=your-shared-code
```

Leave `VITE_ACCESS_CODE` empty to disable the access gate. It ships in the client
bundle, so it is a soft gate for an unlisted URL — not a secret.

### 3. Run locally

```bash
npm install
npm run dev
```

Vite reads `.env` at startup: restart the dev server after changing it.

### 4. Deploy (Vercel)

Import the repository, build command `npm run build`, output directory `dist`, and set
the same three environment variables in **Settings → Environment Variables**. They are
injected at build time, so redeploy after changing them.

---

## Tests

```bash
npm test         # reference data integrity
npm run build    # production build
```

Both run in CI on Node 20 and 22, alongside a check that the reference data can still
be regenerated from the source workbook.

## Data

`src/data/tca_actions.json` (22 actions) and `src/data/nexus_options.json` (71 options)
hold the definitions published in the two assessments. The application only reads them.

They are **derived files**: never edit them by hand. They are generated from
`data/source/TCA and Nexus Definitions.xlsx` (sheets `TCA_Actions_Ch5` and
`Nexus_Response_Options`) by a versioned script:

```bash
pip install -r scripts/requirements.txt
python scripts/extract_definitions.py            # regenerate
python scripts/extract_definitions.py --check    # verify the committed files are current
```

The `id` fields (`TCA5-A01`, `B01`, …) are the keys every stored expert link points at;
changing them orphans existing judgements.

## How to cite

If you use this software, cite it using the metadata in
[`CITATION.cff`](./CITATION.cff). A DOI is minted for each release through Zenodo — use
the concept DOI to cite the software in general, or a version DOI to cite the exact
release you used.

## Licence

The **source code** is released under the [MIT licence](./LICENSE).

The **definitions** under `src/data/` and `data/source/` are reproduced from the IPBES
Transformative Change and Nexus assessments. That material remains the property of
IPBES and is included here with attribution for research purposes; its reuse is governed
by the terms set by IPBES, not by the MIT licence.

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md) and the
[code of conduct](./CODE_OF_CONDUCT.md). Changes are listed in
[CHANGELOG.md](./CHANGELOG.md).

## Provenance

The application was specified by the authors — coding scheme, attribution rules and
agreement criterion — and implemented with the assistance of a large language model
(Claude Opus 4.8, Anthropic), which produced the source code, the database schema and
the extraction of the definitions from the source workbook. Design decisions, testing
and deployment remained with the authors.
