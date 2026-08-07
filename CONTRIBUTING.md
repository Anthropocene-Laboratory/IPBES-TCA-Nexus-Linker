# Contributing

Thanks for your interest in this tool. It was built for a specific IPBES study, so
the scope is narrow — but bug reports, reproducibility problems and improvements are
welcome.

## Reporting a problem

Open an issue describing what you did, what you expected and what happened. If it
concerns the reference data (an action or response option that looks wrong), please
quote the identifier — `TCA5-A01`, `B01` — so the record can be located.

## Development setup

```bash
npm install
cp .env.example .env    # then fill in your Supabase project values
npm run dev
```

You need a Supabase project of your own: run [`supabase_schema.sql`](./supabase_schema.sql)
in its SQL editor. See the [README](./README.md) for the full setup.

## Before opening a pull request

```bash
npm test         # data integrity checks
npm run build    # production build must succeed
```

Both run in CI on Node 20 and 22, together with a check that the reference data can
still be regenerated from the source workbook.

## Changing the reference data

Never edit `src/data/*.json` by hand. They are derived from
`data/source/TCA and Nexus Definitions.xlsx`. Edit the workbook, then regenerate:

```bash
pip install -r scripts/requirements.txt
python scripts/extract_definitions.py
```

Commit the workbook and the regenerated JSON together. Note that the identifiers
(`id` fields) are referenced by every expert link already stored in the database:
changing them silently orphans existing judgements.

## Database changes

Schema changes go in `supabase_migrations/` as a dated, additive SQL file — never by
editing an existing migration, which other deployments may already have applied.
`supabase_schema.sql` describes a fresh install and should be kept consistent with the
accumulated migrations.

## Style

Match the surrounding code: functional React components, hooks, Tailwind utility
classes, no formatter enforced. Comments explain why, not what.
