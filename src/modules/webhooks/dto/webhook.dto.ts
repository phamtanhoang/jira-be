import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsDefined,
  IsOptional,
  IsString,
  IsUrl,
  MaxLength,
  MinLength,
} from 'class-validator';

// Open enum — adding a new event type doesn't require a DTO change. The
// service knows the canonical list (WEBHOOK_EVENTS) and validates against it.
export const WEBHOOK_EVENTS = [
  'issue.created',
  'issue.updated',
  'issue.deleted',
  'issue.moved',
  'comment.created',
] as const;
export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number];

export class CreateWebhookDto {
  @ApiProperty({ example: 'production-deploy-bot' })
  @IsDefined()
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  name!: string;

  @ApiProperty({
    example: 'https://hooks.slack.com/services/T00/B00/XXX',
    description:
      'Receiver URL. URLs matching hooks.slack.com are auto-formatted to Slack attachment payloads.',
  })
  @IsDefined()
  // require_tld=true blocks bare hostnames like `localhost`. The service
  // additionally resolves the hostname and rejects private/loopback/
  // link-local/metadata IPs to prevent SSRF — `IsUrl` is syntactic only.
  @IsUrl({
    require_tld: true,
    require_protocol: true,
    protocols: ['https', 'http'],
  })
  @MaxLength(2048)
  url!: string;

  @ApiProperty({
    type: [String],
    example: ['issue.created', 'comment.created'],
  })
  @IsDefined()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  @IsString({ each: true })
  events!: string[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}

export class UpdateWebhookDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUrl({
    require_tld: true,
    require_protocol: true,
    protocols: ['https', 'http'],
  })
  @MaxLength(2048)
  url?: string;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  @IsString({ each: true })
  events?: string[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}
