/**
 * Bootstrap CLI: grant a platform role to an existing account.
 *
 * THIS EXISTS SOLELY TO CREATE THE FIRST ADMIN. Once one person holds an
 * admin-bearing platform role, every later grant goes through the staff panel
 * (Admin → Staff), which enforces the no-privilege-escalation rule this script
 * deliberately bypasses. There is no first admin to be a superset of, so the
 * bootstrap has to skip that one check — and says so, loudly, in the console
 * and in the audit row.
 *
 * Everything else is still enforced, through the same PlatformGrantsService
 * the HTTP path uses: separation of duties, cardinality, and the rule that
 * only system or platform-scope roles (organization_id IS NULL) may be
 * granted.
 *
 * It refuses unless the user already exists: this never creates an account and
 * never sends an invitation. A person with no account signs up themselves.
 *
 * It requires an interactive terminal and an exact typed confirmation, so it
 * cannot run from CI, a deploy hook or a migration. Nothing grants capability
 * automatically — see P2 in the RBAC brief.
 *
 * Idempotent: re-running for a grant that already exists reports it and exits 0.
 *
 * Run (from repo root). ts-node, NOT tsx: this bootstraps the Nest DI
 * container, which needs the tsc-emitted decorator metadata that esbuild does
 * not produce.
 *   pnpm --filter @libertasian/api platform:grant -- --email you@example.com --role admin
 *   # optional expiry:
 *   pnpm --filter @libertasian/api platform:grant -- --email you@example.com --role reviewer --expires-at 2026-12-31
 */
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';

import { NestFactory } from '@nestjs/core';

import { PlatformGrantCliModule } from '../src/modules/rbac/platform-grant-cli.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { PermissionsService } from '../src/modules/rbac/permissions.service';
import { PlatformGrantsService } from '../src/modules/rbac/platform-grants.service';

interface Args {
  email: string;
  role: string;
  expiresAt?: Date;
}

function parseArgs(argv: string[]): Args | { error: string } {
  const get = (name: string): string | undefined => {
    const withEquals = argv.find((a) => a.startsWith(`--${name}=`));
    if (withEquals) return withEquals.slice(name.length + 3);
    const idx = argv.indexOf(`--${name}`);
    if (idx >= 0) {
      const next = argv[idx + 1];
      if (next && !next.startsWith('--')) return next;
    }
    return undefined;
  };

  const email = get('email');
  const role = get('role');
  if (!email || !role) {
    return {
      error:
        'Usage: platform:grant -- --email <email> --role <slug> [--expires-at <ISO date>]',
    };
  }

  const rawExpiry = get('expires-at');
  let expiresAt: Date | undefined;
  if (rawExpiry) {
    expiresAt = new Date(rawExpiry);
    if (Number.isNaN(expiresAt.getTime())) {
      return { error: `--expires-at is not a valid date: "${rawExpiry}"` };
    }
    if (expiresAt.getTime() <= Date.now()) {
      return { error: `--expires-at is in the past: "${rawExpiry}"` };
    }
  }

  return { email: email.trim().toLowerCase(), role: role.trim(), ...(expiresAt ? { expiresAt } : {}) };
}

async function main(): Promise<number> {
  const parsed = parseArgs(process.argv.slice(2));
  if ('error' in parsed) {
    console.error(parsed.error);
    return 1;
  }

  if (!stdin.isTTY) {
    console.error(
      'Refusing to run without an interactive terminal.\n' +
        'This CLI is the manual bootstrap for the first platform admin and must be run by a\n' +
        'human who can read what it is about to do and confirm it. It is not for CI, deploy\n' +
        'hooks or migrations — no automated path may ever create a grant.',
    );
    return 1;
  }

  // PlatformGrantCliModule, NOT AppModule — see the comment on that module.
  // AppModule's 19 BullMQ processors would make this throwaway container a
  // second consumer of the live queues (2026-09-21: 728 digests' audio jobs
  // consumed, 499 audio_renditions rows failed) and bury the prompt below.
  const app = await NestFactory.createApplicationContext(PlatformGrantCliModule, {
    logger: ['error', 'warn'],
  });

  try {
    const prisma = app.get(PrismaService);
    const grants = app.get(PlatformGrantsService);
    const permissions = app.get(PermissionsService);

    const user = await prisma.user.findUnique({
      where: { email: parsed.email },
      select: { id: true, email: true, fullName: true, status: true },
    });
    if (!user) {
      console.error(
        `No account with email "${parsed.email}".\n` +
          'Platform roles are granted to EXISTING accounts only — ask them to sign up first,\n' +
          'then re-run this command.',
      );
      return 1;
    }

    const role = await prisma.roleDefinition.findFirst({
      where: { slug: parsed.role, organizationId: null },
      select: { id: true, name: true, slug: true, isSystem: true },
    });
    if (!role) {
      const available = await prisma.roleDefinition.findMany({
        where: { organizationId: null },
        select: { slug: true },
        orderBy: { slug: 'asc' },
      });
      console.error(
        `No platform-grantable role with slug "${parsed.role}".\n` +
          `Available: ${available.map((r) => r.slug).join(', ') || '(none)'}`,
      );
      return 1;
    }

    const existing = await prisma.platformRoleGrant.findUnique({
      where: {
        userId_roleDefinitionId: { userId: user.id, roleDefinitionId: role.id },
      },
      select: { createdAt: true, expiresAt: true },
    });
    if (existing) {
      console.log(
        `Nothing to do: ${user.email} already holds the platform role "${role.slug}" ` +
          `(granted ${existing.createdAt.toISOString()}` +
          `${existing.expiresAt ? `, expires ${existing.expiresAt.toISOString()}` : ''}).`,
      );
      return 0;
    }

    const conferred = (
      await permissions.resolvePermissionCodes([role.id])
    ).sort();
    const adminCodes = conferred.filter((c) => c.startsWith('admin:'));

    console.log('');
    console.log('About to create a PLATFORM ROLE GRANT');
    console.log('─────────────────────────────────────');
    console.log(`  Account   : ${user.fullName} <${user.email}>`);
    console.log(`  User id   : ${user.id}`);
    console.log(`  Status    : ${user.status}`);
    console.log(`  Role      : ${role.name} (${role.slug})${role.isSystem ? ' [built-in]' : ''}`);
    console.log(`  Expires   : ${parsed.expiresAt ? parsed.expiresAt.toISOString() : 'never'}`);
    console.log(`  Confers   : ${conferred.length} permission(s)`);
    if (adminCodes.length > 0) {
      console.log(`  Of which  : ${adminCodes.length} platform admin:* code(s)`);
      console.log(`              ${adminCodes.join(', ')}`);
    }
    console.log('');
    console.log('  *** The no-privilege-escalation check is BYPASSED for this grant. ***');
    console.log('  That is what makes it a bootstrap: there is no existing admin whose');
    console.log('  permissions this could be checked against. The audit row records the');
    console.log('  bypass. Every grant after this one must be made in Admin → Staff,');
    console.log('  where escalation, separation of duties and cardinality are all enforced.');
    console.log('');

    const rl = createInterface({ input: stdin, output: stdout });
    let answer: string;
    try {
      answer = await rl.question(
        `Type the account email to confirm (${user.email}), or anything else to abort: `,
      );
    } finally {
      rl.close();
    }

    if (answer.trim().toLowerCase() !== user.email.toLowerCase()) {
      console.log('Aborted. Nothing was written.');
      return 1;
    }

    const grant = await grants.grant(
      user.id,
      role.id,
      null,
      parsed.expiresAt,
      {
        bypassEscalationCheck: true,
        source: 'cli:platform-grant (interactive bootstrap)',
      },
    );

    console.log('');
    console.log(
      `Granted "${grant.roleSlug}" to ${grant.email}. Grant id ${grant.id}.`,
    );
    console.log(
      'An audit_logs row was written recording the CLI origin and the bypassed check.',
    );
    console.log(
      'They may need to sign out and back in for the change to reach their session.',
    );
    return 0;
  } finally {
    await app.close();
  }
}

main()
  .then((code) => process.exit(code))
  .catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
