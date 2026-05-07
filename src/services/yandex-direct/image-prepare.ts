import sharp from 'sharp';
import { logger } from '../../lib/logger.js';

/**
 * Yandex Direct accepts a fixed set of aspect ratios for РСЯ images.
 * REGULAR: 1:1, 4:3 / 3:4, 4:5
 * WIDE:    16:9 (one side ≥ 1080)
 *
 * We auto-fit any input to the closest supported target by center-cropping
 * to that aspect ratio, then upscaling/downscaling to the canonical size.
 */

interface Target {
  name: string;
  ratio: number; // width / height
  width: number;
  height: number;
}

// Yandex Direct TextImageAd: canonical WIDE format is 1080×607 (16:9-ish).
// Larger 16:9 sizes get rejected with "Размер изображения не соответствует типу объявления".
const TARGETS: Target[] = [
  { name: '16:9 WIDE', ratio: 1080 / 607, width: 1080, height: 607 },
];

export interface PrepareResult {
  buffer: Buffer;
  width: number;
  height: number;
  target: Target;
  originalWidth: number;
  originalHeight: number;
}

/**
 * Crop + resize to nearest supported aspect ratio. Always emits JPEG (quality 90)
 * because Direct accepts JPEG universally and it's compact.
 */
export async function prepareForDirect(input: Buffer): Promise<PrepareResult> {
  const img = sharp(input, { failOn: 'none' });
  const meta = await img.metadata();
  if (!meta.width || !meta.height) {
    throw new Error('Не удалось прочитать размеры картинки');
  }
  const srcRatio = meta.width / meta.height;

  // Pick target whose ratio is closest to source.
  let best = TARGETS[0]!;
  let bestDiff = Math.abs(srcRatio - best.ratio);
  for (const t of TARGETS) {
    const d = Math.abs(srcRatio - t.ratio);
    if (d < bestDiff) {
      best = t;
      bestDiff = d;
    }
  }

  // Direct's hard minimums (REGULAR 450×450 / WIDE 1080×607). Don't accept
  // images so small that even max-quality upscale won't satisfy Direct.
  if (meta.width < 450 || meta.height < 450) {
    throw new Error(
      `Картинка слишком маленькая (${meta.width}×${meta.height}). Минимум 450×450.`
    );
  }

  // Compose: cover-crop to target ratio, then resize to canonical dimensions.
  const out = await sharp(input, { failOn: 'none' })
    .resize(best.width, best.height, { fit: 'cover', position: 'attention' })
    .jpeg({ quality: 90, mozjpeg: true })
    .toBuffer();

  logger.info(
    {
      from: `${meta.width}×${meta.height} (ratio ${srcRatio.toFixed(2)})`,
      to: `${best.width}×${best.height} (${best.name})`,
      bytes: out.length,
    },
    'image prepared for Direct'
  );

  return {
    buffer: out,
    width: best.width,
    height: best.height,
    target: best,
    originalWidth: meta.width,
    originalHeight: meta.height,
  };
}
