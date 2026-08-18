# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses
[semantic versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed

- **Links beyond the PostgREST row ceiling were silently invisible.** The client
  loaded every judgement with a single unbounded `select`, which PostgREST caps at
  the project's `max-rows` (1000) while reporting the truncation only in the
  `Content-Range` header. Once the table passed that ceiling, the rows dropped were
  the most recent ones — the order being unspecified — so a coder's new links were
  written to the database but never reappeared in the interface, which showed them
  as uncoded. The Excel export, the flow-graph view and the per-pair agreement
  counts all read the same truncated set. Both the application and the publication
  figure script now page through the table with an explicit, stable order, and the
  figure script refuses to draw when the number of rows it fetched disagrees with
  the total the server reports.

### Added

- `scripts/export-flow-figure.cjs`, the generator for the publication alluvial
  figure, is now versioned alongside the application it reads from.

## [1.0.0] — 2026-08-07

First archived release: the state of the application used to collect the expert
coding reported in the accompanying article.

### Added

- Three-column coding interface: 22 TCA actions grouped by their five strategies,
  71 Nexus response options grouped by their ten categories, and a definitions
  panel showing the verbatim published text for the action being coded and for any
  option under inspection.
- Many-to-many links between actions and response options, qualified as primary or
  secondary, revisable and withdrawable by their author.
- Optional free-text rationale attached to a link.
- Attributed storage: judgements are recorded per expert and never merged or
  overwritten; the interface reports how many coders linked each pair and flags
  those where at least two assigned the same strength.
- Flow-graph view aggregating all judgements from actions to Nexus categories, with
  band thickness proportional to the number of links and a per-band contributor list.
- Formatted Excel export with a `Links` sheet (one row per judgement) and a
  `Summary by pair` sheet (counts, agreement flag, contributors).
- Search, filters (all / mine / unlinked / agreement), keyword highlighting,
  collapsible categories, keyboard shortcuts and resizable columns.
- Name-and-email identity keyed on the email address, with an optional shared access
  code gating the deployment.
- `scripts/extract_definitions.py`, which regenerates the reference datasets from the
  source workbook and can verify that the committed files are current.
- MIT licence, citation metadata, contribution and conduct guidelines, data
  integrity tests and continuous integration.

[1.0.0]: https://github.com/Anthropocene-Laboratory/IPBES-TCA-Nexus-Linker/releases/tag/v1.0.0
