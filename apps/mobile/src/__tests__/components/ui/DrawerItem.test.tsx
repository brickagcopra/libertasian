import { fireEvent, render } from '@testing-library/react-native';
import { DrawerItem } from '@/components/ui/DrawerItem';

jest.mock('@expo/vector-icons', () => ({
  Ionicons: ({ name }: { name: string }) => {
    const { Text } = require('react-native');
    return <Text testID={`icon-${name}`}>{name}</Text>;
  },
}));

describe('DrawerItem', () => {
  it('renders icon and label', () => {
    const { getByText, getByTestId } = render(
      <DrawerItem icon="folder-outline" label="Workspace" />,
    );
    expect(getByText('Workspace')).toBeTruthy();
    expect(getByTestId('icon-folder-outline')).toBeTruthy();
  });

  it('fires onPress when tapped (non-collapsible)', () => {
    const onPress = jest.fn();
    const { getByText } = render(
      <DrawerItem icon="settings-outline" label="Settings" onPress={onPress} />,
    );
    fireEvent.press(getByText('Settings'));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('renders trailing chip when provided', () => {
    const { getByText } = render(
      <DrawerItem icon="briefcase-outline" label="Workspace" trailingChip="14" />,
    );
    expect(getByText('14')).toBeTruthy();
  });

  it('toggles between chevron-forward and chevron-down when collapsible', () => {
    const onToggle = jest.fn();
    const { getByText, getByTestId, queryByTestId } = render(
      <DrawerItem
        icon="shield-outline"
        label="Admin"
        collapsible
        onToggle={onToggle}
      />,
    );
    expect(getByTestId('icon-chevron-forward')).toBeTruthy();
    fireEvent.press(getByText('Admin'));
    expect(onToggle).toHaveBeenCalledWith(true);
    expect(getByTestId('icon-chevron-down')).toBeTruthy();
    expect(queryByTestId('icon-chevron-forward')).toBeNull();
  });
});
