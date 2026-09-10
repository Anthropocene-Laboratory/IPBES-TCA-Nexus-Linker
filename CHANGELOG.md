# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses
[semantic versioning](https://semver.org/spec/v2.0.0.html).

## [1.2.0] — 2026-09-10

### Added

- **`scripts/export-dataset.cjs`, and with it a published dataset.** The judgements
  the article reports existed only inside the application's database, so no claim
  in the paper could be checked from outside the project — which is what the
  journal's data policy exists to prevent. The script writes the four columns the
  findings actually rest on, applies the coder pseudonyms, and refuses to write
  anything from a truncated fetch. The result is
  [IPBES-TCA-Nexus-linkages-data](https://github.com/Anthropocene-Laboratory/IPBES-TCA-Nexus-linkages-data),
  CC BY 4.0, carrying a verification script that recomputes every published number
  from the deposited files alone.
  Pseudonyms are assigned once for the whole project and never renumbered: the
  dataset keys on the database id, the analysis on the self-entered name, and the
  map records both so that `Coder A` is one person everywhere.

### Fixed

- `.zenodo.json` declared `"MIT"` where Zenodo expects the lowercase opendefinition
  identifier. A rejected licence id fails the deposit without a message.

## [1.1.0] — 2026-09-09

### Added

- **Short action names, taken verbatim from the Approach × Action figure.** Sergio
  asked for shortened action names in the figure with the full text in a table;
  Rainer asked whether short names existed and got no answer. They did — in his
  own figure. The same 22 strings now label both panels, so a reader moving
  between the two figures does not have to re-identify the actions. A guard
  compares the short-name table against the action data before anything is drawn
  and aborts on a missing, unknown or duplicated name, so a second hand-maintained
  naming of the same 22 things cannot drift out of step in silence. The published
  titles stay in the alluvial's source data and in sheet S1.
  The short names buy back 170 px of the left column, which goes to the ribbon
  band: 498 px instead of 328, wide enough to follow a ribbon rather than read a
  near-vertical hairpin. Panel (a) drops to one line per row and loses 240 px of
  height it no longer needs, printing at 190.5 × 163.0 mm.

- **A second panel: TCA actions by Nexus response-option category.** A reviewer
  read the alluvial and reported that "connections go all over the place" with
  no discernible pattern. That is a claim about the data, and it is false: every
  action reaches only 2–9 of the ten categories, the share carried by an action's
  largest category runs from 21% to 93%, and the categories themselves range from
  20.7% of all links (*Ensure rights and equity*, the largest for nine of the 22
  actions) down to 3.5% (*Conserve ecosystems*). The structure was real and the
  figure was hiding it, because 70 option rows and 413 ribbons exceed what anyone
  reads off a page. `tca-nexus-action-category-matrix.svg/.png` shows the same
  1,386 links as a 22 × 10 matrix: one number per cell, shading that only repeats
  the number, so it survives greyscale and colour-blind reading intact. The two
  panels are drawn from one shared `collectPairs` rule and the run aborts if
  their link and pair counts ever disagree. Category names are set on the
  diagonal rather than vertically: the eye follows a 45-degree baseline without
  tilting the page, and a label of length L costs L/sqrt(2) of height instead of L.
- **Sheet S4 in the supplementary workbook**, carrying the matrix as text, and
  cross-checked cell for cell against both sheet S3 and the numbers painted into
  the SVG.
- `sharp` as a devDependency: the figure script is versioned but could not run on
  a clean checkout without it.
- `scripts/export-flow-figure.cjs`, the generator for the publication alluvial
  figure, is now versioned alongside the application it reads from.

### Changed

- **The matrix panel no longer draws its own title.** "Expert-coded links, TCA
  actions by Nexus response-option category" only restated the caption printed
  directly beneath it, and a title baked into pixels cannot be typeset,
  translated or numbered by the journal — the same reason the methods sentence
  was moved out of the figures earlier. The panel takes back the 48 px, and now
  prints at 190.5 x 157.9 mm instead of 163.0.

- **The figure is now a full-page portrait, because the arithmetic leaves no
  choice.** Seventy-one response-option labels need at least 2.6 mm of line pitch
  to be read at 7 pt, so the right-hand column alone requires about 18.5 cm of
  height; landscape cannot supply that at any width, which is why a reviewer
  reported the image as "too small … to make sense of it". The canvas is now
  1800 × 2100 (190.5 × 222.3 mm at 600 dpi) and every type size is checked
  against a 7 pt floor before the file is written — a layout change can no longer
  quietly shrink a label below what a reader can resolve on paper. Body text
  lands at 7.2 pt, with a line pitch of 2.82 mm on the main figure and 3.19 mm on
  the primary-only variant.
- **Response options are ordered within their category by barycentre.** The order
  inside a category was the arbitrary code sequence B01, F01, H10; ordering each
  option by the mean position of the actions that reach it removes crossings that
  carry no information. The gain is small and reported as measured, not asserted:
  34,685 → 34,074 ribbon crossings. The 22 actions keep their published 1.1–5.5
  numbering, because a reader looks them up by that number and scrambling them
  inside a strategy costs more than the 5.7% of crossings it would save.
- **The legend flows and wraps** instead of sitting at offsets hand-tuned for one
  page width, and the plot height is derived from the legend it has to clear
  rather than guessed. Category names on the right-hand spine are now printed in
  full or not at all: a truncated "Consume sus…" was worse than a bare coloured
  spine, since the legend already carries all ten names.
- **The flow figure is now produced in two versions.** The single figure drew all
  719 action–response option pairs as identical grey bands, 42% of which were the
  judgement of one coder — a non-observation rendered indistinguishable from a
  consensus. The body figure now keeps only pairs coded by at least two experts,
  which is the agreement criterion the application already applies, and drops the
  per-option counts that the node heights already encode. Its footer states the
  rule, what it retained, and where the rest can be found. The supplementary
  figure keeps every pair and every count. Both are emitted by one run of
  `scripts/export-flow-figure.cjs`.
- **Caption text left the image.** The methods sentence — the strength encoding,
  the coder threshold, the denominators — was drawn inside the figure, where it
  cannot be typeset, translated or copy-edited, and where it forced a two-line
  block across the canvas. It is now written to
  `publication/figure-captions.md`, one caption per figure, as text the authors
  can edit. The plot area takes back the space.

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
- **Figure 3b names the strategies and drops the option titles.** Sixty
  characters of response-option title down the right edge cost the ribbons most
  of the page. The right column now carries the assessments' own codes, which
  frees 580 px for the band a reader actually traces: 1,078 px instead of 498.
  The five strategies gain their published names, which only fit in the legend --
  rotated on the spine, a name of 63 to 117 characters has room for about 22. The
  code-to-title key moves into the caption, because it cannot fit inside an image
  that already spends 1,818 px on 71 label rows. Line pitch is 2.62 mm on the
  body figure, 2.96 on the primary-only variant and 2.58 on the supplement, and
  the script now refuses to write a figure whose labels would sit closer than
  2.55 mm -- a floor proved to fire before being relied on.

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

## [1.0.0] — 2026-08-07

The state of the application used to collect the expert coding reported in the
accompanying article. Described here as a release, but never tagged and never
archived anywhere: see the citation section of the README.

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
