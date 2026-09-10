# TCA ↔ Nexus Linker

[![CI](https://github.com/Anthropocene-Laboratory/IPBES-TCA-Nexus-Linker/actions/workflows/ci.yml/badge.svg)](https://github.com/Anthropocene-Laboratory/IPBES-TCA-Nexus-Linker/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)
[![DOI](https://zenodo.org/badge/DOI/10.5281/zenodo.22686359.svg)](https://doi.org/10.5281/zenodo.22686359)

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

## Role in the article

This repository is one part of the material behind the TCA × Nexus article. The literature
corpus and the approaches × actions heat map of Figure 2 come from
[`rkrug/NXS_TCA_Article`](https://github.com/rkrug/NXS_TCA_Article), an R `targets` pipeline.
The two are linked by DOI rather than by directory: each is archived on Zenodo and cited in
the article's data availability statement, which is what makes the versions traceable — a
repository link is not a persistent identifier.

Produced here, by one run of `node scripts/export-flow-figure.cjs`: **Figures 3a, 3b and 4**,
**S1–S4 Fig** and the **S1 Table** workbook, together with `publication/figure-captions.md`
and a `publication/submission/` folder under the file names PLOS requires.

The judgements themselves are published as a dataset of their own, under CC BY 4.0:
[**IPBES-TCA-Nexus-linkages-data**](https://github.com/Anthropocene-Laboratory/IPBES-TCA-Nexus-linkages-data).
It is written from this repository by `node scripts/export-dataset.cjs --map <private map>`,
which is also what applies the coder pseudonyms — one assignment for the whole project, so
`Coder A` denotes the same person everywhere.

The statistical analysis of those linkages is not in this repository. This one holds the
instrument, the figures it draws, and the export that produces the dataset; the analysis is
versioned separately.

## How to cite

If you use this software, cite it using the metadata in
[`CITATION.cff`](./CITATION.cff).

Each release is archived on Zenodo and carries a DOI:

| | |
|---|---|
| **Concept DOI** — all versions, resolves to the latest | [10.5281/zenodo.22686359](https://doi.org/10.5281/zenodo.22686359) |
| Version DOI — v1.2.0, the release the article cites | [10.5281/zenodo.22686360](https://doi.org/10.5281/zenodo.22686360) |

Cite the concept DOI unless you depend on one exact version. It does not go stale.

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
