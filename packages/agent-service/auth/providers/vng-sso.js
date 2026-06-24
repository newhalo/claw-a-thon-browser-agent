/**
 * VNG SSO provider — stub for Phase 2.
 * Implement verifyToken() once SSO spec is finalised.
 */

export const PROVIDER_ID = 'vng-sso';

export async function verifyToken(_token) {
  throw new Error('VNG SSO provider not yet implemented. Coming in Phase 2.');
}
