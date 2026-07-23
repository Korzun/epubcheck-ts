export type Severity = 'FATAL' | 'ERROR' | 'WARNING' | 'INFO' | 'USAGE'

/** Severity ordering used by rejection thresholds. Higher = more severe. */
export const SEVERITY_RANK: Record<Severity, number> = {
  FATAL: 5,
  ERROR: 4,
  WARNING: 3,
  INFO: 2,
  USAGE: 1,
}

/**
 * Message catalog (id -> severity + template), porting epubcheck's message
 * vocabulary. Templates use positional placeholders: %1$s, %2$s, ...
 * This plan seeds only the OCF/container + internal ids; later plans extend it.
 */
export const CATALOG: Record<string, { severity: Severity; template: string }> = {
  // Package / container structure
  'PKG-001': { severity: 'WARNING', template: 'Validating the EPUB against version %1$s but detected version %2$s.' },
  'PKG-003': { severity: 'FATAL', template: 'The EPUB could not be read: %1$s' },
  'PKG-005': { severity: 'ERROR', template: 'The mimetype file must not be compressed.' },
  'PKG-006': { severity: 'ERROR', template: 'The mimetype file entry is missing or is not the first file in the archive.' },
  'PKG-007': { severity: 'ERROR', template: "The mimetype file contains an incorrect value; expected 'application/epub+zip'." },
  // Resources
  'RSC-002': { severity: 'FATAL', template: 'The required META-INF/container.xml resource could not be found.' },
  'RSC-003': { severity: 'ERROR', template: "No rootfile with media type 'application/oebps-package+xml' was found in META-INF/container.xml." },
  'RSC-005': { severity: 'ERROR', template: "Error while parsing file '%1$s': %2$s" },
  'RSC-006': { severity: 'ERROR', template: 'Remote resource reference is not allowed in this context; resource "%1$s" must be located in the EPUB container.' },
  'RSC-007': { severity: 'ERROR', template: 'Referenced resource "%1$s" could not be found in the EPUB.' },
  'RSC-008': { severity: 'ERROR', template: 'Referenced resource "%1$s" is not declared in the OPF manifest.' },
  'RSC-010': { severity: 'ERROR', template: 'Reference to non-standard resource type found.' },
  'RSC-011': { severity: 'ERROR', template: 'Found a reference to a resource that is not a spine item.' },
  'RSC-012': { severity: 'ERROR', template: 'Fragment identifier is not defined.' },
  // Package / OPF semantics
  'OPF-001': { severity: 'ERROR', template: 'There was an error when parsing the EPUB version: %1$s' },
  'OPF-003': { severity: 'USAGE', template: 'Item "%1$s" exists in the EPUB, but is not declared in the OPF manifest.' },
  'OPF-030': { severity: 'ERROR', template: 'The unique-identifier "%1$s" was not found.' },
  'OPF-031': { severity: 'ERROR', template: 'File listed in reference element in guide was not declared in OPF manifest: %1$s.' },
  'OPF-032': { severity: 'ERROR', template: 'Guide references "%1$s" which is not a valid "OPS Content Document".' },
  'OPF-033': { severity: 'ERROR', template: 'The spine contains no linear resources.' },
  'OPF-034': { severity: 'ERROR', template: 'The spine contains multiple references to the manifest item with id "%1$s".' },
  'OPF-035': { severity: 'WARNING', template: 'Media type "text/html" is not appropriate for XHTML/OPS.' },
  'OPF-037': { severity: 'WARNING', template: 'Found deprecated media-type "%1$s".' },
  'OPF-040': { severity: 'ERROR', template: 'Fallback item with id "%1$s" could not be found.' },
  'OPF-042': { severity: 'ERROR', template: '"%1$s" is not a permissible spine media-type.' },
  'OPF-043': { severity: 'ERROR', template: 'Spine item with non-standard media-type "%1$s" has no fallback.' },
  'OPF-044': { severity: 'ERROR', template: 'Spine item with non-standard media-type "%1$s" has no EPUB content document fallback.' },
  'OPF-050': { severity: 'ERROR', template: 'TOC attribute references resource with non-NCX mime type; "application/x-dtbncx+xml" is expected.' },
  'OPF-099': { severity: 'ERROR', template: 'The manifest must not list the package document.' },
  'OPF-048': { severity: 'ERROR', template: 'Package tag is missing its required unique-identifier attribute and value.' },
  'OPF-049': { severity: 'ERROR', template: 'Item id "%1$s" was not found in the manifest.' },
  'OPF-074': { severity: 'ERROR', template: 'Package resource "%1$s" is declared in several manifest item.' },
  'RSC-001': { severity: 'ERROR', template: 'File "%1$s" could not be found.' },
  // Navigation
  'NAV-010': { severity: 'ERROR', template: '"%1$s" nav must not link to remote resources; found link to "%2$s".' },
  'NAV-011': { severity: 'WARNING', template: '"%1$s" nav must be in reading order; link target "%2$s" is before the previous link\'s target in %3$s order.' },
  // NCX (EPUB 2 navigation)
  'NCX-001': { severity: 'ERROR', template: 'NCX identifier ("%1$s") does not match OPF identifier ("%2$s").' },
  'NCX-004': { severity: 'USAGE', template: 'NCX identifier ("dtb:uid" metadata) should not contain leading or trailing whitespace.' },
  'NCX-006': { severity: 'USAGE', template: 'Empty "text" label in the NCX document' },
  // Internal
  'CHK-001': { severity: 'FATAL', template: 'An internal error occurred while validating: %1$s' },
  // CSS
  'CSS-001': { severity: 'ERROR', template: 'The "%1$s" property must not be included in an EPUB Style Sheet.' },
  'CSS-002': { severity: 'ERROR', template: 'Empty or NULL reference found.' },
  'CSS-003': { severity: 'WARNING', template: 'CSS document is encoded in UTF-16. It should be encoded in UTF-8 instead.' },
  'CSS-004': { severity: 'ERROR', template: 'CSS documents must be encoded in UTF-8, detected %1$s;' },
  'CSS-005': { severity: 'USAGE', template: 'Conflicting alternate style tags found: %1$s.' },
  'CSS-006': { severity: 'USAGE', template: 'CSS selector specifies fixed position.' },
  'CSS-007': { severity: 'INFO', template: 'Font-face reference "%1$s" refers to non-standard font type "%2$s".' },
  'CSS-008': { severity: 'ERROR', template: 'An error occurred while parsing the CSS: %1$s.' },
  'CSS-015': { severity: 'ERROR', template: 'Alternative style sheets must have a title.' },
  'CSS-019': { severity: 'WARNING', template: 'CSS font-face declaration has no attributes.' },
  'RSC-013': { severity: 'ERROR', template: 'Fragment identifier is used in a reference to a stylesheet resource.' },
  'RSC-017': { severity: 'WARNING', template: 'Warning while parsing file: %1$s' },
  'RSC-030': { severity: 'ERROR', template: 'File URLs are not allowed in EPUB, but found "%1$s".' },
  'RSC-031': { severity: 'WARNING', template: 'Remote resource references should use HTTPS, but found "%1$s".' },
  'RSC-032': { severity: 'ERROR', template: 'Fallback must be provided for foreign resources, but found none for resource "%1$s" of type "%2$s".' },
}
