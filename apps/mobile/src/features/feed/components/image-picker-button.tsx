import React, { useState } from 'react';
import { TouchableOpacity, Text, View, Modal, StyleSheet, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

interface ImagePickerButtonProps {
  onPickFromLibrary: () => void;
  onTakePhoto: () => void;
  disabled?: boolean;
}

export function ImagePickerButton({ onPickFromLibrary, onTakePhoto, disabled }: ImagePickerButtonProps) {
  const [showMenu, setShowMenu] = useState(false);

  return (
    <>
      <TouchableOpacity
        style={[styles.button, disabled && styles.buttonDisabled]}
        onPress={() => setShowMenu(true)}
        disabled={disabled}
      >
        <Ionicons name="image-outline" size={20} color={disabled ? '#9ca3af' : '#1a56db'} />
      </TouchableOpacity>

      <Modal
        visible={showMenu}
        transparent
        animationType="fade"
        onRequestClose={() => setShowMenu(false)}
      >
        <Pressable style={styles.overlay} onPress={() => setShowMenu(false)}>
          <View style={styles.menu}>
            <Text style={styles.menuTitle}>Add Image</Text>

            <TouchableOpacity
              style={styles.menuItem}
              onPress={() => {
                setShowMenu(false);
                onPickFromLibrary();
              }}
            >
              <Ionicons name="images-outline" size={22} color="#374151" />
              <Text style={styles.menuItemText}>Choose from Library</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.menuItem}
              onPress={() => {
                setShowMenu(false);
                onTakePhoto();
              }}
            >
              <Ionicons name="camera-outline" size={22} color="#374151" />
              <Text style={styles.menuItemText}>Take Photo</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.cancelButton}
              onPress={() => setShowMenu(false)}
            >
              <Text style={styles.cancelText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </Pressable>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  button: {
    padding: 8,
    borderRadius: 8,
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'flex-end',
  },
  menu: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    padding: 20,
    paddingBottom: 34,
  },
  menuTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#111827',
    marginBottom: 16,
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#e5e7eb',
  },
  menuItemText: {
    fontSize: 15,
    color: '#374151',
  },
  cancelButton: {
    alignItems: 'center',
    paddingTop: 16,
  },
  cancelText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#6b7280',
  },
});
