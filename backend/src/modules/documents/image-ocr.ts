// OCR for photos and scanned PDFs: image bytes in, plain text out. The text then goes through the same
// extraction and rules as an uploaded .txt. One worker is shared and reused (loading the model is slow).
import { createWorker, type Worker } from 'tesseract.js';
import { getDocumentProxy, renderPageAsImage } from 'unpdf';

const MAX_PDF_PAGES = 3; // an ID card or bill is 1-2 pages; cap the OCR work per file

let worker: Promise<Worker> | undefined;
let queue: Promise<unknown> = Promise.resolve();

function getWorker(): Promise<Worker> {
  worker ??= createWorker('eng').catch((err: unknown) => {
    worker = undefined; // retry on the next upload (e.g. language data could not be downloaded)
    throw err;
  });
  return worker;
}

/** Runs OCR jobs one at a time on the shared worker. */
function recognize(image: Buffer | Uint8Array): Promise<string> {
  const job = queue.then(async () => {
    const w = await getWorker();
    const { data } = await w.recognize(Buffer.from(image));
    return data.text;
  });
  queue = job.catch(() => undefined);
  return job;
}

export const isImageFile = (name: string): boolean => /\.(png|jpe?g)$/i.test(name);

/** True when the bytes start like a PNG or a JPEG, whatever the file name says. */
export function looksLikeImage(buffer: Buffer): boolean {
  const png = buffer.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  const jpeg = buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  return png || jpeg;
}

export async function ocrImage(buffer: Buffer): Promise<string> {
  return (await recognize(buffer)).replace(/\0/g, '').trim();
}

/** Renders the first pages of a scanned PDF and reads them. */
export async function ocrPdf(buffer: Buffer): Promise<string> {
  const pdf = await getDocumentProxy(new Uint8Array(buffer));
  const pages = Math.min(pdf.numPages, MAX_PDF_PAGES);
  const parts: string[] = [];
  for (let n = 1; n <= pages; n++) {
    const png = await renderPageAsImage(pdf, n, {
      canvasImport: () => import('@napi-rs/canvas'),
      scale: 2,
    });
    parts.push(await recognize(new Uint8Array(png)));
  }
  return parts.join('\n').replace(/\0/g, '').trim();
}

export async function stopOcr(): Promise<void> {
  if (worker) await (await worker).terminate();
  worker = undefined;
}
