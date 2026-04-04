import { useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  Platform,
  Modal,
  StyleSheet,
} from 'react-native';
import DateTimePicker, {
  type DateTimePickerEvent,
} from '@react-native-community/datetimepicker';
import { Ionicons } from '@expo/vector-icons';

interface DatePickerFieldProps {
  label?: string;
  value: Date | null;
  onChange: (date: Date | null) => void;
  placeholder?: string;
  minimumDate?: Date;
  clearable?: boolean;
}

export function DatePickerField({
  label,
  value,
  onChange,
  placeholder = 'Select date',
  minimumDate,
  clearable = true,
}: DatePickerFieldProps) {
  const [showPicker, setShowPicker] = useState(false);

  const handleChange = (_event: DateTimePickerEvent, selectedDate?: Date) => {
    if (Platform.OS === 'android') {
      setShowPicker(false);
    }
    if (selectedDate) {
      onChange(selectedDate);
    }
  };

  const handleConfirmIOS = () => {
    setShowPicker(false);
  };

  const handleCancelIOS = () => {
    setShowPicker(false);
  };

  const handleClear = () => {
    onChange(null);
  };

  const formattedValue = value
    ? value.toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      })
    : null;

  return (
    <View style={styles.container}>
      {label ? <Text style={styles.label}>{label}</Text> : null}
      <TouchableOpacity
        style={styles.field}
        onPress={() => setShowPicker(true)}
        activeOpacity={0.7}
      >
        <Ionicons
          name="calendar-outline"
          size={18}
          color={value ? '#1a56db' : '#9ca3af'}
        />
        <Text style={[styles.fieldText, !value && styles.placeholder]}>
          {formattedValue ?? placeholder}
        </Text>
        {clearable && value ? (
          <TouchableOpacity
            onPress={handleClear}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Ionicons name="close-circle" size={18} color="#9ca3af" />
          </TouchableOpacity>
        ) : (
          <Ionicons name="chevron-down" size={16} color="#9ca3af" />
        )}
      </TouchableOpacity>

      {/* Android: inline picker that auto-dismisses */}
      {showPicker && Platform.OS === 'android' && (
        <DateTimePicker
          value={value ?? new Date()}
          mode="date"
          display="default"
          onChange={handleChange}
          minimumDate={minimumDate}
        />
      )}

      {/* iOS: modal picker with confirm/cancel */}
      {Platform.OS === 'ios' && (
        <Modal
          visible={showPicker}
          transparent
          animationType="slide"
          onRequestClose={handleCancelIOS}
        >
          <View style={styles.modalOverlay}>
            <View style={styles.modalContent}>
              <View style={styles.modalHeader}>
                <TouchableOpacity onPress={handleCancelIOS}>
                  <Text style={styles.modalCancel}>Cancel</Text>
                </TouchableOpacity>
                <Text style={styles.modalTitle}>Select Date</Text>
                <TouchableOpacity onPress={handleConfirmIOS}>
                  <Text style={styles.modalDone}>Done</Text>
                </TouchableOpacity>
              </View>
              <DateTimePicker
                value={value ?? new Date()}
                mode="date"
                display="spinner"
                onChange={handleChange}
                minimumDate={minimumDate}
                style={styles.iosPicker}
              />
            </View>
          </View>
        </Modal>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: 6 },
  label: {
    fontSize: 13,
    fontWeight: '600',
    color: '#374151',
  },
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#fff',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#e5e7eb',
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  fieldText: {
    flex: 1,
    fontSize: 15,
    color: '#111827',
  },
  placeholder: {
    color: '#9ca3af',
  },

  // iOS modal styles
  modalOverlay: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0, 0, 0, 0.4)',
  },
  modalContent: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    paddingBottom: 32,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#e5e7eb',
  },
  modalTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#111827',
  },
  modalCancel: {
    fontSize: 16,
    color: '#6b7280',
  },
  modalDone: {
    fontSize: 16,
    fontWeight: '600',
    color: '#1a56db',
  },
  iosPicker: {
    height: 200,
  },
});
