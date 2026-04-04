import { View, Text, StyleSheet, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { PipelineStep } from '../types';
import { PIPELINE_STEPS } from '../types';

interface UploadProgressProps {
  uploadProgress: number;
  currentStep: PipelineStep;
  error?: string | null;
}

function getStepStatus(
  stepKey: PipelineStep,
  currentStep: PipelineStep,
): 'completed' | 'active' | 'pending' | 'failed' {
  if (currentStep === 'failed') {
    const currentIndex = PIPELINE_STEPS.findIndex((s) => s.key === currentStep);
    const stepIndex = PIPELINE_STEPS.findIndex((s) => s.key === stepKey);
    if (stepIndex < currentIndex) return 'completed';
    if (stepIndex === currentIndex) return 'failed';
    return 'pending';
  }

  const currentIndex = PIPELINE_STEPS.findIndex((s) => s.key === currentStep);
  const stepIndex = PIPELINE_STEPS.findIndex((s) => s.key === stepKey);

  if (stepIndex < currentIndex) return 'completed';
  if (stepIndex === currentIndex) return 'active';
  return 'pending';
}

function StepIcon({ status }: { status: 'completed' | 'active' | 'pending' | 'failed' }) {
  switch (status) {
    case 'completed':
      return <Ionicons name="checkmark-circle" size={22} color="#059669" />;
    case 'active':
      return <ActivityIndicator size="small" color="#1a56db" />;
    case 'failed':
      return <Ionicons name="close-circle" size={22} color="#ef4444" />;
    default:
      return <Ionicons name="ellipse-outline" size={22} color="#d1d5db" />;
  }
}

export function UploadProgress({ uploadProgress, currentStep, error }: UploadProgressProps) {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>Processing Scan</Text>

      {currentStep === 'uploading' && (
        <View style={styles.progressBarContainer}>
          <View style={[styles.progressBar, { width: `${Math.round(uploadProgress * 100)}%` }]} />
          <Text style={styles.progressText}>{Math.round(uploadProgress * 100)}%</Text>
        </View>
      )}

      <View style={styles.steps}>
        {PIPELINE_STEPS.filter((s) => s.key !== 'complete').map((step, index) => {
          const status = getStepStatus(step.key, currentStep);
          return (
            <View key={step.key} style={styles.stepRow}>
              <StepIcon status={status} />
              <View style={styles.stepContent}>
                <Text
                  style={[
                    styles.stepLabel,
                    status === 'active' && styles.stepLabelActive,
                    status === 'completed' && styles.stepLabelDone,
                    status === 'failed' && styles.stepLabelFailed,
                  ]}
                >
                  {step.label}
                </Text>
                <Text style={styles.stepDescription}>{step.description}</Text>
              </View>
              {index < PIPELINE_STEPS.length - 2 && (
                <View
                  style={[
                    styles.connector,
                    status === 'completed' && styles.connectorDone,
                  ]}
                />
              )}
            </View>
          );
        })}
      </View>

      {currentStep === 'complete' && (
        <View style={styles.successBanner}>
          <Ionicons name="checkmark-circle" size={24} color="#059669" />
          <Text style={styles.successText}>Processing complete</Text>
        </View>
      )}

      {error && (
        <View style={styles.errorBanner}>
          <Ionicons name="alert-circle" size={20} color="#ef4444" />
          <Text style={styles.errorText}>{error}</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 20,
    margin: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
  },
  title: {
    fontSize: 17,
    fontWeight: '600',
    color: '#111827',
    marginBottom: 16,
  },
  progressBarContainer: {
    height: 28,
    backgroundColor: '#f3f4f6',
    borderRadius: 14,
    overflow: 'hidden',
    marginBottom: 20,
    justifyContent: 'center',
  },
  progressBar: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    backgroundColor: '#1a56db',
    borderRadius: 14,
  },
  progressText: {
    textAlign: 'center',
    fontSize: 12,
    fontWeight: '600',
    color: '#374151',
  },
  steps: {
    gap: 4,
  },
  stepRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 8,
    position: 'relative',
  },
  stepContent: {
    flex: 1,
  },
  stepLabel: {
    fontSize: 14,
    fontWeight: '500',
    color: '#9ca3af',
  },
  stepLabelActive: {
    color: '#1a56db',
    fontWeight: '600',
  },
  stepLabelDone: {
    color: '#059669',
  },
  stepLabelFailed: {
    color: '#ef4444',
  },
  stepDescription: {
    fontSize: 12,
    color: '#9ca3af',
    marginTop: 1,
  },
  connector: {
    position: 'absolute',
    left: 10,
    top: 34,
    width: 2,
    height: 16,
    backgroundColor: '#e5e7eb',
  },
  connectorDone: {
    backgroundColor: '#059669',
  },
  successBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#ecfdf5',
    padding: 12,
    borderRadius: 8,
    marginTop: 16,
  },
  successText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#059669',
  },
  errorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#fef2f2',
    padding: 12,
    borderRadius: 8,
    marginTop: 16,
  },
  errorText: {
    fontSize: 13,
    color: '#ef4444',
    flex: 1,
  },
});
