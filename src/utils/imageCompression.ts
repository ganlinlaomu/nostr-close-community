/**
 * 智能图片压缩工具
 * 
 * 压缩策略：
 * 1. 目标大小：200KB - 300KB
 * 2. 如果原图 < 200KB，直接返回原图（不放大）
 * 3. 如果原图 >= 200KB，通过迭代调整质量和尺寸进行压缩
 * 4. 压缩算法：
 *    - 第一阶段：保持尺寸，降低质量（0.9 -> 0.5）
 *    - 第二阶段：同时降低尺寸和质量
 * 5. 保留 EXIF 方向信息（通过 canvas 处理）
 * 
 * @param file - 待压缩的图片文件
 * @returns 压缩后的文件
 */

const MIN_TARGET_SIZE = 200 * 1024; // 200KB
const MAX_TARGET_SIZE = 300 * 1024; // 300KB
const MAX_ITERATIONS = 10; // 最大迭代次数

interface CompressionOptions {
  minTargetSize?: number;
  maxTargetSize?: number;
  maxIterations?: number;
}

interface CompressionResult {
  file: File;
  originalSize: number;
  compressedSize: number;
  compressionRatio: number;
  iterations: number;
}

/**
 * 压缩图片到目标大小范围
 */
export async function compressImageToTargetSize(
  file: File,
  options: CompressionOptions = {}
): Promise<CompressionResult> {
  const minTargetSize = options.minTargetSize ?? MIN_TARGET_SIZE;
  const maxTargetSize = options.maxTargetSize ?? MAX_TARGET_SIZE;
  const maxIterations = options.maxIterations ?? MAX_ITERATIONS;

  const originalSize = file.size;

  // 如果不是图片文件，直接返回
  if (!file.type.startsWith("image/")) {
    console.warn("非图片文件，跳过压缩:", file.type);
    return {
      file,
      originalSize,
      compressedSize: originalSize,
      compressionRatio: 1,
      iterations: 0
    };
  }

  // 如果原图已经小于最小目标大小，直接返回原图（不放大）
  if (originalSize <= minTargetSize) {
    console.log(`原图大小 ${(originalSize / 1024).toFixed(1)}KB 已小于目标 ${(minTargetSize / 1024).toFixed(0)}KB，无需压缩`);
    return {
      file,
      originalSize,
      compressedSize: originalSize,
      compressionRatio: 1,
      iterations: 0
    };
  }

  // 如果原图在目标范围内，也直接返回
  if (originalSize >= minTargetSize && originalSize <= maxTargetSize) {
    console.log(`原图大小 ${(originalSize / 1024).toFixed(1)}KB 已在目标范围内，无需压缩`);
    return {
      file,
      originalSize,
      compressedSize: originalSize,
      compressionRatio: 1,
      iterations: 0
    };
  }

  try {
    // 加载图片
    const bitmap = await createImageBitmap(file);
    const { width, height } = bitmap;

    console.log(`开始压缩: ${file.name}, 原始大小: ${(originalSize / 1024).toFixed(1)}KB, 尺寸: ${width}x${height}`);

    // 初始化压缩参数
    let quality = 0.85; // 起始质量
    let scale = 1.0; // 起始缩放比例
    let currentSize = originalSize;
    let bestResult: { blob: Blob; size: number } | null = null;
    let iteration = 0;

    // 迭代压缩直到达到目标大小或达到最大迭代次数
    while (iteration < maxIterations) {
      iteration++;

      // 计算当前尺寸
      const targetWidth = Math.round(width * scale);
      const targetHeight = Math.round(height * scale);

      // 创建 canvas 并绘制图片
      const canvas = document.createElement("canvas");
      canvas.width = targetWidth;
      canvas.height = targetHeight;

      const ctx = canvas.getContext("2d");
      if (!ctx) {
        throw new Error("无法创建 Canvas 上下文");
      }

      // 使用高质量缩放算法
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(bitmap, 0, 0, targetWidth, targetHeight);

      // 转换为 Blob
      const blob = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob(
          (b) => {
            if (b) {
              resolve(b);
            } else {
              reject(new Error("Canvas toBlob 失败"));
            }
          },
          "image/jpeg",
          quality
        );
      });

      currentSize = blob.size;

      console.log(
        `迭代 ${iteration}: 质量=${quality.toFixed(2)}, 缩放=${scale.toFixed(2)}, ` +
        `尺寸=${targetWidth}x${targetHeight}, 大小=${(currentSize / 1024).toFixed(1)}KB`
      );

      // 如果当前大小在目标范围内，保存结果
      if (currentSize >= minTargetSize && currentSize <= maxTargetSize) {
        bestResult = { blob, size: currentSize };
        console.log(`✓ 压缩成功: ${(currentSize / 1024).toFixed(1)}KB 在目标范围内`);
        break;
      }

      // 如果当前大小接近目标范围但稍微超出，也保存为最佳结果
      if (currentSize < minTargetSize * 1.5 && (!bestResult || Math.abs(currentSize - minTargetSize) < Math.abs(bestResult.size - minTargetSize))) {
        bestResult = { blob, size: currentSize };
      }

      // 调整压缩参数
      if (currentSize > maxTargetSize) {
        // 当前太大，需要进一步压缩
        if (quality > 0.5) {
          // 优先降低质量
          quality = Math.max(0.5, quality - 0.1);
        } else if (scale > 0.5) {
          // 质量已经很低，开始缩小尺寸
          scale = Math.max(0.5, scale - 0.1);
        } else {
          // 两者都已达到下限，同时调整
          quality = Math.max(0.3, quality - 0.05);
          scale = Math.max(0.3, scale - 0.05);
        }
      } else {
        // 当前太小，停止迭代（避免过度压缩）
        console.log("当前大小已小于目标范围，停止迭代");
        break;
      }
    }

    bitmap.close();

    // 如果没有找到合适的结果，使用最后一次的结果
    if (!bestResult) {
      console.warn("未能压缩到目标范围，使用最接近的结果");
      // 重新执行最后一次压缩
      const canvas = document.createElement("canvas");
      const targetWidth = Math.round(width * scale);
      const targetHeight = Math.round(height * scale);
      canvas.width = targetWidth;
      canvas.height = targetHeight;
      const ctx = canvas.getContext("2d");
      if (ctx) {
        const bitmap2 = await createImageBitmap(file);
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = "high";
        ctx.drawImage(bitmap2, 0, 0, targetWidth, targetHeight);
        bitmap2.close();
        const blob = await new Promise<Blob>((resolve, reject) => {
          canvas.toBlob(
            (b) => b ? resolve(b) : reject(new Error("Canvas toBlob 失败")),
            "image/jpeg",
            quality
          );
        });
        bestResult = { blob, size: blob.size };
      }
    }

    if (!bestResult) {
      throw new Error("压缩失败");
    }

    // 创建新文件
    const compressedFile = new File(
      [bestResult.blob],
      file.name.replace(/\.\w+$/, ".jpg"),
      { type: "image/jpeg" }
    );

    const compressionRatio = bestResult.size / originalSize;

    console.log(
      `压缩完成: ${(originalSize / 1024).toFixed(1)}KB -> ${(bestResult.size / 1024).toFixed(1)}KB ` +
      `(${(compressionRatio * 100).toFixed(1)}%), 迭代次数: ${iteration}`
    );

    return {
      file: compressedFile,
      originalSize,
      compressedSize: bestResult.size,
      compressionRatio,
      iterations: iteration
    };
  } catch (error) {
    console.error("图片压缩失败，返回原图:", error);
    // 压缩失败时的兜底策略：返回原图
    return {
      file,
      originalSize,
      compressedSize: originalSize,
      compressionRatio: 1,
      iterations: 0
    };
  }
}

/**
 * 批量压缩图片
 */
export async function compressImages(
  files: File[],
  options: CompressionOptions = {}
): Promise<CompressionResult[]> {
  const results: CompressionResult[] = [];
  
  for (const file of files) {
    const result = await compressImageToTargetSize(file, options);
    results.push(result);
  }
  
  return results;
}
