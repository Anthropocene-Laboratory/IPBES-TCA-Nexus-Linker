# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses
[semantic versioning](https://semver.org/spec/v2.0.0.html).

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
