/** XHR-based uploads so we get real byte-level progress percentages. */

export type ProgressFn = (pct: number) => void;

export type UploadHandle = { promise: Promise<void>; abort: () => void };

/**
 * Direct-to-R2 upload with a presigned PUT URL.
 * Returns an abortable handle so a failed step can cancel siblings.
 */
export function uploadToR2(
  url: string,
  body: Blob,
  contentType: string,
  onProgress?: ProgressFn,
): UploadHandle {
  const xhr = new XMLHttpRequest();
  const promise = new Promise<void>((resolve, reject) => {
    xhr.open("PUT", url, true);
    xhr.setRequestHeader("Content-Type", contentType || "application/octet-stream");
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress?.(Math.round((event.loaded / event.total) * 100));
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        onProgress?.(100);
        resolve();
      } else {
        reject(new Error(`Storage rejected the upload (${xhr.status}). ${xhr.responseText || ""}`.trim()));
      }
    };
    xhr.onerror = () =>
      reject(
        new Error(
          "Network error during upload. Check that the R2 bucket allows PUT from this origin (CORS).",
        ),
      );
    xhr.onabort = () => reject(new Error("Upload cancelled."));
    xhr.send(body);
  });

  return { promise, abort: () => xhr.abort() };
}

export type CloudinarySignature = {
  uploadUrl: string;
  apiKey: string;
  timestamp: number;
  signature: string;
  folder: string;
};

export type CloudinaryResult = { publicId: string; secureUrl: string };

/** Direct-to-Cloudinary signed upload with byte-level progress. */
export function uploadToCloudinary(
  config: CloudinarySignature,
  file: Blob,
  filename: string,
  onProgress?: ProgressFn,
): { promise: Promise<CloudinaryResult>; abort: () => void } {
  const form = new FormData();
  form.append("file", file, filename);
  form.append("api_key", config.apiKey);
  form.append("timestamp", String(config.timestamp));
  form.append("folder", config.folder);
  form.append("signature", config.signature);

  const xhr = new XMLHttpRequest();
  const promise = new Promise<CloudinaryResult>((resolve, reject) => {
    xhr.open("POST", config.uploadUrl, true);
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress?.(Math.round((event.loaded / event.total) * 100));
    };
    xhr.onload = () => {
      let payload: { public_id?: string; secure_url?: string; error?: { message?: string } } = {};
      try {
        payload = JSON.parse(xhr.responseText) as typeof payload;
      } catch {
        /* handled below */
      }
      if (xhr.status >= 200 && xhr.status < 300 && payload.public_id && payload.secure_url) {
        onProgress?.(100);
        resolve({ publicId: payload.public_id, secureUrl: payload.secure_url });
      } else {
        reject(
          new Error(
            payload.error?.message ?? `Cloudinary rejected the poster upload (${xhr.status}).`,
          ),
        );
      }
    };
    xhr.onerror = () => reject(new Error("Network error while uploading the poster to Cloudinary."));
    xhr.onabort = () => reject(new Error("Poster upload cancelled."));
    xhr.send(form);
  });

  return { promise, abort: () => xhr.abort() };
}

/* ------------------------------------------------------------------ *
 * Parallel multipart upload to R2 — several parts in flight at once,  *
 * which is dramatically faster than one sequential PUT for big files. *
 * ------------------------------------------------------------------ */

export const MULTIPART_THRESHOLD = 16 * 1024 * 1024; // below this a single PUT wins

/** Part size grows with the file so we never exceed 10k parts. */
export function pickPartSize(size: number): number {
  const min = 8 * 1024 * 1024;
  return Math.max(min, Math.ceil(size / 9000 / min) * min);
}

function putPart(
  url: string,
  body: Blob,
  onBytes: (loaded: number) => void,
  signal: { aborted: boolean; register: (abort: () => void) => void },
): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    signal.register(() => xhr.abort());
    xhr.open("PUT", url, true);
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onBytes(event.loaded);
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        const etag = xhr.getResponseHeader("ETag");
        if (!etag) {
          reject(new Error("R2 did not expose the ETag header — add ETag to the bucket CORS ExposeHeaders."));
          return;
        }
        onBytes(body.size);
        resolve(etag);
      } else {
        reject(new Error(`Part upload failed (${xhr.status}). ${xhr.responseText || ""}`.trim()));
      }
    };
    xhr.onerror = () =>
      reject(new Error("Network error during upload. Check the R2 bucket CORS rules for this origin."));
    xhr.onabort = () => reject(new Error("Upload cancelled."));
    xhr.send(body);
  });
}

/** Uploads all parts with a bounded concurrency pool, retrying transient failures. */
export async function uploadPartsInParallel(options: {
  file: Blob;
  partUrls: string[];
  partSize: number;
  concurrency?: number;
  onProgress?: (pct: number, bytesPerSecond: number) => void;
}): Promise<{ partNumber: number; etag: string }[]> {
  const { file, partUrls, partSize } = options;
  const concurrency = Math.min(options.concurrency ?? 4, partUrls.length);
  const loaded = new Array<number>(partUrls.length).fill(0);
  const started = performance.now();
  const aborts: (() => void)[] = [];
  const state = { aborted: false, register: (a: () => void) => aborts.push(a) };
  const results: { partNumber: number; etag: string }[] = [];

  const report = () => {
    const total = loaded.reduce((a, b) => a + b, 0);
    const seconds = Math.max(0.001, (performance.now() - started) / 1000);
    options.onProgress?.(Math.min(99, Math.round((total / file.size) * 100)), total / seconds);
  };

  let next = 0;
  const worker = async () => {
    for (;;) {
      const index = next++;
      if (index >= partUrls.length) return;
      const start = index * partSize;
      const chunk = file.slice(start, Math.min(start + partSize, file.size));
      let lastError: unknown;
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const etag = await putPart(
            partUrls[index]!,
            chunk,
            (bytes) => {
              loaded[index] = bytes;
              report();
            },
            state,
          );
          results.push({ partNumber: index + 1, etag });
          lastError = undefined;
          break;
        } catch (error) {
          lastError = error;
          loaded[index] = 0;
          await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
        }
      }
      if (lastError) {
        aborts.forEach((a) => a());
        throw lastError;
      }
    }
  };

  await Promise.all(Array.from({ length: concurrency }, worker));
  options.onProgress?.(100, file.size / Math.max(0.001, (performance.now() - started) / 1000));
  return results;
}
