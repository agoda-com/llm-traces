// Unit tests for queryBuilder.ts
// Run with: node --experimental-strip-types tests/queryBuilder.unit.test.ts

import { filterToCondition, looksLikeTraceId, tempoQueryToTraceQL } from '../src/utils/queryBuilder.ts';
import type { DataSourceApi } from '@grafana/data';

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

const ds = {} as DataSourceApi;

describe('filterToCondition - status and kind enums', () => {
  assertEquals(filterToCondition({ id: 'f', tag: 'status', operator: '=', value: 'error' }), 'status=error', 'status=error is an unquoted enum literal');
  assertEquals(filterToCondition({ id: 'f', tag: 'status', operator: '!=', value: ['ok'] }), 'status!=ok', 'status != ok');
  assertEquals(filterToCondition({ id: 'f', tag: 'status', operator: '=', value: 'ERROR' }), 'status=error', 'enum values are lower-cased');
  assertEquals(filterToCondition({ id: 'f', tag: 'status', operator: '=', value: ['error', 'unset'] }), '(status=error || status=unset)', 'multiple statuses become an OR group');
  assertEquals(filterToCondition({ id: 'f', tag: 'status', operator: '=', value: 'bogus' }), null, 'unknown status is ignored');
  assertEquals(filterToCondition({ id: 'f', tag: 'status', operator: '=', value: ['error', 'bogus'] }), 'status=error', 'unknown status among valid ones is dropped');
  assertEquals(filterToCondition({ id: 'f', tag: 'status', operator: '=~', value: 'err.*' }), null, 'regex on an enum is ignored');
  assertEquals(filterToCondition({ id: 'f', tag: 'status', operator: '!=', value: '' }), null, 'status != "" is ignored');
  assertEquals(filterToCondition({ id: 'f', tag: 'status', scope: 'span', operator: '=', value: 'ok' }), 'status=ok', 'status never gets a scope prefix');
  assertEquals(filterToCondition({ id: 'f', tag: 'kind', operator: '=', value: 'server' }), 'kind=server', 'kind=server');
  for (const kind of ['server', 'client', 'producer', 'consumer', 'internal', 'unspecified']) {
    assertEquals(filterToCondition({ id: 'f', tag: 'kind', operator: '=', value: kind }), `kind=${kind}`, `kind=${kind} is accepted`);
  }
  assertEquals(filterToCondition({ id: 'f', tag: 'kind', operator: '=', value: 'sideways' }), null, 'unknown kind is ignored');
});

describe('filterToCondition - durations', () => {
  assertEquals(filterToCondition({ id: 'f', tag: 'duration', operator: '>', value: '5s' }), 'duration>5s', 'duration>5s is unquoted');
  assertEquals(filterToCondition({ id: 'f', tag: 'duration', operator: '>=', value: ['100ms'] }), 'duration>=100ms', 'milliseconds');
  assertEquals(filterToCondition({ id: 'f', tag: 'duration', operator: '<', value: '1.5m' }), 'duration<1.5m', 'fractional minutes');
  assertEquals(filterToCondition({ id: 'f', tag: 'traceDuration', operator: '>', value: '2h' }), 'traceDuration>2h', 'traceDuration is unquoted');
  assertEquals(filterToCondition({ id: 'f', tag: 'duration', operator: '>', value: '1h30m' }), 'duration>1h30m', 'compound duration');
  assertEquals(filterToCondition({ id: 'f', tag: 'duration', operator: '>', value: ' 5s ' }), 'duration>5s', 'surrounding whitespace is trimmed');
  assertEquals(filterToCondition({ id: 'f', tag: 'duration', operator: '>', value: '5' }), null, 'duration without unit is ignored');
  assertEquals(filterToCondition({ id: 'f', tag: 'duration', operator: '>', value: 'five seconds' }), null, 'non-duration text is ignored');
  assertEquals(filterToCondition({ id: 'f', tag: 'duration', operator: '>', value: '5s} || {true' }), null, 'injection attempt is ignored');
  assertEquals(filterToCondition({ id: 'f', tag: 'duration', operator: '=~', value: '5s' }), null, 'regex on a duration is ignored');
  assertEquals(filterToCondition({ id: 'f', tag: 'duration', operator: '!=', value: '' }), null, 'duration != "" is ignored');
  assertEquals(filterToCondition({ id: 'f', tag: 'duration', scope: 'span', operator: '>', value: '5s' }), 'duration>5s', 'duration never gets a scope prefix');
});

describe('filterToCondition - attributes', () => {
  assertEquals(filterToCondition({ id: 'f', tag: 'gen_ai.system', scope: 'span', operator: '=', value: 'openai' }), 'span.gen_ai.system="openai"', 'string attribute stays quoted');
  assertEquals(filterToCondition({ id: 'f', tag: 'msg', scope: 'span', operator: '=', value: 'say "hi"\\' }), 'span.msg="say \\"hi\\"\\\\"', 'string attribute is escaped');
  assertEquals(filterToCondition({ id: 'f', tag: 'service.name', scope: 'resource', operator: '=~', value: 'llm.*' }), 'resource.service.name=~"llm.*"', 'regex stays quoted');
  assertEquals(filterToCondition({ id: 'f', tag: 'name', operator: '=', value: 'chat' }), 'name="chat"', 'name intrinsic is a string');
  assertEquals(filterToCondition({ id: 'f', tag: 'gen_ai.usage.input_tokens', scope: 'span', operator: '>', value: '1000' }), 'span.gen_ai.usage.input_tokens>1000', 'numeric comparison is unquoted');
  assertEquals(filterToCondition({ id: 'f', tag: 'temp', scope: 'span', operator: '<=', value: '-0.5' }), 'span.temp<=-0.5', 'negative decimal comparison is unquoted');
  assertEquals(filterToCondition({ id: 'f', tag: 'gen_ai.system', scope: 'span', operator: '>', value: 'abc' }), 'span.gen_ai.system>"abc"', 'non-numeric comparison stays quoted');
  assertEquals(
    filterToCondition({ id: 'f', tag: 'http.status_code', scope: 'span', operator: '=', value: '200' }),
    '(span.http.status_code=200 || span.http.status_code="200")',
    'numeric equality matches both integer and string attributes',
  );
  assertEquals(
    filterToCondition({ id: 'f', tag: 'http.status_code', scope: 'span', operator: '!=', value: '200' }),
    'span.http.status_code!="200"',
    'numeric inequality keeps the quoted string form',
  );
  assertEquals(filterToCondition({ id: 'f', tag: 'span.kind', scope: 'span', operator: '!=', value: '' }), 'span.span.kind!=""', 'existence check is kept');
  assertEquals(filterToCondition({ id: 'f', tag: '', value: 'x' }), null, 'missing tag is ignored');
});

describe('tempoQueryToTraceQL - search filters', () => {
  assertEquals(
    tempoQueryToTraceQL({ refId: 'A', filters: [{ id: '1', tag: 'status', operator: '=', value: 'error' }] }, ds),
    '{status=error}',
    'status filter query',
  );
  assertEquals(
    tempoQueryToTraceQL({
      refId: 'A',
      filters: [
        { id: '1', tag: 'gen_ai.system', scope: 'span', operator: '=', value: 'openai' },
        { id: '2', tag: 'duration', operator: '>', value: '5s' },
      ],
    }, ds),
    '{span.gen_ai.system="openai" && duration>5s}',
    'attribute and duration filters combine with &&',
  );
});

describe('looksLikeTraceId', () => {
  assertEquals(looksLikeTraceId('0123456789abcdef'), true, '16 hex chars');
  assertEquals(looksLikeTraceId('0123456789abcdef0123456789abcdef'), true, '32 hex chars');
  assertEquals(looksLikeTraceId('  0123456789ABCDEF0123456789abcdef  '), true, 'surrounding whitespace and upper case');
  assertEquals(looksLikeTraceId('123456789abcdef0123456789abcdef'), true, '31 hex chars (one leading zero trimmed)');
  assertEquals(looksLikeTraceId('23456789abcdef0123456789abcdef'), true, '30 hex chars (two leading zeros trimmed)');
  assertEquals(looksLikeTraceId('123456789abcdef'), false, '15 hex chars is too short');
  assertEquals(looksLikeTraceId('0123456789abcdef0123456789abcdef0'), false, '33 hex chars is too long');
  assertEquals(looksLikeTraceId('{ 0123456789abcdef0123456789abcdef }'), false, 'braces are a TraceQL query');
  assertEquals(looksLikeTraceId('{span.id=0123456789abcdef}'), false, 'TraceQL containing hex is not an id');
  assertEquals(looksLikeTraceId('0123456789abcdeg'), false, 'non-hex character');
  assertEquals(looksLikeTraceId('0123456789abcdef 0123456789abcdef'), false, 'inner space');
  assertEquals(looksLikeTraceId(''), false, 'empty string');
});

console.log(`\nResults: ${passed} passed, ${failed} failed`);
if (failed > 0) { process.exit(1); }
