import { Injectable } from '@nestjs/common';
import type { OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

/**
 * Cliente Prisma gestionado por el ciclo de vida de Nest.
 * Conecta al iniciar el módulo y desconecta al destruirlo, de modo que la
 * conexión a Postgres se abre/cierra de forma determinista junto con la app.
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  async onModuleInit(): Promise<void> {
    await this.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
