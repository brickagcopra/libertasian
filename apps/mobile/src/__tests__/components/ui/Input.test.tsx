import { fireEvent, render } from '@testing-library/react-native';
import { Text } from 'react-native';
import { Input } from '@/components/ui/Input';

describe('Input', () => {
  it('renders with placeholder', () => {
    const { getByPlaceholderText } = render(<Input placeholder="Email" />);
    expect(getByPlaceholderText('Email')).toBeTruthy();
  });

  it('reflects value from props', () => {
    const { getByDisplayValue } = render(<Input value="hi" onChangeText={() => {}} />);
    expect(getByDisplayValue('hi')).toBeTruthy();
  });

  it('calls onChangeText', () => {
    const onChangeText = jest.fn();
    const { getByPlaceholderText } = render(
      <Input placeholder="Search" onChangeText={onChangeText} />,
    );
    fireEvent.changeText(getByPlaceholderText('Search'), 'q');
    expect(onChangeText).toHaveBeenCalledWith('q');
  });

  it('calls onFocus and onBlur', () => {
    const onFocus = jest.fn();
    const onBlur = jest.fn();
    const { getByPlaceholderText } = render(
      <Input placeholder="x" onFocus={onFocus} onBlur={onBlur} />,
    );
    fireEvent(getByPlaceholderText('x'), 'focus');
    fireEvent(getByPlaceholderText('x'), 'blur');
    expect(onFocus).toHaveBeenCalledTimes(1);
    expect(onBlur).toHaveBeenCalledTimes(1);
  });

  it('renders an eyebrow label', () => {
    const { getByText } = render(<Input label="Email" placeholder="x" />);
    expect(getByText('Email')).toBeTruthy();
  });

  it('renders an error message', () => {
    const { getByText } = render(<Input placeholder="x" error="Required" />);
    expect(getByText('Required')).toBeTruthy();
  });

  it('renders leading and trailing nodes', () => {
    const { getByText } = render(
      <Input placeholder="x" leading={<Text>L</Text>} trailing={<Text>T</Text>} />,
    );
    expect(getByText('L')).toBeTruthy();
    expect(getByText('T')).toBeTruthy();
  });
});
