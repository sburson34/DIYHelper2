// Thin shim over @sburson34/mobile-shared/monitoring. The shared package
// owns the reportError / reportHandledError / addBreadcrumb shapes, the
// fatal-via-withScope path, and the perf-mark helpers. Feature code in
// this app should still import from '../services/monitoring' (NOT from
// '@sburson34/mobile-shared/monitoring' directly) so per-app composition
// stays in one place if we ever need to layer DIYHelper2-specific
// behavior on top.

export {
  reportError,
  reportHandledError,
  reportWarning,
  addBreadcrumb,
  setMonitoringUser,
  clearMonitoringUser,
  setMonitoringTag,
  startPerfMark,
  endPerfMark,
  measureAsync,
} from '@sburson34/mobile-shared/monitoring';

export type {
  ReportErrorOptions,
  PerfMarkToken,
  SeverityLevel,
  UserContext,
} from '@sburson34/mobile-shared/monitoring';
