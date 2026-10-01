/** Joins a text box's OCR lines into the single string the Yomitan drawer looks words up in. */
export function joinTextBoxLines(lines: string[]): string {
  return lines
    .map((line) => line.trim())
    .filter(Boolean)
    .join('')
    .replace(/\s+/g, '')
    .trim();
}
