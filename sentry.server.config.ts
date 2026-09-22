import * as Sentry from "@sentry/nextjs";
import { scrubEvent } from "./src/lib/observability/scrub";

const dsn = process.env.SENTRY_DSN ?? process.env.NEXT_PUBLIC_SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.APP_ENV ?? process.env.NODE_ENV,
    tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE ?? 0.1),
    sendDefaultPii: false,
    beforeSend: (event) => scrubEvent(event),
    beforeBreadcrumb: (crumb) => {
      if (crumb.category === "http" || crumb.category === "fetch") {
        const url = crumb.data?.url;
        if (typeof url === "string") crumb.data = { ...crumb.data, url: url.split("?")[0] };
      }
      return crumb;
    },
  });
}
