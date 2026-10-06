import { describe, expect, it } from 'vitest';
import {
  hashInviteToken,
  inviteRedirect,
  inviteRequestSchema,
  makeInviteToken,
} from '../../supabase/functions/_shared/invite.ts';

describe('invitations', () => {
  it('tokens are 256-bit hex and unique', () => {
    const a = makeInviteToken();
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(makeInviteToken()).not.toBe(a);
  });

  it('hash matches the SQL hash_invite_token (sha256 hex of UTF-8)', () => {
    expect(hashInviteToken('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });

  it('validates requests: patient_id required for family roles only', () => {
    expect(
      inviteRequestSchema.safeParse({ email: 'A@Example.org', role: 'nurse' }).data?.email,
    ).toBe('a@example.org');
    expect(
      inviteRequestSchema.safeParse({ email: 'a@example.org', role: 'caregiver' }).success,
    ).toBe(false);
    expect(
      inviteRequestSchema.safeParse({
        email: 'a@example.org',
        role: 'caregiver',
        patient_id: '7a1c3a0e-8a5b-4c3e-9f5d-2f1b6c0d9e8a',
      }).success,
    ).toBe(true);
    expect(
      inviteRequestSchema.safeParse({
        email: 'a@example.org',
        role: 'nurse',
        patient_id: '7a1c3a0e-8a5b-4c3e-9f5d-2f1b6c0d9e8a',
      }).success,
    ).toBe(false);
    expect(inviteRequestSchema.safeParse({ email: 'not-an-email', role: 'nurse' }).success).toBe(
      false,
    );
    expect(
      inviteRequestSchema.safeParse({ email: 'a@example.org', role: 'superuser' }).success,
    ).toBe(false);
  });

  it('builds the accept link with an encoded token', () => {
    expect(inviteRedirect('https://app.example.org/', 'abc')).toBe(
      'https://app.example.org/accept-invite?token=abc',
    );
  });
});
