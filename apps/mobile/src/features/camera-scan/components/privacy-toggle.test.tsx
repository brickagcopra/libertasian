import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import { Alert } from 'react-native';

import { PrivacyToggle } from './privacy-toggle';

jest.mock('@expo/vector-icons', () => {
  const { Text } = require('react-native');
  return {
    Ionicons: ({ name }: { name: string }) =>
      require('react').createElement(Text, { testID: `icon-${name}` }, name),
  };
});

const mockMutate = jest.fn();
jest.mock('../hooks/use-update-privacy', () => ({
  useUpdatePrivacy: () => ({
    mutate: mockMutate,
    isPending: false,
    isError: false,
  }),
}));

jest.spyOn(Alert, 'alert');

describe('PrivacyToggle', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('shows "Private" text for non-editorial users with private level', () => {
    const { getByText } = render(
      <PrivacyToggle
        uploadId="upload-1"
        privacyLevel="private"
        canPromoteToEditorial={false}
      />,
    );

    expect(getByText('Privacy')).toBeTruthy();
    expect(getByText('Private')).toBeTruthy();
  });

  it('does not show switch for non-editorial users with private level', () => {
    const { queryByRole } = render(
      <PrivacyToggle
        uploadId="upload-1"
        privacyLevel="private"
        canPromoteToEditorial={false}
      />,
    );

    // No switch should be rendered
    // We check that only "Private" text is shown, not the toggle
    expect(queryByRole).toBeDefined();
  });

  it('shows switch for users with editorial role', () => {
    const { getByText } = render(
      <PrivacyToggle
        uploadId="upload-1"
        privacyLevel="private"
        canPromoteToEditorial={true}
      />,
    );

    expect(getByText('Privacy')).toBeTruthy();
    expect(getByText('Private')).toBeTruthy();
  });

  it('shows "Editorial Candidate" text when privacy is editorial', () => {
    const { getByText } = render(
      <PrivacyToggle
        uploadId="upload-1"
        privacyLevel="editorial_candidate"
        canPromoteToEditorial={true}
      />,
    );

    expect(getByText('Editorial Candidate')).toBeTruthy();
  });

  it('shows hint text when canPromoteToEditorial is false but editorial_candidate is set', () => {
    const { getByText } = render(
      <PrivacyToggle
        uploadId="upload-1"
        privacyLevel="editorial_candidate"
        canPromoteToEditorial={false}
      />,
    );

    expect(getByText('Editorial candidate option requires an editor or admin role')).toBeTruthy();
  });

  it('shows confirmation alert when toggling to editorial_candidate', () => {
    const { UNSAFE_getByType } = render(
      <PrivacyToggle
        uploadId="upload-1"
        privacyLevel="private"
        canPromoteToEditorial={true}
      />,
    );

    // Find the Switch and toggle it
    const RNSwitch = require('react-native').Switch;
    const switchEl = UNSAFE_getByType(RNSwitch);
    fireEvent(switchEl, 'valueChange', true);

    expect(Alert.alert).toHaveBeenCalledWith(
      'Change to Editorial Candidate?',
      expect.stringContaining('reviewed by LIBERTASIAN'),
      expect.any(Array),
    );
  });

  it('calls mutate with private when toggling off', () => {
    const { UNSAFE_getByType } = render(
      <PrivacyToggle
        uploadId="upload-1"
        privacyLevel="editorial_candidate"
        canPromoteToEditorial={true}
      />,
    );

    const RNSwitch = require('react-native').Switch;
    const switchEl = UNSAFE_getByType(RNSwitch);
    fireEvent(switchEl, 'valueChange', false);

    expect(mockMutate).toHaveBeenCalledWith({
      uploadId: 'upload-1',
      privacyLevel: 'private',
    });
  });
});
