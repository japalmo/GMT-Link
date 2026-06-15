import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Put,
  Query,
  UnauthorizedException,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { CurrentUser } from '../../auth/current-user.decorator';
import type { AuthUser } from '../../authz/auth-user.types';
import { TasksService } from './tasks.service';
import { CreateTaskDto, UpdateTaskDto, UpdateTaskStatusDto } from './dto/tasks.dto';
import { TaskStatus } from '@prisma/client';

@Controller('tasks')
@UsePipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }))
export class TasksController {
  constructor(private readonly tasks: TasksService) {}

  @Post()
  create(
    @CurrentUser() authUser: AuthUser | undefined,
    @Body() dto: CreateTaskDto,
  ) {
    const userId = this.requireUserId(authUser);
    return this.tasks.create(userId, dto);
  }

  @Get()
  list(
    @CurrentUser() authUser: AuthUser | undefined,
    @Query('projectId') projectId?: string,
    @Query('serviceId') serviceId?: string,
    @Query('status') status?: TaskStatus,
    @Query('assignedToId') assignedToId?: string,
    @Query('search') search?: string,
  ) {
    const userId = this.requireUserId(authUser);
    return this.tasks.list(userId, { projectId, serviceId, status, assignedToId, search });
  }

  @Get(':id')
  getById(
    @CurrentUser() authUser: AuthUser | undefined,
    @Param('id') id: string,
  ) {
    const userId = this.requireUserId(authUser);
    return this.tasks.getById(id, userId);
  }

  @Put(':id')
  update(
    @CurrentUser() authUser: AuthUser | undefined,
    @Param('id') id: string,
    @Body() dto: UpdateTaskDto,
  ) {
    const userId = this.requireUserId(authUser);
    return this.tasks.update(id, userId, dto);
  }

  @Put(':id/status')
  @HttpCode(200)
  updateStatus(
    @CurrentUser() authUser: AuthUser | undefined,
    @Param('id') id: string,
    @Body() dto: UpdateTaskStatusDto,
  ) {
    const userId = this.requireUserId(authUser);
    return this.tasks.updateStatus(id, userId, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  remove(
    @CurrentUser() authUser: AuthUser | undefined,
    @Param('id') id: string,
  ) {
    const userId = this.requireUserId(authUser);
    return this.tasks.remove(id, userId);
  }

  private requireUserId(authUser: AuthUser | undefined): string {
    if (!authUser) {
      throw new UnauthorizedException('Se requiere un usuario autenticado.');
    }
    return authUser.id;
  }
}
