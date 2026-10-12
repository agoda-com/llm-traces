import React, { useEffect, useRef, useState } from 'react';

import { Icon, useStyles2 } from '@grafana/ui';
import { getStyles } from './LlmSpanDetail.styles';
import { formatCompactArray } from '../utils/formatUtils';
import { LlmToolCall, LlmToolDefinition } from '../utils/llmUtils';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function formatStructuredValue(value: unknown): string {
  if (typeof value === 'string') {
    try {
      return JSON.stringify(JSON.parse(value), null, 2);
    } catch {
      return value;
    }
  }
  try {
    return JSON.stringify(value, null, 2) ?? String(value);
  } catch {
    return String(value);
  }
}

export function CopyButton({ text, label }: { text: string; label: string }) {
  const styles = useStyles2(getStyles);
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
    }
  }, []);

  const handleCopy = () => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      timerRef.current = setTimeout(() => setCopied(false), 1500);
    });
  };

  return (
    <button className={styles.toolCopyButton} type="button" onClick={handleCopy} aria-label={`Copy ${label}`} title={`Copy ${label}`}>
      <Icon name={copied ? 'check' : 'copy'} size="sm" />
      {copied ? 'Copied' : ''}
    </button>
  );
}

interface ToolParameterRow {
  name: string;
  type: string;
  required: boolean;
  defaultValue?: unknown;
  description?: string;
}

function getSchemaType(schema: unknown): string {
  if (!isRecord(schema)) {
    return 'any';
  }
  if (typeof schema.type === 'string') {
    return schema.type;
  }
  if (Array.isArray(schema.type)) {
    return schema.type.map(String).join(' | ');
  }
  if (Array.isArray(schema.anyOf)) {
    return schema.anyOf.map(getSchemaType).join(' | ');
  }
  return 'any';
}

function getParameterRows(parameters: unknown): ToolParameterRow[] {
  if (!isRecord(parameters) || !isRecord(parameters.properties)) {
    return [];
  }
  const required = new Set(Array.isArray(parameters.required) ? parameters.required.map(String) : []);
  return Object.entries(parameters.properties).map(([name, schema]) => {
    const definition = isRecord(schema) ? schema : {};
    return {
      name,
      type: getSchemaType(definition),
      required: required.has(name),
      ...('default' in definition ? { defaultValue: definition.default } : {}),
      ...(typeof definition.description === 'string' ? { description: definition.description } : {}),
    };
  });
}

export function ToolCatalog({ tools }: { tools: LlmToolDefinition[] }) {
  const styles = useStyles2(getStyles);
  const [query, setQuery] = useState('');
  const [expandedIndex, setExpandedIndex] = useState<number>();
  const normalizedQuery = query.trim().toLowerCase();
  const filteredTools = tools.filter((tool) => `${tool.name} ${tool.description ?? ''}`.toLowerCase().includes(normalizedQuery));

  return (
    <div className={styles.toolCatalog}>
      <input
        className={styles.toolCatalogSearch}
        data-testid="tool-catalog-search"
        aria-label="Search available tools"
        placeholder="Search tools"
        value={query}
        onChange={(event) => setQuery(event.currentTarget.value)}
      />
      {filteredTools.length === 0 ? <div className={styles.toolCatalogEmpty}>No tools match</div> : (
        <div className={styles.toolDefinitionList}>
          {filteredTools.map((tool) => {
            const rows = getParameterRows(tool.parameters);
            const requiredCount = rows.filter((row) => row.required).length;
            const isExpanded = expandedIndex === tool.index;
            return (
              <div className={styles.toolDefinitionRow} data-testid={`tool-definition-row-${tool.index}`} key={tool.index}>
                <button
                  type="button"
                  className={styles.toolDefinitionButton}
                  aria-expanded={isExpanded}
                  onClick={() => setExpandedIndex(isExpanded ? undefined : tool.index)}
                >
                  <Icon name={isExpanded ? 'angle-down' : 'angle-right'} size="xs" />
                  <span className={styles.toolDefinitionSummary}>
                    <span className={styles.toolDefinitionTitleLine}>
                      <span className={styles.toolDefinitionName}>{tool.name}</span>
                      <span className={styles.toolBadge}>{tool.type}</span>
                      <span className={styles.toolBadge}>{requiredCount} required</span>
                      {tool.strict !== undefined && <span className={styles.toolBadge}>{tool.strict ? 'strict' : 'non-strict'}</span>}
                    </span>
                    {tool.description && <span className={styles.toolDescriptionPreview}>{tool.description}</span>}
                  </span>
                </button>
                {isExpanded && (
                  <div className={styles.toolDefinitionBody}>
                    {tool.description && <p>{tool.description}</p>}
                    {rows.length > 0 ? (
                      <div className={styles.toolParameterTableWrapper} data-testid="tool-parameter-table-wrapper">
                        <table className={styles.toolParameterTable}>
                          <thead><tr><th>Name</th><th>Type</th><th>Required</th><th>Default</th><th>Description</th></tr></thead>
                          <tbody>{rows.map((row) => (
                            <tr key={row.name}>
                              <td>{row.name}</td><td>{row.type}</td><td>{row.required ? 'Required' : 'Optional'}</td>
                              <td>{row.defaultValue === undefined ? '' : formatStructuredValue(row.defaultValue)}</td><td>{row.description ?? ''}</td>
                            </tr>
                          ))}</tbody>
                        </table>
                      </div>
                    ) : <div className={styles.toolCatalogEmpty}>No declared parameters</div>}
                    <div className={styles.toolDefinitionActions}>
                      <CopyButton text={formatStructuredValue(tool.raw)} label={`${tool.name} definition`} />
                    </div>
                    <details className={styles.toolRawSchema}>
                      <summary>Raw schema</summary>
                      <pre>{formatStructuredValue(tool.raw)}</pre>
                    </details>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function parseForDisplay(value: unknown): unknown {
  if (typeof value !== 'string') {
    return value;
  }
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function ToolArgumentValue({ value }: { value: unknown }) {
  const styles = useStyles2(getStyles);
  const compact = formatCompactArray(value);
  if (compact === undefined && typeof value === 'object' && value !== null) {
    return <pre className={styles.toolArgumentStructured}>{formatStructuredValue(value)}</pre>;
  }
  return <>{compact ?? formatStructuredValue(value)}</>;
}

function copyValue(value: unknown): string {
  return typeof value === 'string' ? value : formatStructuredValue(value);
}

function ToolCorrelationChip({ id }: { id?: string }) {
  const styles = useStyles2(getStyles);
  if (!id) {
    return null;
  }
  return <span className={styles.toolCorrelationChip} data-testid="tool-correlation-chip">{id}</span>;
}

export function ToolCallCard({ toolCall, definition }: { toolCall: LlmToolCall; definition?: LlmToolDefinition }) {
  const styles = useStyles2(getStyles);
  const [isRawArgumentsOpen, setIsRawArgumentsOpen] = useState(false);
  const parsedArguments = parseForDisplay(toolCall.arguments);
  const argumentEntries = isRecord(parsedArguments) ? Object.entries(parsedArguments) : [];
  const hasNestedArguments = argumentEntries.some(([, value]) => typeof value === 'object' && value !== null);
  return (
    <div className={styles.toolCallBlock} data-testid="message-part-tool_call">
      <div className={styles.toolCardHeader}>
        <span className={styles.partLabel}>Tool call</span>
        <span className={styles.toolCallName}>{toolCall.name}</span>
        <ToolCorrelationChip id={toolCall.id} />
        <CopyButton text={toolCall.arguments} label={`${toolCall.name} arguments`} />
      </div>
      {definition?.description && <div className={styles.toolCardDescription}>{definition.description}</div>}
      {argumentEntries.length === 0 && isRecord(parsedArguments) ? (
        <div className={styles.emptyContent}>No arguments</div>
      ) : argumentEntries.length > 0 ? (
        <dl className={styles.toolArgumentGrid}>
          {argumentEntries.map(([key, value]) => (
            <div className={styles.toolArgumentRow} key={key}>
              <dt>{key}</dt>
              <dd><ToolArgumentValue value={value} /></dd>
            </div>
          ))}
        </dl>
      ) : (
        <pre className={styles.structuredValue}>{formatStructuredValue(parsedArguments)}</pre>
      )}
      {hasNestedArguments && (
        <details className={styles.toolRawSchema} onToggle={(event) => setIsRawArgumentsOpen(event.currentTarget.open)}>
          <summary>Raw arguments</summary>
          {isRawArgumentsOpen && <pre>{formatStructuredValue(parsedArguments)}</pre>}
        </details>
      )}
    </div>
  );
}

export function ToolResultCard({ result, toolCallId, name }: { result: unknown; toolCallId?: string; name?: string }) {
  const styles = useStyles2(getStyles);
  const [isExpanded, setIsExpanded] = useState(false);
  const formatted = formatStructuredValue(parseForDisplay(result));
  const isLarge = formatted.length > 600 || formatted.split('\n').length > 10;
  return (
    <div className={styles.toolResultBlock} data-testid="message-part-tool_result">
      <div className={styles.toolCardHeader}>
        <span className={styles.partLabel}>Tool result</span>
        {name && <span className={styles.toolResultName}>{name}</span>}
        <ToolCorrelationChip id={toolCallId} />
        <CopyButton text={copyValue(result)} label="tool result" />
      </div>
      <div
        className={`${styles.toolResultPreview} ${isLarge && !isExpanded ? styles.toolResultPreviewCollapsed : ''}`}
        data-testid="tool-result-preview"
      >
        <pre className={styles.structuredValue}>{formatted}</pre>
        {isLarge && !isExpanded && <div className={styles.toolResultFade} aria-hidden="true" />}
      </div>
      {isLarge && (
        <button
          type="button"
          className={styles.toolResultToggle}
          aria-expanded={isExpanded}
          onClick={() => setIsExpanded((value) => !value)}
        >
          {isExpanded ? 'Collapse result' : 'Show full result'}
        </button>
      )}
    </div>
  );
}
