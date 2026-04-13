# API: File Attachments

## Status: done

## Endpoints
- `POST /issues/:id/attachments` — Upload file (multipart/form-data, field: "file")
- `GET /issues/:id/attachments` — List attachments for issue
- `DELETE /attachments/:id` — Delete own attachment

## File Storage
- Multer diskStorage → `uploads/` directory at project root
- Filename: `{timestamp}-{random}{ext}`
- Static serving via @nestjs/serve-static at `/uploads/*`
- Max size: 10MB
- Allowed MIME types: image/*, application/pdf, zip, doc/docx, xls/xlsx, text/plain, text/csv

## Authorization
- Upload/List: any workspace member (via assertMember)
- Delete: author only (uploadedById check)

## Activity
- ATTACHED action logged on upload with fileName as newValue

## Files
- `src/modules/attachments/attachments.module.ts`
- `src/modules/attachments/attachments.controller.ts`
- `src/modules/attachments/attachments.service.ts`
- `src/app.module.ts` — registered module + ServeStaticModule
