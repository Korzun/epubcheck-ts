export type Severity = 'FATAL' | 'ERROR' | 'WARNING' | 'INFO' | 'USAGE'

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
  'OPF-033': { severity: 'ERROR', template: 'The spine contains no linear resources.' },
  'OPF-048': { severity: 'ERROR', template: 'Package tag is missing its required unique-identifier attribute and value.' },
  'OPF-049': { severity: 'ERROR', template: 'Item id "%1$s" was not found in the manifest.' },
  'OPF-074': { severity: 'ERROR', template: 'Package resource "%1$s" is declared in several manifest item.' },
  'RSC-001': { severity: 'ERROR', template: 'File "%1$s" could not be found.' },
  // Navigation
  'NAV-010': { severity: 'ERROR', template: '"%1$s" nav must not link to remote resources; found link to "%2$s".' },
  // Internal
  'CHK-001': { severity: 'FATAL', template: 'An internal error occurred while validating: %1$s' },
  // CSS
  'CSS-001': { severity: 'ERROR', template: 'The "%1$s" property must not be included in an EPUB Style Sheet.' },
  'CSS-002': { severity: 'ERROR', template: 'Empty or NULL reference found.' },
  'CSS-006': { severity: 'USAGE', template: 'CSS selector specifies fixed position.' },
  'CSS-008': { severity: 'ERROR', template: 'An error occurred while parsing the CSS: %1$s.' },
  'CSS-019': { severity: 'WARNING', template: 'CSS font-face declaration has no attributes.' },
  'RSC-013': { severity: 'ERROR', template: 'Fragment identifier is used in a reference to a stylesheet resource.' },
  'RSC-030': { severity: 'ERROR', template: 'File URLs are not allowed in EPUB, but found "%1$s".' },
  'RSC-031': { severity: 'WARNING', template: 'Remote resource references should use HTTPS, but found "%1$s".' },
  'RSC-032': { severity: 'ERROR', template: 'Fallback must be provided for foreign resources, but found none for resource "%1$s" of type "%2$s".' },
}
