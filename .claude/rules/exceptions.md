# Domain Exceptions

## When to use a `BaseAppException` subclass

PREFER a domain exception over raw NestJS built-ins when:
- The same error condition is thrown from multiple services and the FE needs to branch on it (e.g. `WORKSPACE_ACCESS_DENIED` is shown with a "request access" CTA, while `INSUFFICIENT_PERMISSIONS` is just a toast).
- The error has a stable contract that the FE consumes — UI tests or analytics depend on knowing this is the same failure across releases.

NestJS built-ins (`NotFoundException`, `BadRequestException`, etc.) remain fine for one-off / generic cases that don't merit a class.

## Anatomy

`src/core/exceptions/base-app.exception.ts` — every domain exception extends this. Constructor:

```ts
super(message, errorCode, status);
//    ^^^^^^^  ^^^^^^^^^  ^^^^^^
//    MSG.*    machine    HttpStatus
//    i18n     code       enum
//    key      (FE switch)
```

The filter (`AllExceptionsFilter`) detects `instanceof BaseAppException` and adds `errorCode` to the JSON response so the FE can switch on it without parsing the localized message.

## Adding a new exception

1. Pick or add an `MSG.ERROR.*` constant.
2. Create `src/core/exceptions/<name>.exception.ts`:
   ```ts
   import { HttpStatus } from '@nestjs/common';
   import { MSG } from '@/core/constants';
   import { BaseAppException } from './base-app.exception';

   export class XException extends BaseAppException {
     constructor(message: string = MSG.ERROR.X) {
       super(message, 'X', HttpStatus.NOT_FOUND);
     }
   }
   ```
3. Re-export from `src/core/exceptions/index.ts`.
4. Replace `throw new NotFoundException(MSG.ERROR.X)` with `throw new XException()` in services.

## DON'T

- DON'T put `errorCode`s in `MSG.ERROR.*` — those are i18n keys, not stable codes. They share a name today, but if `MSG.ERROR.ISSUE_NOT_FOUND` changes for translation reasons, `errorCode: 'ISSUE_NOT_FOUND'` must stay byte-stable.
- DON'T add an exception class for transient validation (`@IsString()` failures) — those are auto-handled by the global ValidationPipe.
- DON'T import `BaseAppException` from feature modules — always extend a concrete subclass to keep the FE contract stable.
