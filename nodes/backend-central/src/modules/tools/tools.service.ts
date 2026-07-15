import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { ConvertDirection, ConvertPointDto } from './dto/tools.dto';
import { callNvidiaChat, extractJson } from '../../common/nvidia';

// Pure mathematical UTM <-> Lat/Long conversion
export function utmToLatLong(easting: number, northing: number, zone: number, southernHemisphere: boolean) {
  const a = 6378137.0; // equatorial radius
  const f = 1.0 / 298.257223563; // WGS84 flattening
  const b = a * (1.0 - f);
  const k0 = 0.9996;

  const e = Math.sqrt(1.0 - (b * b) / (a * a));
  const ePrimeSq = (e * e) / (1.0 - e * e);

  const x = easting - 500000.0;
  let y = northing;
  if (southernHemisphere) {
    y = northing - 10000000.0;
  }

  const longitudeOrigin = (zone - 1) * 6 - 180 + 3;

  const eccSquared = e * e;
  const e1 = (1 - Math.sqrt(1 - eccSquared)) / (1 + Math.sqrt(1 - eccSquared));

  const M = y / k0;
  const mu = M / (a * (1 - eccSquared / 4 - 3 * eccSquared * eccSquared / 64 - 5 * eccSquared * eccSquared * eccSquared / 256));

  const phi1Rad = mu + (3 * e1 / 2 - 27 * e1 * e1 * e1 / 32) * Math.sin(2 * mu)
                + (21 * e1 * e1 / 16 - 55 * e1 * e1 * e1 * e1 / 32) * Math.sin(4 * mu)
                + (151 * e1 * e1 * e1 / 96) * Math.sin(6 * mu);

  const N1 = a / Math.sqrt(1.0 - eccSquared * Math.sin(phi1Rad) * Math.sin(phi1Rad));
  const T1 = Math.tan(phi1Rad) * Math.tan(phi1Rad);
  const C1 = ePrimeSq * Math.cos(phi1Rad) * Math.cos(phi1Rad);
  const R1 = a * (1 - eccSquared) / Math.pow(1 - eccSquared * Math.sin(phi1Rad) * Math.sin(phi1Rad), 1.5);
  const D = x / (N1 * k0);

  let lat = phi1Rad - (N1 * Math.tan(phi1Rad) / R1) * (D * D / 2 - (5 + 3 * T1 + 10 * C1 - 4 * C1 * C1 - 9 * ePrimeSq) * D * D * D * D / 24
            + (61 + 90 * T1 + 298 * C1 + 45 * T1 * T1 - 252 * ePrimeSq - 3 * C1 * C1) * D * D * D * D * D * D / 720);

  let lng = (D - (1 + 2 * T1 + C1) * D * D * D / 6 + (5 - 2 * C1 + 28 * T1 - 3 * C1 * C1 + 8 * ePrimeSq + 24 * T1 * T1) * D * D * D * D * D / 120) / Math.cos(phi1Rad);

  lat = lat * 180 / Math.PI;
  lng = lng * 180 / Math.PI + longitudeOrigin;

  return { latitude: lat, longitude: lng };
}

export function latLongToUtm(latitude: number, longitude: number) {
  const a = 6378137.0;
  const f = 1.0 / 298.257223563;
  const b = a * (1.0 - f);
  const k0 = 0.9996;

  const e = Math.sqrt(1.0 - (b * b) / (a * a));
  const eccSquared = e * e;
  const ePrimeSq = (eccSquared) / (1.0 - eccSquared);

  const latRad = latitude * Math.PI / 180;
  const lngRad = longitude * Math.PI / 180;

  let zone = Math.floor((longitude + 180) / 6) + 1;
  if (latitude >= 56.0 && latitude < 64.0 && longitude >= 3.0 && longitude < 12.0) {
    zone = 32;
  }

  const longitudeOrigin = (zone - 1) * 6 - 180 + 3;
  const lngOriginRad = longitudeOrigin * Math.PI / 180;

  const N = a / Math.sqrt(1.0 - eccSquared * Math.sin(latRad) * Math.sin(latRad));
  const T = Math.tan(latRad) * Math.tan(latRad);
  const C = ePrimeSq * Math.cos(latRad) * Math.cos(latRad);
  const A = (lngRad - lngOriginRad) * Math.cos(latRad);

  const M = a * ((1 - eccSquared / 4 - 3 * eccSquared * eccSquared / 64 - 5 * eccSquared * eccSquared * eccSquared / 256) * latRad
            - (3 * eccSquared / 8 + 3 * eccSquared * eccSquared / 32 + 45 * eccSquared * eccSquared * eccSquared / 1024) * Math.sin(2 * latRad)
            + (15 * eccSquared * eccSquared / 256 + 45 * eccSquared * eccSquared * eccSquared / 1024) * Math.sin(4 * latRad)
            - (35 * eccSquared * eccSquared * eccSquared / 3072) * Math.sin(6 * latRad));

  const easting = k0 * N * (A + (1 - T + C) * A * A * A / 6 + (5 - 18 * T + T * T + 72 * C - 58 * ePrimeSq) * A * A * A * A * A / 120) + 500000.0;
  let northing = k0 * (M + N * Math.tan(latRad) * (A * A / 2 + (5 - T + 9 * C + 4 * C * C) * A * A * A * A / 24
                + (61 - 58 * T + T * T + 600 * C - 330 * ePrimeSq) * A * A * A * A * A * A / 720));

  const southernHemisphere = latitude < 0;
  if (southernHemisphere) {
    northing += 10000000.0;
  }

  return { easting, northing, zone, southernHemisphere };
}

@Injectable()
export class ToolsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {}

  convertPoint(dto: ConvertPointDto) {
    if (dto.direction === ConvertDirection.UTM_TO_LL) {
      if (dto.easting === undefined || dto.northing === undefined) {
        throw new BadRequestException('easting y northing son obligatorios para conversión UTM a Lat/Long.');
      }
      const zone = dto.zone !== undefined ? dto.zone : 19;
      const south = dto.southernHemisphere !== undefined ? dto.southernHemisphere : true;
      const res = utmToLatLong(dto.easting, dto.northing, zone, south);
      return {
        direction: dto.direction,
        easting: dto.easting,
        northing: dto.northing,
        zone,
        southernHemisphere: south,
        latitude: res.latitude,
        longitude: res.longitude,
      };
    } else {
      if (dto.latitude === undefined || dto.longitude === undefined) {
        throw new BadRequestException('latitude y longitude son obligatorios para conversión Lat/Long a UTM.');
      }
      const res = latLongToUtm(dto.latitude, dto.longitude);
      return {
        direction: dto.direction,
        latitude: dto.latitude,
        longitude: dto.longitude,
        easting: res.easting,
        northing: res.northing,
        zone: res.zone,
        southernHemisphere: res.southernHemisphere,
      };
    }
  }

  async detectShoreline(
    userId: string,
    fileBase64: string,
  ): Promise<{ polygon: Array<{ x: number; y: number }> }> {
    // Sin límite diario: los modelos NVIDIA NIM son gratuitos e ilimitados. Se
    // conserva el registro de uso (geminiUsage) solo como auditoría.

    // Strip header if base64 starts with data URI scheme
    let rawBase64 = fileBase64;
    const match = fileBase64.match(/^data:image\/([a-zA-Z]+);base64,(.+)$/);
    let mimeType = 'image/jpeg';
    if (match && match[1] && match[2]) {
      mimeType = `image/${match[1]}`;
      rawBase64 = match[2];
    }

    const apiKey =
      this.configService.get<string>('NVIDIA_API_KEY_VISION') ??
      this.configService.get<string>('NVIDIA_API_KEY');
    if (!apiKey) {
      // Dev mode placeholder fallback (sin clave NVIDIA configurada)
      await this.prisma.geminiUsage.create({
        data: { userId, action: 'SHORE_DETECTION' },
      });
      return {
        polygon: [
          { x: 15, y: 40 },
          { x: 45, y: 30 },
          { x: 75, y: 50 },
          { x: 85, y: 75 },
          { x: 50, y: 85 },
          { x: 25, y: 65 },
        ],
      };
    }

    // Register usage count
    await this.prisma.geminiUsage.create({
      data: { userId, action: 'SHORE_DETECTION' },
    });

    const model =
      this.configService.get<string>('NVIDIA_VISION_MODEL') ??
      'meta/llama-3.2-90b-vision-instruct';
    const prompt = `Analyze the attached orthophoto image. Detect the shoreline / land-water boundary.
Return ONLY a valid, raw JSON object containing a list of normalized coordinates tracing the shoreline polygon.
Use normalized percentage values from 0 to 100 relative to the image size (where top-left is {"x": 0, "y": 0} and bottom-right is {"x": 100, "y": 100}).
Do not write markdown formatting wrappers or markdown code blocks, return ONLY the raw JSON matching this format:
{
  "polygon": [
    {"x": number, "y": number}
  ]
}`;

    try {
      // NVIDIA NIM (OpenAI-compatible) — modelo multimodal sobre la ortofoto.
      const content = await callNvidiaChat({
        apiKey,
        model,
        maxTokens: 3072,
        temperature: 0,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: prompt },
              { type: 'image_url', image_url: { url: `data:${mimeType};base64,${rawBase64}` } },
            ],
          },
        ],
      });

      const parsed = extractJson(content) as { polygon?: Array<{ x: number; y: number }> };
      const polygon = Array.isArray(parsed.polygon) ? parsed.polygon : [];
      return { polygon };
    } catch (err) {
      console.error('Shore detection NVIDIA call failed:', err);
      throw new BadRequestException('Error al procesar la ortofoto mediante la IA.');
    }
  }

}
