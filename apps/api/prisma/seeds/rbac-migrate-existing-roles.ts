/**
 * RBAC Migration — Backfill MemberRole rows for existing OrganizationMember records.
 *
 * Maps each OrganizationMember's legacy `role` VARCHAR field to the corresponding
 * system RoleDefinition and creates a MemberRole junction record.
 *
 * This is idempotent — existing MemberRole rows are skipped via unique constraint.
 */

import { PrismaClient } from '@prisma/client';

export interface MigratedRoles {
  processed: number;
  created: number;
  skipped: number;
}

export async function migrateExistingRolesToRbac(
  prisma: PrismaClient,
): Promise<MigratedRoles> {
  console.log('\n--- Migrating existing roles to RBAC ---');

  // Load all system role definitions
  const systemRoles = await prisma.roleDefinition.findMany({
    where: { isSystem: true, organizationId: null },
  });

  const roleSlugToId: Record<string, string> = {};
  for (const role of systemRoles) {
    roleSlugToId[role.slug] = role.id;
  }

  if (Object.keys(roleSlugToId).length === 0) {
    console.log('  No system roles found. Run RBAC seed first.');
    return { processed: 0, created: 0, skipped: 0 };
  }

  console.log(`  Found ${systemRoles.length} system roles: ${Object.keys(roleSlugToId).join(', ')}`);

  // Load all organization members
  const members = await prisma.organizationMember.findMany({
    select: {
      id: true,
      role: true,
      userId: true,
      organizationId: true,
    },
  });

  let created = 0;
  let skipped = 0;

  for (const member of members) {
    const roleId = roleSlugToId[member.role];

    if (!roleId) {
      console.warn(`  Warning: no RoleDefinition found for legacy role "${member.role}" (member: ${member.id})`);
      skipped++;
      continue;
    }

    // Check if MemberRole already exists
    const existing = await prisma.memberRole.findUnique({
      where: {
        organizationMemberId_roleDefinitionId: {
          organizationMemberId: member.id,
          roleDefinitionId: roleId,
        },
      },
    });

    if (existing) {
      skipped++;
      continue;
    }

    await prisma.memberRole.create({
      data: {
        organizationMemberId: member.id,
        roleDefinitionId: roleId,
        assignedByUserId: null,
        expiresAt: null,
      },
    });
    created++;
  }

  console.log(`  Processed: ${members.length}, Created: ${created}, Skipped: ${skipped}`);
  return { processed: members.length, created, skipped };
}
