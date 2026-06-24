import { Storage } from '@google-cloud/storage';
import { getFirestore } from 'firebase-admin/firestore';
import { onObjectFinalized } from 'firebase-functions/v2/storage';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import sharp from 'sharp';

const storage = new Storage();

export const compressUploadedImage = onObjectFinalized(
  {
    region: 'us-west1',
    cpu: 2,
    memory: '2GiB',
  },
  async (event) => {
    const filePath = event.data.name;
    const contentType = event.data.contentType;
    const bucketName = event.data.bucket;

    // --- 1. Validation ---
    if (!contentType?.startsWith('image/')) return console.log('Skipping: Not an image.');

    if (filePath.endsWith('_compressed.webp') || filePath.endsWith('_compressed.jpg')) {
      return console.log('Skipping: Already compressed.');
    }

    // --- 2. Determine Settings ---
    let targetWidth = 0;
    let targetHeight = 0;
    let format: 'webp' | 'jpeg' = 'webp';
    let folderType = '';
    let fit: 'cover' | 'inside' = 'cover';

    if (filePath.startsWith('organizations/logos/')) {
      // Logos render at ~32pt in the app; raw uploads (multi-megapixel) cause
      // main-thread resample hangs on older iPhones, so keep them small.
      folderType = 'LOGO';
      targetWidth = 256;
      targetHeight = 256;
      format = 'webp';
      fit = 'inside';
    } else if (filePath.startsWith('organizations/') && filePath.includes('/ads/')) {
      folderType = 'AD';
      targetWidth = 1920;
      targetHeight = 1080;
      format = 'webp';
    } else if (filePath.startsWith('invite-images/')) {
      folderType = 'INVITE';
      targetWidth = 1200;
      targetHeight = 630;
      format = 'jpeg';
    } else if (filePath.startsWith('affiliates/') && filePath.endsWith('/photo.jpg')) {
      // Affiliate profile photos render as small avatars on /vp pages
      folderType = 'AFFILIATE_PHOTO';
      targetWidth = 512;
      targetHeight = 512;
      format = 'webp';
      fit = 'inside';
    } else {
      return console.log('Skipping: Path not monitored', filePath);
    }

    // --- 3. Setup Paths ---
    const bucket = storage.bucket(bucketName);
    const fileName = path.basename(filePath);
    const fileNameNoExt = path.parse(fileName).name;
    const newExt = format === 'webp' ? 'webp' : 'jpg';

    const tempFilePath = path.join(os.tmpdir(), fileName);
    const tempCompressedPath = path.join(os.tmpdir(), `${fileNameNoExt}_compressed.${newExt}`);

    const destinationDir = path.dirname(filePath);
    const compressedFileName = `${fileNameNoExt}_compressed.${newExt}`;
    const compressedFilePath = path.join(destinationDir, compressedFileName);

    try {
      // --- 4. Download ---
      await bucket.file(filePath).download({ destination: tempFilePath });

      // --- 5. Resize & Compress with Orientation Logic ---
      const imageInstance = sharp(tempFilePath);
      const metadata = await imageInstance.metadata();

      // Detect if the original is portrait
      // We check metadata.orientation because some cameras store portrait images
      // as landscape with a rotation flag. .rotate() handles this later.
      const isPortrait =
        metadata.height && metadata.width ? metadata.height > metadata.width : false;

      // Swap dimensions if portrait to maintain the intended aspect ratio.
      // Not needed for 'inside' fit (logos), which already preserves aspect ratio.
      let finalWidth = targetWidth;
      let finalHeight = targetHeight;

      if (isPortrait && fit === 'cover') {
        finalWidth = targetHeight;
        finalHeight = targetWidth;
      }

      console.log(
        `Processing ${folderType}: ${filePath} as ${isPortrait ? 'PORTRAIT' : 'LANDSCAPE'}`
      );

      const pipeline = imageInstance
        .rotate() // CRITICAL: Auto-rotates based on EXIF data (fixes sideways phone uploads)
        .resize(finalWidth, finalHeight, {
          fit,
          position: 'center',
          // Never enlarge logos; ads/invites keep their original fill behavior
          withoutEnlargement: fit === 'inside',
        });

      if (format === 'webp') {
        await pipeline.webp({ quality: 80 }).toFile(tempCompressedPath);
      } else {
        await pipeline.jpeg({ quality: 90, mozjpeg: true }).toFile(tempCompressedPath);
      }

      // --- 6. Upload Processed File ---
      await bucket.upload(tempCompressedPath, {
        destination: compressedFilePath,
        predefinedAcl: 'publicRead',
        metadata: {
          contentType: format === 'webp' ? 'image/webp' : 'image/jpeg',
          metadata: {
            originalFile: filePath,
            optimized: 'true',
            orientation: isPortrait ? 'portrait' : 'landscape',
          },
        },
      });

      // --- 6b. For affiliate photos, update the Firestore document so the stored
      // URL points to the compressed file rather than the original (which gets
      // deleted below). Path shape: affiliates/{uid}/photo.jpg; uid == authUid.
      if (folderType === 'AFFILIATE_PHOTO') {
        const publicUrl = `https://storage.googleapis.com/${bucketName}/${compressedFilePath}`;
        const uid = filePath.split('/')[1];
        if (uid) {
          const db = getFirestore();
          const snap = await db.collection('affiliates').where('authUid', '==', uid).limit(1).get();
          if (!snap.empty) {
            await snap.docs[0].ref.update({ photo: publicUrl });
          }
        }
      }

      // --- 7. Cleanup ---
      await bucket.file(filePath).delete();
      fs.unlinkSync(tempFilePath);
      fs.unlinkSync(tempCompressedPath);

      console.log(`✅ Complete: ${compressedFilePath} (${finalWidth}x${finalHeight})`);
    } catch (error) {
      console.error('Error processing image:', error);
      if (fs.existsSync(tempFilePath)) fs.unlinkSync(tempFilePath);
      if (fs.existsSync(tempCompressedPath)) fs.unlinkSync(tempCompressedPath);
    }
  }
);
