/** Max PNG payload (~1.5 MB binary) after base64 decode. */
export const MAX_SCREENSHOT_BYTES = 1_500_000;

export async function captureTabScreenshot(): Promise<string | null> {
  if (typeof navigator === "undefined" || !navigator.mediaDevices?.getDisplayMedia) {
    return null;
  }

  let stream: MediaStream | null = null;
  try {
    stream = await navigator.mediaDevices.getDisplayMedia({
      video: { displaySurface: "browser" },
      audio: false,
    });

    const track = stream.getVideoTracks()[0];
    if (!track) return null;

    const video = document.createElement("video");
    video.srcObject = stream;
    video.muted = true;
    await video.play();

    await new Promise<void>((resolve) => {
      if (video.readyState >= 2) {
        resolve();
        return;
      }
      video.onloadeddata = () => resolve();
    });

    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(video, 0, 0);

    const dataUrl = canvas.toDataURL("image/png", 0.92);
    track.stop();
    return dataUrl;
  } catch {
    return null;
  } finally {
    stream?.getTracks().forEach((t) => t.stop());
  }
}

export async function readClipboardScreenshot(): Promise<string | null> {
  if (typeof navigator === "undefined" || !navigator.clipboard?.read) {
    return null;
  }

  try {
    const items = await navigator.clipboard.read();
    for (const item of items) {
      const imageType = item.types.find((t) => t.startsWith("image/"));
      if (!imageType) continue;
      const blob = await item.getType(imageType);
      return await blobToDataUrl(blob);
    }
    return null;
  } catch {
    return null;
  }
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

export function estimateDataUrlBytes(dataUrl: string): number {
  const base64 = dataUrl.split(",")[1] ?? "";
  return Math.floor((base64.length * 3) / 4);
}

export function isScreenshotWithinLimit(dataUrl: string): boolean {
  return estimateDataUrlBytes(dataUrl) <= MAX_SCREENSHOT_BYTES;
}
