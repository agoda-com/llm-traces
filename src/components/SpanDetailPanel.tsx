import React, { useMemo, useState } from 'react';
import { useStyles2, useTheme2, Icon } from '@grafana/ui';
import { getStyles } from './TraceDetail.styles';
import { PluginSpan } from '../utils/tempoClient';
import { decodeUnicodeEscapes, extractLlmSpanData, getLlmDisplayAttributeKeys } from '../utils/llmUtils';
import { formatDuration } from '../utils/formatUtils';
import { LlmSpanDetail } from './LlmSpanDetail';

/** Try to parse a string as JSON; if it succeeds, return pretty-printed JSON, else return original. */
function tryExpandString(value: unknown): string {
  const s = String(value);
  // BUG-057: skip expansion for very large values to avoid browser freeze
  if (s.length > 50000) { return s; }
  try {
    const parsed = JSON.parse(s);
    if (typeof parsed === 'object' && parsed !== null) {
      return JSON.stringify(parsed, null, 2);
    }
  } catch { /* not JSON */ }
  return s;
}

function getSpanStatus(span: PluginSpan): { isError: boolean; message?: string } {
  // Prefer the dedicated statusCode field (populated from OTLP status object or attribute fallback)
  if (span.statusCode === 'ERROR') {
    const message = span.statusMessage
      ?? (span.tags.find((t) => t.key === 'error.message') ?? span.tags.find((t) => t.key === 'exception.message'))?.value as string | undefined;
    return { isError: true, message: message ? String(message) : undefined };
  }
  // Legacy attribute-based signals (error=true, exception.*, status.code=2)
  const isError = span.tags.some((t) => {
    const k = t.key.toLowerCase();
    const v = String(t.value).toLowerCase();
    return (k === 'status.code' && (v === 'error' || v === 'status_code_error' || v === '2')) ||
           (k === 'error' && v === 'true') ||
           k.startsWith('exception.');
  });
  if (!isError) { return { isError: false }; }
  const message = (span.tags.find((t) => t.key === 'error.message') ?? span.tags.find((t) => t.key === 'exception.message'))?.value as string | undefined;
  return { isError: true, message: message ? String(message) : undefined };
}

interface SpanDetailPanelProps {
  span: PluginSpan;
}

export function SpanDetailPanel({ span }: SpanDetailPanelProps) {
  const styles = useStyles2(getStyles);
  const theme = useTheme2();
  const [expandStrings, setExpandStrings] = useState(false);
  const [expandedLlmAttributesForSpan, setExpandedLlmAttributesForSpan] = useState<string | null>(null);
  const spanStatus = getSpanStatus(span);
  const llmData = useMemo(
    () => extractLlmSpanData(span.tags, span.logs, span.operationName),
    [span.tags, span.logs, span.operationName]
  );
  const llmAttributeKeys = useMemo(
    () => getLlmDisplayAttributeKeys(span.tags, llmData),
    [span.tags, llmData]
  );
  const attributeEntries = span.tags.map((tag, index) => ({ tag, index }));
  const llmAttributeEntries = attributeEntries.filter(({ tag }) => llmAttributeKeys.has(tag.key));
  const ordinaryAttributeEntries = attributeEntries.filter(({ tag }) => !llmAttributeKeys.has(tag.key));
  const llmAttributesExpanded = expandedLlmAttributesForSpan === span.spanId;

  const renderValue = (value: unknown) => {
    const raw = decodeUnicodeEscapes(String(value));
    const expanded = expandStrings ? tryExpandString(raw) : raw;
    return expanded !== raw
      ? <pre style={{ margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-all', fontFamily: 'inherit' }}>{expanded}</pre>
      : expanded;
  };

  return (
    <div data-testid="span-detail-panel">
      <div className={styles.spanDetailHeader}>
        <div className={styles.spanDetailTitle}>{span.operationName}</div>
        <div className={styles.spanDetailMeta}>
          <span>{span.serviceName}</span>
          <span>{formatDuration(span.durationMs)}</span>
          <span title="Start time">{new Date(span.startTimeMs).toISOString().replace('T', ' ').replace('Z', '')}</span>
          {/* BUG-074: only append ellipsis for IDs longer than 16 chars */}
          <span title="Span ID">{span.spanId.length > 16 ? span.spanId.slice(0, 16) + '…' : span.spanId}</span>
          {spanStatus.isError && (
            <span className={styles.spanStatusError} data-testid="span-status-error">
              <Icon name="exclamation-circle" size="xs" />
              Status: error
            </span>
          )}
        </div>
        {spanStatus.isError && spanStatus.message && (
          <div className={styles.spanStatusMessage} data-testid="span-status-message">
            Status Message: {spanStatus.message}
          </div>
        )}
      </div>

      {/* LLM / OpenInference view — rendered for LLM and non-LLM OI spans */}
      <LlmSpanDetail tags={span.tags} llmData={llmData} />

      {/* Span attributes */}
      <div className={styles.sectionLabel} style={{ display: 'flex', alignItems: 'center' }}>
        <span style={{ flex: 1 }}>Span Attributes</span>
        <button
          onClick={() => setExpandStrings((v) => !v)}
          title="Expand embedded JSON strings"
          data-testid="expand-strings-btn"
          style={{
            background: expandStrings ? theme.colors.primary.transparent : 'none',
            border: `1px solid ${expandStrings ? theme.colors.primary.border : theme.colors.border.weak}`,
            borderRadius: '3px',
            cursor: 'pointer',
            color: expandStrings ? theme.colors.primary.text : theme.colors.text.secondary,
            fontSize: '10px',
            padding: '1px 6px',
            marginRight: theme.spacing(1.5),
            lineHeight: 1.4,
          }}
        >
          {'{}'} Expand strings
        </button>
      </div>
      <div className={styles.attrSection}>
        <table className={styles.attrTable} data-testid="span-attrs-table">
          <tbody>
            {llmAttributeEntries.length > 0 && (
              <tr className={styles.attrGroupRow}>
                <td colSpan={2} className={styles.attrGroupCell}>
                  <button
                    type="button"
                    className={styles.attrGroupToggle}
                    data-testid="llm-attrs-toggle"
                    aria-expanded={llmAttributesExpanded}
                    onClick={() => setExpandedLlmAttributesForSpan(llmAttributesExpanded ? null : span.spanId)}
                  >
                    <Icon name={llmAttributesExpanded ? 'angle-down' : 'angle-right'} size="xs" />
                    <span className={styles.attrGroupLabel}>
                      LLM attributes shown above ({llmAttributeEntries.length})
                    </span>
                    <span className={styles.attrGroupAction}>
                      {llmAttributesExpanded ? 'Hide raw values' : 'Show raw values'}
                    </span>
                  </button>
                </td>
              </tr>
            )}
            {llmAttributesExpanded && llmAttributeEntries.map(({ tag, index }) => (
              <tr key={`${tag.key}-${index}`} className={`${styles.attrRow} ${styles.promotedAttrRow}`}>
                <td className={styles.attrKey}>{tag.key}</td>
                <td className={styles.attrValue}>{renderValue(tag.value)}</td>
              </tr>
            ))}
            {ordinaryAttributeEntries.map(({ tag, index }) => (
              <tr key={`${tag.key}-${index}`} className={styles.attrRow}>
                <td className={styles.attrKey}>{tag.key}</td>
                <td className={styles.attrValue}>{renderValue(tag.value)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* BUG-055: Events / logs section */}
      {span.logs && span.logs.length > 0 && (
        <>
          <div className={styles.sectionLabel}>Events</div>
          <div className={styles.attrSection}>
            {span.logs.map((log, li) => (
              <div key={li} style={{ marginBottom: '8px' }}>
                <div style={{ fontSize: '11px', color: 'inherit', opacity: 0.7, marginBottom: '2px' }}>
                  {log.name ?? 'event'} &mdash; {new Date(log.timestamp ?? 0).toISOString().replace('T', ' ').replace('Z', '')}
                </div>
                <table className={styles.attrTable}>
                  <tbody>
                    {log.fields.map((f: { key: string; value: unknown }, fi: number) => (
                      <tr key={`${f.key}-${fi}`} className={styles.attrRow}>
                        <td className={styles.attrKey}>{f.key}</td>
                        <td className={styles.attrValue}>{renderValue(f.value)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))}
          </div>
        </>
      )}

      {/* Resource attributes */}
      {span.serviceAttributes.length > 0 && (
        <>
          <div className={styles.sectionLabel}>Resource Attributes</div>
          <div className={styles.attrSection}>
            <table className={styles.attrTable}>
              <tbody>
                {/* BUG-056: use index in key to avoid duplicate-key collision */}
                {span.serviceAttributes.map((tag, i) => (
                  <tr key={`${tag.key}-${i}`} className={styles.attrRow}>
                    <td className={styles.attrKey}>{tag.key}</td>
                    <td className={styles.attrValue}>{renderValue(tag.value)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
