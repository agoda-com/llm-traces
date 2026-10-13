import React from 'react';

import { IconName } from '@grafana/data';
import { Icon } from '@grafana/ui';

import { getSpanKindColor } from '../utils/llmUtils';

// Only names in Grafana's icon index from 11.3 on; "ai-sparkle", "robot", "brain" and "wrench" are missing from some 11.x and 12.x versions.
const KIND_ICONS: Record<string, IconName> = {
  AGENT: 'user',
  LLM: 'ai',
  TOOL: 'cog',
  CHAIN: 'link',
  RETRIEVER: 'database',
  EMBEDDING: 'cube',
  RERANKER: 'sort-amount-down',
  GUARDRAIL: 'shield',
  UNKNOWN: 'question-circle',
};

/** "LLM" stays upper case; other kinds read as words, e.g. "Agent". */
export function getKindLabel(kind: string): string {
  const upper = kind.toUpperCase();
  return upper === 'LLM' ? upper : upper.charAt(0) + upper.slice(1).toLowerCase();
}

export function KindIcon({ kind }: { kind: string }) {
  const label = getKindLabel(kind);
  return (
    <span
      role="img"
      aria-label={label}
      title={label}
      data-testid="span-kind-icon"
      style={{ display: 'inline-flex', flexShrink: 0, color: getSpanKindColor(kind) }}
    >
      <Icon name={KIND_ICONS[kind.toUpperCase()] ?? 'circle'} size="md" />
    </span>
  );
}
