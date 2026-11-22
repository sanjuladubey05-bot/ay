import type { Request } from 'express';
import { getDb, type QueryRunner } from './pool';

export interface WriteAuditLogInput {
  actorProfileId: string | null;
  actorRole: string;
  action: string;
  resourceType: string;
  resourceId?: string | null;
  req?: Request;
  details?: Record<string, unknown>;
}

export async function writeAuditLog(
  input: WriteAuditLogInput,
  runner: QueryRunner = getDb()
): Promise<void> {
  const ip =
    input.req?.headers['x-forwarded-for']?.toString().split(',')[0]?.trim() ||
    input.req?.ip ||
    null;
  const userAgent = input.req?.headers['user-agent']?.slice(0, 240) || null;

  await runner.query(
    `INSERT INTO public.audit_logs
       (actor_profile_id, actor_role, action, resource_type, resource_id, ip_address, user_agent, details)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)`,
    [
      input.actorProfileId,
      input.actorRole,
      input.action,
      input.resourceType,
      input.resourceId ?? null,
      ip,
      userAgent,
      JSON.stringify(input.details || {}),
    ]
  );
}
