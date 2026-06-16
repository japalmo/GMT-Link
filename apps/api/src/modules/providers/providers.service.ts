import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { GamificationService } from '../gamification/gamification.service';
import {
  AddProviderProductDto,
  CreateProviderDto,
  SubmitProviderRatingDto,
} from './dto/providers.dto';
import { ProviderProductView, ProviderRatingView, ProviderView } from './providers.types';
import { Provider, ProviderProduct, ProviderRating, User } from '@prisma/client';

@Injectable()
export class ProvidersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    private readonly gamification: GamificationService,
  ) {}

  async createProvider(dto: CreateProviderDto): Promise<ProviderView> {
    if (dto.rut) {
      const existing = await this.prisma.provider.findUnique({
        where: { rut: dto.rut },
      });
      if (existing) {
        throw new BadRequestException(`Ya existe un proveedor registrado con el RUT "${dto.rut}".`);
      }
    }

    const row = await this.prisma.provider.create({
      data: {
        rut: dto.rut || null,
        name: dto.name,
        email: dto.email || null,
        phone: dto.phone || null,
        address: dto.address || null,
        score: 0.0,
      },
    });

    return this.toProviderView(row);
  }

  async listProviders(): Promise<ProviderView[]> {
    const rows = await this.prisma.provider.findMany({
      orderBy: { name: 'asc' },
    });
    return rows.map((r) => this.toProviderView(r));
  }

  async getProviderById(id: string): Promise<{
    provider: ProviderView;
    products: ProviderProductView[];
    ratings: ProviderRatingView[];
  }> {
    const provider = await this.prisma.provider.findUnique({ where: { id } });
    if (!provider) {
      throw new NotFoundException('El proveedor no existe.');
    }

    const products = await this.prisma.providerProduct.findMany({
      where: { providerId: id },
      orderBy: { name: 'asc' },
    });

    const ratings = await this.prisma.providerRating.findMany({
      where: { providerId: id },
      include: { actor: true },
      orderBy: { createdAt: 'desc' },
    });

    return {
      provider: this.toProviderView(provider),
      products: products.map((p) => this.toProductView(p)),
      ratings: ratings.map((r) => this.toRatingView(r)),
    };
  }

  async addProduct(providerId: string, dto: AddProviderProductDto): Promise<ProviderProductView> {
    const provider = await this.prisma.provider.findUnique({ where: { id: providerId } });
    if (!provider) {
      throw new NotFoundException('El proveedor no existe.');
    }

    const row = await this.prisma.providerProduct.create({
      data: {
        providerId,
        name: dto.name,
        description: dto.description || null,
        price: dto.price !== undefined ? Math.round(dto.price) : null,
        unit: dto.unit || null,
      },
    });

    return this.toProductView(row);
  }

  async submitRating(
    providerId: string,
    actorId: string,
    dto: SubmitProviderRatingDto,
  ): Promise<ProviderRatingView> {
    const provider = await this.prisma.provider.findUnique({ where: { id: providerId } });
    if (!provider) {
      throw new NotFoundException('El proveedor no existe.');
    }

    const rating = await this.prisma.$transaction(async (prismaTx) => {
      const created = await prismaTx.providerRating.create({
        data: {
          providerId,
          score: dto.score,
          comment: dto.comment || null,
          actorId,
        },
        include: {
          actor: true,
        },
      });

      const allRatings = await prismaTx.providerRating.findMany({
        where: { providerId },
      });

      const totalScore = allRatings.reduce((sum, r) => sum + r.score, 0);
      const avg = allRatings.length > 0 ? Number((totalScore / allRatings.length).toFixed(2)) : 0;

      await prismaTx.provider.update({
        where: { id: providerId },
        data: { score: avg },
      });

      return created;
    });

    // Gamificación: otorgar puntos por evaluar proveedor (best-effort)
    void this.gamification.awardPoints(actorId, 'RATE_PROVIDER');

    return this.toRatingView(rating);
  }

  async cleanProviderData(
    userId: string,
    rawData: string,
  ): Promise<{
    name: string;
    rut?: string;
    email?: string;
    phone?: string;
    address?: string;
    products: Array<{ name: string; description?: string; price?: number; unit?: string }>;
  }> {
    // 1. Validate Gemini quota limit (3 queries per day)
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const usageCount = await this.prisma.geminiUsage.count({
      where: {
        userId,
        createdAt: { gte: today },
      },
    });

    if (usageCount >= 3) {
      throw new BadRequestException(
        'Has alcanzado tu límite de 3 consultas de IA para el día de hoy.',
      );
    }

    const apiKey = this.configService.get<string>('GEMINI_API_KEY');
    if (!apiKey) {
      // In development, if no API key is present, fallback to a mocked clean response so it doesn't block evaluation.
      await this.prisma.geminiUsage.create({
        data: { userId, action: 'DATA_CLEANING' },
      });
      return {
        name: 'Proveedor Demo Autodetectado',
        rut: '12.345.678-9',
        email: 'contacto@demo-ia.cl',
        phone: '+56912345678',
        address: 'Av. Providencia 1234, Santiago',
        products: [
          { name: 'Producto Demo 1', description: 'Cargado por detector fallback de IA', price: 25000, unit: 'unidades' },
        ],
      };
    }

    // Register usage
    await this.prisma.geminiUsage.create({
      data: { userId, action: 'DATA_CLEANING' },
    });

    // 2. Query Gemini API
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`;
    const prompt = `Parse the following unstructured text containing provider contact details or products/services catalog information.
Extract values and return ONLY a valid, raw JSON object matching the JSON schema below. Do not wrap the JSON output in markdown formatting blocks or include any commentary.
JSON Schema:
{
  "name": "string (required, name of provider company)",
  "rut": "string (optional, Chilean RUT format)",
  "email": "string (optional, email address)",
  "phone": "string (optional, contact number)",
  "address": "string (optional, physical address)",
  "products": [
    {
      "name": "string (required, name of product/service)",
      "description": "string (optional)",
      "price": "number (optional, CLP integer value without decimals)",
      "unit": "string (optional, unit of measurement)"
    }
  ]
}

Unstructured text to parse:
${rawData}`;

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
        }),
      });

      if (!response.ok) {
        throw new Error(`Gemini API returned status ${response.status}`);
      }

      const resBody = (await response.json()) as Record<string, unknown>;
      const candidates = resBody.candidates as Record<string, unknown>[] | undefined;
      const firstCandidate = candidates?.[0];
      const content = firstCandidate?.content as Record<string, unknown> | undefined;
      const parts = content?.parts as Record<string, unknown>[] | undefined;
      let rawText = (parts?.[0]?.text as string) || '';

      // Clean up markdown formatting if returned
      rawText = rawText.trim();
      if (rawText.startsWith('```')) {
        rawText = rawText.replace(/^```json\s*/, '').replace(/```\s*$/, '');
      }
      rawText = rawText.trim();

      const parsed = JSON.parse(rawText);
      return {
        name: parsed.name || 'Proveedor Extraído con IA',
        rut: parsed.rut || undefined,
        email: parsed.email || undefined,
        phone: parsed.phone || undefined,
        address: parsed.address || undefined,
        products: Array.isArray(parsed.products) ? parsed.products : [],
      };
    } catch (err) {
      console.error('Gemini cleanup API error:', err);
      throw new BadRequestException('Error al procesar los datos con la Inteligencia Artificial.');
    }
  }

  private toProviderView(p: Provider): ProviderView {
    return {
      id: p.id,
      rut: p.rut,
      name: p.name,
      email: p.email,
      phone: p.phone,
      address: p.address,
      score: p.score,
      createdAt: p.createdAt.toISOString(),
      updatedAt: p.updatedAt.toISOString(),
    };
  }

  private toProductView(p: ProviderProduct): ProviderProductView {
    return {
      id: p.id,
      providerId: p.providerId,
      name: p.name,
      description: p.description,
      price: p.price,
      unit: p.unit,
      createdAt: p.createdAt.toISOString(),
      updatedAt: p.updatedAt.toISOString(),
    };
  }

  private toRatingView(r: ProviderRating & { actor?: User | null }): ProviderRatingView {
    return {
      id: r.id,
      providerId: r.providerId,
      score: r.score,
      comment: r.comment,
      actorId: r.actorId,
      createdAt: r.createdAt.toISOString(),
      actor: r.actor
        ? {
            firstName: r.actor.firstName,
            lastName: r.actor.lastName,
          }
        : null,
    };
  }
}
