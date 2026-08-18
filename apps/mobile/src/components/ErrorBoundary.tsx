import { Component, type ErrorInfo, type ReactNode } from 'react';
import { router } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { logger } from '@/lib/logger';
import { authStorage } from '@/storage/auth-storage';

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  error: Error | null;
}

/**
 * Top-level crash barrier. Wraps the OUTERMOST element of the root layout —
 * outside every provider — so a throw from any of them (theme, auth, query)
 * still lands here.
 *
 * Without it a single render throw unmounts the whole tree and leaves a blank,
 * input-dead screen with the JS thread still alive: the app looks frozen
 * rather than crashed. That is what App Store review saw on build 19
 * ("app was unresponsive after log in", 2.1(a)) — the reviewer had no way
 * back and no way out.
 *
 * The fallback deliberately uses hardcoded colours and no hooks: it must
 * render even when the providers it wraps are the thing that failed.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  override state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  override componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    logger.error('render_error_boundary_caught', {
      message: error.message,
      componentStack: errorInfo.componentStack ?? null,
    });
  }

  private handleRetry = (): void => {
    this.setState({ error: null });
  };

  /**
   * Escape hatch when retrying keeps hitting the same throw — a corrupt
   * session is the likeliest cause, so drop the tokens and send the user
   * back to a screen that renders from scratch.
   */
  private handleSignOut = (): void => {
    void authStorage
      .clearTokens()
      .catch((error: unknown) => {
        logger.error('render_error_boundary_sign_out_failed', {
          message: error instanceof Error ? error.message : String(error),
        });
      })
      .finally(() => {
        this.setState({ error: null });
        router.replace('/(auth)/login');
      });
  };

  override render(): ReactNode {
    const { error } = this.state;

    if (!error) {
      return this.props.children;
    }

    return (
      <View style={styles.container} testID="error-boundary-fallback">
        <ScrollView contentContainerStyle={styles.content}>
          <Text style={styles.title}>Something went wrong</Text>
          <Text style={styles.message}>{error.message}</Text>

          <Pressable
            style={styles.primaryButton}
            onPress={this.handleRetry}
            testID="error-boundary-retry"
          >
            <Text style={styles.primaryButtonLabel}>Try again</Text>
          </Pressable>

          <Pressable
            style={styles.secondaryButton}
            onPress={this.handleSignOut}
            testID="error-boundary-sign-out"
          >
            <Text style={styles.secondaryButtonLabel}>Sign out</Text>
          </Pressable>
        </ScrollView>
      </View>
    );
  }
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F6F1E8',
  },
  content: {
    flexGrow: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
    paddingVertical: 48,
    gap: 12,
  },
  title: {
    fontSize: 22,
    fontWeight: '600',
    color: '#1C1A14',
    textAlign: 'center',
  },
  message: {
    fontSize: 14,
    lineHeight: 20,
    color: '#1C1A14',
    opacity: 0.7,
    textAlign: 'center',
    marginBottom: 12,
  },
  primaryButton: {
    minWidth: 200,
    paddingHorizontal: 24,
    paddingVertical: 14,
    borderRadius: 999,
    backgroundColor: '#1C1A14',
    alignItems: 'center',
  },
  primaryButtonLabel: {
    fontSize: 15,
    fontWeight: '600',
    color: '#F6F1E8',
  },
  secondaryButton: {
    minWidth: 200,
    paddingHorizontal: 24,
    paddingVertical: 14,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#1C1A14',
    alignItems: 'center',
  },
  secondaryButtonLabel: {
    fontSize: 15,
    fontWeight: '600',
    color: '#1C1A14',
  },
});
