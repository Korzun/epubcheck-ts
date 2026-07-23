/** Message ids the TS validator can currently emit (Plans 1–6). Expected fixtures must only reference these. */
export const IMPLEMENTED_IDS: ReadonlySet<string> = new Set([
  // container / package-archive
  'PKG-001', 'PKG-003', 'PKG-005', 'PKG-006', 'PKG-007',
  // resources
  'RSC-001', 'RSC-002', 'RSC-003', 'RSC-005', 'RSC-006', 'RSC-007', 'RSC-008', 'RSC-010', 'RSC-011', 'RSC-012', 'RSC-013', 'RSC-030', 'RSC-031', 'RSC-032',
  // package document
  'OPF-001', 'OPF-003', 'OPF-030', 'OPF-031', 'OPF-032', 'OPF-033', 'OPF-034', 'OPF-035', 'OPF-037', 'OPF-040', 'OPF-042', 'OPF-043', 'OPF-044', 'OPF-048', 'OPF-049', 'OPF-050', 'OPF-074', 'OPF-099',
  // ncx
  'NCX-001', 'NCX-004', 'NCX-006',
  // navigation
  'NAV-010', 'NAV-011',
  // css
  'CSS-001', 'CSS-002', 'CSS-003', 'CSS-004', 'CSS-005', 'CSS-006', 'CSS-007', 'CSS-008', 'CSS-015', 'CSS-019',
  // internal
  'CHK-001',
])
