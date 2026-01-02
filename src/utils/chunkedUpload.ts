import { uploadImageToBlossom } from "./blossom";

export interface ChunkUploadOptions {
  signEvent: (evt: any) => Promise<any>;
  onProgress?: (chunkIndex: number, chunkProgress: number, totalProgress: number) => void;
  maxRetries?: number;
  retryDelayMs?: number;
}

export interface UploadedChunk {
  index: number;
  url: string;
  size: number;
}

/**
 * Upload a single chunk with retry logic (exponential backoff)
 */
async function uploadChunkWithRetry(
  chunkBlob: Blob,
  chunkIndex: number,
  options: ChunkUploadOptions
): Promise<UploadedChunk> {
  const maxRetries = options.maxRetries || 3;
  const baseDelay = options.retryDelayMs || 1000;
  
  let lastError: any;
  
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      // Create a File from Blob for upload
      const chunkFile = new File(
        [chunkBlob],
        `chunk_${chunkIndex}.bin`,
        { type: "application/octet-stream" }
      );
      
      // Upload to Blossom
      const descriptor = await uploadImageToBlossom(chunkFile, {
        includeAuthIfRequired: true,
        signEvent: options.signEvent,
        onProgress: (progress) => {
          if (options.onProgress) {
            // Report progress for this chunk
            options.onProgress(chunkIndex, progress, 0);
          }
        }
      });
      
      return {
        index: chunkIndex,
        url: descriptor.url,
        size: chunkBlob.size
      };
    } catch (error) {
      lastError = error;
      
      if (attempt < maxRetries) {
        // Exponential backoff: baseDelay * 2^attempt
        const delay = baseDelay * Math.pow(2, attempt);
        console.warn(`Chunk ${chunkIndex} upload failed (attempt ${attempt + 1}/${maxRetries + 1}), retrying in ${delay}ms...`, error);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }
  
  throw new Error(`Failed to upload chunk ${chunkIndex} after ${maxRetries + 1} attempts: ${lastError?.message || lastError}`);
}

/**
 * Upload multiple chunks in sequence with progress tracking
 */
export async function uploadChunks(
  chunks: Blob[],
  options: ChunkUploadOptions
): Promise<UploadedChunk[]> {
  const results: UploadedChunk[] = [];
  const totalChunks = chunks.length;
  
  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    
    try {
      const result = await uploadChunkWithRetry(chunk, i, {
        ...options,
        onProgress: (chunkIndex, chunkProgress, _totalProgress) => {
          if (options.onProgress) {
            // Calculate overall progress
            // 15-95% range for upload (0-15% is encryption, 95-100% is finalization)
            const baseProgress = 15;
            const uploadRange = 80;
            const completedChunks = results.length;
            const currentChunkContribution = (chunkProgress / 100) * (uploadRange / totalChunks);
            const completedContribution = (completedChunks / totalChunks) * uploadRange;
            const totalProgress = baseProgress + completedContribution + currentChunkContribution;
            
            options.onProgress(chunkIndex, chunkProgress, Math.min(95, totalProgress));
          }
        }
      });
      
      results.push(result);
    } catch (error) {
      // If any chunk fails after retries, throw error
      throw error;
    }
  }
  
  return results;
}

/**
 * Upload a single file (for small videos < 20MB)
 */
export async function uploadSingleFile(
  fileBlob: Blob,
  mimeType: string,
  options: ChunkUploadOptions
): Promise<string> {
  const file = new File([fileBlob], `video.bin`, { type: mimeType });
  
  const descriptor = await uploadImageToBlossom(file, {
    includeAuthIfRequired: true,
    signEvent: options.signEvent,
    onProgress: (progress) => {
      if (options.onProgress) {
        // Map 0-100% upload to 15-95% overall progress
        const mappedProgress = 15 + (progress * 0.8);
        options.onProgress(0, progress, mappedProgress);
      }
    }
  });
  
  return descriptor.url;
}
