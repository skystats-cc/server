import * as Sentry from '@sentry/node';
import { config } from './config.js';

// Error tracking (Sentry or a self-hosted GlitchTip; both speak the Sentry protocol). Off without a DSN.
// No personal data is sent: user ids, IPs and request bodies are stripped.
export const sentryEnabled = Boolean(config.SENTRY_DSN);
if (sentryEnabled) {
  Sentry.init({
    dsn: config.SENTRY_DSN,
    environment: config.NODE_ENV,
    sendDefaultPii: false,
    beforeSend(event) {
      delete event.user;
      if (event.request) {
        delete event.request.data;
        delete event.request.cookies;
        if (event.request.headers) for (const h of ['cookie', 'authorization', 'x-api-key', 'x-bot-key', 'x-admin-key']) delete event.request.headers[h];
      }
      return event;
    },
  });
}

export function captureError(err: unknown, context: Record<string, string> = {}) {
  if (sentryEnabled) Sentry.captureException(err, { tags: context });
}
