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

/** After variant selected — apply / revise / reject. */
export function variantActionsKeyboard(approvalId: string): InlineKeyboard {
  return new InlineKeyboard()
    .text('✅ Применить в Директ', `apply|${approvalId}`)
    .row()
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
