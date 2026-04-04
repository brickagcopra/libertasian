// ==========================================================================
// LIBERTASIAN — k6 Reusable Check Wrappers
// ==========================================================================

import { check } from 'k6';

/**
 * Check response is successful (2xx) with success: true body.
 */
export function checkSuccess(response, name) {
  return check(response, {
    [`${name} status 2xx`]: (r) => r.status >= 200 && r.status < 300,
    [`${name} success true`]: (r) => {
      try {
        return r.json().success === true;
      } catch {
        return false;
      }
    },
  });
}

/**
 * Check response has a specific status code.
 */
export function checkStatus(response, expected, name) {
  return check(response, {
    [`${name} status ${expected}`]: (r) => r.status === expected,
  });
}

/**
 * Check response is 2xx and body has data array with items.
 */
export function checkDataArray(response, name) {
  return check(response, {
    [`${name} status 2xx`]: (r) => r.status >= 200 && r.status < 300,
    [`${name} has data array`]: (r) => {
      try {
        const body = r.json();
        return body.success === true && Array.isArray(body.data);
      } catch {
        return false;
      }
    },
  });
}

/**
 * Check response is 2xx and body has data object.
 */
export function checkDataObject(response, name) {
  return check(response, {
    [`${name} status 2xx`]: (r) => r.status >= 200 && r.status < 300,
    [`${name} has data`]: (r) => {
      try {
        const body = r.json();
        return body.success === true && body.data !== null && typeof body.data === 'object';
      } catch {
        return false;
      }
    },
  });
}
