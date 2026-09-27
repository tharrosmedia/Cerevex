export type SeoMetafieldInput = { namespace: 'global'; key: 'title_tag' | 'description_tag'; type: 'single_line_text_field'; value: string };

/**
 * Pages and articles have no `seo` input in the Admin API; the storefront reads
 * `global.title_tag` / `global.description_tag` metafields instead.
 */
export function seoMetafields(seoTitle?: string | null, seoDescription?: string | null): SeoMetafieldInput[] {
  const out: SeoMetafieldInput[] = [];
  const title = seoTitle?.trim();
  const description = seoDescription?.trim();
  if (title) out.push({ namespace: 'global', key: 'title_tag', type: 'single_line_text_field', value: title });
  if (description) out.push({ namespace: 'global', key: 'description_tag', type: 'single_line_text_field', value: description });
  return out;
}
