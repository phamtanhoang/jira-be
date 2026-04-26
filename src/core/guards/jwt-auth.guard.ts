import { ExecutionContext, Injectable, Optional } from '@nestjs/common';
import { ModuleRef, Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import type { Request } from 'express';
import { IS_PUBLIC_KEY } from '@/core/decorators';
import { PatService } from '@/modules/personal-access-tokens/pat.service';

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  private patService?: PatService;

  constructor(
    private reflector: Reflector,
    @Optional() private moduleRef?: ModuleRef,
  ) {
    super();
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    // PAT branch — try the personal-access-token path before falling back to
    // standard JWT. PATs are bearer-only (never in cookies); a malformed PAT
    // is rejected explicitly rather than silently falling back, otherwise an
    // expired token + a valid JWT cookie would still authenticate the
    // request, which is confusing.
    const req = context.switchToHttp().getRequest<Request>();
    const rawPat = PatService.isPatBearer(req.headers.authorization);
    if (rawPat) {
      const svc = this.resolvePatService();
      const user = svc
        ? await svc.resolveBearerToken(rawPat).catch(() => null)
        : null;
      if (user) {
        (req as Request & { user: typeof user }).user = user;
        return true;
      }
      return false;
    }

    return (await super.canActivate(context)) as boolean;
  }

  private resolvePatService(): PatService | null {
    if (this.patService) return this.patService;
    if (!this.moduleRef) return null;
    try {
      this.patService = this.moduleRef.get(PatService, { strict: false });
      return this.patService;
    } catch {
      return null;
    }
  }
}
