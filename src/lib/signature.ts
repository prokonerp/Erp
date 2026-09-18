/**
 * Signature authorization gate (single policy for the User Signatures page).
 *
 * - upload: admin-or-self. Any authenticated user may set their OWN
 *   signatory image; only admins may set someone else's.
 * - remove: admin-only (preserves the legacy "Only admins can remove
 *   signatures" behavior).
 *
 * Pure — the server fns in signature.functions.ts resolve `isAdmin` via the
 * `has_role` RPC and enforce this before touching storage or app_users.
 */
export type SignatureAction = "upload" | "remove";

export function canManageSignature(
  caller: { userId: string; isAdmin: boolean },
  targetUserId: string,
  action: SignatureAction,
): boolean {
  if (caller.isAdmin) return true;
  if (action === "upload" && caller.userId === targetUserId) return true;
  return false;
}
