import { promises as dns } from 'node:dns';
import * as net from 'node:net';
import { BadRequestException } from '@nestjs/common';

// IPv4/IPv6 ranges we never let webhooks reach. Even when the hostname
// looks safe ("api.example.com"), an attacker controlling DNS can point
// it at an internal IP — so we resolve first, then check every address.
function isPrivateIPv4(ip: string): boolean {
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some((n) => Number.isNaN(n))) return false;
  const [a, b] = parts;
  if (a === 10) return true; // 10.0.0.0/8
  if (a === 127) return true; // loopback
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
  if (a === 192 && b === 168) return true; // 192.168.0.0/16
  if (a === 169 && b === 254) return true; // link-local + cloud metadata
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
  if (a === 0) return true; // 0.0.0.0/8
  if (a >= 224) return true; // multicast + reserved
  return false;
}

function isPrivateIPv6(ip: string): boolean {
  const lower = ip.toLowerCase();
  if (lower === '::1' || lower === '::') return true;
  // ULA + link-local + loopback-mapped IPv4 + multicast
  if (lower.startsWith('fc') || lower.startsWith('fd')) return true;
  if (lower.startsWith('fe80')) return true;
  if (lower.startsWith('ff')) return true;
  if (lower.startsWith('::ffff:')) {
    // IPv4-mapped — extract the trailing v4 and recurse
    const v4 = lower.slice('::ffff:'.length);
    return isPrivateIPv4(v4);
  }
  return false;
}

/**
 * Reject webhook URLs that point at internal/private/metadata IPs.
 * Resolves the hostname and walks every returned address. A single
 * private hit fails the whole URL — attackers can return mixed records
 * to slip past a naive "first address" check.
 *
 * Allows http:// in non-production (dev / staging) but enforces https://
 * in production. Production-only is determined by NODE_ENV.
 */
export async function assertSafeWebhookUrl(url: string): Promise<void> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new BadRequestException('Invalid webhook URL');
  }

  if (process.env.NODE_ENV === 'production' && parsed.protocol !== 'https:') {
    throw new BadRequestException('Webhook URL must use https in production');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new BadRequestException('Webhook URL must be http(s)');
  }

  const host = parsed.hostname;

  // If the hostname is already an IP literal, check directly. dns.lookup
  // happily echoes a literal back, so we'd still catch it — but skipping
  // the lookup avoids a DNS round trip for the common attack vector
  // ("http://169.254.169.254/latest/meta-data/").
  if (net.isIP(host)) {
    const family = net.isIPv4(host) ? 4 : 6;
    if (family === 4 ? isPrivateIPv4(host) : isPrivateIPv6(host)) {
      throw new BadRequestException(
        'Webhook URL must not target a private network',
      );
    }
    return;
  }

  // Resolve A + AAAA records. `all: true` returns every address so we
  // can reject if ANY resolution lands in private space (mixed-record
  // attack defense).
  let addrs: { address: string; family: number }[];
  try {
    addrs = await dns.lookup(host, { all: true });
  } catch {
    throw new BadRequestException('Could not resolve webhook host');
  }
  for (const { address, family } of addrs) {
    if (family === 4 && isPrivateIPv4(address)) {
      throw new BadRequestException(
        'Webhook URL must not target a private network',
      );
    }
    if (family === 6 && isPrivateIPv6(address)) {
      throw new BadRequestException(
        'Webhook URL must not target a private network',
      );
    }
  }
}
