export function assertExactCorpusCoverage(reports, expectedCaseIds) {
  if (new Set(expectedCaseIds).size !== expectedCaseIds.length) {
    throw new Error('Unicode corpus case ids must be unique');
  }
  for (const report of reports) {
    if (!Array.isArray(report.cases)) throw new Error(`${report.engine}: missing cases array`);
    const ids = report.cases.map((entry) => entry.id);
    if (
      new Set(ids).size !== ids.length ||
      JSON.stringify(ids) !== JSON.stringify(expectedCaseIds)
    ) {
      throw new Error(
        `${report.engine}: corpus coverage changed; expected ${JSON.stringify(expectedCaseIds)}, observed ${JSON.stringify(ids)}`,
      );
    }
    for (const entry of report.cases) normalizeGeometry(entry);
  }
}

export function normalizeGeometry(entry) {
  if (
    !Number.isSafeInteger(entry.markerColumn) ||
    !Number.isSafeInteger(entry.cursor?.x) ||
    !Number.isSafeInteger(entry.cursor?.y) ||
    !Array.isArray(entry.cells)
  ) {
    throw new Error(`${entry.id}: malformed geometry observation`);
  }
  return {
    markerColumn: entry.markerColumn,
    cursor: { x: entry.cursor.x, y: entry.cursor.y },
    cells: entry.cells.map((cell) => {
      if (
        !Number.isSafeInteger(cell.column) ||
        ![0, 1, 2].includes(cell.width) ||
        typeof cell.continuation !== 'boolean'
      ) {
        throw new Error(`${entry.id}: malformed cell topology`);
      }
      return {
        column: cell.column,
        width: cell.width,
        continuation: cell.continuation,
      };
    }),
  };
}

export function observedGapIds(report, canonical) {
  const gaps = report.cases
    .filter((entry, index) => {
      const canonicalEntry = canonical.cases[index];
      if (canonicalEntry === undefined)
        throw new Error(`${report.engine}: canonical case is missing`);
      return (
        entry.correct !== true ||
        JSON.stringify(normalizeGeometry(entry)) !==
          JSON.stringify(normalizeGeometry(canonicalEntry))
      );
    })
    .map((entry) => entry.id);
  return [...new Set(gaps)].sort();
}
