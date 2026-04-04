/**
 * Dev Users Seed Data — 3 additional role-based users for development.
 *
 * All users join the existing `libertasian-dev` organization.
 * Passwords hashed with bcrypt cost factor 12.
 */

import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const ORG_SLUG = 'libertasian-dev';

interface DevUserSeed {
  email: string;
  password: string;
  fullName: string;
  role: string;
  userRole: string;
}

const DEV_USERS: DevUserSeed[] = [
  {
    email: 'editor@libertasian.dev',
    password: 'Editor123456!',
    fullName: 'Maria Santos',
    role: 'editor',
    userRole: 'editor',
  },
  {
    email: 'member@libertasian.dev',
    password: 'Member123456!',
    fullName: 'Carlos Reyes',
    role: 'member',
    userRole: 'member',
  },
  {
    email: 'student@libertasian.dev',
    password: 'Student123456!',
    fullName: 'Ana Cruz',
    role: 'member',
    userRole: 'student',
  },
];

export interface SeededUsers {
  admin: { id: string; email: string };
  editor: { id: string; email: string };
  member: { id: string; email: string };
  student: { id: string; email: string };
  orgId: string;
}

export async function seedDevUsers(prisma: PrismaClient): Promise<SeededUsers> {
  console.log('\n--- Seeding dev users ---');

  // Find existing org and admin
  const org = await prisma.organization.findUnique({ where: { slug: ORG_SLUG } });
  if (!org) {
    throw new Error(`Organization "${ORG_SLUG}" not found. Run base seed first.`);
  }

  const admin = await prisma.user.findFirst({
    where: { memberships: { some: { organizationId: org.id, role: 'admin' } } },
  });
  if (!admin) {
    throw new Error('Admin user not found. Run base seed first.');
  }

  const users: Record<string, { id: string; email: string }> = {
    admin: { id: admin.id, email: admin.email },
  };

  for (const seed of DEV_USERS) {
    const passwordHash = await bcrypt.hash(seed.password, 12);

    const user = await prisma.user.upsert({
      where: { email: seed.email },
      update: {
        passwordHash,
        fullName: seed.fullName,
        status: 'active',
        emailVerified: true,
        userRole: seed.userRole,
      },
      create: {
        email: seed.email,
        passwordHash,
        fullName: seed.fullName,
        status: 'active',
        emailVerified: true,
        mfaEnabled: false,
        userRole: seed.userRole,
      },
    });

    // Ensure org membership
    const existingMembership = await prisma.organizationMember.findUnique({
      where: { organizationId_userId: { organizationId: org.id, userId: user.id } },
    });

    if (!existingMembership) {
      await prisma.organizationMember.create({
        data: {
          organizationId: org.id,
          userId: user.id,
          role: seed.role,
          status: 'active',
        },
      });
    } else {
      await prisma.organizationMember.update({
        where: { id: existingMembership.id },
        data: { role: seed.role, status: 'active' },
      });
    }

    // Map by userRole for easy reference
    const key = seed.userRole === 'student' ? 'student' : seed.role;
    users[key] = { id: user.id, email: user.email };
    console.log(`  User: ${user.email} (${seed.role}) → ${user.id}`);
  }

  console.log(`  ${DEV_USERS.length} dev users seeded.`);

  return {
    admin: users['admin']!,
    editor: users['editor']!,
    member: users['member']!,
    student: users['student']!,
    orgId: org.id,
  };
}
