import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { reportError } from '../services/monitoring';
import theme from '../theme';

/**
 * Reusable error boundary for screen-level crash isolation.
 *
 * Props:
 *   screenName  — identifies which boundary caught the error in Sentry
 *   onReset     — optional callback; if provided the fallback shows a retry button
 *   fallback    — optional custom fallback component: (error, reset) => JSX
 */
export default class ScreenErrorBoundary extends React.Component {
  state = { error: null };

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    reportError(error, {
      source: this.props.screenName || 'ScreenErrorBoundary',
      operation: 'render',
      extra: { componentStack: info?.componentStack?.slice(0, 1000) },
    });
  }

  reset = () => {
    this.setState({ error: null });
    this.props.onReset?.();
  };

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    if (this.props.fallback) {
      return this.props.fallback(error, this.reset);
    }

    return (
      <View style={styles.container}>
        <Text style={styles.icon}>!</Text>
        <Text style={styles.title}>Something went wrong</Text>
        <Text style={styles.body}>
          This section ran into a problem. The error has been reported automatically.
        </Text>
        <TouchableOpacity style={styles.button} onPress={this.reset}>
          <Text style={styles.buttonText}>Try again</Text>
        </TouchableOpacity>
      </View>
    );
  }
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
    backgroundColor: theme.colors.background,
  },
  icon: {
    fontSize: 48,
    fontWeight: '900',
    color: theme.colors.danger,
    width: 72,
    height: 72,
    lineHeight: 72,
    textAlign: 'center',
    borderRadius: 36,
    backgroundColor: theme.colors.danger + '15',
    marginBottom: 20,
    overflow: 'hidden',
  },
  title: {
    fontSize: 20,
    fontWeight: '700',
    color: theme.colors.text,
    marginBottom: 8,
  },
  body: {
    fontSize: 14,
    color: theme.colors.textSecondary,
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: 24,
    maxWidth: 280,
  },
  button: {
    paddingHorizontal: 28,
    paddingVertical: 14,
    borderRadius: theme.roundness.medium,
    backgroundColor: theme.colors.primary,
  },
  buttonText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#FFFFFF',
  },
});
