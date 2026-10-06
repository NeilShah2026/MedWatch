import { z } from 'zod';
import { sha256Hex } from '../../../packages/core/src/fingerprint.ts';

export const inviteRequestSchema = z
  .object({
    email: z.string().trim().toLowerCase().email().max(254),
    role: z.enum(['patient', 'caregiver', 'nurse', 'agency_admin']),
    full_name: z.string().trim().min(2).max(120).optional(),
    patient_id: z.string().uuid().optional(),
  })
  .refine(
    (v) => (v.role === 'patient' || v.role === 'caregiver' ? Boolean(v.patient_id) : !v.patient_id),
    {
      message: 'patient_id is required for patient/caregiver invitations and not allowed otherwise',
      path: ['patient_id'],
    },
  );

export type InviteRequest = z.infer<typeof inviteRequestSchema>;

/** 256-bit random token (hex). Only its SHA-256 is stored (spec §6.5). */
export function makeInviteToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Must match public.hash_invite_token() in SQL. */
export function hashInviteToken(token: string): string {
  return sha256Hex(token);
}

export const INVITE_TTL_DAYS = 7;

export function inviteRedirect(appUrl: string, token: string): string {
  return `${appUrl.replace(/\/$/, '')}/accept-invite?token=${encodeURIComponent(token)}`;
}
