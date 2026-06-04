const Sentry = require("@sentry/node");

function initSentry() {
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) return null;

  Sentry.init({
    dsn,
    tracesSampleRate: 0.1,
    integrations: [],
  });

  return Sentry;
}

module.exports = { initSentry };
