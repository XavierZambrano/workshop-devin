export interface CsvPlayerRow {
  line: number;
  displayName: string;
  seed?: number;
  photoRef?: string;
}

export interface CsvRowError {
  line: number;
  message: string;
}

export type CsvSeparator = ',' | ';' | '\t';

export interface ParsedPlayersCsv {
  rows: CsvPlayerRow[];
  errors: CsvRowError[];
  separator: CsvSeparator;
  hasHeader: boolean;
}

interface ParsedRecord {
  line: number;
  fields: string[];
}

const HEADER_ALIASES = new Map<string, 'name' | 'seed' | 'photo'>([
  ['name', 'name'],
  ['nombre', 'name'],
  ['jugador', 'name'],
  ['player', 'name'],
  ['display name', 'name'],
  ['displayname', 'name'],
  ['seed', 'seed'],
  ['semilla', 'seed'],
  ['sembrado', 'seed'],
  ['siembra', 'seed'],
  ['photo', 'photo'],
  ['foto', 'photo'],
  ['photoref', 'photo'],
  ['imagen', 'photo'],
]);

function normalizeHeader(value: string): string {
  return value
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function detectSeparator(text: string): CsvSeparator {
  for (const line of text.split(/\r\n|\n|\r/)) {
    if (!line.trim()) continue;
    const counts: Record<CsvSeparator, number> = { ',': 0, ';': 0, '\t': 0 };
    let quoted = false;
    for (let i = 0; i < line.length; i++) {
      const char = line[i]!;
      if (char === '"') {
        if (quoted && line[i + 1] === '"') {
          i++;
        } else {
          quoted = !quoted;
        }
      } else if (!quoted && char in counts) {
        counts[char as CsvSeparator] += 1;
      }
    }
    return ([',', ';', '\t'] as CsvSeparator[]).reduce((best, candidate) =>
      counts[candidate] > counts[best] ? candidate : best,
    );
  }
  return ',';
}

function parseRecords(text: string, separator: CsvSeparator): {
  records: ParsedRecord[];
  errors: CsvRowError[];
} {
  const records: ParsedRecord[] = [];
  const errors: CsvRowError[] = [];
  let fields: string[] = [];
  let field = '';
  let quoted = false;
  let rowHasNonWhitespace = false;
  let line = 1;
  let rowLine = 1;

  const finishField = () => {
    fields.push(field.trim());
    field = '';
  };
  const finishRecord = () => {
    finishField();
    if (rowHasNonWhitespace) records.push({ line: rowLine, fields });
    fields = [];
    rowHasNonWhitespace = false;
  };

  for (let i = 0; i < text.length; i++) {
    const char = text[i]!;
    if (quoted) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          quoted = false;
        }
      } else if (char === '\r' || char === '\n') {
        if (char === '\r' && text[i + 1] === '\n') i++;
        field += '\n';
        line++;
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      rowHasNonWhitespace = true;
      if (!field.trim()) {
        field = '';
        quoted = true;
      } else {
        field += char;
      }
    } else if (char === separator) {
      rowHasNonWhitespace = true;
      finishField();
    } else if (char === '\r' || char === '\n') {
      if (char === '\r' && text[i + 1] === '\n') i++;
      finishRecord();
      line++;
      rowLine = line;
    } else {
      field += char;
      if (!/\s/.test(char)) rowHasNonWhitespace = true;
    }
  }

  if (quoted) {
    errors.push({ line: rowLine, message: 'Unterminated quoted field' });
  } else if (rowHasNonWhitespace || fields.length > 0 || field.length > 0) {
    finishRecord();
  }
  return { records, errors };
}

export function parsePlayersCsv(text: string): ParsedPlayersCsv {
  const content = text.replace(/^\uFEFF/, '');
  const separator = detectSeparator(content);
  const parsed = parseRecords(content, separator);
  const records = parsed.records;
  const errors = [...parsed.errors];
  const firstRecord = records[0];

  if (!firstRecord) {
    return { rows: [], errors, separator, hasHeader: false };
  }

  const headerKinds = firstRecord.fields.map((field) => HEADER_ALIASES.get(normalizeHeader(field)));
  const hasHeader = headerKinds.some((kind) => kind !== undefined);
  if (hasHeader) {
    const unknown = firstRecord.fields.findIndex((_, index) => headerKinds[index] === undefined);
    if (unknown >= 0) {
      return {
        rows: [],
        errors: [...errors, { line: firstRecord.line, message: `Unknown column '${firstRecord.fields[unknown]}'` }],
        separator,
        hasHeader: true,
      };
    }
  }

  const dataRecords = hasHeader ? records.slice(1) : records;
  const seenNames = new Set<string>();
  const rows: CsvPlayerRow[] = [];
  for (const record of dataRecords) {
    const values = record.fields;
    const nameIndex = hasHeader ? headerKinds.indexOf('name') : 0;
    const seedIndex = hasHeader ? headerKinds.indexOf('seed') : 1;
    const photoIndex = hasHeader ? headerKinds.indexOf('photo') : -1;
    const displayName = (values[nameIndex] ?? '').trim().normalize('NFC');
    const rowErrors: CsvRowError[] = [];

    if (!displayName) {
      rowErrors.push({ line: record.line, message: 'Player name is required' });
    }

    let seed: number | undefined;
    const rawSeed = seedIndex >= 0 ? (values[seedIndex] ?? '').trim() : '';
    if (rawSeed) {
      const parsedSeed = Number(rawSeed);
      if (!Number.isInteger(parsedSeed) || parsedSeed <= 0) {
        rowErrors.push({ line: record.line, message: `Seed '${rawSeed}' must be a positive integer` });
      } else {
        seed = parsedSeed;
      }
    }

    if (displayName) {
      const nameKey = displayName.toLowerCase();
      if (seenNames.has(nameKey)) {
        rowErrors.push({ line: record.line, message: `Duplicate player name '${displayName}'` });
      } else {
        seenNames.add(nameKey);
      }
    }

    const photoRef = photoIndex >= 0 ? (values[photoIndex] ?? '').trim() : '';
    if (rowErrors.length === 0) {
      rows.push({
        line: record.line,
        displayName,
        ...(seed === undefined ? {} : { seed }),
        ...(photoRef ? { photoRef } : {}),
      });
    } else {
      errors.push(...rowErrors);
    }
  }

  return { rows, errors, separator, hasHeader };
}
