import { act, render } from '@testing-library/react-native';
import { AccessibilityInfo, Animated } from 'react-native';
import { HeaderAmbient } from '@/components/ui/HeaderAmbient';

/** Flush the pending isReduceMotionEnabled promise inside act(). */
const flushAsync = () => act(async () => {});

describe('HeaderAmbient', () => {
  let reduceMotionSpy: jest.SpyInstance;
  let addListenerSpy: jest.SpyInstance;
  let loopSpy: jest.SpyInstance;
  const removeSubscription = jest.fn();

  beforeEach(() => {
    reduceMotionSpy = jest
      .spyOn(AccessibilityInfo, 'isReduceMotionEnabled')
      .mockResolvedValue(false);
    addListenerSpy = jest
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

  it('renders a non-interactive overlay (pointerEvents none) with the default height', async () => {
    const { getByTestId } = render(<HeaderAmbient />);
    await flushAsync();

    const overlay = getByTestId('header-ambient');
    expect(overlay.props.pointerEvents).toBe('none');
    expect(overlay.props.style).toMatchObject({
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      height: 180,
      overflow: 'hidden',
      zIndex: 0,
    });
  });

  it('respects a custom height', async () => {
    const { getByTestId } = render(<HeaderAmbient height={120} />);
    await flushAsync();

    expect(getByTestId('header-ambient').props.style).toMatchObject({ height: 120 });
  });

  it('starts looping animations when reduce motion is off', async () => {
    const { unmount } = render(<HeaderAmbient />);
    await flushAsync();

    // One Animated.loop per blob (3) + the owl's wave and wink loops (2).
    expect(loopSpy).toHaveBeenCalledTimes(5);
    unmount();
  });

  it('renders the owl by default and hides it when owl is false', async () => {
    const { getByTestId, queryByTestId, rerender } = render(<HeaderAmbient />);
    await flushAsync();

    expect(getByTestId('header-ambient-owl')).toBeTruthy();

    rerender(<HeaderAmbient owl={false} />);
    expect(queryByTestId('header-ambient-owl')).toBeNull();
  });

  it('renders static circles (no loop) when reduce motion is enabled', async () => {
    reduceMotionSpy.mockResolvedValue(true);

    const { getByTestId, unmount } = render(<HeaderAmbient />);
    await flushAsync();

    expect(loopSpy).not.toHaveBeenCalled();
    // The decoration still renders — just without motion.
    expect(getByTestId('header-ambient')).toBeTruthy();
    unmount();
  });

  it('subscribes to reduceMotionChanged and removes the listener on unmount', async () => {
    const { unmount } = render(<HeaderAmbient />);
    await flushAsync();

    expect(addListenerSpy).toHaveBeenCalledWith('reduceMotionChanged', expect.any(Function));
    unmount();
    expect(removeSubscription).toHaveBeenCalled();
  });
});
