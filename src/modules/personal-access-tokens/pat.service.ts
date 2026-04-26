import { createHash, randomBytes } from 'node:crypto';
import { Injectable, NotFoundException } from '@nestjs/common';
import { MSG } from '@/core/constants';
import { PrismaService } from '@/core/database/prisma.service';
import { AUTH_USER_SELECT } from '@/core/types';
import type { AuthUser } from '@/core/types';
import { CreatePatDto } from './dto';

const TOKEN_PREFIX = 'pat_';
const TOKEN_BYTES = 32; // 64 hex chars
const PREFIX_DISPLAY_LEN = 12; // chars saved in DB for "pat_abcdefgh…" UI

/**
 * Personal access tokens for programmatic API access.
 *
 * Storage model:
 *   - The raw token (`pat_<64-hex>`) is shown ONCE on creation, never again.
 *   - We persist sha256(rawToken) so a DB leak doesn't directly hand out
 *     usable tokens — attacker still needs the preimage.
 *   - `tokenPrefix` is the first 12 chars of the raw token, safe to render
 *     in the UI list (`pat_abc12345…`).
 *
 * Auth path:
 *   - Custom branch in `JwtAuthGuard.canActivate` reads the Bearer header,
 *     hashes when prefix matches `pat_`, looks up the row, and attaches
 *     the user. Standard JWT path runs only when there's no PAT.
 */
@Injectable()
export class PatService {
  constructor(private prisma: PrismaService) {}

  async create(userId: string, dto: CreatePatDto) {
    const raw = `${TOKEN_PREFIX}${randomBytes(TOKEN_BYTES).toString('hex')}`;
    const tokenHash = sha256Hex(raw);
    const tokenPrefix = raw.slice(0, PREFIX_DISPLAY_LEN);
    const expiresAt =
      dto.expiresInDays && dto.expiresInDays > 0
        ? new Date(Date.now() + dto.expiresInDays * 24 * 60 * 60 * 1000)
        : null;

    const row = await this.prisma.personalAccessToken.create({
      data: {
        userId,
        name: dto.name.trim(),
        tokenHash,
        tokenPrefix,
        expiresAt,
      },
    });

    return {
      message: MSG.SUCCESS.PAT_CREATED,
      // Raw token returned ONLY on create — caller MUST display + warn.
      token: raw,
      pat: {
        id: row.id,
        name: row.name,
        tokenPrefix: row.tokenPrefix,
        scopes: row.scopes,
        lastUsedAt: row.lastUsedAt,
        expiresAt: row.expiresAt,
        createdAt: row.createdAt,
      },
    };
  }

  async list(userId: string) {
    return this.prisma.personalAccessToken.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        name: true,
        tokenPrefix: true,
        scopes: true,
        lastUsedAt: true,
        expiresAt: true,
        createdAt: true,
      },
    });
  }

  async revoke(userId: string, id: string) {
    const exists = await this.prisma.personalAccessToken.findFirst({
      where: { id, userId },
      select: { id: true },
    });
    if (!exists) throw new NotFoundException(MSG.ERROR.PAT_NOT_FOUND);
    await this.prisma.personalAccessToken.delete({ where: { id } });
    return { message: MSG.SUCCESS.PAT_REVOKED };
  }

  /**
   * Auth-path lookup. Returns null when the token is missing, expired, or
   * doesn't match a row. Updates `lastUsedAt` fire-and-forget so we don't
   * block the request on a write.
   */
  async resolveBearerToken(rawToken: string): Promise<AuthUser | null> {
    if (!rawToken.startsWith(TOKEN_PREFIX)) return null;
    const tokenHash = sha256Hex(rawToken);
    const row = await this.prisma.personalAccessToken.findUnique({
      where: { tokenHash },
      include: { user: { select: AUTH_USER_SELECT } },
    });
    if (!row) return null;
    if (row.expiresAt && row.expiresAt.getTime() < Date.now()) return null;

    // Best-effort touch — never block the auth path on the write.
    void this.prisma.personalAccessToken
      .update({ where: { id: row.id }, data: { lastUsedAt: new Date() } })
      .catch(() => null);

    return row.user;
  }

  static isPatBearer(authHeader: string | undefined): string | null {
    if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
    const token = authHeader.slice('Bearer '.length).trim();
    if (!token.startsWith(TOKEN_PREFIX)) return null;
    return token;
  }
}

function sha256Hex(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}
