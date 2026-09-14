import { Test, TestingModule } from '@nestjs/testing';
import { getQueueToken } from '@nestjs/bullmq';
import { ConfigService } from '@nestjs/config';

import { PrismaService } from '../../prisma/prisma.service';
import { NotificationsService } from './notifications.service';

describe('NotificationsService', () => {
  let service: NotificationsService;
  let emailQueue: { add: jest.Mock };
  let configService: jest.Mocked<ConfigService>;

  beforeEach(async () => {
    emailQueue = { add: jest.fn().mockResolvedValue(undefined) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NotificationsService,
        {
          provide: getQueueToken('emails'),
          useValue: emailQueue,
        },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string, fallback?: string) => {
              const config: Record<string, string> = {
                APP_URL: 'https://libertasian.com',
              };
              return config[key] ?? fallback;
            }),
          },
        },
        {
          provide: PrismaService,
          useValue: {
            user: {
              findMany: jest.fn().mockResolvedValue([]),
            },
            emailPreference: {
              findUnique: jest.fn(),
            },
          },
        },
      ],
    }).compile();

    service = module.get<NotificationsService>(NotificationsService);
    configService = module.get(ConfigService);
  });

  // ---- sendVerificationEmail ----

  describe('sendVerificationEmail', () => {
    it('should enqueue a verification email with 6-digit code', async () => {
      await service.sendVerificationEmail(
        'maria@example.com',
        'Maria Santos',
        '123456',
      );

      expect(emailQueue.add).toHaveBeenCalledTimes(1);
      expect(emailQueue.add).toHaveBeenCalledWith(
        'send-email',
        expect.objectContaining({
          to: 'maria@example.com',
          subject: expect.any(String),
          html: expect.stringContaining('1'),
        }),
        expect.objectContaining({
          attempts: 3,
          backoff: { type: 'exponential', delay: 5000 },
          removeOnComplete: 100,
          removeOnFail: 500,
        }),
      );
    });

    it('should include each digit of the code in the email body', async () => {
      await service.sendVerificationEmail(
        'test@example.com',
        'Test User',
        '987654',
      );

      const call = emailQueue.add.mock.calls[0];
      const emailData = call[1] as { html: string };
      // Each digit should appear in the HTML
      for (const digit of '987654') {
        expect(emailData.html).toContain(digit);
      }
    });
  });

  // ---- sendPasswordResetEmail ----

  describe('sendPasswordResetEmail', () => {
    it('should enqueue a password reset email', async () => {
      await service.sendPasswordResetEmail(
        'carlos@example.com',
        'Atty. Carlos',
        'reset-token-456',
      );

      expect(emailQueue.add).toHaveBeenCalledTimes(1);
      expect(emailQueue.add).toHaveBeenCalledWith(
        'send-email',
        expect.objectContaining({
          to: 'carlos@example.com',
          subject: expect.any(String),
          html: expect.stringContaining('reset-token-456'),
        }),
        expect.any(Object),
      );
    });

    it('should include the correct reset URL', async () => {
      await service.sendPasswordResetEmail(
        'test@example.com',
        'Test User',
        'rst-token',
      );

      const call = emailQueue.add.mock.calls[0];
      const emailData = call[1] as { html: string };
      // Exact path: `(auth)` is a Next.js route GROUP, so the web page lives at
      // /reset-password. An `/auth/` prefix 307s to /login — the live bug.
      expect(emailData.html).toContain(
        'https://libertasian.com/reset-password?token=rst-token',
      );
      expect(emailData.html).not.toContain('/auth/reset-password');
    });
  });

  // ---- sendPasswordChangedEmail ----

  describe('sendPasswordChangedEmail', () => {
    it('links to /forgot-password, not the route-group path /auth/forgot-password', async () => {
      await service.sendPasswordChangedEmail(
        'test@example.com',
        'Test User',
        '203.0.113.9',
        new Date('2026-09-13T04:05:06.000Z'),
      );

      const emailData = emailQueue.add.mock.calls[0][1] as { html: string };
      expect(emailData.html).toContain('https://libertasian.com/forgot-password');
      expect(emailData.html).not.toContain('/auth/forgot-password');
    });
  });

  // ---- sendMemberInviteEmail ----

  describe('sendMemberInviteEmail', () => {
    it('should enqueue a member invite email', async () => {
      await service.sendMemberInviteEmail(
        'new@example.com',
        'Elena',
        'Santos Law Office',
        'Atty. Reyes',
        'admin',
        'raw-invite-token',
      );

      expect(emailQueue.add).toHaveBeenCalledTimes(1);
      expect(emailQueue.add).toHaveBeenCalledWith(
        'send-email',
        expect.objectContaining({
          to: 'new@example.com',
          subject: expect.any(String),
          html: expect.any(String),
        }),
        expect.any(Object),
      );
    });

    it('carries the raw token in the accept URL and points at the real web page', async () => {
      await service.sendMemberInviteEmail(
        'test@example.com',
        'Invitee',
        'Test Firm',
        'Inviter',
        'member',
        'raw-invite-token',
      );

      const call = emailQueue.add.mock.calls[0];
      const emailData = call[1] as { html: string };
      // Without the raw token the invitee has nothing to POST to
      // /auth/accept-invite — only its hash is stored server-side.
      expect(emailData.html).toContain(
        'https://libertasian.com/accept-invite?token=raw-invite-token',
      );
      // The old URL matched no web route at all and 307'd to /login.
      expect(emailData.html).not.toContain('/organizations/accept-invite');
    });

    it('URL-encodes the token', async () => {
      await service.sendMemberInviteEmail(
        'test@example.com',
        'Invitee',
        'Test Firm',
        'Inviter',
        'member',
        'tok/en+with spaces',
      );

      const emailData = emailQueue.add.mock.calls[0][1] as { html: string };
      expect(emailData.html).toContain(
        'https://libertasian.com/accept-invite?token=tok%2Fen%2Bwith%20spaces',
      );
    });

    it('states the role being granted', async () => {
      await service.sendMemberInviteEmail(
        'test@example.com',
        'Invitee',
        'Test Firm',
        'Inviter',
        'admin',
        'raw-invite-token',
      );

      const emailData = emailQueue.add.mock.calls[0][1] as { html: string };
      expect(emailData.html).toContain('<strong>admin</strong>');
    });

    it('addresses the invitee by email when no name is known', async () => {
      await service.sendMemberInviteEmail(
        'nonexistent@test.com',
        'nonexistent@test.com',
        'Test Firm',
        'Inviter',
        'member',
        'raw-invite-token',
      );

      const emailData = emailQueue.add.mock.calls[0][1] as { html: string };
      expect(emailData.html).toContain('Hi nonexistent@test.com,');
      expect(emailData.html).not.toContain('New User');
    });

    it('sends an already-registered invitee to the members page (no token to redeem)', async () => {
      await service.sendMemberInviteEmail(
        'member@example.com',
        'Elena',
        'Test Firm',
        'Inviter',
        'member',
      );

      const emailData = emailQueue.add.mock.calls[0][1] as { html: string };
      expect(emailData.html).toContain('https://libertasian.com/settings/members');
      expect(emailData.html).not.toContain('/accept-invite');
    });
  });

  // ---- sendRenewalReminder ----

  describe('sendRenewalReminder', () => {
    const params = {
      email: 'owner@example.com',
      userName: 'Owner',
      planName: 'Pro',
      billingPeriod: 'monthly',
      amount: '1,999.00',
      chargeDate: 'August 1, 2026',
      paymentMethod: 'Visa •••• 4242',
    };

    it('enqueues the reminder with the card-network subject line (plan, date, amount)', async () => {
      await service.sendRenewalReminder(params);

      expect(emailQueue.add).toHaveBeenCalledTimes(1);
      expect(emailQueue.add).toHaveBeenCalledWith(
        'send-email',
        expect.objectContaining({
          to: 'owner@example.com',
          subject: 'Your LIBERTASIAN Pro plan renews on August 1, 2026 — ₱1,999.00',
        }),
        expect.any(Object),
      );
    });

    it('includes the amount (VAT-inclusive), charge date, instrument and manage link in the body', async () => {
      await service.sendRenewalReminder(params);

      const emailData = emailQueue.add.mock.calls[0][1] as { html: string };
      expect(emailData.html).toContain('₱1,999.00');
      expect(emailData.html).toContain('VAT-inclusive');
      expect(emailData.html).toContain('August 1, 2026');
      expect(emailData.html).toContain('Visa •••• 4242');
      expect(emailData.html).toContain('https://libertasian.com/settings/billing');
      expect(emailData.html).toContain('support@libertasian.com');
    });

    it('labels the interval from billingPeriod (annual → Annual)', async () => {
      await service.sendRenewalReminder({ ...params, billingPeriod: 'annual' });

      const emailData = emailQueue.add.mock.calls[0][1] as { html: string };
      expect(emailData.html).toContain('Pro — Annual');
    });
  });

  // ---- retry configuration ----

  describe('email queue configuration', () => {
    it('should use exponential backoff with 3 attempts', async () => {
      await service.sendVerificationEmail('a@b.com', 'A', '123456');

      const call = emailQueue.add.mock.calls[0];
      const options = call[2] as Record<string, unknown>;
      expect(options).toEqual(
        expect.objectContaining({
          attempts: 3,
          backoff: { type: 'exponential', delay: 5000 },
          removeOnComplete: 100,
          removeOnFail: 500,
        }),
      );
    });
  });
});
