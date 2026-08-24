# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses
[semantic versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed

- **The flow figure is now produced in two versions.** The single figure drew all
  719 action–response option pairs as identical grey bands, 42% of which were the
  judgement of one coder — a non-observation rendered indistinguishable from a
  consensus. The body figure now keeps only pairs coded by at least two experts,
  which is the agreement criterion the application already applies, and drops the
  per-option counts that the node heights already encode. Its footer states the
  rule, what it retained, and where the rest can be found. The supplementary
  figure keeps every pair and every count. Both are emitted by one run of
  `scripts/export-flow-figure.cjs`.
- **Counts left the figures for a supplementary workbook.** The per-action,
  per-option and per-strategy `(n = …)` annotations were a table wearing a
  figure's clothes: node height already encodes them, and 71 numbers down the
  right margin cost more attention than they returned. They are now in
  `tca-nexus-supplementary-tables.xlsx` — one sheet per action, per response
  option and per pair, the last recording how many coders saw each pair, whether
  they divided on strength, and which figure shows it. Nothing is lost; it is
  moved. The supplementary figure keeps its counts.
- **A primary-only variant.** Restricted to links at least two experts judged
  *primary*, it draws 162 pairs and 572 links against the main figure's 413 and
  1,386, and is legible ribbon by ribbon. It covers all 22 actions but only 62 of
  the 71 response options, so it makes a narrower claim than the main figure.

- **Ribbons are split by link strength.** The figure summed primary and secondary
  judgements into one band and mentioned the distinction only in its footer,
  although the manuscript uses it to speak of link strength and the coders divide
  between the two on 44% of the pairs shown. Each ribbon is now split along its
  width, the primary share drawn denser than the secondary one, in the same
  strategy hue. Total width is unchanged, so node heights still read as counts.
- Both sides of the figure are coloured by their published groupings — the five
  TCA strategies and the ten Nexus categories — with labelled spines and a legend
  naming every colour, so no grouping depends on hue alone.

### Added

- `sharp` as a devDependency: the figure script is versioned but could not run on
  a clean checkout without it.

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
