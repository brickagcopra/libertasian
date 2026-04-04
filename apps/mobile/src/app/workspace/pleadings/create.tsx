import { useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Alert,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
} from 'react-native';
import { Stack, router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import {
  usePleadingTemplates,
  usePleadingTemplate,
  useGeneratePleading,
} from '../../../features/pleadings/hooks/use-pleadings';
import { PLEADING_CATEGORY_LABELS } from '../../../features/pleadings/types';
import type {
  PleadingTemplateListItem,
  PleadingTemplateSection,
} from '../../../features/pleadings/types';

const CATEGORY_OPTIONS: { label: string; value: string }[] = [
  { label: 'All', value: '' },
  { label: 'Motion', value: 'motion' },
  { label: 'Complaint', value: 'complaint' },
  { label: 'Petition', value: 'petition' },
  { label: 'Answer', value: 'answer' },
  { label: 'Memo', value: 'memorandum' },
  { label: 'Appeal', value: 'appeal' },
];

export default function CreatePleadingScreen() {
  const generatePleading = useGeneratePleading();

  // Step 1: Template selection
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(
    null,
  );
  const [categoryFilter, setCategoryFilter] = useState('');

  // Step 2: Form data
  const [inputData, setInputData] = useState<Record<string, string>>({});
  const [contextQuery, setContextQuery] = useState('');

  const { data: templatesResp, isLoading: isLoadingTemplates } =
    usePleadingTemplates(categoryFilter || undefined);
  const { data: templateDetailResp, isLoading: isLoadingDetail } =
    usePleadingTemplate(selectedTemplateId ?? '', !!selectedTemplateId);

  const templates = templatesResp?.data ?? [];
  const templateDetail = templateDetailResp?.data;
  const sections = templateDetail?.templateJson?.sections ?? [];

  const isStep2 = selectedTemplateId !== null && templateDetail !== undefined;

  const allRequiredFilled =
    isStep2 &&
    sections
      .filter((s) => s.required)
      .every((s) => (inputData[s.key] ?? '').trim().length > 0);

  const canSubmit = isStep2 && allRequiredFilled && !generatePleading.isPending;

  const handleSelectTemplate = (template: PleadingTemplateListItem) => {
    setSelectedTemplateId(template.id);
    setInputData({});
    setContextQuery('');
  };

  const handleBackToTemplates = () => {
    setSelectedTemplateId(null);
    setInputData({});
    setContextQuery('');
  };

  const handleFieldChange = (key: string, value: string) => {
    setInputData((prev) => ({ ...prev, [key]: value }));
  };

  const handleSubmit = async () => {
    if (!canSubmit || !selectedTemplateId) return;

    try {
      const result = await generatePleading.mutateAsync({
        templateId: selectedTemplateId,
        inputData,
        contextQuery: contextQuery.trim() || undefined,
      });
      if (result.data?.id) {
        router.replace(`/workspace/pleadings/${result.data.id}`);
      } else {
        router.back();
      }
    } catch (err) {
      Alert.alert(
        'Error',
        err instanceof Error ? err.message : 'Failed to generate pleading',
      );
    }
  };

  return (
    <>
      <Stack.Screen
        options={{
          title: isStep2 ? templateDetail?.name ?? 'Fill Details' : 'Select Template',
          headerLeft: isStep2
            ? () => (
                <TouchableOpacity
                  onPress={handleBackToTemplates}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  style={styles.headerBackButton}
                >
                  <Ionicons name="arrow-back" size={22} color="#1a56db" />
                </TouchableOpacity>
              )
            : undefined,
          headerRight: isStep2
            ? () => (
                <TouchableOpacity
                  onPress={handleSubmit}
                  disabled={!canSubmit}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                >
                  <Text
                    style={[
                      styles.submitText,
                      !canSubmit && styles.submitTextDisabled,
                    ]}
                  >
                    {generatePleading.isPending ? 'Generating...' : 'Generate'}
                  </Text>
                </TouchableOpacity>
              )
            : undefined,
        }}
      />
      <KeyboardAvoidingView
        style={styles.container}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        {isStep2 ? (
          /* Step 2: Dynamic Form */
          <ScrollView
            style={styles.scrollView}
            contentContainerStyle={styles.content}
            keyboardShouldPersistTaps="handled"
          >
            {isLoadingDetail ? (
              <View style={styles.loadingState}>
                <ActivityIndicator size="large" color="#1a56db" />
              </View>
            ) : (
              <>
                {/* Template Info */}
                <View style={styles.templateInfoCard}>
                  <Text style={styles.templateInfoName}>
                    {templateDetail?.name}
                  </Text>
                  {templateDetail?.description && (
                    <Text style={styles.templateInfoDesc}>
                      {templateDetail.description}
                    </Text>
                  )}
                </View>

                {/* Dynamic Fields */}
                {sections.map((section) => (
                  <SectionField
                    key={section.key}
                    section={section}
                    value={inputData[section.key] ?? ''}
                    onChange={(val) => handleFieldChange(section.key, val)}
                    disabled={generatePleading.isPending}
                  />
                ))}

                {/* Context Query */}
                <View style={styles.field}>
                  <Text style={styles.label}>
                    Context Query (Optional)
                  </Text>
                  <TextInput
                    style={styles.textArea}
                    value={contextQuery}
                    onChangeText={setContextQuery}
                    placeholder="Add context for AI to incorporate relevant legal references..."
                    placeholderTextColor="#9ca3af"
                    multiline
                    numberOfLines={3}
                    textAlignVertical="top"
                    maxLength={1000}
                    editable={!generatePleading.isPending}
                  />
                </View>

                {/* Info */}
                <View style={styles.infoCard}>
                  <Text style={styles.infoText}>
                    Fill in the required fields marked with *. The AI will
                    generate a structured pleading based on the template and your
                    inputs. Generation may take up to 60 seconds.
                  </Text>
                </View>
              </>
            )}
          </ScrollView>
        ) : (
          /* Step 1: Template Browser */
          <ScrollView
            style={styles.scrollView}
            contentContainerStyle={styles.content}
          >
            {/* Category Filter */}
            <View style={styles.filterRow}>
              {CATEGORY_OPTIONS.map((opt) => (
                <TouchableOpacity
                  key={opt.value}
                  style={[
                    styles.filterChip,
                    categoryFilter === opt.value && styles.filterChipActive,
                  ]}
                  onPress={() => setCategoryFilter(opt.value)}
                >
                  <Text
                    style={[
                      styles.filterChipText,
                      categoryFilter === opt.value &&
                        styles.filterChipTextActive,
                    ]}
                  >
                    {opt.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            {/* Templates List */}
            {isLoadingTemplates ? (
              <View style={styles.loadingState}>
                <ActivityIndicator size="large" color="#1a56db" />
              </View>
            ) : templates.length === 0 ? (
              <View style={styles.emptyTemplates}>
                <Ionicons
                  name="document-outline"
                  size={40}
                  color="#d1d5db"
                />
                <Text style={styles.emptyTemplatesText}>
                  No templates found
                </Text>
              </View>
            ) : (
              templates.map((template) => (
                <TemplateCard
                  key={template.id}
                  template={template}
                  onSelect={handleSelectTemplate}
                />
              ))
            )}
          </ScrollView>
        )}
      </KeyboardAvoidingView>
    </>
  );
}

function TemplateCard({
  template,
  onSelect,
}: {
  template: PleadingTemplateListItem;
  onSelect: (t: PleadingTemplateListItem) => void;
}) {
  const categoryLabel =
    PLEADING_CATEGORY_LABELS[template.category] ?? template.category;

  return (
    <TouchableOpacity
      style={styles.templateCard}
      onPress={() => onSelect(template)}
      activeOpacity={0.7}
    >
      <View style={styles.templateCardHeader}>
        <Text style={styles.templateCardName}>{template.name}</Text>
        <Ionicons name="chevron-forward" size={18} color="#9ca3af" />
      </View>
      <View style={styles.templateCardMeta}>
        <View style={[styles.badge, { backgroundColor: '#e0e7ff' }]}>
          <Text style={[styles.badgeText, { color: '#3730a3' }]}>
            {categoryLabel}
          </Text>
        </View>
        {template.court && (
          <Text style={styles.templateCardCourt}>{template.court}</Text>
        )}
      </View>
      {template.description && (
        <Text style={styles.templateCardDesc} numberOfLines={2}>
          {template.description}
        </Text>
      )}
    </TouchableOpacity>
  );
}

function SectionField({
  section,
  value,
  onChange,
  disabled,
}: {
  section: PleadingTemplateSection;
  value: string;
  onChange: (val: string) => void;
  disabled: boolean;
}) {
  const labelText = section.required
    ? `${section.label} *`
    : section.label;

  if (section.inputType === 'select' && section.options) {
    return (
      <View style={styles.field}>
        <Text style={styles.label}>{labelText}</Text>
        <Text style={styles.fieldDescription}>{section.description}</Text>
        <View style={styles.selectOptions}>
          {section.options.map((opt) => (
            <TouchableOpacity
              key={opt}
              style={[
                styles.selectOption,
                value === opt && styles.selectOptionActive,
              ]}
              onPress={() => onChange(opt)}
              disabled={disabled}
            >
              <Text
                style={[
                  styles.selectOptionText,
                  value === opt && styles.selectOptionTextActive,
                ]}
              >
                {opt}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>
    );
  }

  if (section.inputType === 'textarea' || section.inputType === 'party_list') {
    return (
      <View style={styles.field}>
        <Text style={styles.label}>{labelText}</Text>
        <Text style={styles.fieldDescription}>{section.description}</Text>
        <TextInput
          style={styles.textArea}
          value={value}
          onChangeText={onChange}
          placeholder={section.description}
          placeholderTextColor="#9ca3af"
          multiline
          numberOfLines={4}
          textAlignVertical="top"
          editable={!disabled}
        />
      </View>
    );
  }

  if (section.inputType === 'date') {
    return (
      <View style={styles.field}>
        <Text style={styles.label}>{labelText}</Text>
        <Text style={styles.fieldDescription}>{section.description}</Text>
        <TextInput
          style={styles.textInput}
          value={value}
          onChangeText={onChange}
          placeholder="YYYY-MM-DD"
          placeholderTextColor="#9ca3af"
          editable={!disabled}
        />
      </View>
    );
  }

  // Default: text
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{labelText}</Text>
      <Text style={styles.fieldDescription}>{section.description}</Text>
      <TextInput
        style={styles.textInput}
        value={value}
        onChangeText={onChange}
        placeholder={section.description}
        placeholderTextColor="#9ca3af"
        editable={!disabled}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f3f4f6' },
  scrollView: { flex: 1 },
  content: { padding: 16, gap: 16 },
  loadingState: {
    paddingVertical: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },

  headerBackButton: { marginRight: 8 },
  submitText: { fontSize: 16, fontWeight: '600', color: '#1a56db' },
  submitTextDisabled: { color: '#9ca3af' },

  filterRow: {
    flexDirection: 'row',
    gap: 6,
    flexWrap: 'wrap',
  },
  filterChip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#e5e7eb',
  },
  filterChipActive: {
    backgroundColor: '#1a56db',
    borderColor: '#1a56db',
  },
  filterChipText: {
    fontSize: 12,
    fontWeight: '500',
    color: '#374151',
  },
  filterChipTextActive: { color: '#fff' },

  templateCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 14,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1,
  },
  templateCardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  templateCardName: {
    fontSize: 15,
    fontWeight: '600',
    color: '#111827',
    flex: 1,
  },
  templateCardMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 4,
  },
  templateCardCourt: { fontSize: 11, color: '#6b7280' },
  templateCardDesc: {
    fontSize: 12,
    color: '#9ca3af',
    lineHeight: 16,
    marginTop: 2,
  },

  badge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  badgeText: {
    fontSize: 10,
    fontWeight: '600',
    textTransform: 'capitalize',
  },

  emptyTemplates: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 40,
  },
  emptyTemplatesText: {
    fontSize: 14,
    color: '#9ca3af',
    marginTop: 8,
  },

  templateInfoCard: {
    backgroundColor: '#eff6ff',
    borderRadius: 10,
    padding: 12,
    borderWidth: 1,
    borderColor: '#bfdbfe',
  },
  templateInfoName: { fontSize: 16, fontWeight: '600', color: '#1e40af' },
  templateInfoDesc: {
    fontSize: 12,
    color: '#3b82f6',
    marginTop: 4,
    lineHeight: 16,
  },

  field: { gap: 4 },
  label: {
    fontSize: 14,
    fontWeight: '600',
    color: '#374151',
  },
  fieldDescription: {
    fontSize: 11,
    color: '#9ca3af',
    lineHeight: 14,
  },
  textInput: {
    backgroundColor: '#fff',
    borderRadius: 10,
    padding: 12,
    fontSize: 14,
    color: '#111827',
    borderWidth: 1,
    borderColor: '#e5e7eb',
  },
  textArea: {
    backgroundColor: '#fff',
    borderRadius: 10,
    padding: 12,
    fontSize: 14,
    color: '#111827',
    lineHeight: 20,
    minHeight: 80,
    borderWidth: 1,
    borderColor: '#e5e7eb',
  },

  selectOptions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  selectOption: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#e5e7eb',
  },
  selectOptionActive: {
    backgroundColor: '#1a56db',
    borderColor: '#1a56db',
  },
  selectOptionText: {
    fontSize: 13,
    fontWeight: '500',
    color: '#374151',
  },
  selectOptionTextActive: { color: '#fff' },

  infoCard: {
    backgroundColor: '#eff6ff',
    borderRadius: 10,
    padding: 12,
    borderWidth: 1,
    borderColor: '#bfdbfe',
  },
  infoText: { fontSize: 12, color: '#1e40af', lineHeight: 18 },
});
