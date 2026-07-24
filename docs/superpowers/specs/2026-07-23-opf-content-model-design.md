# Systematic OPF content-model validation

Date: 2026-07-23
Status: approved, ready for planning

## Problem

PR #28 added the OPF 2.0 `<meta>` content model as a hand-written rule. Every other OPF
element is still unvalidated for attributes and content model, in both EPUB 2 and EPUB 3:
`package`, `metadata`, the `dc:*` elements, `manifest`/`item`, `spine`/`itemref`,
`guide`/`reference`, `tours`/`tour`/`site`, `link`, `bindings`, `collection`, plus element
ordering within `package`.

Real EPUBCheck gets all of this from RelaxNG (`schema/20/rng/opf20.rng`,
`schema/30/package-30.rnc`) validated by Jing, so every failure surfaces as `RSC-005` with a
schema-derived message. epubcheck-ts has no bundled schemas and cannot adopt the RNG wholesale.

## Ground truth

All findings below were probed against EPUBCheck 5.3.0 (`brew install epubcheck`), not inferred
from the schema. The schemas themselves were extracted from the installed jar
(`/opt/homebrew/opt/epubcheck/libexec/epubcheck.jar`), so they are the exact revision the jar
validates against. The probe transcript is reproduced by the differential harness (below).

### The ten message shapes

Every RNG failure is `RSC-005` ERROR, template `Error while parsing file '%1$s': %2$s`. The
detail takes one of ten shapes:

| # | shape |
|---|---|
| 1 | `attribute "X" not allowed here; expected attribute <list>` |
| 2 | `found attribute "X", but no attributes allowed here` |
| 3 | `element "Q" missing required attribute[s] <list>` |
| 4 | `text not allowed here; expected the element end-tag` |
| 5 | `element "C" not allowed anywhere; expected <list>` |
| 6 | `element "C" not allowed here; expected <list>` |
| 7 | `element "C" not allowed yet; missing required element "Y"` |
| 8 | `element "P" incomplete; missing required element[s] <list>` |
| 9 | `element "P" incomplete; expected <list>` |
| 10 | `value of attribute "A" is invalid; must be <constraint>` |

Multiple messages are emitted per element — validation does not stop at the first failure.

The one schematron rule that is not `RSC-005` is duplicate `guide/reference`, which is
`RSC-017` WARNING, `Duplicate "reference" elements with the same "type" and "href" attributes`
(matched on lower-cased, space-normalised `type` + `href`).

### Two behaviours the schema does not reveal

**Attribute-list narrowing is document-order sensitive.** The expected list contains the allowed
attributes not yet *consumed in document order*, alphabetically. It is neither the static allowed
set nor set-difference against all present attributes:

```
<dc:creator bogus opf:file-as opf:role>  -> expected "id", "opf:file-as", "opf:role" or "xml:lang"
<dc:creator opf:file-as bogus opf:role>  -> expected "id", "opf:role" or "xml:lang"
```

PR #28's `checkEpub2Metas` filters against all present attributes, so it mis-words
`<meta property="…" name="…" content="…"/>`: it emits three expected attributes where the jar
emits five. This is a real defect that the new design fixes by construction.

**`anywhere` / `here` / `yet` is a three-way classification:**

- `not allowed anywhere` — the name occurs nowhere in the grammar (`zzz`, `dc:isbn`)
- `not allowed here` — the name occurs elsewhere in the grammar but not in the current
  derivative (`item` inside `spine`, `meta` inside `manifest`, a foreign-namespace element at
  package level, which is legal only inside `metadata`)
- `not allowed yet; missing required element "Y"` — the name is valid later in this same
  sequence but a required predecessor is unsatisfied (`tours` or `guide` before `spine`)

Expected-name lists are alphabetical, `", "`-joined with a final ` or `, prefixed by
`the element end-tag` when the current derivative is nullable:

```
expected element "item"
expected the element end-tag or element "itemref"
expected the element end-tag or element "guide" or "tours"
```

Also non-obvious, and already handled by PR #28: whitespace-only text is accepted in an `<empty/>`
model, and messages echo the *qualified* element name (`opf:meta`, not `meta`).

### Ordering

`package` children are an ordered sequence — `metadata, manifest, spine, tours?, guide?` in
OPF 2.0; `metadata, manifest, spine, guide?, bindings?, collection*` in package-30. Violations
produce shapes 6/7. Foreign-namespace elements are *not* permitted at package level.

`metadata` children are an `interleave` in both versions, so their order is entirely free.
`<meta>` before `<dc:title>`, `dc:language` before `dc:identifier`, foreign-namespace elements
anywhere: all clean. **No ordering work is needed inside `metadata`.**

### The OPF 2.0 metadata content model

`OPF20.metadata-content` is a `<choice>` of two `<interleave>` branches — an OEB 1.2 branch
(`dc-metadata` + optional `x-metadata`) and the EPUB 2 branch (`dc:title`+, `dc:language`+,
`dc:identifier`+, other `dc:*`\*, `meta`\*, foreign\*). Expected-element lists are a projection of
live branch state, so they shrink as elements are consumed:

- empty `metadata` → list includes `dc-metadata` and `x-metadata`
- after title/language/identifier are consumed → both wrappers drop out of the list
- `x-metadata` without `dc-metadata` → shape 6 listing the whole EPUB 2 branch

package-30's metadata is a plain interleave with no branch choice, so it is structurally simpler.

### Guide vocabulary is not enforced

`<reference type="banana">` is **clean** — the RNG types `type` as free `<text/>`. `title` is
optional on `reference`. No `type` vocabulary check exists for OPF 2.0 and none must be added.
This was flagged as the highest false-positive risk in the brief; it turns out to need no work.

### A bad attribute VALUE does not also report the attribute missing

`<itemref idref="1"/>` -- required attribute present, value not a valid NCName -- yields only
`value of attribute "idref" is invalid; must be an XML name without colons`. There is NO
accompanying `missing required attribute` message. Probed against the jar; a validator that
emits both is producing a false positive.

## IDREF referential integrity is not schema-enforced

`<spine toc="nope">` produces only `OPF-049`, no `RSC-005`. Jing's IDREF resolution does not fire
for these grammars. `datatype.ID` *is* enforced as a lexical constraint, though:
`id="1"` → `value of attribute "id" is invalid; must be an XML name without colons`.

### False-positive survey

Realistic vendor metadata blocks, run through the jar:

| producer | result |
|---|---|
| calibre 3.x — `opf:file-as`, `opf:role`, `opf:scheme`, `calibre:*` metas | clean |
| Sigil — `opf:role`, `opf:event`, `dc:subject`, `dc:rights` | clean |
| InDesign — `xsi:type`, foreign `dcterms:modified` element, `meta name="cover"` | clean |
| legacy `opf:file-as` on `dc:title` | 1 ERROR (genuine) |
| kindlegen `x-metadata`/`output` alongside the EPUB 2 branch | 2 ERRORs (genuine) |
| EPUB 3 `<meta property>` in a 2.0 package | 3 ERRORs (PR #28, already covered) |

Every `opf:` attribute the brief flagged as high-risk is accepted on its schema-sanctioned
elements. The migration impact is far narrower than feared.

## Architecture

### A scoped RelaxNG derivative validator

The dynamic expected-lists are not a family of special cases to enumerate — they *are* the set of
names the current derivative accepts. Modelling the interleave state by hand means writing three
bespoke state machines (OPF 2.0 metadata's two-branch choice, package-30 metadata, and
`collection`'s recursive content) and hand-maintaining their projections. One derivative engine
subsumes all of them and makes the second grammar nearly free.

`src/schema/derivative.ts` implements James Clark's *An algorithm for RELAX NG validation*:
`nullable`, `startTagOpenDeriv`, `attDeriv`, `startTagCloseDeriv`, `childrenDeriv`, `endTagDeriv`,
over only the constructs these two grammars use:

```
Empty | NotAllowed | Text | Data | Value | Element | Attribute
Group | Interleave | Choice | OneOrMore | Optional | AnyName(except)
```

No `list`, no `mixed`, no external refs, no datatype library beyond the handful below. The engine
is deliberately not a general RelaxNG implementation — it is scoped to OPF package documents.

Name classes are `QName | AnyNameExcept`. Grammars are plain data with lazy `Ref` thunks for the
one recursive production (`collection`).

### Grammars as data

- `src/schema/opf20.ts` — transcribed from `opf20.rng`
- `src/schema/package30.ts` — transcribed from `package-30.rnc`

Each exports a root pattern plus the global name set used for the `anywhere`/`here` split. Each
carries a comment pointing at the schema file and revision it was transcribed from.

Datatypes needed: `ID` (XML name without colons), `IDREF`, `anyURI`, `token minLength=1`
(`string.nonempty`), enumerated `value`, and free `text`. `datatype.property`,
`datatype.properties`, `datatype.languagecode` and `datatype.mimetype` are lexically permissive in
practice; they are checked only where the harness confirms a message, and otherwise treated as
`text` (see Containment).

### Message generation

`src/schema/messages.ts` turns derivative failures into the ten shapes. It owns:

- alphabetical `", " … or `/` and ` list joining (replacing `quotedList` in `checks/opf.ts`)
- the `the element end-tag` prefix when the derivative is nullable
- the `anywhere` / `here` / `yet` classification
- document-order attribute consumption

### Driver and wiring

`src/checks/schema.ts` walks the retained OPF `XmlNode` tree, feeds the derivative engine, and
emits `RSC-005`. It selects the grammar by resolved EPUB version, inheriting the existing
"unknown version means EPUB 3" gating that `checkEpub2` and the `dcterms:modified` rule use.

The two schematron rules (`opf.sch` for EPUB 2, the equivalent in `package-30.sch`) stay
hand-written in `src/checks/schema.ts` — they are an XPath count assertion each and gain nothing
from the engine.

### Parser change

`metas` was added to `PackageDocument` because the parser had discarded raw elements, and
field-per-element does not scale to every element in the document. `parseOpf` instead retains the
parsed root `XmlNode` on `PackageDocument` (`root`), and the schema layer walks that directly.
The typed `manifest` / `spine` / `guide` / `metadata` projections stay exactly as they are for the
semantic checks. `metas` and `OpfMeta` are removed, since the schema layer subsumes them.

### Consolidation

Six existing hand-written approximations are deleted and re-emitted by the schema layer with the
jar's wording. Ids and severities are unchanged; only the detail string changes.

| current | jar |
|---|---|
| `The spine element must include the toc attribute in EPUB 2.` | `element "spine" missing required attribute "toc"` |
| `The spine element must contain at least one itemref.` | `element "spine" incomplete; missing required element "itemref"` |
| `The package document must contain a spine element.` | `element "guide" not allowed yet; missing required element "spine"` |
| `The package metadata must include at least one dc:title element.` | `element "metadata" incomplete; missing required element "dc:title"` |
| `A manifest item is missing a required attribute (…)` | `element "item" missing required attribute[s] …` |
| `Duplicate manifest item id "x".` | `The "id" attribute does not have a unique value` |

`checkEpub2Metas`, `OPF2_META_*` and `quotedList` are deleted from `src/checks/opf.ts` outright.

Schematron-derived EPUB 3 rules that are *not* in the RNG stay hand-written: the
`dcterms:modified` cardinality rule and the `nav`-property rule in `checkSpineAndNav`.

## Containment: how false positives are prevented

This change touches every EPUB 2 and EPUB 3 file, so a wrong content model rejects valid books at
scale. Three rules govern it:

1. **Silence beats a guess.** Where the harness shows a case the engine cannot reproduce exactly,
   the driver suppresses the message rather than emitting approximate wording. Suppressions are
   listed explicitly in the driver with a comment, and reported in the summary.
2. **Permissive datatypes stay permissive.** `datatype.property`, `datatype.properties`,
   `datatype.languagecode`, `datatype.mimetype` and `anyURI` are treated as free text unless a
   harness case pins a concrete message. Rejecting a legal `media-type` or `xml:lang` is exactly
   the failure mode to avoid.
3. **The realistic corpus is the gate.** The calibre / Sigil / InDesign fixtures above become
   permanent "genuinely clean" corpus entries, so a future regression that starts rejecting
   real-world metadata fails the suite.

## Testing

### Differential harness (committed)

`test/differential/` — this was scratch work in PR #2 and PR #28 and was lost both times.

- `harness.ts` — build a fixture, run `epubcheck --json -` and `validateEpub`, diff id, severity,
  wording, count and order.
- `cases.ts` — the full probe set behind this spec (package, metadata, every `dc:*`, `meta`,
  manifest/item, spine/itemref, guide/reference, tours/tour/site, ordering, the vendor-realistic
  files, and the EPUB 3 equivalents).
- Gated behind an env var and skipped when the `epubcheck` binary is absent, so CI without the jar
  stays green. It is a verification tool, not a unit test.
- Reports a parity count (`N/M exact match`) so future work can re-verify in one command.

### Corpus fixtures

Valid + invalid pairs per element covered, in `test/fixtures/corpus.ts`. The corpus does exact
multiset comparison of id + severity, so "still valid" fixtures genuinely pin zero output — which
is what makes the vendor-realistic entries load-bearing.

Existing corpus expectations are rebaselined where the schema layer legitimately adds messages
(e.g. a missing `unique-identifier` gains an `RSC-005` alongside today's `OPF-048`/`OPF-030`).
Every rebaseline is justified against jar output, not against what the code now happens to emit.

### Unit tests

Colocated beside source per project convention: `derivative.test.ts` (the algorithm against small
synthetic grammars), `messages.test.ts` (the ten shapes, including the document-order narrowing
regression from PR #28), `opf20.test.ts` / `package30.test.ts` (grammar transcription spot-checks).

## Scope boundaries

In scope: OPF 2.0 and package-30 package documents — attributes, content models, datatypes where
pinned, package-level ordering, and the two schematron rules.

Explicitly out of scope: NCX, XHTML content documents, SVG, the navigation document, media
overlays, OCF/container, and the `dict`/`edupub`/`idx`/`preview` profiles. `package-30.sch` is 396
lines of schematron encoding rules well beyond the content model; only the `id`-uniqueness rule is
adopted here, and the rest remains a separate follow-up.

## Success criteria

- Differential harness committed and reporting parity across the full case set.
- Full test suite and lint pass. Baseline is 374 tests / 31 files.
- Per-element migration impact reported, including which elements were left unvalidated and why.
