import { renderHook, act } from '@testing-library/react-native';
import NetInfo from '@react-native-community/netinfo';
import { useNetworkState, useOnReconnect } from './use-network-state';

jest.mock('@react-native-community/netinfo', () => ({
  addEventListener: jest.fn(() => jest.fn()),
}), { virtual: true });

const mockAddEventListener = NetInfo.addEventListener as jest.MockedFunction<
  typeof NetInfo.addEventListener
>;

beforeEach(() => jest.clearAllMocks());

describe('useNetworkState', () => {
  it('defaults to connected state', () => {
    mockAddEventListener.mockReturnValue(jest.fn());
    const { result } = renderHook(() => useNetworkState());

    expect(result.current.isConnected).toBe(true);
    expect(result.current.isInternetReachable).toBe(true);
    expect(result.current.type).toBe('unknown');
  });

  it('updates state when network changes to offline', () => {
    let listener: ((state: unknown) => void) | null = null;
    mockAddEventListener.mockImplementation((cb) => {
      listener = cb as (state: unknown) => void;
      return jest.fn();
    });

    const { result } = renderHook(() => useNetworkState());

    act(() => {
      listener?.({
        isConnected: false,
        isInternetReachable: false,
        type: 'none',
      });
    });

    expect(result.current.isConnected).toBe(false);
    expect(result.current.isInternetReachable).toBe(false);
    expect(result.current.type).toBe('none');
  });

  it('updates state when network changes to wifi', () => {
    let listener: ((state: unknown) => void) | null = null;
    mockAddEventListener.mockImplementation((cb) => {
      listener = cb as (state: unknown) => void;
      return jest.fn();
    });

    const { result } = renderHook(() => useNetworkState());

    act(() => {
      listener?.({
        isConnected: true,
        isInternetReachable: true,
        type: 'wifi',
      });
    });

    expect(result.current.isConnected).toBe(true);
    expect(result.current.isInternetReachable).toBe(true);
    expect(result.current.type).toBe('wifi');
  });

  it('handles null values from NetInfo gracefully', () => {
    let listener: ((state: unknown) => void) | null = null;
    mockAddEventListener.mockImplementation((cb) => {
      listener = cb as (state: unknown) => void;
      return jest.fn();
    });

    const { result } = renderHook(() => useNetworkState());

    act(() => {
      listener?.({
        isConnected: null,
        isInternetReachable: null,
        type: 'unknown',
      });
    });

    expect(result.current.isConnected).toBe(false);
    expect(result.current.isInternetReachable).toBe(false);
  });

  it('unsubscribes on unmount', () => {
    const unsubscribe = jest.fn();
    mockAddEventListener.mockReturnValue(unsubscribe);

    const { unmount } = renderHook(() => useNetworkState());
    unmount();

    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });
});

describe('useOnReconnect', () => {
  it('calls callback when transitioning from offline to online', () => {
    let listener: ((state: unknown) => void) | null = null;
    mockAddEventListener.mockImplementation((cb) => {
      listener = cb as (state: unknown) => void;
      return jest.fn();
    });

    const callback = jest.fn();
    renderHook(() => useOnReconnect(callback));

    // Go offline
    act(() => {
      listener?.({ isConnected: false, isInternetReachable: false, type: 'none' });
    });
    expect(callback).not.toHaveBeenCalled();

    // Come back online
    act(() => {
      listener?.({ isConnected: true, isInternetReachable: true, type: 'wifi' });
    });
    expect(callback).toHaveBeenCalledTimes(1);
  });

  it('does not call callback when staying online', () => {
    let listener: ((state: unknown) => void) | null = null;
    mockAddEventListener.mockImplementation((cb) => {
      listener = cb as (state: unknown) => void;
      return jest.fn();
    });

    const callback = jest.fn();
    renderHook(() => useOnReconnect(callback));

    // Stay online
    act(() => {
      listener?.({ isConnected: true, isInternetReachable: true, type: 'wifi' });
    });
    act(() => {
      listener?.({ isConnected: true, isInternetReachable: true, type: 'cellular' });
    });

    expect(callback).not.toHaveBeenCalled();
  });

  it('does not call callback on initial offline state', () => {
    let listener: ((state: unknown) => void) | null = null;
    mockAddEventListener.mockImplementation((cb) => {
      listener = cb as (state: unknown) => void;
      return jest.fn();
    });

    const callback = jest.fn();
    renderHook(() => useOnReconnect(callback));

    // Already offline on start — should not fire
    act(() => {
      listener?.({ isConnected: false, isInternetReachable: false, type: 'none' });
    });

    expect(callback).not.toHaveBeenCalled();
  });
});
