/**
 * Resize image before upload
 * - maxWidth / maxHeight: longest edge limit
 * - quality: jpeg quality (0~1)
 * - outputType: usually image/jpeg (faster & smaller)
 */
async function resizeImageFile(
  file: File,
  {
    maxSize = 1920,
    quality = 0.82,
    outputType = "image/jpeg"
  }: {
    maxSize?: number;
    quality?: number;
    outputType?: string;
  } = {}
): Promise<File> {
  // 非图片直接返回
  if (!file.type.startsWith("image/")) return file;

  const bitmap = await createImageBitmap(file);
  const { width, height } = bitmap;

  // 不需要 resize
  if (Math.max(width, height) <= maxSize) {
    bitmap.close();
    return file;

  }

  const scale = maxSize / Math.max(width, height);
  const targetW = Math.round(width * scale);
  const targetH = Math.round(height * scale);
  console.log(
  "resize:",
  width, "x", height,
  "→",
  targetW, "x", targetH,
  "size:",
  (file.size / 1024).toFixed(1), "KB"
);

  const canvas = document.createElement("canvas");
  canvas.width = targetW;
  canvas.height = targetH;

  const ctx = canvas.getContext("2d");
  if (!ctx) {
    bitmap.close();
    return file;
  }

  ctx.drawImage(bitmap, 0, 0, targetW, targetH);
  bitmap.close();

  const blob: Blob = await new Promise((resolve) =>
    canvas.toBlob(
      (b) => resolve(b as Blob),
      outputType,
      quality
    )
  );

  return new File([blob], file.name.replace(/\.\w+$/, ".jpg"), {
    type: outputType
  });
}
