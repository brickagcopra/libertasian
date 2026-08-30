import type { PurchaseSurfaceStatus } from '../components/purchase-surface';
import type { PurchasePlanOption, StoreProductId } from '../products';

export interface PurchaseOptions {
  status: PurchaseSurfaceStatus;
  plans: PurchasePlanOption[];
  busy: boolean;
  notice: string | null;
  purchase: (productId: StoreProductId) => void;
  restore: () => void;
}

/**
 * The seam between the purchase screen and the store SDK.
 *
 * This PR ships the screen with NO SDK behind it — `react-native-purchases` is
 * not a dependency yet, and no store products exist to fetch. The screen is
 * still real: it renders whatever options it is handed, and with none it shows
 * the neutral unavailable state, which is also the correct runtime behaviour
 * on a device with no store account or no network.
 *
 * Keeping the seam here rather than inlining the SDK call in the route means
 * the next PR replaces one file's implementation and the route, the components
 * and their tests do not move. It also keeps `react-native-purchases` — which
 * needs a native build — out of every test that renders this screen.
 */
export function usePurchaseOptions(): PurchaseOptions {
  return {
    status: 'unavailable',
    plans: [],
    busy: false,
    notice: null,
    // No-ops rather than throws: an unreachable button that crashes is worse
    // than one that does nothing, and `status: 'unavailable'` already disables
    // the purchase action in the surface.
    purchase: () => undefined,
    restore: () => undefined,
  };
}
