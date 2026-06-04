/**
 * Browser-specific utilities for Sentry SDKs
 *
 * @module
 */
export { getComponentName, getLocationHref, htmlTreeAsString } from './utils/browser';
export { supportsDOMError, supportsHistory, supportsNativeFetch, supportsReportingObserver } from './utils/supports';
export { XhrBreadcrumbData, XhrBreadcrumbHint } from './types-hoist/breadcrumb';
export { HandlerDataXhr, HandlerDataDom, HandlerDataHistory, SentryXhrData, SentryWrappedXMLHttpRequest, } from './types-hoist/instrument';
export { BrowserClientReplayOptions, BrowserClientProfilingOptions } from './types-hoist/browseroptions';
//# sourceMappingURL=browser-exports.d.ts.map
