// Unit tests for shareUrl.ts
// Run with: node --experimental-strip-types tests/shareUrl.unit.test.ts

import { buildShareUrl } from '../src/utils/shareUrl.ts';

let passed = 0;
let failed = 0;

function assertEquals<T>(actual: T, expected: T, message: string): void {
  if (actual !== expected) {
    console.error(`  FAIL: ${message} - expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
    failed++;
  } else {
    console.log(`  pass: ${message}`);
    passed++;
  }
}

function describe(name: string, fn: () => void): void {
  console.log(`\n=== ${name} ===`);
  fn();
}

const PAGE = '/a/agoda-llmtraces-app/traces';

describe('buildShareUrl', () => {
  assertEquals(
    buildShareUrl('http://localhost:3000/', { pathname: PAGE, search: '', hash: '' }),
    'http://localhost:3000/a/agoda-llmtraces-app/traces',
    'root path: appUrl with trailing slash',
  );
  assertEquals(
    buildShareUrl('http://localhost:3000', { pathname: PAGE, search: '', hash: '' }),
    'http://localhost:3000/a/agoda-llmtraces-app/traces',
    'root path: appUrl without trailing slash',
  );
  assertEquals(
    buildShareUrl('https://example.com/grafana/', { pathname: PAGE, search: '', hash: '' }),
    'https://example.com/grafana/a/agoda-llmtraces-app/traces',
    'sub-path: appUrl ending with /grafana/',
  );
  assertEquals(
    buildShareUrl('https://example.com/grafana', { pathname: PAGE, search: '', hash: '' }),
    'https://example.com/grafana/a/agoda-llmtraces-app/traces',
    'sub-path: appUrl ending with /grafana',
  );

  const query = '{span.gen_ai.system = "openai" && duration > 1s}';
  const search = `?llt-ds=tempo&llt-query=${encodeURIComponent(JSON.stringify({ refId: 'A', query }))}&llt-traceId=0af7651916cd43dd8448eb211c80319c`;
  const url = buildShareUrl('https://example.com/grafana/', { pathname: PAGE, search, hash: '' });
  assertEquals(url, `https://example.com/grafana${PAGE}${search}`, 'search params are copied verbatim, keeping percent-encoding');
  const parsed = new URL(url);
  assertEquals(parsed.searchParams.get('llt-traceId'), '0af7651916cd43dd8448eb211c80319c', 'llt-traceId round-trips');
  assertEquals(JSON.parse(parsed.searchParams.get('llt-query')!).query, query, 'encoded TraceQL round-trips');

  assertEquals(
    buildShareUrl('http://localhost:3000/', { pathname: PAGE, search: '?llt-ds=tempo', hash: '#span-1' }),
    'http://localhost:3000/a/agoda-llmtraces-app/traces?llt-ds=tempo#span-1',
    'hash is appended after search',
  );
});

console.log(`\nResults: ${passed} passed, ${failed} failed`);
if (failed > 0) { process.exit(1); }
