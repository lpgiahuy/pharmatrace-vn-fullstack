import { Injectable, Logger } from '@nestjs/common';
import { v2 as cloudinary, UploadApiResponse, UploadApiErrorResponse } from 'cloudinary';
import { Readable } from 'stream';

export type PrivateImageUpload = {
  publicId: string;
  bytes: number;
  width: number;
  height: number;
};

@Injectable()
export class CloudinaryService {
  private readonly logger = new Logger(CloudinaryService.name);

  constructor() {
    const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
    const apiKey = process.env.CLOUDINARY_API_KEY;
    const apiSecret = process.env.CLOUDINARY_API_SECRET;
    if (!cloudName || !apiKey || !apiSecret) {
      throw new Error('Cloudinary configuration is required');
    }
    cloudinary.config({
      cloud_name: cloudName,
      api_key: apiKey,
      api_secret: apiSecret,
    });
  }

  async uploadImage(
    file: { buffer: Buffer; mimetype?: string; originalname?: string },
    folder: string = 'pharmatrace/products',
  ): Promise<UploadApiResponse> {
    return new Promise((resolve, reject) => {
      const uploadStream = cloudinary.uploader.upload_stream(
        {
          folder,
          resource_type: 'image',
          transformation: [{ quality: 'auto', fetch_format: 'auto' }],
        },
        (error?: UploadApiErrorResponse, result?: UploadApiResponse) => {
          if (error) {
            this.logger.error('Cloudinary upload error:', error);
            return reject(new Error(error.message, { cause: error }));
          }
          if (!result) {
            return reject(new Error('Cloudinary upload failed with empty result'));
          }
          resolve(result);
        },
      );

      const readableStream = new Readable();
      readableStream.push(file.buffer);
      readableStream.push(null);
      readableStream.pipe(uploadStream);
    });
  }

  async uploadPrivateImage(buffer: Buffer, folder: string): Promise<PrivateImageUpload> {
    const result = await new Promise<UploadApiResponse>((resolve, reject) => {
      const uploadStream = cloudinary.uploader.upload_stream(
        {
          folder,
          resource_type: 'image',
          type: 'authenticated',
          format: 'webp',
          overwrite: false,
        },
        (error?: UploadApiErrorResponse, response?: UploadApiResponse) => {
          if (error) {
            this.logger.error('Cloudinary prescription upload error:', error);
            reject(new Error(error.message, { cause: error }));
            return;
          }
          if (!response) {
            reject(new Error('Cloudinary upload failed with empty result'));
            return;
          }
          resolve(response);
        },
      );

      Readable.from(buffer).pipe(uploadStream);
    });

    return {
      publicId: result.public_id,
      bytes: result.bytes,
      width: result.width,
      height: result.height,
    };
  }

  async downloadPrivateImage(publicId: string): Promise<Buffer> {
    const url = cloudinary.utils.private_download_url(publicId, 'webp', {
      resource_type: 'image',
      type: 'authenticated',
      expires_at: Math.floor(Date.now() / 1000) + 60,
    });
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Cloudinary image download failed with status ${response.status}`);
    }
    return Buffer.from(await response.arrayBuffer());
  }

  async deletePrivateImage(publicId: string): Promise<void> {
    await cloudinary.uploader.destroy(publicId, {
      resource_type: 'image',
      type: 'authenticated',
      invalidate: true,
    });
  }

  async deleteImage(publicIdOrUrl: string): Promise<void> {
    try {
      let publicId = publicIdOrUrl;
      if (publicIdOrUrl.startsWith('http://') || publicIdOrUrl.startsWith('https://')) {
        const match = publicIdOrUrl.match(/\/upload\/(?:v\d+\/)?([^.]+)/);
        if (match && match[1]) {
          publicId = match[1];
        }
      }
      await cloudinary.uploader.destroy(publicId, {
        resource_type: 'image',
        invalidate: true,
      });
      this.logger.log(`Deleted Cloudinary product image: ${publicId}`);
    } catch (error) {
      this.logger.warn(`Failed to delete Cloudinary image: ${publicIdOrUrl}`, error);
    }
  }
}
