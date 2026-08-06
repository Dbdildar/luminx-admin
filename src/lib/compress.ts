/**
 * Browser-side video compression (WebCodecs, hardware accelerated via mediabunny).
 *
 * Goal: cut the bytes we push to R2 without a visible quality drop.
 *  - re-encodes to H.264/AAC MP4 with a high quality target
 *  - downscales only when the source is larger than 1080p
 *  - never blocks publishing: any failure, or a result that isn't meaningfully
 *    smaller, falls back to the original file untouched.
 */

export type CompressionResult = {
  file: File;
  compressed: boolean;
  originalSize: number;
  finalSize: number;
  reason?: string;
};

const MAX_HEIGHT = 1080;
const MIN_SIZE_TO_BOTHER = 4 * 1024 * 1024; // tiny clips aren't worth a re-encode
const WORTH_IT_RATIO = 0.92; // must save at least 8% to be used

export async function compressVideo(
  file: File,
  onProgress?: (pct: number) => void,
): Promise<CompressionResult> {
  const base: CompressionResult = {
    file,
    compressed: false,
    originalSize: file.size,
    finalSize: file.size,
  };

  if (typeof window === "undefined" || typeof VideoEncoder === "undefined") {
    return { ...base, reason: "Browser can't re-encode video — uploading the original." };
  }
  if (file.size < MIN_SIZE_TO_BOTHER) {
    return { ...base, reason: "Already small — skipped compression." };
  }

  try {
    const {
      ALL_FORMATS,
      BlobSource,
      BufferTarget,
      Conversion,
      Input,
      Mp4OutputFormat,
      Output,
      QUALITY_HIGH,
      canEncodeVideo,
    } = await import("mediabunny");

    if (!(await canEncodeVideo("avc"))) {
      return { ...base, reason: "H.264 encoding unavailable — uploading the original." };
    }

    const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
    const videoTrack = await input.getPrimaryVideoTrack();
    if (!videoTrack) return { ...base, reason: "No video track detected — uploading the original." };

    const height = videoTrack.displayHeight || 0;
    const output = new Output({
      format: new Mp4OutputFormat({ fastStart: "in-memory" }),
      target: new BufferTarget(),
    });

    const conversion = await Conversion.init({
      input,
      output,
      video: {
        codec: "avc",
        bitrate: QUALITY_HIGH,
        ...(height > MAX_HEIGHT ? { height: MAX_HEIGHT, fit: "contain" as const } : {}),
      },
      audio: { codec: "aac", bitrate: 128_000 },
      showWarnings: false,
    });

    if (!conversion.isValid) {
      return { ...base, reason: "Codec not supported here — uploading the original." };
    }

    conversion.onProgress = (progress) => onProgress?.(Math.round(progress * 100));
    await conversion.execute();
    onProgress?.(100);

    const buffer = output.target.buffer;
    if (!buffer) return { ...base, reason: "Compression produced no data — uploading the original." };

    if (buffer.byteLength >= file.size * WORTH_IT_RATIO) {
      return { ...base, reason: "Source is already efficiently encoded — uploading the original." };
    }

    const name = file.name.replace(/\.[^.]+$/, "") || "video";
    const compressedFile = new File([buffer], `${name}.mp4`, { type: "video/mp4" });
    return {
      file: compressedFile,
      compressed: true,
      originalSize: file.size,
      finalSize: compressedFile.size,
    };
  } catch (error) {
    return { ...base, reason: `Compression skipped: ${(error as Error).message}` };
  }
}
