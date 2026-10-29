// Upload checks from spec FR-2 / section 4: .txt (UTF-8) or .pdf with a text layer, at most 1 MB, a declared
// type per file. A PDF is turned into plain text here, so everything after upload works on text only.
// Document text is untrusted data: it is validated as bytes and stored, never interpreted.
import { createHash } from 'node:crypto';
import { extractText, getDocumentProxy } from 'unpdf';
import { isImageFile, looksLikeImage, ocrImage, ocrPdf } from './image-ocr.js';
import { unprocessable, type FieldIssue } from '../../http/errors.js';

export const MAX_UPLOAD_BYTES = 1024 * 1024;
export const MIN_FILES_FIRST_UPLOAD = 3;

export interface IncomingFile {
  originalname: string;
  mimetype: string;
  buffer: Buffer;
}

export interface CheckedFile {
  text: string;
  bytes: Buffer; // the UTF-8 bytes that are stored and hashed (BOM removed)
  sha256: string;
}

const PDF_MIME = /^application\/pdf$|^application\/octet-stream$/i;
const TEXT_MIME = /^text\/plain(;.*)?$|^application\/octet-stream$/i;
const utf8 = new TextDecoder('utf-8', { fatal: true });

/** Returns the checked file, or the problem (one machine code and a message). */
export function checkTextFile(file: IncomingFile): CheckedFile | { code: string; message: string } {
  if (file.buffer.length > MAX_UPLOAD_BYTES)
    return {
      code: 'FILE_TOO_LARGE',
      message: `File is larger than ${MAX_UPLOAD_BYTES} bytes (1 MB)`,
    };
  if (!/\.txt$/i.test(file.originalname) || !TEXT_MIME.test(file.mimetype))
    return { code: 'UNSUPPORTED_FILE_TYPE', message: 'Only plain-text .txt files are accepted' };
  if (file.buffer.length === 0) return { code: 'EMPTY_FILE', message: 'File is empty' };
  if (file.buffer.includes(0))
    return { code: 'UNSUPPORTED_FILE_TYPE', message: 'File looks binary (contains NUL bytes)' };
  let text: string;
  try {
    text = utf8.decode(file.buffer); // fatal: invalid UTF-8 throws; a leading BOM is dropped
  } catch {
    return { code: 'INVALID_ENCODING', message: 'File is not valid UTF-8' };
  }
  const bytes = Buffer.from(text, 'utf8');
  return { text, bytes, sha256: createHash('sha256').update(bytes).digest('hex') };
}

/** Reads the text layer of a PDF. Scanned images have none and are refused (no OCR engine). */
async function pdfToText(file: IncomingFile): Promise<string | { code: string; message: string }> {
  if (!/\.pdf$/i.test(file.originalname) || !PDF_MIME.test(file.mimetype))
    return {
      code: 'UNSUPPORTED_FILE_TYPE',
      message: 'Only .txt, .pdf, .png and .jpg files are accepted',
    };
  if (file.buffer.subarray(0, 5).toString('latin1') !== '%PDF-')
    return { code: 'UNSUPPORTED_FILE_TYPE', message: 'File is not a valid PDF' };
  try {
    const pdf = await getDocumentProxy(new Uint8Array(file.buffer));
    const { text } = await extractText(pdf, { mergePages: true });
    const clean = text.replaceAll('\u0000', '').trim();
    if (!clean) {
      const scanned = await ocrPdf(file.buffer);
      if (!scanned)
        return { code: 'OCR_NO_TEXT', message: 'No readable text was found in this scanned PDF' };
      return scanned;
    }
    return clean;
  } catch {
    return { code: 'INVALID_PDF', message: 'PDF could not be read' };
  }
}

/** Checks one upload: a .txt as-is, a .pdf or a photo (.png, .jpg) converted to text first. */
export async function checkUpload(
  file: IncomingFile,
): Promise<CheckedFile | { code: string; message: string }> {
  const image = isImageFile(file.originalname);
  if (!image && !/\.pdf$/i.test(file.originalname)) return checkTextFile(file);
  if (file.buffer.length > MAX_UPLOAD_BYTES)
    return {
      code: 'FILE_TOO_LARGE',
      message: `File is larger than ${MAX_UPLOAD_BYTES} bytes (1 MB)`,
    };
  if (file.buffer.length === 0) return { code: 'EMPTY_FILE', message: 'File is empty' };
  let text: string | { code: string; message: string };
  if (image) {
    if (
      !/^image\/(png|jpeg)$|^application\/octet-stream$/i.test(file.mimetype) ||
      !looksLikeImage(file.buffer)
    )
      return { code: 'UNSUPPORTED_FILE_TYPE', message: 'File is not a valid PNG or JPEG image' };
    try {
      text = (await ocrImage(file.buffer)) || {
        code: 'OCR_NO_TEXT',
        message: 'No readable text was found in this image',
      };
    } catch {
      text = { code: 'OCR_FAILED', message: 'The image could not be read (OCR unavailable)' };
    }
  } else text = await pdfToText(file);
  if (typeof text !== 'string') return text;
  const bytes = Buffer.from(text, 'utf8');
  return { text, bytes, sha256: createHash('sha256').update(bytes).digest('hex') };
}

/** Checks every file; any problem becomes one 422 that names each offending file by index. */
export async function checkAll(files: IncomingFile[]): Promise<CheckedFile[]> {
  const checked: CheckedFile[] = [];
  const issues: FieldIssue[] = [];
  let firstCode = '';
  for (const [i, file] of files.entries()) {
    const result = await checkUpload(file);
    if ('code' in result) {
      firstCode ||= result.code;
      issues.push({ field: `files[${i}]`, message: `${result.code}: ${result.message}` });
    } else checked.push(result);
  }
  if (issues.length) throw unprocessable(firstCode, 'One or more files were rejected', issues);
  return checked;
}
