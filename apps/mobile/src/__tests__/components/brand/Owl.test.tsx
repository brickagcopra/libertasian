import { act, render } from '@testing-library/react-native';
import { AccessibilityInfo, Animated, StyleSheet } from 'react-native';
import { Owl } from '@/components/brand/Owl';

/** Flush the pending isReduceMotionEnabled promise inside act(). */
const flushAsync = () => act(async () => {});

describe('Owl', () => {
  let reduceMotionSpy: jest.SpyInstance;
  let loopSpy: jest.SpyInstance;
  const removeSubscription = jest.fn();

  beforeEach(() => {
    reduceMotionSpy = jest
      .spyOn(AccessibilityInfo, 'isReduceMotionEnabled')
      .mockResolvedValue(false);
    jest
      .spyOn(AccessibilityInfo, 'addEventListener')
      .mockReturnValue({ remove: removeSubscription } as unknown as ReturnType<
        typeof AccessibilityInfo.addEventListener
      >);
    loopSpy = jest.spyOn(Animated, 'loop');
  });

  afterEach(() => {
    jest.restoreAllMocks();
    removeSubscription.mockClear();
  });

  it('renders the body plus the animated wing and eye pieces', async () => {
    const { getByTestId } = render(<Owl />);
    await flushAsync();

    expect(getByTestId('owl')).toBeTruthy();
    expect(getByTestId('owl-wing')).toBeTruthy();
    expect(getByTestId('owl-eye-right')).toBeTruthy();
  });

  it('sizes the container from the size prop', async () => {
    const { getByTestId } = render(<Owl size={240} />);
    await flushAsync();

    expect(StyleSheet.flatten(getByTestId('owl').props.style)).toMatchObject({
      width: 240,
      height: 240,
    });
  });

  it('starts the wave and wink loops when reduce motion is off', async () => {
    const { unmount } = render(<Owl />);
    await flushAsync();

    expect(loopSpy).toHaveBeenCalledTimes(2);
    unmount();
  });

  it('renders static (no loop started) when reduce motion is enabled', async () => {
    reduceMotionSpy.mockResolvedValue(true);

    const { getByTestId, unmount } = render(<Owl />);
    await flushAsync();

    expect(loopSpy).not.toHaveBeenCalled();
    // The mascot still renders — wing and eye just hold their resting pose.
    expect(getByTestId('owl')).toBeTruthy();
    expect(getByTestId('owl-wing')).toBeTruthy();
    expect(getByTestId('owl-eye-right')).toBeTruthy();
    unmount();
  });

  it('removes the reduceMotionChanged listener on unmount', async () => {
    const { unmount } = render(<Owl />);
    await flushAsync();

    unmount();
    expect(removeSubscription).toHaveBeenCalled();
  });
});
