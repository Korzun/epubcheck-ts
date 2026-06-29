# Attribution

epubcheck-ts is a fresh, TypeScript-native EPUB validator inspired by
[w3c/epubcheck](https://github.com/w3c/epubcheck). It is not a port of
epubcheck's code.

## Message catalog

The validation message identifiers (e.g. `OPF-014`, `RSC-005`, `NAV-010`) and
their English message templates are reused from epubcheck's
`MessageBundle.properties` so that results are compatible with existing
epubcheck-aware tooling. epubcheck is distributed under the BSD 3-Clause
License:

```
Copyright (c) 2007, Adobe Systems Incorporated
Copyright (c) 2008, IDPF
Copyright (c) 2017, W3C
```

## Test fixtures

The fixtures under `test/fixtures/` are original works authored for this
project. They are *modeled on* the scenarios described in epubcheck's
Cucumber `.feature` test files (which document the expected message for each
case), but no epubcheck source or binary test files are redistributed here.
