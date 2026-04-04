import { Test, TestingModule } from '@nestjs/testing';
import { getQueueToken } from '@nestjs/bullmq';
import { ConfigService } from '@nestjs/config';

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
      ],
    }).compile();

    service = module.get<NotificationsService>(NotificationsService);
    configService = module.get(ConfigService);
  });

  // ---- sendVerificationEmail ----

  describe('sendVerificationEmail', () => {
    it('should enqueue a verification email with correct data', async () => {
      await service.sendVerificationEmail(
        'maria@example.com',
        'Maria Santos',
        'verify-token-123',
      );

      expect(emailQueue.add).toHaveBeenCalledTimes(1);
      expect(emailQueue.add).toHaveBeenCalledWith(
        'send-email',
        expect.objectContaining({
          to: 'maria@example.com',
          subject: expect.any(String),
          html: expect.stringContaining('verify-token-123'),
        }),
        expect.objectContaining({
          attempts: 3,
          backoff: { type: 'exponential', delay: 5000 },
          removeOnComplete: 100,
          removeOnFail: 500,
        }),
      );
    });

    it('should include the correct verification URL', async () => {
      await service.sendVerificationEmail(
        'test@example.com',
        'Test User',
        'abc-token',
      );

      const call = emailQueue.add.mock.calls[0];
      const emailData = call[1] as { html: string };
      expect(emailData.html).toContain(
        'https://libertasian.com/auth/verify-email?token=abc-token',
      );
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
      expect(emailData.html).toContain(
        'https://libertasian.com/auth/reset-password?token=rst-token',
      );
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

    it('should include accept URL in email body', async () => {
      await service.sendMemberInviteEmail(
        'test@example.com',
        'Invitee',
        'Test Firm',
        'Inviter',
      );

      const call = emailQueue.add.mock.calls[0];
      const emailData = call[1] as { html: string };
      expect(emailData.html).toContain(
        'https://libertasian.com/organizations/accept-invite',
      );
    });
  });

  // ---- retry configuration ----

  describe('email queue configuration', () => {
    it('should use exponential backoff with 3 attempts', async () => {
      await service.sendVerificationEmail('a@b.com', 'A', 'token');

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
