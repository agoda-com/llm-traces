import React, { ReactNode, useMemo, useState } from 'react';

import { useStyles2, Icon } from '@grafana/ui';
import { getStyles } from './LlmSpanDetail.styles';
import { CopyButton, ToolCallCard, ToolCatalog, ToolResultCard } from './ToolVisualization';
import { KeyValuePair, LlmMessage, LlmMessagePart, LlmSpanData, LlmTokenUsage, LlmInvocationParams, LlmToolCall, LlmToolDefinition, getSpanKindColor, getSpanKind, isOpenInferenceSpan, decodeUnicodeEscapes } from '../utils/llmUtils';
import { estimateCost, formatCost } from '../utils/costUtils';

function estimateTokenCount(text: string): number {
  let asciiCharacters = 0;
  let nonAsciiCharacters = 0;

  for (const character of text) {
    if (character.codePointAt(0)! <= 0x7f) {
      asciiCharacters++;
    } else {
      nonAsciiCharacters++;
    }
  }

  return Math.max(1, Math.ceil(asciiCharacters / 4 + nonAsciiCharacters));
}

// marked is available as a transitive dep in the Grafana monorepo
let markedParse: ((src: string) => string) | null = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const m = require('marked');
  markedParse = m.marked?.parse ?? m.parse ?? null;
} catch {
  markedParse = null;
}

/**
 * Decode HTML entities (numeric and named) so that entity-encoded tags like
 * &#60;script&#62; are converted to < > before sanitization. This prevents
 * XSS payloads from bypassing the allowlist via HTML entity encoding (BUG-070).
 */
function decodeHtmlEntities(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(parseInt(dec, 10)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

/**
 * Sanitize HTML using an allowlist approach. DOMPurify is not available as a
 * direct dependency, so we strip all tags/attributes not on the safe list.
 * Only permits safe inline/block formatting tags. href attributes on <a> tags
 * are allowed only for http://, https://, and mailto: protocols (BUG-021).
 */
function sanitizeHtml(html: string): string {
  const ALLOWED = /^(b|i|em|strong|p|br|ul|ol|li|code|pre|h[1-6]|blockquote|hr|a|table|thead|tbody|tr|th|td)$/i;
  return html
    .replace(/<(\/?)([a-zA-Z][a-zA-Z0-9]*)((?:\s[^>]*)?)?>/g, (_match, slash, tag, attrs) => {
      if (!ALLOWED.test(tag)) { return ''; }
      const lowerTag = tag.toLowerCase();
      // For <a> tags allow href only with safe protocols
      if (lowerTag === 'a' && !slash && attrs) {
        const hrefMatch = attrs.match(/\shref\s*=\s*(?:"([^"]*)"|'([^']*)'|(\S+))/i);
        if (hrefMatch) {
          const href = hrefMatch[1] ?? hrefMatch[2] ?? hrefMatch[3] ?? '';
          const safeHref = /^(https?:|mailto:)/i.test(href) ? href : '#';
          return `<a href="${safeHref}">`;
        }
      }
      return `<${slash}${lowerTag}>`;
    })
    .replace(/javascript\s*:/gi, '')
    .replace(/data\s*:/gi, '');
}


function getRoleStyle(role: string, styles: ReturnType<typeof getStyles>): string {
  const r = role.toLowerCase();
  if (r === 'system') { return styles.roleSystem; }
  if (r === 'user' || r === 'human') { return styles.roleUser; }
  if (r === 'assistant' || r === 'ai' || r === 'model') { return styles.roleAssistant; }
  if (r === 'tool' || r === 'function') { return styles.roleTool; }
  return styles.roleUser;
}

function getRoleIcon(role: string): 'user' | 'comment-alt' | 'cog' | 'code-branch' {
  const r = role.toLowerCase();
  if (r === 'user' || r === 'human') { return 'user'; }
  if (r === 'assistant' || r === 'ai' || r === 'model') { return 'comment-alt'; }
  if (r === 'system') { return 'cog'; }
  return 'code-branch';
}

function getConventionLabel(convention: string): string {
  switch (convention) {
    case 'openinference': return 'OpenInference';
    case 'otel-genai': return 'OTel GenAI';
    case 'vertex': return 'Vertex / ADK';
    case 'generic': return 'Generic';
    default: return convention;
  }
}

function formatJson(value: string): string {
  try { return JSON.stringify(JSON.parse(value), null, 2); } catch { return value; }
}

function formatStructuredValue(value: unknown): string {
  if (typeof value === 'string') { return formatJson(value); }
  try { return JSON.stringify(value, null, 2) ?? String(value); } catch { return String(value); }
}

function FinishReasonBadge({ reason }: { reason: string }) {
  const styles = useStyles2(getStyles);
  const r = reason.toUpperCase();
  const isWarning = r === 'MAX_TOKENS' || r === 'LENGTH' || r === 'CONTENT_FILTER';
  const isError = r === 'ERROR';
  const color = isWarning ? '#FF9830' : isError ? '#F2495C' : '#73BF69';
  return (
    <span
      className={styles.kindBadge}
      style={{ background: color }}
      title={isWarning ? 'Response was cut off due to max token limit' : undefined}
    >
      {isWarning && '⚠ '}{r}
    </span>
  );
}

function MessagePartBlock({
  part,
  showMarkdown,
  tools,
  toolCallsById,
}: {
  part: LlmMessagePart;
  showMarkdown: boolean;
  tools: LlmToolDefinition[];
  toolCallsById: ReadonlyMap<string, LlmToolCall>;
}) {
  const styles = useStyles2(getStyles);
  if (part.type === 'text') {
    return showMarkdown && markedParse ? (
      <div
        data-testid="message-part-text"
        dangerouslySetInnerHTML={{ __html: sanitizeHtml(decodeHtmlEntities(markedParse(part.text))) }}
      />
    ) : <div data-testid="message-part-text">{part.text}</div>;
  }
  if (part.type === 'reasoning') {
    return (
      <div className={styles.reasoningBlock} data-testid="message-part-reasoning">
        <div className={styles.partLabel}>Reasoning</div>
        <div>{part.text}</div>
      </div>
    );
  }
  if (part.type === 'tool_call') {
    return <ToolCallCard toolCall={part.toolCall} definition={tools.find((tool) => tool.name === part.toolCall.name)} />;
  }
  if (part.type === 'tool_result') {
    const correlatedCall = part.toolCallId ? toolCallsById.get(part.toolCallId) : undefined;
    return <ToolResultCard result={part.result} toolCallId={part.toolCallId} name={part.name ?? correlatedCall?.name} />;
  }
  const label = part.type === 'image' ? 'Image' : part.type === 'audio' ? 'Audio' : 'Unknown part';
  return (
    <div className={styles.structuredPartBlock} data-testid={`message-part-${part.type}`}>
      <div className={styles.partLabel}>{label}</div>
      <pre className={styles.structuredValue}>{formatStructuredValue(part.value)}</pre>
    </div>
  );
}

function sameToolCall(left: LlmToolCall, right: LlmToolCall): boolean {
  return Boolean(left.id && right.id && left.id === right.id)
    || (left.name === right.name && left.arguments === right.arguments);
}

function MessageBlock({
  message,
  tools,
  toolCallsById,
  defaultOpen = true,
}: {
  message: LlmMessage;
  tools: LlmToolDefinition[];
  toolCallsById: ReadonlyMap<string, LlmToolCall>;
  defaultOpen?: boolean;
}) {
  const styles = useStyles2(getStyles);
  const [isOpen, setIsOpen] = useState(defaultOpen);
  const [showMarkdown, setShowMarkdown] = useState(false);
  const roleStyle = getRoleStyle(message.role, styles);
  const icon = getRoleIcon(message.role);
  const canMarkdown = markedParse !== null && !!message.content;
  const tokenCount = useMemo(
    () => message.content ? estimateTokenCount(message.content) : null,
    [message.content]
  );
  const parts = message.parts ?? [];
  const partToolCalls = parts
    .filter((part): part is Extract<LlmMessagePart, { type: 'tool_call' }> => part.type === 'tool_call')
    .map((part) => part.toolCall);
  const additionalToolCalls = message.toolCalls?.filter(
    (toolCall) => !partToolCalls.some((partToolCall) => sameToolCall(toolCall, partToolCall))
  ) ?? [];
  const hasSemanticContent = Boolean(message.content)
    || parts.some((part) => part.type !== 'text' || part.text !== '')
    || additionalToolCalls.length > 0;
  const contentClass = showMarkdown && canMarkdown ? styles.markdownContent : styles.messageContent;

  return (
    <div className={styles.message} data-testid={`message-block-${message.role}`}>
      <button
        className={`${styles.messageHeader} ${roleStyle}`}
        onClick={() => setIsOpen(!isOpen)}
        aria-expanded={isOpen}
      >
        <div className={styles.messageHeaderLeft}>
          <Icon name={isOpen ? 'angle-down' : 'angle-right'} size="xs" />
          <Icon name={icon} size="sm" />
          <span className={styles.roleLabel}>{
            message.role === 'model' || message.role === 'ai' ? 'assistant' :
            message.role === 'human' ? 'user' :
            message.role
          }</span>
        </div>
        {canMarkdown && isOpen && (
          <button
            className={`${styles.mdToggle} ${showMarkdown ? styles.mdToggleActive : ''}`}
            onClick={(e) => { e.stopPropagation(); setShowMarkdown((v) => !v); }}
            title={showMarkdown ? 'Show raw text' : 'Render Markdown'}
          >
            MD
          </button>
        )}
      </button>
      {isOpen && (
        <div className={`${contentClass} ${roleStyle}`}>
          {!hasSemanticContent && <span className={styles.emptyContent}>(empty)</span>}
          {parts.length > 0 ? (
            <div className={styles.partStack}>
              {parts.map((part, index) => (
                <MessagePartBlock
                  key={index}
                  part={part}
                  showMarkdown={showMarkdown && canMarkdown}
                  tools={tools}
                  toolCallsById={toolCallsById}
                />
              ))}
            </div>
          ) : showMarkdown && canMarkdown ? (
            <div
              dangerouslySetInnerHTML={{ __html: sanitizeHtml(decodeHtmlEntities(markedParse!(message.content))) }}
            />
          ) : (
            message.content
          )}
          {!showMarkdown && message.content && (
            <div style={{ fontSize: '10px', color: 'inherit', opacity: 0.45, marginTop: '4px', textAlign: 'right' }}>
              {message.content.split(/\s+/).filter(Boolean).length} words · {message.content.length} chars
              {tokenCount !== null && ` · ~${tokenCount.toLocaleString()} tokens`}
            </div>
          )}
          {additionalToolCalls.map((toolCall, index) => (
            <ToolCallCard
              key={toolCall.id ?? `${toolCall.name}-${index}`}
              toolCall={toolCall}
              definition={tools.find((tool) => tool.name === toolCall.name)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function indexToolCalls(messages: LlmMessage[]): ReadonlyMap<string, LlmToolCall> {
  const calls = new Map<string, LlmToolCall>();
  for (const message of messages) {
    const partCalls = (message.parts ?? [])
      .filter((part): part is Extract<LlmMessagePart, { type: 'tool_call' }> => part.type === 'tool_call')
      .map((part) => part.toolCall);
    for (const call of [...partCalls, ...(message.toolCalls ?? [])]) {
      if (call.id && !calls.has(call.id)) {
        calls.set(call.id, call);
      }
    }
  }
  return calls;
}

function TokenUsageDisplay({ usage, model, precomputedCostUsd }: { usage: LlmTokenUsage; model: string; precomputedCostUsd?: number }) {
  const styles = useStyles2(getStyles);
  const hasAny = usage.input !== undefined || usage.output !== undefined || usage.total !== undefined;
  if (!hasAny) { return null; }
  return (
    <div className={styles.tokenRow}>
      {usage.input !== undefined && (
        <div className={styles.tokenItem}>
          <span className={styles.tokenLabel}>Input:</span>
          <span className={styles.tokenValue}>{usage.input.toLocaleString()}</span>
        </div>
      )}
      {usage.output !== undefined && (
        <div className={styles.tokenItem}>
          <span className={styles.tokenLabel}>Output:</span>
          <span className={styles.tokenValue}>{usage.output.toLocaleString()}</span>
        </div>
      )}
      {usage.total !== undefined && (
        <div className={styles.tokenItem}>
          <span className={styles.tokenLabel}>Total:</span>
          <span className={styles.tokenValue}>{usage.total.toLocaleString()}</span>
        </div>
      )}
      {(() => {
        if (precomputedCostUsd !== undefined) {
          return (
            <div className={styles.tokenItem}>
              <span className={styles.tokenLabel}>Reported Cost:</span>
              <span className={styles.tokenValue}>{formatCost(precomputedCostUsd)}</span>
            </div>
          );
        }
        const cost = estimateCost(model, usage.input, usage.output);
        return (
          <div className={styles.tokenItem}>
            <span className={styles.tokenLabel}>Est. Cost:</span>
            <span className={styles.tokenValue}>
              {cost !== undefined
                ? formatCost(cost)
                : <span style={{ opacity: 0.5, fontStyle: 'italic' }}>unknown</span>
              }
            </span>
          </div>
        );
      })()}
    </div>
  );
}

function InvocationParamsDisplay({ params }: { params: LlmInvocationParams }) {
  const styles = useStyles2(getStyles);
  const entries = Object.entries(params).filter(([, v]) => v !== undefined && v !== null);
  if (entries.length === 0) { return null; }
  return (
    <div className={styles.paramsGrid}>
      {entries.map(([key, value]) => (
        <div key={key} className={styles.paramItem}>
          <span className={styles.paramKey}>{key}:</span>
          <span className={styles.paramValue}>{typeof value === 'object' ? JSON.stringify(value) : String(value)}</span>
        </div>
      ))}
    </div>
  );
}

function CollapsibleSection({ title, defaultOpen = true, children, testId, titleExtra }: { title: string; defaultOpen?: boolean; children: ReactNode; testId?: string; titleExtra?: ReactNode }) {
  const styles = useStyles2(getStyles);
  const [isOpen, setIsOpen] = useState(defaultOpen);
  return (
    <div className={styles.section} data-testid={testId}>
      <button
        className={styles.sectionHeader}
        onClick={() => setIsOpen(!isOpen)}
        aria-expanded={isOpen}
      >
        <Icon name={isOpen ? 'angle-down' : 'angle-right'} size="sm" />
        <span className={styles.sectionTitle}>{title}</span>
        {titleExtra && <span style={{ marginLeft: 'auto' }} onClick={(e) => e.stopPropagation()}>{titleExtra}</span>}
      </button>
      {isOpen && <div className={styles.sectionContent}>{children}</div>}
    </div>
  );
}

function formatValue(value: string): string {
  try { return JSON.stringify(JSON.parse(value), null, 2); } catch { return value; }
}

function ValueBlock({ label, value }: { label: string; value: string }) {
  const styles = useStyles2(getStyles);
  if (value === undefined || value === null) { return null; }
  return (
    <div className={styles.fieldBlock}>
      <div className={styles.fieldLabel}>{label}</div>
      <div className={styles.valueBlock}>{value === '' ? <span className={styles.emptyContent}>(empty)</span> : formatValue(value)}</div>
    </div>
  );
}

interface RetrievalDocument {
  index: number;
  id?: string;
  score?: string;
  content?: string;
  metadata?: string;
}

function extractRetrievalDocuments(tags: KeyValuePair[]): RetrievalDocument[] {
  const docs = new Map<number, RetrievalDocument>();
  for (const tag of tags) {
    const match = tag.key.match(/^retrieval\.documents\.(\d+)\.(.+)$/);
    if (!match) { continue; }
    const idx = parseInt(match[1], 10);
    const field = match[2];
    if (!docs.has(idx)) { docs.set(idx, { index: idx }); }
    const doc = docs.get(idx)!;
    if (field === 'document.id') { doc.id = String(tag.value); }
    else if (field === 'document.score') { doc.score = String(tag.value); }
    else if (field === 'document.content') { doc.content = String(tag.value); }
    else if (field === 'document.metadata') { doc.metadata = String(tag.value); }
  }
  return Array.from(docs.values()).sort((a, b) => a.index - b.index);
}

function getAttrValue(tags: KeyValuePair[], key: string): string | undefined {
  const tag = tags.find((t) => t.key === key);
  return tag !== undefined ? decodeUnicodeEscapes(String(tag.value)) : undefined;
}

function OpenInferenceSpanDetail({ tags, spanKind }: { tags: KeyValuePair[]; spanKind: string }) {
  const styles = useStyles2(getStyles);
  const kind = spanKind.toUpperCase();
  const kindColor = getSpanKindColor(spanKind);

  const inputValue = getAttrValue(tags, 'input.value');
  const outputValue = getAttrValue(tags, 'output.value');
  const toolName = getAttrValue(tags, 'tool.name');
  const toolDesc = getAttrValue(tags, 'tool.description');
  const toolParams = getAttrValue(tags, 'tool.parameters');
  const retrieralDocs = kind === 'RETRIEVER' ? extractRetrievalDocuments(tags) : [];

  // RERANKER attributes (BUG-005)
  const rerankerQuery = getAttrValue(tags, 'reranker.query');
  const rerankerModel = getAttrValue(tags, 'reranker.model_name');
  const rerankerResults = (() => {
    const results: Array<{ index: number; document?: string; score?: string; relevanceScore?: string }> = [];
    const map = new Map<number, (typeof results)[0]>();
    for (const tag of tags) {
      const m = tag.key.match(/^reranker\.results\.(\d+)\.(.+)$/);
      if (!m) { continue; }
      const idx = parseInt(m[1], 10);
      if (!map.has(idx)) { map.set(idx, { index: idx }); }
      const entry = map.get(idx)!;
      const field = m[2];
      if (field === 'document.content' || field === 'document.text') { entry.document = String(tag.value); }
      else if (field === 'score') { entry.score = String(tag.value); }
      else if (field === 'relevance_score') { entry.relevanceScore = String(tag.value); }
    }
    map.forEach((v) => results.push(v));
    return results.sort((a, b) => a.index - b.index);
  })();

  return (
    <div className={styles.container} data-testid="oi-span-detail">
      <div className={styles.headerRow}>
        <span className={styles.kindBadge} style={{ background: kindColor }} data-testid="oi-span-kind">
          {kind}
        </span>
        <span className={styles.conventionBadge}>OpenInference</span>
      </div>

      {kind === 'TOOL' && (toolName || toolDesc || toolParams || inputValue || outputValue) && (
        <CollapsibleSection title="Tool" testId="tool-section">
          {toolName && <ValueBlock label="Tool Name" value={toolName} />}
          {toolDesc && <ValueBlock label="Description" value={toolDesc} />}
          {toolParams && <ValueBlock label="Parameters" value={toolParams} />}
          {inputValue && <ValueBlock label="Input" value={inputValue} />}
          {outputValue && <ValueBlock label="Output" value={outputValue} />}
        </CollapsibleSection>
      )}

      {kind === 'RERANKER' && (rerankerQuery || rerankerModel || rerankerResults.length > 0 || inputValue || outputValue) && (
        <CollapsibleSection title="Reranker" testId="reranker-section">
          {rerankerModel && <ValueBlock label="Model" value={rerankerModel} />}
          {rerankerQuery && <ValueBlock label="Query" value={rerankerQuery} />}
          {inputValue && <ValueBlock label="Input" value={inputValue} />}
          {outputValue && <ValueBlock label="Output" value={outputValue} />}
          {rerankerResults.length > 0 && (
            <div className={styles.fieldBlock}>
              <div className={styles.fieldLabel}>Results ({rerankerResults.length})</div>
              {rerankerResults.map((r) => (
                <div key={r.index} className={styles.documentBlock}>
                  <div className={styles.documentMeta}>
                    #{r.index}{(r.score !== undefined || r.relevanceScore !== undefined) ? ` · score: ${r.score ?? r.relevanceScore}` : ''}
                  </div>
                  {r.document && <div className={styles.valueBlock}>{r.document}</div>}
                </div>
              ))}
            </div>
          )}
        </CollapsibleSection>
      )}

      {kind === 'RETRIEVER' && (inputValue || retrieralDocs.length > 0) && (
        <CollapsibleSection title="Retrieval" testId="retriever-section">
          {inputValue && <ValueBlock label="Query" value={inputValue} />}
          {retrieralDocs.length > 0 && (
            <div className={styles.fieldBlock}>
              <div className={styles.fieldLabel}>Documents ({retrieralDocs.length})</div>
              {retrieralDocs.map((doc) => (
                <div key={doc.index} className={styles.documentBlock}>
                  <div className={styles.documentMeta}>
                    #{doc.index}{doc.id ? ` · id: ${doc.id}` : ''}{doc.score !== undefined ? ` · score: ${doc.score}` : ''}
                  </div>
                  {doc.content && <div className={styles.valueBlock}>{doc.content}</div>}
                  {doc.metadata && <div className={styles.valueBlock}>{formatValue(doc.metadata)}</div>}
                </div>
              ))}
            </div>
          )}
        </CollapsibleSection>
      )}

      {(kind === 'CHAIN' || kind === 'AGENT' || kind === 'EMBEDDING' || kind === 'UNKNOWN') && (inputValue || outputValue) && (
        <CollapsibleSection title={kind === 'EMBEDDING' ? 'Embedding' : 'Input / Output'} testId="io-section">
          {inputValue && <ValueBlock label="Input" value={inputValue} />}
          {outputValue && <ValueBlock label="Output" value={outputValue} />}
        </CollapsibleSection>
      )}
    </div>
  );
}

interface LlmSpanDetailProps {
  tags: KeyValuePair[];
  llmData: LlmSpanData;
}

export function LlmSpanDetail({ tags, llmData }: LlmSpanDetailProps) {
  const styles = useStyles2(getStyles);
  const toolCallsById = useMemo(
    () => indexToolCalls([...llmData.inputMessages, ...llmData.outputMessages]),
    [llmData.inputMessages, llmData.outputMessages]
  );

  if (!llmData.isLlm) {
    // For non-LLM OpenInference spans (CHAIN, TOOL, RETRIEVER, AGENT, RERANKER, UNKNOWN),
    // show a structured detail panel with their relevant attributes.
    // EMBEDDING spans are routed through the LLM detail path so model/token/cost data is shown (BUG-022).
    if (isOpenInferenceSpan(tags) && llmData.spanKind && llmData.spanKind.toUpperCase() !== 'EMBEDDING') {
      return <OpenInferenceSpanDetail tags={tags} spanKind={llmData.spanKind} />;
    }
    if (!isOpenInferenceSpan(tags) || (llmData.spanKind && llmData.spanKind.toUpperCase() !== 'EMBEDDING')) {
      return null;
    }
  }

  const hasTokenUsage = llmData.tokenUsage.input !== undefined || llmData.tokenUsage.output !== undefined || llmData.tokenUsage.total !== undefined;
  const hasParams = Object.values(llmData.invocationParams).some((v) => v !== undefined && v !== null);
  // For Vertex/OTel spans, spanKind isn't set by extraction — fall back to getSpanKind(tags)
  const spanKindLabel = llmData.spanKind ?? getSpanKind(tags);
  const kindColor = getSpanKindColor(spanKindLabel);
  const hasIdentifiableModel = llmData.model && llmData.model !== 'unknown';

  return (
    <div className={styles.container} data-testid="llm-span-detail">
      <div className={styles.headerRow}>
        {hasIdentifiableModel && (
          <div className={styles.modelBadge}>
            <Icon name="ai-sparkle" className={styles.modelIcon} />
            <span data-testid="llm-model-name">{llmData.model}</span>
          </div>
        )}
        {spanKindLabel && (
          <span className={styles.kindBadge} style={{ background: kindColor }} data-testid="llm-span-kind">
            {spanKindLabel.toUpperCase()}
          </span>
        )}
        <span className={styles.conventionBadge}>{getConventionLabel(llmData.convention)}</span>
        {llmData.system && <span className={styles.conventionBadge}>{llmData.system}</span>}
        {llmData.finishReason && <FinishReasonBadge reason={llmData.finishReason} />}
      </div>

      {llmData.contentNotices?.map((notice) => (
        <div key={notice} className={styles.contentNotice} data-testid="content-notice">{notice}</div>
      ))}

      {llmData.inputMessages.length > 0 && (
        <CollapsibleSection
          title="Input Messages"
          testId="input-messages-section"
          titleExtra={
            <CopyButton
              text={JSON.stringify(llmData.inputMessages, null, 2)}
              label="input messages"
            />
          }
        >
          <div className={styles.messagesContainer}>
            {llmData.inputMessages.map((msg, i) => (
              <MessageBlock
                key={`${i}-${msg.role}-${(msg.content ?? '').slice(0, 20)}`}
                message={msg}
                tools={llmData.tools}
                toolCallsById={toolCallsById}
              />
            ))}
          </div>
        </CollapsibleSection>
      )}

      {llmData.outputMessages.length > 0 && (
        <CollapsibleSection
          title="Output"
          testId="output-section"
          titleExtra={
            llmData.outputMessages.length > 0 ? (
              <CopyButton
                text={JSON.stringify(llmData.outputMessages, null, 2)}
                label="output"
              />
            ) : undefined
          }
        >
          <div className={styles.messagesContainer}>
            {llmData.outputMessages.map((msg, i) => (
              <MessageBlock
                key={`${i}-${msg.role}-${(msg.content ?? '').slice(0, 20)}`}
                message={msg}
                tools={llmData.tools}
                toolCallsById={toolCallsById}
              />
            ))}
          </div>
        </CollapsibleSection>
      )}

      {llmData.tools.length > 0 && (
        <CollapsibleSection title={`Available Tools (${llmData.tools.length})`} defaultOpen={false} testId="available-tools-section">
          <ToolCatalog tools={llmData.tools} />
        </CollapsibleSection>
      )}

      {(hasTokenUsage || hasParams) && (
        <CollapsibleSection title="Parameters & Token Usage" defaultOpen={true} testId="params-section">
          {hasTokenUsage && <TokenUsageDisplay usage={llmData.tokenUsage} model={llmData.model} precomputedCostUsd={llmData.precomputedCostUsd} />}
          {hasParams && <InvocationParamsDisplay params={llmData.invocationParams} />}
        </CollapsibleSection>
      )}
    </div>
  );
}
