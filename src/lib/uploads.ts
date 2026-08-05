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


/** Direct-to-Cloudinary signed upload with byte-level progress. */
export async function uploadToCloudinary(
  config: { uploadUrl: string; apiKey: string; timestamp: number; signature: string; folder: string },
  file: Blob,
  filename: string,
  onProgress?: (pct: number) => void,
) {
  const formData = new FormData();
  formData.append("file", file, filename);
  formData.append("api_key", config.apiKey);
  formData.append("timestamp", String(config.timestamp));
  formData.append("folder", config.folder);
  formData.append("signature", config.signature);

  console.log("Uploading with:", {
    api_key: config.apiKey,
    timestamp: config.timestamp,
    folder: config.folder,
    signature: config.signature,
  });

  const res = await fetch(config.uploadUrl, {
    method: "POST",
    body: formData,
  });

  if (!res.ok) {
    throw new Error(`Cloudinary upload failed: ${res.statusText}`);
  }

  return res.json();
}
