import { Injectable, NotFoundException } from '@nestjs/common';

import { PrismaService } from '../../prisma/prisma.service';
import { CompleteOnboardingDto } from './dto/complete-onboarding.dto';
import { UpdateUserDto } from './dto/update-user.dto';

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  async findByEmail(email: string) {
    return this.prisma.user.findUnique({
      where: { email: email.toLowerCase().trim() },
    });
  }

  async findById(id: string) {
    const user = await this.prisma.user.findUnique({
      where: { id },
    });
    if (!user) {
      throw new NotFoundException('User not found');
    }
    return user;
  }

  async create(data: { email: string; passwordHash: string; fullName: string }) {
    return this.prisma.user.create({
      data: {
        email: data.email.toLowerCase().trim(),
        passwordHash: data.passwordHash,
        fullName: data.fullName.trim(),
      },
    });
  }

  async findByGoogleId(googleId: string) {
    return this.prisma.user.findUnique({
      where: { googleId },
    });
  }

  async createFromGoogle(data: { email: string; fullName: string; googleId: string }) {
    return this.prisma.user.create({
      data: {
        email: data.email.toLowerCase().trim(),
        fullName: data.fullName.trim(),
        googleId: data.googleId,
        emailVerified: true, // Google-verified email
      },
    });
  }

  async linkGoogleAccount(userId: string, googleId: string) {
    return this.prisma.user.update({
      where: { id: userId },
      data: { googleId },
    });
  }

  async update(id: string, dto: UpdateUserDto) {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) {
      throw new NotFoundException('User not found');
    }
    return this.prisma.user.update({
      where: { id },
      data: {
        ...(dto.fullName !== undefined && { fullName: dto.fullName.trim() }),
        ...(dto.phone !== undefined && { phone: dto.phone.trim() }),
      },
    });
  }

  async setEmailVerified(id: string) {
    return this.prisma.user.update({
      where: { id },
      data: { emailVerified: true, emailVerifyToken: null },
    });
  }

  async setMfaSecret(id: string, encryptedSecret: string) {
    return this.prisma.user.update({
      where: { id },
      data: { mfaSecret: encryptedSecret, mfaEnabled: true },
    });
  }

  async disableMfa(id: string) {
    return this.prisma.user.update({
      where: { id },
      data: { mfaSecret: null, mfaEnabled: false },
    });
  }

  async completeOnboarding(userId: string, dto: CompleteOnboardingDto) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException('User not found');
    }
    return this.prisma.user.update({
      where: { id: userId },
      data: {
        userRole: dto.userRole,
        onboardingCompletedAt: new Date(),
      },
    });
  }

  /** Returns a safe user object without sensitive fields */
  sanitize(user: {
    id: string;
    email: string;
    fullName: string;
    phone: string | null;
    status: string;
    emailVerified: boolean;
    mfaEnabled: boolean;
    onboardingCompletedAt: Date | null;
    userRole: string | null;
    createdAt: Date;
    updatedAt: Date;
  }) {
    return {
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      phone: user.phone,
      status: user.status,
      emailVerified: user.emailVerified,
      mfaEnabled: user.mfaEnabled,
      onboardingCompletedAt: user.onboardingCompletedAt,
      userRole: user.userRole,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    };
  }
}
