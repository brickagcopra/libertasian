import {
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { JwtPayload } from '@libertasian/types';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { NotificationCenterService } from './notification-center.service';
import { ListNotificationsQueryDto } from './dto';

@ApiTags('Notifications')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
@Controller('notifications')
export class NotificationCenterController {
  constructor(
    private readonly notificationCenterService: NotificationCenterService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'List notifications (cursor pagination, optional read filter)' })
  async listNotifications(
    @Query() query: ListNotificationsQueryDto,
    @CurrentUser() user: JwtPayload,
  ) {
    const result = await this.notificationCenterService.listNotifications(
      user.sub,
      {
        cursor: query.cursor,
        limit: query.limit,
        isRead: query.isRead,
      },
    );
    return { success: true, data: result.items, meta: result.meta };
  }

  @Get('unread-count')
  @ApiOperation({ summary: 'Get unread notification count' })
  async getUnreadCount(@CurrentUser() user: JwtPayload) {
    const count = await this.notificationCenterService.getUnreadCount(user.sub);
    return { success: true, data: { count } };
  }

  @Patch(':id/read')
  @ApiOperation({ summary: 'Mark a single notification as read' })
  async markAsRead(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: JwtPayload,
  ) {
    const notification = await this.notificationCenterService.markAsRead(
      id,
      user.sub,
    );
    return { success: true, data: notification };
  }

  @Post('mark-all-read')
  @ApiOperation({ summary: 'Mark all notifications as read' })
  async markAllAsRead(@CurrentUser() user: JwtPayload) {
    const result = await this.notificationCenterService.markAllAsRead(user.sub);
    return { success: true, data: result };
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete a notification' })
  async deleteNotification(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: JwtPayload,
  ) {
    await this.notificationCenterService.deleteNotification(id, user.sub);
    return { success: true, data: { message: 'Notification deleted' } };
  }
}
