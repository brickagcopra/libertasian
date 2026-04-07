import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { UsersService } from './users.service';
import { PrismaService } from '../../prisma/prisma.service';
import { UpdateUserDto } from './dto/update-user.dto';

describe('UsersService', () => {
  let service: UsersService;
  let prismaService: PrismaService;

  const mockUser = {
    id: 'user-123',
    email: 'test@example.com',
    passwordHash: '$2b$12$hashedpassword',
    fullName: 'Test User',
    phone: null,
    status: 'active',
    emailVerified: false,
    emailVerifyToken: null,
    resetPasswordToken: null,
    resetPasswordExpires: null,
    googleId: null,
    mfaSecret: null,
    mfaEnabled: false,
    onboardingCompletedAt: null as Date | null,
    userRole: null as string | null,
    createdAt: new Date('2024-01-01T00:00:00.000Z'),
    updatedAt: new Date('2024-01-01T00:00:00.000Z'),
  };

  const mockPrismaService = {
    user: {
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsersService,
        {
          provide: PrismaService,
          useValue: mockPrismaService,
        },
      ],
    }).compile();

    service = module.get<UsersService>(UsersService);
    prismaService = module.get<PrismaService>(PrismaService);

    // Clear all mocks before each test
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('findByEmail', () => {
    it('should lowercase and trim email before lookup', async () => {
      const email = '  Test@Example.COM  ';
      mockPrismaService.user.findUnique.mockResolvedValue(mockUser);

      await service.findByEmail(email);

      expect(mockPrismaService.user.findUnique).toHaveBeenCalledWith({
        where: { email: 'test@example.com' },
      });
    });

    it('should return user when found', async () => {
      mockPrismaService.user.findUnique.mockResolvedValue(mockUser);

      const result = await service.findByEmail('test@example.com');

      expect(result).toEqual(mockUser);
    });

    it('should return null when user not found', async () => {
      mockPrismaService.user.findUnique.mockResolvedValue(null);

      const result = await service.findByEmail('nonexistent@example.com');

      expect(result).toBeNull();
    });
  });

  describe('findById', () => {
    it('should return user when found', async () => {
      mockPrismaService.user.findUnique.mockResolvedValue(mockUser);

      const result = await service.findById('user-123');

      expect(result).toEqual(mockUser);
      expect(mockPrismaService.user.findUnique).toHaveBeenCalledWith({
        where: { id: 'user-123' },
      });
    });

    it('should throw NotFoundException when user not found', async () => {
      mockPrismaService.user.findUnique.mockResolvedValue(null);

      await expect(service.findById('nonexistent-id')).rejects.toThrow(
        NotFoundException,
      );
      await expect(service.findById('nonexistent-id')).rejects.toThrow(
        'User not found',
      );
    });
  });

  describe('create', () => {
    it('should create user with lowercased email and trimmed fullName', async () => {
      const createData = {
        email: '  NewUser@Example.COM  ',
        passwordHash: '$2b$12$newhash',
        fullName: '  New User  ',
      };

      const createdUser = {
        ...mockUser,
        email: 'newuser@example.com',
        fullName: 'New User',
        passwordHash: '$2b$12$newhash',
      };

      mockPrismaService.user.create.mockResolvedValue(createdUser);

      const result = await service.create(createData);

      expect(mockPrismaService.user.create).toHaveBeenCalledWith({
        data: {
          email: 'newuser@example.com',
          passwordHash: '$2b$12$newhash',
          fullName: 'New User',
        },
      });
      expect(result).toEqual(createdUser);
    });
  });

  describe('findByGoogleId', () => {
    it('should find user by googleId', async () => {
      const googleUser = { ...mockUser, googleId: 'google-123' };
      mockPrismaService.user.findUnique.mockResolvedValue(googleUser);

      const result = await service.findByGoogleId('google-123');

      expect(mockPrismaService.user.findUnique).toHaveBeenCalledWith({
        where: { googleId: 'google-123' },
      });
      expect(result).toEqual(googleUser);
    });

    it('should return null when googleId not found', async () => {
      mockPrismaService.user.findUnique.mockResolvedValue(null);

      const result = await service.findByGoogleId('nonexistent-google-id');

      expect(result).toBeNull();
    });
  });

  describe('createFromGoogle', () => {
    it('should create user with emailVerified true and lowercased/trimmed data', async () => {
      const googleData = {
        email: '  GoogleUser@Example.COM  ',
        fullName: '  Google User  ',
        googleId: 'google-456',
      };

      const createdGoogleUser = {
        ...mockUser,
        email: 'googleuser@example.com',
        fullName: 'Google User',
        googleId: 'google-456',
        emailVerified: true,
      };

      mockPrismaService.user.create.mockResolvedValue(createdGoogleUser);

      const result = await service.createFromGoogle(googleData);

      expect(mockPrismaService.user.create).toHaveBeenCalledWith({
        data: {
          email: 'googleuser@example.com',
          fullName: 'Google User',
          googleId: 'google-456',
          emailVerified: true,
        },
      });
      expect(result).toEqual(createdGoogleUser);
    });
  });

  describe('linkGoogleAccount', () => {
    it('should update user with googleId', async () => {
      const linkedUser = { ...mockUser, googleId: 'google-789' };
      mockPrismaService.user.update.mockResolvedValue(linkedUser);

      const result = await service.linkGoogleAccount('user-123', 'google-789');

      expect(mockPrismaService.user.update).toHaveBeenCalledWith({
        where: { id: 'user-123' },
        data: { googleId: 'google-789' },
      });
      expect(result).toEqual(linkedUser);
    });
  });

  describe('update', () => {
    it('should update user with provided fields', async () => {
      const updateDto: UpdateUserDto = {
        fullName: '  Updated Name  ',
        phone: '  +1234567890  ',
      };

      const updatedUser = {
        ...mockUser,
        fullName: 'Updated Name',
        phone: '+1234567890',
      };

      mockPrismaService.user.findUnique.mockResolvedValue(mockUser);
      mockPrismaService.user.update.mockResolvedValue(updatedUser);

      const result = await service.update('user-123', updateDto);

      expect(mockPrismaService.user.findUnique).toHaveBeenCalledWith({
        where: { id: 'user-123' },
      });
      expect(mockPrismaService.user.update).toHaveBeenCalledWith({
        where: { id: 'user-123' },
        data: {
          fullName: 'Updated Name',
          phone: '+1234567890',
        },
      });
      expect(result).toEqual(updatedUser);
    });

    it('should only update fullName when phone is undefined', async () => {
      const updateDto: UpdateUserDto = {
        fullName: 'Only Name',
      };

      const updatedUser = { ...mockUser, fullName: 'Only Name' };

      mockPrismaService.user.findUnique.mockResolvedValue(mockUser);
      mockPrismaService.user.update.mockResolvedValue(updatedUser);

      await service.update('user-123', updateDto);

      expect(mockPrismaService.user.update).toHaveBeenCalledWith({
        where: { id: 'user-123' },
        data: {
          fullName: 'Only Name',
        },
      });
    });

    it('should only update phone when fullName is undefined', async () => {
      const updateDto: UpdateUserDto = {
        phone: '+9876543210',
      };

      const updatedUser = { ...mockUser, phone: '+9876543210' };

      mockPrismaService.user.findUnique.mockResolvedValue(mockUser);
      mockPrismaService.user.update.mockResolvedValue(updatedUser);

      await service.update('user-123', updateDto);

      expect(mockPrismaService.user.update).toHaveBeenCalledWith({
        where: { id: 'user-123' },
        data: {
          phone: '+9876543210',
        },
      });
    });

    it('should throw NotFoundException when user not found', async () => {
      const updateDto: UpdateUserDto = {
        fullName: 'Updated Name',
      };

      mockPrismaService.user.findUnique.mockResolvedValue(null);

      await expect(
        service.update('nonexistent-id', updateDto),
      ).rejects.toThrow(NotFoundException);
      await expect(
        service.update('nonexistent-id', updateDto),
      ).rejects.toThrow('User not found');
    });
  });

  describe('setEmailVerified', () => {
    it('should set emailVerified to true and clear emailVerifyToken', async () => {
      const verifiedUser = {
        ...mockUser,
        emailVerified: true,
        emailVerifyToken: null,
      };

      mockPrismaService.user.update.mockResolvedValue(verifiedUser);

      const result = await service.setEmailVerified('user-123');

      expect(mockPrismaService.user.update).toHaveBeenCalledWith({
        where: { id: 'user-123' },
        data: { emailVerified: true, emailVerifyToken: null },
      });
      expect(result).toEqual(verifiedUser);
    });
  });

  describe('setMfaSecret', () => {
    it('should set encrypted MFA secret and enable MFA', async () => {
      const mfaUser = {
        ...mockUser,
        mfaSecret: 'encrypted-secret-123',
        mfaEnabled: true,
      };

      mockPrismaService.user.update.mockResolvedValue(mfaUser);

      const result = await service.setMfaSecret('user-123', 'encrypted-secret-123');

      expect(mockPrismaService.user.update).toHaveBeenCalledWith({
        where: { id: 'user-123' },
        data: { mfaSecret: 'encrypted-secret-123', mfaEnabled: true },
      });
      expect(result).toEqual(mfaUser);
    });
  });

  describe('disableMfa', () => {
    it('should clear MFA secret and disable MFA', async () => {
      const noMfaUser = {
        ...mockUser,
        mfaSecret: null,
        mfaEnabled: false,
      };

      mockPrismaService.user.update.mockResolvedValue(noMfaUser);

      const result = await service.disableMfa('user-123');

      expect(mockPrismaService.user.update).toHaveBeenCalledWith({
        where: { id: 'user-123' },
        data: { mfaSecret: null, mfaEnabled: false },
      });
      expect(result).toEqual(noMfaUser);
    });
  });

  describe('sanitize', () => {
    it('should return only non-sensitive user fields', () => {
      const result = service.sanitize(mockUser);

      expect(result).toEqual({
        id: mockUser.id,
        email: mockUser.email,
        fullName: mockUser.fullName,
        phone: mockUser.phone,
        status: mockUser.status,
        emailVerified: mockUser.emailVerified,
        mfaEnabled: mockUser.mfaEnabled,
        createdAt: mockUser.createdAt,
        updatedAt: mockUser.updatedAt,
      });
    });

    it('should not include sensitive fields like passwordHash', () => {
      const result = service.sanitize(mockUser);

      expect(result).not.toHaveProperty('passwordHash');
      expect(result).not.toHaveProperty('mfaSecret');
      expect(result).not.toHaveProperty('emailVerifyToken');
      expect(result).not.toHaveProperty('resetPasswordToken');
      expect(result).not.toHaveProperty('googleId');
    });

    it('should handle user with phone number', () => {
      const userWithPhone = { ...mockUser, phone: '+1234567890' };
      const result = service.sanitize(userWithPhone);

      expect(result.phone).toBe('+1234567890');
    });
  });
});
