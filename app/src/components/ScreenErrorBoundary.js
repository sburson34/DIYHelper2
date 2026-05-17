// Thin wrapper around the shared ScreenErrorBoundary that injects this
// app's theme. The shared boundary reports via captureException from
// @sburson34/mobile-shared/sentry, which is the same path our local
// monitoring.reportError ultimately uses — so telemetry is preserved.

import React from 'react';
import { ScreenErrorBoundary as SharedScreenErrorBoundary } from '@sburson34/mobile-shared/error-boundary';
import theme from '../theme';

const boundaryTheme = {
  background: theme.colors.background,
  text: theme.colors.text,
  textSecondary: theme.colors.textSecondary,
  danger: theme.colors.danger,
  primary: theme.colors.primary,
  buttonText: '#FFFFFF',
  roundness: theme.roundness.medium,
};

export default function ScreenErrorBoundary(props) {
  return <SharedScreenErrorBoundary theme={boundaryTheme} {...props} />;
}
