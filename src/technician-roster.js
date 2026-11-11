export function normalizeTechnicianNames(rows) {
  if (!Array.isArray(rows)) return [];
  const names = rows
    .map((row) => typeof row?.display_name === 'string' ? row.display_name.replace(/\s+/g, ' ').trim().slice(0, 100) : '')
    .filter(Boolean);
  return [...new Set(names)].sort((a, b) => a.localeCompare(b, 'es-MX'));
}
