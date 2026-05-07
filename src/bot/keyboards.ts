import { InlineKeyboard } from 'grammy';
import type { CampaignVariant } from '../services/ai/prompts/search-campaign.js';

/** Carousel of 3 variants — one button per variant, plus "reject all". */
export function variantsKeyboard(approvalId: string, variants: CampaignVariant[]): InlineKeyboard {
  const kb = new InlineKeyboard();
  variants.forEach((v, i) => {
    kb.text(`${i + 1}. ${v.title}`, `select|${approvalId}|${v.variant_id}`).row();
  });
  kb.text('❌ Отклонить все', `reject|${approvalId}`);
  return kb;
}

/**
 * After variant selected — apply / revise / reject.
 * If `hasViolations`, primary button is "shrink" instead of "apply".
 */
export function variantActionsKeyboard(
  approvalId: string,
  hasViolations = false
): InlineKeyboard {
  const kb = new InlineKeyboard();
  if (hasViolations) {
    kb.text('✂️ Сократить через ИИ', `shrink|${approvalId}`).row();
  } else {
    kb.text('✅ Применить в Директ', `apply|${approvalId}`).row();
  }
  return kb
    .text('✏️ Изменить', `revise|${approvalId}`)
    .text('🔄 Сменить вариант', `back|${approvalId}`)
    .row()
    .text('❌ Отклонить', `reject|${approvalId}`);
}

/** CPL choice — let AI suggest or enter manually. */
export function cplChoiceKeyboard(approvalId: string): InlineKeyboard {
  return new InlineKeyboard()
    .text('💡 Предложить ИИ', `cpl_ai|${approvalId}`)
    .text('✍️ Ввести вручную', `cpl_manual|${approvalId}`);
}

/** After AI suggested CPL — accept / change. */
export function cplSuggestionKeyboard(approvalId: string): InlineKeyboard {
  return new InlineKeyboard()
    .text('✅ Принять', `cpl_accept|${approvalId}`)
    .text('✍️ Ввести своё', `cpl_manual|${approvalId}`);
}

/** РСЯ image-source choice for a new campaign. */
export function imageRequestKeyboard(bankSize: number): InlineKeyboard {
  const kb = new InlineKeyboard().text('📤 Загрузить картинку', 'img_upload').row();
  if (bankSize > 0) {
    kb.text(`🗂 Из банка (${bankSize})`, 'img_bank').row();
  }
  return kb.text('➡️ Без картинки', 'img_skip');
}

/** Carousel of bank images for selection (one button per image, by hash). */
export function bankImagesKeyboard(
  images: Array<{ hash: string; description: string | null; name: string | null }>
): InlineKeyboard {
  const kb = new InlineKeyboard();
  for (const img of images.slice(0, 12)) {
    const label = (img.description ?? img.name ?? img.hash).slice(0, 40);
    kb.text(label, `img_pick|${img.hash}`).row();
  }
  kb.text('↩️ Назад', 'img_back');
  return kb;
}

/** Per-image actions (view / rename / delete) in /images management. */
export function imageManageKeyboard(hash: string): InlineKeyboard {
  return new InlineKeyboard()
    .text('✏️ Переименовать', `img_rename|${hash}`)
    .text('🗑 Удалить', `img_del|${hash}`);
}
