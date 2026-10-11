export interface ParsedSegment {
  type: 'text' | 'variable';
  raw: string;
  varName?: string;
  value?: string;
  isFilled?: boolean;
}

const VARIABLE_REGEX = /\[([^\[\]\n]+)\]/g;

const MULTILINE_KEYWORDS = [
  '清單',
  '內容',
  '說明',
  '項目',
  '重點',
  '待辦',
  '議程',
  '備註',
  '細節',
  '效益',
  '條件',
  '資訊',
  '紀錄',
];

/**
 * Extracts unique variable names in order of appearance from subject and body.
 */
export function extractVariables(subject: string, body: string): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  const scan = (text: string) => {
    if (!text) return;
    const matches = text.matchAll(VARIABLE_REGEX);
    for (const match of matches) {
      const name = match[1].trim();
      if (name && !seen.has(name)) {
        seen.add(name);
        result.push(name);
      }
    }
  };

  scan(subject);
  scan(body);
  return result;
}

/**
 * Checks where a variable appears (Subject, Body, or both).
 */
export function getVariableLocations(
  varName: string,
  subject: string,
  body: string
): { inSubject: boolean; inBody: boolean } {
  const token = `[${varName}]`;
  return {
    inSubject: subject.includes(token),
    inBody: body.includes(token),
  };
}

/**
 * Determines whether a variable should default to a multi-line textarea.
 */
export function isLikelyMultilineVariable(varName: string, currentValue?: string): boolean {
  if (currentValue && currentValue.includes('\n')) return true;
  return MULTILINE_KEYWORDS.some((kw) => varName.includes(kw));
}

/**
 * Replaces [變數名稱] with user-provided values for plain text copy.
 * If a variable is empty/unfilled, keeps [變數名稱] so user sees it clearly or replaces with fallback.
 */
export function renderPlainText(
  templateText: string,
  values: Record<string, string>,
  keepBracketsWhenEmpty = true
): string {
  if (!templateText) return '';
  return templateText.replace(VARIABLE_REGEX, (fullMatch, rawName) => {
    const name = rawName.trim();
    const val = values[name];
    if (val !== undefined && val.trim() !== '') {
      return val;
    }
    return keepBracketsWhenEmpty ? fullMatch : '';
  });
}

/**
 * Splits template text into structured segments for rich live preview rendering.
 */
export function parseTemplateSegments(
  templateText: string,
  values: Record<string, string>
): ParsedSegment[] {
  if (!templateText) return [];
  const segments: ParsedSegment[] = [];
  let lastIndex = 0;

  const matches = Array.from(templateText.matchAll(VARIABLE_REGEX));
  for (const match of matches) {
    const matchIndex = match.index ?? 0;
    if (matchIndex > lastIndex) {
      segments.push({
        type: 'text',
        raw: templateText.slice(lastIndex, matchIndex),
      });
    }

    const varName = match[1].trim();
    const rawValue = values[varName];
    const isFilled = rawValue !== undefined && rawValue.trim() !== '';

    segments.push({
      type: 'variable',
      raw: match[0],
      varName,
      value: isFilled ? rawValue : `[${varName}]`,
      isFilled,
    });

    lastIndex = matchIndex + match[0].length;
  }

  if (lastIndex < templateText.length) {
    segments.push({
      type: 'text',
      raw: templateText.slice(lastIndex),
    });
  }

  return segments;
}
