export interface ImageCompressionOptions {
  maxWidth?: number;
  maxHeight?: number;
  quality?: number;
  mimeType?: string;
}

/**
 * Compresses and resizes an image file directly in the browser using HTML5 Canvas.
 * Significantly speeds up uploads by shrinking 5MB-10MB camera/raw photos to ~150KB-300KB.
 */
export async function compressAndResizeImage(
  file: File,
  options: ImageCompressionOptions = {},
): Promise<File> {
  // If not an image or is SVG/GIF (which we shouldn't rasterize to JPEG), return original
  if (!file.type.startsWith('image/') || file.type === 'image/svg+xml' || file.type === 'image/gif') {
    return file;
  }

  const {
    maxWidth = 1200,
    maxHeight = 1200,
    quality = 0.82,
    mimeType = 'image/jpeg',
  } = options;

  return new Promise<File>((resolve) => {
    const objectUrl = URL.createObjectURL(file);
    const img = new Image();

    img.onload = () => {
      URL.revokeObjectURL(objectUrl);

      let { width, height } = img;

      // Calculate proportional new dimensions
      if (width > maxWidth || height > maxHeight) {
        if (width / height > maxWidth / maxHeight) {
          height = Math.round((height * maxWidth) / width);
          width = maxWidth;
        } else {
          width = Math.round((width * maxHeight) / height);
          height = maxHeight;
        }
      }

      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, width);
      canvas.height = Math.max(1, height);

      const ctx = canvas.getContext('2d');
      if (!ctx) {
        resolve(file);
        return;
      }

      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';

      // Fill with white background so transparent PNGs don't have black background when converted to JPEG
      if (mimeType === 'image/jpeg') {
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
      }

      ctx.drawImage(img, 0, 0, width, height);

      canvas.toBlob(
        (blob) => {
          if (!blob) {
            resolve(file);
            return;
          }

          // If compression somehow produced a larger file than small original, use original
          if (blob.size >= file.size && file.size < 500 * 1024) {
            resolve(file);
            return;
          }

          const originalName = file.name.replace(/\.[^/.]+$/, '');
          const extension = mimeType === 'image/webp' ? '.webp' : '.jpg';
          const newFileName = `${originalName}${extension}`;

          const compressedFile = new File([blob], newFileName, {
            type: mimeType,
            lastModified: Date.now(),
          });

          resolve(compressedFile);
        },
        mimeType,
        quality,
      );
    };

    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(file); // Fallback to original file on error
    };

    img.src = objectUrl;
  });
}

/**
 * Compresses multiple images in parallel.
 */
export async function compressImages(
  files: File[],
  options?: ImageCompressionOptions,
): Promise<File[]> {
  return Promise.all(files.map((file) => compressAndResizeImage(file, options)));
}
