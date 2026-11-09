export const WEBHOOK_QUEUE = 'webhooks';
export const SCHEDULE_QUEUE = 'scheduled-changes';

export interface WebhookJob {
  webhookId: string;
  event: WebhookEvent;
}

export interface ScheduleJob {
  scheduleId: string;
}

/** The JSON body a webhook receiver gets. */
export interface WebhookEvent {
  id: string;
  type: string;
  createdAt: string;
  project: string | null;
  environment: string | null;
  resource: { type: string; key: string };
  actor: { type: string; label: string };
  before: unknown;
  after: unknown;
}
