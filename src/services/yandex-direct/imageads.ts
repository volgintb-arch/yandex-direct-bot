import { direct } from './client.js';

export interface AdImageSummary {
  AdImageHash: string;
  OriginalUrl?: string;
  PreviewUrl?: string;
  Name?: string;
  Type?: string; // REGULAR | WIDE | ...
  Subtype?: string;
  AssociatedWith?: string; // CAMPAIGN | AD | NONE
}

interface GetAdImagesResponse {
  AdImages?: AdImageSummary[];
}

/** List all images uploaded to the Direct account. */
export async function listAdImages(): Promise<AdImageSummary[]> {
  const r = await direct<GetAdImagesResponse>('adimages', 'get', {
    SelectionCriteria: {},
    FieldNames: ['AdImageHash', 'OriginalUrl', 'PreviewUrl', 'Name', 'Type', 'Subtype', 'AssociatedWith'],
  });
  return r.AdImages ?? [];
}

interface AddAdImagesResponse {
  AddResults: Array<{
    AdImageHash?: string;
    Errors?: Array<{ Code: number; Message: string }>;
  }>;
}

/**
 * Upload an image to the Direct account image bank.
 * `imageData` is base64-encoded image content.
 */
export async function uploadAdImage(input: {
  imageBase64: string;
  name?: string;
}): Promise<string> {
  const r = await direct<AddAdImagesResponse>('adimages', 'add', {
    AdImages: [
      {
        ImageData: input.imageBase64,
        Name: input.name,
      },
    ],
  });
  const result = r.AddResults?.[0];
  if (!result?.AdImageHash) {
    throw new Error(
      `Failed to upload image: ${result?.Errors?.map((e) => e.Message).join('; ') ?? 'unknown'}`
    );
  }
  return result.AdImageHash;
}
