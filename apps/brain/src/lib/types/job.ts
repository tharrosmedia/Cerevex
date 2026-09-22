export type JobDomain = 'seo' | 'ads' | 'fulfillment' | 'customer-service' | 'inventory';
export type JobStatus =
  | 'pending'
  | 'queued'
  | 'running'
  | 'awaiting_approval'
  | 'approved'
  | 'rejected'
  | 'completed'
  | 'failed';

export interface Job {
  id: string;
  storeId: string;
  domain: JobDomain;
  type: string;
  status: JobStatus;
  input: Record<string, unknown>;
  output?: Record<string, unknown>;
}
