export type Severity = 'FATAL' | 'ERROR' | 'WARNING' | 'INFO' | 'USAGE'

/**
 * Message catalog (id -> severity + template), porting epubcheck's message
 * vocabulary. Templates use positional placeholders: %1$s, %2$s, ...
 * This plan seeds only the OCF/container + internal ids; later plans extend it.
 */
export const CATALOG: Record<string, { severity: Severity; template: string }> = {
  // Package / container structure
  'PKG-003': { severity: 'FATAL', template: 'The EPUB could not be read: %1$s' },
  'PKG-005': { severity: 'ERROR', template: 'The mimetype file must not be compressed.' },
  'PKG-006': { severity: 'ERROR', template: 'The mimetype file entry is missing or is not the first file in the archive.' },
  'PKG-007': { severity: 'ERROR', template: "The mimetype file contains an incorrect value; expected 'application/epub+zip'." },
  // Resources
  'RSC-002': { severity: 'FATAL', template: 'The required META-INF/container.xml resource could not be found.' },
  'RSC-003': { severity: 'ERROR', template: "No rootfile with media type 'application/oebps-package+xml' was found in META-INF/container.xml." },
  'RSC-005': { severity: 'ERROR', template: "Error while parsing file '%1$s': %2$s" },
  // Package / OPF semantics
  'OPF-001': { severity: 'ERROR', template: 'There was an error when parsing the EPUB version: %1$s' },
  'OPF-030': { severity: 'ERROR', template: 'The unique-identifier "%1$s" was not found.' },
  'OPF-033': { severity: 'ERROR', template: 'The spine contains no linear resources.' },
  'OPF-048': { severity: 'ERROR', template: 'Package tag is missing its required unique-identifier attribute and value.' },
  'OPF-049': { severity: 'ERROR', template: 'Item id "%1$s" was not found in the manifest.' },
  'OPF-074': { severity: 'ERROR', template: 'Package resource "%1$s" is declared in several manifest item.' },
  'RSC-001': { severity: 'ERROR', template: 'File "%1$s" could not be found.' },
  // Internal
  'CHK-001': { severity: 'FATAL', template: 'An internal error occurred while validating: %1$s' },
}
