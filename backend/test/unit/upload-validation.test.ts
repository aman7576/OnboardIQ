import { describe, expect, it } from 'vitest';
import {
  checkAll,
  checkTextFile,
  checkUpload,
  MAX_UPLOAD_BYTES,
} from '../../src/modules/documents/validation.js';
import { realText } from '../support/real-data.js';

const file = (name: string, buffer: Buffer, mimetype = 'text/plain') => ({
  originalname: name,
  mimetype,
  buffer,
});

describe('upload validation', () => {
  it('accepts a supplied document text and hashes the UTF-8 bytes', () => {
    const text = realText('D3000001');
    const result = checkTextFile(file('D3000001.txt', Buffer.from(text)));
    expect(result).toMatchObject({ text });
    expect('sha256' in result && result.sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it('accepts exactly 1 MB and rejects one byte more', () => {
    expect('code' in checkTextFile(file('a.txt', Buffer.alloc(MAX_UPLOAD_BYTES, 'a')))).toBe(false);
    expect(checkTextFile(file('a.txt', Buffer.alloc(MAX_UPLOAD_BYTES + 1, 'a')))).toMatchObject({
      code: 'FILE_TOO_LARGE',
    });
  });

  it('rejects invalid UTF-8', () => {
    expect(checkTextFile(file('a.txt', Buffer.from([0x41, 0xff, 0xfe, 0x42])))).toMatchObject({
      code: 'INVALID_ENCODING',
    });
  });

  it.each([
    ['scan.png', 'image/png'],
    ['notes.pdf', 'application/pdf'],
    ['page.html', 'text/html'],
    ['sneaky.txt.exe', 'text/plain'],
    ['text.txt', 'image/png'],
  ])('rejects %s (%s) as an unsupported file', (name, mime) => {
    expect(checkTextFile(file(name, Buffer.from('hello'), mime))).toMatchObject({
      code: 'UNSUPPORTED_FILE_TYPE',
    });
  });

  it('rejects binary content and empty files', () => {
    expect(checkTextFile(file('a.txt', Buffer.from([0x68, 0x00, 0x69])))).toMatchObject({
      code: 'UNSUPPORTED_FILE_TYPE',
    });
    expect(checkTextFile(file('a.txt', Buffer.alloc(0)))).toMatchObject({ code: 'EMPTY_FILE' });
  });

  it('drops a leading BOM so the stored text and hash match the text itself', () => {
    const plain = checkTextFile(file('a.txt', Buffer.from('abc')));
    const bom = checkTextFile(file('a.txt', Buffer.from([0xef, 0xbb, 0xbf, 0x61, 0x62, 0x63])));
    expect(bom).toEqual(plain);
  });

  it('names every offending file by index in one 422', async () => {
    try {
      await checkAll([
        file('ok.txt', Buffer.from('fine')),
        file('bad.png', Buffer.from('x'), 'image/png'),
        file('worse.txt', Buffer.from([0xff])),
      ]);
      expect.unreachable();
    } catch (err) {
      expect(err).toMatchObject({
        status: 422,
        fields: [{ field: 'files[1]' }, { field: 'files[2]' }],
      });
    }
  });

  describe('pdf', () => {
    // Smallest valid PDF with one line of text; offsets are not needed because readers rebuild the xref.
    const pdfWith = (line: string) =>
      Buffer.from(
        `%PDF-1.4
1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj
2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj
` +
          `3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 300 100]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>endobj
` +
          `4 0 obj<</Length ${line.length + 30}>>stream
BT /F1 12 Tf 10 50 Td (${line}) Tj ET
endstream endobj
` +
          `5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj
trailer<</Root 1 0 R/Size 6>>
%%EOF`,
      );

    it('extracts the text layer of a PDF', async () => {
      const result = await checkUpload(
        file('pan.pdf', pdfWith('Permanent Account Number ABCDE1234F'), 'application/pdf'),
      );
      expect(result).toMatchObject({ text: expect.stringContaining('ABCDE1234F') });
    });

    it('rejects a fake PDF and an oversized PDF', async () => {
      expect(
        await checkUpload(file('x.pdf', Buffer.from('hello'), 'application/pdf')),
      ).toMatchObject({
        code: 'UNSUPPORTED_FILE_TYPE',
      });
      expect(
        await checkUpload(file('x.pdf', Buffer.alloc(MAX_UPLOAD_BYTES + 1), 'application/pdf')),
      ).toMatchObject({ code: 'FILE_TOO_LARGE' });
    });
  });
});
