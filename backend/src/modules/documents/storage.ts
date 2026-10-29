// Uploaded files are kept on disk under STORAGE_DIR, outside the web root and never served by a
// static route; they are only ever read back through the authorised API. Files are 0600, folders 0700.
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';

const SAFE_ID = /^[A-Za-z0-9_-]{1,40}$/;

export interface FileStore {
  save(applicationId: string, docId: string, bytes: Buffer): Promise<string>;
  remove(key: string): Promise<void>;
}

export function createDiskStore(root: string): FileStore {
  const base = resolve(root);
  const pathFor = (key: string): string => {
    const path = resolve(join(base, key));
    if (!path.startsWith(base + sep)) throw new Error('storage key escapes the storage folder');
    return path;
  };
  return {
    async save(applicationId, docId, bytes) {
      if (!SAFE_ID.test(applicationId) || !SAFE_ID.test(docId))
        throw new Error('unsafe storage id');
      const key = `${applicationId}/${docId}.txt`;
      const path = pathFor(key);
      await mkdir(dirname(path), { recursive: true, mode: 0o700 });
      await writeFile(path, bytes, { flag: 'wx', mode: 0o600 }); // wx: never overwrite
      return key;
    },
    async remove(key) {
      await rm(pathFor(key), { force: true });
    },
  };
}
