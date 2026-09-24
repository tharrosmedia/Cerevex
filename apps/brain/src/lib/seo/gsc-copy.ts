/**
 * Operator-facing Search recommendation copy (GSC Recommendations Brief 1.1).
 * Product standby for final polish — ship the brief's placeholder, no SEO jargon.
 */

export const GSC_POSITION_EDUCATION =
  'Google often tests your page in different spots between about position 5 and position 1 while it decides whether you deserve a higher place. Sites usually only settle above about position 5 when the page is more useful to the person searching than what is already ranking there. Raising rank without making the page more useful (and more likely to convert) does not stick.';

export const GSC_POSITION_EDUCATION_SHORT =
  'Google often tests pages between about position 5 and 1. A higher spot usually only sticks when the page is more useful — and more likely to convert — than what is already there.';

export const GSC_REC_TYPE_LABELS = {
  gsc_u: 'Update this page',
  gsc_n: 'Create a page for this search',
  gsc_c: 'Combine overlapping pages',
  gsc_a: 'Realign this page to what people search',
} as const;

export type GscRecTypeId = keyof typeof GSC_REC_TYPE_LABELS;

export const GSC_REC_TYPE_HELP = {
  gsc_u: 'This page gets searches but sits farther down than the cutoff you set. Improve usefulness and the offer — not rank for its own sake.',
  gsc_n: 'People search this, and you do not have a page that can convert that request.',
  gsc_c: 'More than one page is answering the same search. Keep the one that can convert.',
  gsc_a: 'What people search and what this page says do not match.',
} as const;

export const GSC_RECOMMEND_ONLY_COPY =
  'Recommend only — nothing will be written to the site until Search recommendation apply is on and the write block is off.';

export const GSC_APPLY_OFF_REVIEW_COPY =
  'Approve will keep this draft. It will not write Shopify or WordPress while Search recommendation apply is off or the write block is on.';

export const GSC_KILL_SWITCH_HELP =
  'When this block is on, Approve never writes the site — even if the apply flag is on. Deny and Snooze never write.';

export const GSC_THRESHOLD_HELP =
  '“Update this page” uses this cutoff. Soft start is worse than 3. You can raise or lower it. It is saved for this store.';

export function gscRecTypeLabel(id: string | null | undefined): string {
  if (id && id in GSC_REC_TYPE_LABELS) return GSC_REC_TYPE_LABELS[id as GscRecTypeId];
  return 'Search recommendation';
}
