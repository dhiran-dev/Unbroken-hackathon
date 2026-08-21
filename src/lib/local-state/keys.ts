/**
 * Namespaced storage keys for PulseRank browser-local state.
 *
 * Everything this layer persists lives under the `pulserank:v1` namespace so it
 * can never collide with — or read from — the legacy `unbroken:*` keys.
 */

/** Schema/envelope version for PulseRank local state. */
export const PULSERANK_LOCAL_STATE_VERSION = 1;

/** Shared namespace prefix for every PulseRank storage key. */
export const PULSERANK_LOCAL_STATE_PREFIX = "pulserank:v1";

/** localStorage key holding the preferences JSON document. */
export const PREFERENCES_STORAGE_KEY = "pulserank:v1:preferences";

/**
 * localStorage mirror key for saved products. Saved products themselves live
 * in IndexedDB (store `saved-products` in database `pulserank`); this key is
 * reserved so a future lightweight mirror/fallback keeps a stable namespace.
 */
export const SAVED_PRODUCTS_STORAGE_KEY = "pulserank:v1:saved-products";

/** localStorage key holding the compare-tray slug list (max 4). */
export const COMPARE_STORAGE_KEY = "pulserank:v1:compare";

/**
 * localStorage mirror key for My Day. Entries live in IndexedDB (store
 * `my-day`); this key is reserved so a future lightweight mirror keeps a
 * stable namespace.
 */
export const MY_DAY_STORAGE_KEY = "pulserank:v1:my-day";

/** Reserved localStorage key for "last seen" markers (recently-viewed metadata). */
export const LAST_SEEN_STORAGE_KEY = "pulserank:v1:last-seen";
