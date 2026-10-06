// invite-user: an agency admin invites a staff member, caregiver or patient by email.
// Stores only a hash of the invitation token; sends the email through Supabase Auth.
import { getEnv } from '../_shared/deno/env.ts';
import { HttpError, json, readJson, serveHandler } from '../_shared/deno/http.ts';
import { authenticate, requireRole, serviceClient } from '../_shared/deno/auth.ts';
import {
  INVITE_TTL_DAYS,
  hashInviteToken,
  inviteRedirect,
  inviteRequestSchema,
  makeInviteToken,
} from '../_shared/invite.ts';
import { fnLog, printDevInviteLink } from '../_shared/logger.ts';

serveHandler('invite-user', async (req) => {
  const env = getEnv();
  const db = serviceClient(env);
  const caller = await authenticate(req, env, db, { allowUser: true });
  requireRole(caller, ['agency_admin']);

  const parsed = inviteRequestSchema.safeParse(await readJson(req));
  if (!parsed.success) throw new HttpError(400, 'invalid_request');
  const inv = parsed.data;

  if (inv.patient_id) {
    const { data: patient } = await db
      .from('patients')
      .select('organization_id')
      .eq('id', inv.patient_id)
      .maybeSingle();
    if (!patient || patient.organization_id !== caller.organizationId)
      throw new HttpError(404, 'patient_not_found');
  }
  const { data: existing } = await db
    .from('profiles')
    .select('id')
    .ilike('email', inv.email)
    .maybeSingle();
  if (existing) throw new HttpError(409, 'already_registered');

  const token = makeInviteToken();
  const { data: row, error } = await db
    .from('invitations')
    .insert({
      organization_id: caller.organizationId,
      email: inv.email,
      role: inv.role,
      full_name: inv.full_name ?? null,
      patient_id: inv.patient_id ?? null,
      token_hash: hashInviteToken(token),
      invited_by: caller.userId,
      expires_at: new Date(Date.now() + INVITE_TTL_DAYS * 86_400_000).toISOString(),
    })
    .select('id')
    .single();
  if (error || !row) throw new HttpError(500, 'invite_insert_failed');

  const redirectTo = inviteRedirect(env.APP_URL, token);
  const sent = await db.auth.admin.inviteUserByEmail(inv.email, {
    redirectTo,
    data: { invitation_id: row.id },
  });
  if (sent.error) {
    await db.from('invitations').delete().eq('id', row.id);
    throw new HttpError(409, 'invite_email_failed');
  }
  if (env.APP_ENV === 'development' || env.APP_ENV === 'local') {
    const link = await db.auth.admin.generateLink({
      type: 'magiclink',
      email: inv.email,
      options: { redirectTo },
    });
    if (link.data?.properties?.action_link)
      printDevInviteLink(env.APP_ENV, link.data.properties.action_link);
  }
  fnLog.info('invite.created', { invitation_id: row.id, organization_id: caller.organizationId });
  return json({ invitation_id: row.id });
});
