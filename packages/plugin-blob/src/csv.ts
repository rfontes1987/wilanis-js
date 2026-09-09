/** RFC 4180 rows out of text fed in pieces: a field may be quoted, a quote inside it doubled, a line ended by LF or CRLF. */
export class CsvRows {
  private field = '';
  private row: string[] = [];
  private inQuotes = false;
  private afterQuote = false;
  private quoted = false;

  /** The rows completed by this piece of text. */
  feed(text: string): string[][] {
    const rows: string[][] = [];
    for (const char of text) {
      if (this.inQuotes && this.insideQuotes(char)) continue;
      this.outsideQuotes(char, rows);
    }
    return rows;
  }

  /** The last row, when the text ended without a newline. */
  end(): string[][] {
    if (this.field === '' && !this.row.length && !this.quoted) return [];
    this.row.push(this.field);
    const last = this.row;
    this.row = [];
    this.field = '';
    this.quoted = false;
    return [last];
  }

  /** A character inside a quoted field; answers whether it was consumed, or closed the field and must be read again outside. */
  private insideQuotes(char: string): boolean {
    if (!this.afterQuote) {
      if (char === '"') this.afterQuote = true;
      else this.field += char;
      return true;
    }
    if (char === '"') {
      this.field += '"'; // a doubled quote is one quote
      this.afterQuote = false;
      return true;
    }
    this.inQuotes = false; // the quote closed the field; char is a separator or a line end
    this.afterQuote = false;
    return false;
  }

  private outsideQuotes(char: string, rows: string[][]): void {
    if (char === '"' && this.field === '' && !this.quoted) {
      this.inQuotes = true;
      this.quoted = true;
    } else if (char === ',') this.endField();
    else if (char === '\n') rows.push(this.endRow());
    else if (char !== '\r') this.field += char;
  }

  private endField(): void {
    this.row.push(this.field);
    this.field = '';
    this.quoted = false;
  }

  private endRow(): string[] {
    this.endField();
    const row = this.row;
    this.row = [];
    return row;
  }
}
