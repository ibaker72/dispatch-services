import "server-only";
import {
  businessToday,
  dailyOperationsSummary,
  documentExpirationReminders,
  invoiceReminders,
  onboardingReminders,
  retryFailedNotifications,
  staleApplicationFollowUp,
  weeklyStatements,
} from "@/lib/jobs/handlers";
import type { JobResult } from "@/lib/jobs/runner";
import { previousWeekStart } from "@/lib/domain/dates";
import { getOperationsSettings } from "@/lib/settings";

export interface JobDefinition {
  /** Human description for the admin UI and docs. */
  description: string;
  /** UTC cron schedule used in vercel.json. */
  schedule: string;
  /** Idempotency key for one run (e.g. the business date). */
  runKey: (now: Date) => Promise<string>;
  handler: (now: Date) => Promise<JobResult>;
}

const daily = async (now: Date) => businessToday(now);

export const JOBS: Record<string, JobDefinition> = {
  "document-expiration-reminders": {
    description: "Email reminders before tracked documents expire; mark expired documents",
    schedule: "0 13 * * *",
    runKey: daily,
    handler: async (now) => documentExpirationReminders(await businessToday(now)),
  },
  "weekly-statements": {
    description: "Generate last week's statements (and issue them if auto-issue is on)",
    schedule: "0 12 * * 1",
    runKey: async (now) => previousWeekStart(now, (await getOperationsSettings()).timezone),
    handler: weeklyStatements,
  },
  "invoice-reminders": {
    description: "Invoice due and overdue reminders",
    schedule: "0 14 * * *",
    runKey: daily,
    handler: async (now) => invoiceReminders(await businessToday(now)),
  },
  "stale-application-follow-up": {
    description: "Tasks for unreviewed applications and reminders for requested information",
    schedule: "0 15 * * *",
    runKey: daily,
    handler: staleApplicationFollowUp,
  },
  "onboarding-reminders": {
    description: "Missing-document reminders for carriers in onboarding",
    schedule: "30 14 * * *",
    runKey: daily,
    handler: async (now) => onboardingReminders(await businessToday(now)),
  },
  "daily-operations-summary": {
    description: "Morning operations summary for administrators",
    schedule: "0 11 * * *",
    runKey: daily,
    handler: async (now) => dailyOperationsSummary(await businessToday(now)),
  },
  "retry-failed-notifications": {
    description: "Retry failed emails with backoff",
    schedule: "0 * * * *",
    runKey: async (now) => now.toISOString().slice(0, 13),
    handler: retryFailedNotifications,
  },
};
