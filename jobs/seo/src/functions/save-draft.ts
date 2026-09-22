import { inngest } from '../client';
import { saveDraft } from '@brain/lib/db/drafts';

export const saveDraftFn = inngest.createFunction(
  { id: 'seo-save-draft', retries: 2, triggers: [{ event: 'seo/save-draft' }] },
  async ({ event, step }: any) => {
    const data = event.data;
    return await step.run('save-draft', async () => {
      return saveDraft({
        jobId: data.jobId,
        storeId: data.storeId,
        title: data.title,
        handle: data.handle,
        bodyHtml: data.bodyHtml,
        metaTitle: data.metaTitle,
        metaDescription: data.metaDescription,
        metafields: data.metafields,
        schemaJsonLd: data.schemaJsonLd,
        evaluationScores: data.evaluationScores,
        rawResearch: data.rawResearch,
        selectedProducts: data.selectedProducts,
        collectionRules: data.collectionRules,
        brief: data.brief,
      });
    });
  }
);
