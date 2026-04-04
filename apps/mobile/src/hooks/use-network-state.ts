import { useState, useEffect, useCallback, useRef } from 'react';
import NetInfo, { type NetInfoState } from '@react-native-community/netinfo';

export interface NetworkState {
  /** Whether the device has network connectivity */
  isConnected: boolean;
  /** Whether internet is reachable (can be false even when connected, e.g. captive portal) */
  isInternetReachable: boolean;
  /** Network type: wifi, cellular, ethernet, etc. */
  type: string;
}

/**
 * Hook that provides real-time network connectivity state.
 * Subscribes to NetInfo listeners for automatic updates on network transitions.
 */
export function useNetworkState(): NetworkState {
  const [state, setState] = useState<NetworkState>({
    isConnected: true,
    isInternetReachable: true,
    type: 'unknown',
  });

  useEffect(() => {
    const unsubscribe = NetInfo.addEventListener((netState: NetInfoState) => {
      setState({
        isConnected: netState.isConnected ?? false,
        isInternetReachable: netState.isInternetReachable ?? false,
        type: netState.type,
      });
    });

    return () => unsubscribe();
  }, []);

  return state;
}

/**
 * Hook that fires a callback when the device transitions from offline to online.
 * Useful for triggering sync or re-fetch operations after reconnection.
 */
export function useOnReconnect(callback: () => void): void {
  const wasOffline = useRef(false);

  useEffect(() => {
    const unsubscribe = NetInfo.addEventListener((netState: NetInfoState) => {
      const isOnline = (netState.isConnected ?? false) && (netState.isInternetReachable ?? false);

      if (wasOffline.current && isOnline) {
        callback();
      }

      wasOffline.current = !isOnline;
    });

    return () => unsubscribe();
  }, [callback]);
}
