import { generateObject } from 'ai';
import { xai, XAI_MODEL } from '../../ai/xai';
import { z } from 'zod';
import { formatSEORulesForPrompt, getDefaultSEORules } from '../../seo/rules';

const GradeSchema = z.object({
  score: z.number().min(0).max(10),
  suggestions: z.array(z.string()).optional(),
  violations: z.array(z.object({ ruleId: z.string(), note: z.string() })).optional(),
  titleFeedback: z.string().optional(),
  metaDescriptionFeedback: z.string().optional(),
  contentFeedback: z.string().optional(),
  metafieldFeedback: z.string().optional(),
  productFeedback: z.string().optional(),
});

export async function gradeDraft({
  draft,
  type = 'collection',
  platform,
  brandVoice,
  seoRules,
  metafieldDefinitions = [],
  placement,
  products = [],
  brief,
  research,
  metafieldSamples = [],
  storeName = '',
  productTypes = [],
  mode = 'create',
  liveSnapshot = null,
  gscQueries = [],
}: {
  draft: any;
  type?: string;
  platform?: string;
  brandVoice?: any;
  seoRules?: any;
  metafieldDefinitions?: any[];
  placement?: any;
  products?: any[];
  brief?: any;
  research?: any;
  metafieldSamples?: any[];
  storeName?: string;
  productTypes?: string[];
  mode?: string;
  liveSnapshot?: any;
  gscQueries?: string[];
}) {
  const bv = brandVoice ? (typeof brandVoice === 'string' ? brandVoice : brandVoice.text || '') : '';
  const intent = brief?.intent || (research && research.summary ? research.summary.slice(0, 500) : '');
  const researchSum = research?.summary || brief?.researchSummary || '';
  const content = (draft.bodyHtml || '').slice(0, 1800);
  const metaT = draft.metaTitle || '';
  const metaD = draft.metaDescription || '';
  const mfs = Array.isArray(draft.metafields) ? draft.metafields.map((m:any)=>`${m.namespace}.${m.key}:${String(m.value||'').slice(0,80)}`).join(' | ') : (draft.metafields ? Object.entries(draft.metafields).map(([k, v]) => `${k}: ${(String(v) || '').slice(0, 120)}`).join(' | ') : 'none');
  const defsStr = (metafieldDefinitions && metafieldDefinitions.length)
    ? JSON.stringify(metafieldDefinitions.map((d: any) => ({ namespace: d.namespace, key: d.key, name: d.name, type: d.type?.name, description: d.description })))
    : 'none';
  const samplesStr = (metafieldSamples && metafieldSamples.length) ? JSON.stringify(metafieldSamples.slice(0,2)).slice(0,800) : 'none';
  const prods = products.length ? products.slice(0, 6).map((p: any) => `${p.title} (/${p.handle})`).join('; ') : 'none';
  const catalogStr = [storeName, ...(productTypes || [])].filter(Boolean).join(' ');
  const rulesText = formatSEORulesForPrompt(seoRules);

  const prompt = `You are an expert SEO grader and editor coach. Grade this ${type} draft on a 0-10 scale (8.5+ is required before human approval). Use the structured SEO rules below as the STRICT rubric.

SEO RULES:
${rulesText}

Searcher intent: ${intent}
Research summary: ${researchSum}
Brand voice: ${bv}
Platform: ${platform || ''}
Catalog: ${catalogStr}

Current draft:
title: ${draft.title || ''}
handle: ${draft.handle || ''}
metaTitle: ${metaT}
  metaDescription: ${metaD}
bodyHtml (first 1800 chars): ${content}
metafields used: ${mfs}
Available metafield defs: ${defsStr}
Example values: ${samplesStr}
Available products for this job: ${prods}

Be strict. For every rule violated, include {ruleId, note} in violations array.
Return score (0-10), 3-8 specific actionable suggestions (reference ruleIds), violations array, plus short feedback strings for title, metaDescription, content, metafields, products.`;

  try {
    const { object } = await generateObject({
      model: xai(XAI_MODEL),
      schema: GradeSchema,
      prompt,
    });
    return { ...object, type, platform, brandVoice };
  } catch {
    // fallback - conservative
    const hasMetaT = !!(draft.metaTitle && draft.metaTitle.length > 10);
    const hasMetaD = !!(draft.metaDescription && draft.metaDescription.length > 30);
    let score = 5.0;
    if (hasMetaT && hasMetaD) score = 6.5;
    const length = (draft.bodyHtml || '').length;
    if (length > 400) score += 1;
    return {
      score: Math.min(7, Math.max(4, score)),
      suggestions: ['Improve metaTitle to speak directly to searcher intent and stand out', 'Populate relevant metafields (FAQs etc.) instead of long body text', 'Reference specific products from context', 'Ensure on-topic per brief (cover mustCover, avoid drift)'],
      violations: [],
      titleFeedback: hasMetaT ? 'Basic title present' : 'Lazy or missing title',
      metaDescriptionFeedback: hasMetaD ? 'Basic description' : 'Too short or generic',
      contentFeedback: 'Review for repetition and structure; check topic adherence',
      metafieldFeedback: 'Check if available structured fields were used',
      productFeedback: 'Consider adding real product mentions',
      type,
      platform,
      brandVoice,
    };
  }
}
