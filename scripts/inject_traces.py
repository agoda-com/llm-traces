"""
Injects sample LLM traces into local Tempo for development and review:
plain OpenInference chats, an agent run with tool usage and a guardrail check,
and an OTel GenAI span with structured messages and a tool call.
"""
import json
import sys
import time
import urllib.request
from opentelemetry import trace
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import BatchSpanProcessor
from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter
from opentelemetry.sdk.resources import Resource
from opentelemetry.trace import SpanKind

TEMPO_URL = "http://tempo:3200"
TEMPO_ENDPOINT = "http://tempo:4318/v1/traces"

ORDER_TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "lookup_order",
            "description": "Look up an order by its ID and return its status and items.",
            "parameters": {
                "type": "object",
                "properties": {
                    "order_id": {"type": "string", "description": "Order identifier, for example ORD-1042."},
                    "fields": {"type": "array", "items": {"type": "string"}, "description": "Fields to return."},
                },
                "required": ["order_id"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "issue_refund",
            "description": "Refund an order, fully or partially.",
            "parameters": {
                "type": "object",
                "properties": {
                    "order_id": {"type": "string"},
                    "amount": {"type": "number", "description": "Amount in USD."},
                    "reason": {"type": "string"},
                },
                "required": ["order_id", "amount"],
            },
        },
    },
]
AGENT_SYSTEM = "You are a support agent for an online store. Use the available tools to check orders before answering. Be concise and polite."
AGENT_USER = "My order ORD-1042 arrived with a broken mug. Can I get a refund?"
LOOKUP_ARGS = {"order_id": "ORD-1042", "fields": ["status", "items", "total"]}
LOOKUP_RESULT = {
    "order_id": "ORD-1042",
    "status": "delivered",
    "items": [{"sku": "MUG-BLUE", "name": "Blue ceramic mug", "price": 12.5}],
    "total": 12.5,
}
AGENT_ANSWER = (
    "I am sorry the **Blue ceramic mug** arrived broken. Your order ORD-1042 was delivered, so it is eligible for a refund.\n\n"
    "- Item: Blue ceramic mug\n- Refund amount: **$12.50**\n\n"
    "If you would like, I can issue the refund now. Shall I proceed?"
)


def agent_llm_attrs(extra: dict) -> dict:
    attrs = {
        "openinference.span.kind": "LLM",
        "llm.model_name": "claude-sonnet-4-5",
        "llm.system": "anthropic",
        "llm.invocation_parameters": json.dumps({"temperature": 0.2, "max_tokens": 1024}),
        "llm.input_messages.0.message.role": "system",
        "llm.input_messages.0.message.content": AGENT_SYSTEM,
        "llm.input_messages.1.message.role": "user",
        "llm.input_messages.1.message.content": AGENT_USER,
        "llm.tools.0.tool.json_schema": json.dumps(ORDER_TOOLS[0]),
        "llm.tools.1.tool.json_schema": json.dumps(ORDER_TOOLS[1]),
    }
    attrs.update(extra)
    return attrs


SERVICES = [
    {
        "name": "chatbot-api",
        "traces": [
            {
                "root": "customer_query_chain",
                "spans": [
                    {
                        "name": "llm claude-sonnet-4-5",
                        "attrs": {
                            "openinference.span.kind": "LLM",
                            "llm.model_name": "claude-sonnet-4-5",
                            "llm.system": "anthropic",
                            "llm.invocation_parameters": json.dumps({"temperature": 0.3, "max_tokens": 1024}),
                            "llm.input_messages.0.message.role": "system",
                            "llm.input_messages.0.message.content": "You are a helpful customer support assistant.",
                            "llm.input_messages.1.message.role": "user",
                            "llm.input_messages.1.message.content": "What features does product 12345 have?",
                            "llm.output_messages.0.message.role": "assistant",
                            "llm.output_messages.0.message.content": "Product 12345 includes real-time analytics, custom dashboards, and API access.",
                            "llm.token_count.prompt": 312,
                            "llm.token_count.completion": 48,
                            "llm.token_count.total": 360,
                        },
                        "duration_ms": 920,
                    }
                ],
            }
        ],
    },
    {
        "name": "summarizer-api",
        "traces": [
            {
                "root": "generate_summary",
                "spans": [
                    {
                        "name": "llm gpt-4o-mini",
                        "attrs": {
                            "openinference.span.kind": "LLM",
                            "llm.model_name": "gpt-4o-mini",
                            "llm.system": "openai",
                            "llm.invocation_parameters": json.dumps({"temperature": 0.7, "max_tokens": 500}),
                            "llm.input_messages.0.message.role": "system",
                            "llm.input_messages.0.message.content": "You write concise performance summaries.",
                            "llm.input_messages.1.message.role": "user",
                            "llm.input_messages.1.message.content": "Summarize the Q1 2026 metrics for dashboard 99999.",
                            "llm.output_messages.0.message.role": "assistant",
                            "llm.output_messages.0.message.content": "Q1 2026 highlights: response time down 12%, throughput up 15%. Strong performance across all regions.",
                            "llm.token_count.prompt": 145,
                            "llm.token_count.completion": 62,
                            "llm.token_count.total": 207,
                        },
                        "duration_ms": 1820,
                    }
                ],
            }
        ],
    },
    {
        "name": "support-agent",
        "traces": [
            {
                "root": "support_agent_run",
                "root_attrs": {
                    "openinference.span.kind": "AGENT",
                    "input.value": AGENT_USER,
                    "output.value": AGENT_ANSWER,
                    "session.id": "sess_demo_001",
                },
                "spans": [
                    {
                        "name": "input_guardrail",
                        "attrs": {
                            "openinference.span.kind": "GUARDRAIL",
                            "llm.model_name": "gpt-4o-mini",
                            "llm.system": "openai",
                            "llm.invocation_parameters": json.dumps({"temperature": 0, "max_tokens": 16}),
                            "llm.input_messages.0.message.role": "system",
                            "llm.input_messages.0.message.content": "Answer SAFE if the request is a legitimate store support question, otherwise answer BLOCK.",
                            "llm.input_messages.1.message.role": "user",
                            "llm.input_messages.1.message.content": AGENT_USER,
                            "llm.output_messages.0.message.role": "assistant",
                            "llm.output_messages.0.message.content": "SAFE",
                            "llm.token_count.prompt": 58,
                            "llm.token_count.completion": 2,
                            "llm.token_count.total": 60,
                        },
                        "duration_ms": 340,
                    },
                    {
                        "name": "llm claude-sonnet-4-5",
                        "attrs": agent_llm_attrs({
                            "llm.output_messages.0.message.role": "assistant",
                            "llm.output_messages.0.message.tool_calls.0.tool_call.id": "call_order_1",
                            "llm.output_messages.0.message.tool_calls.0.tool_call.function.name": "lookup_order",
                            "llm.output_messages.0.message.tool_calls.0.tool_call.function.arguments": json.dumps(LOOKUP_ARGS),
                            "llm.token_count.prompt": 418,
                            "llm.token_count.completion": 61,
                            "llm.token_count.total": 479,
                        }),
                        "duration_ms": 1320,
                    },
                    {
                        "name": "lookup_order",
                        "attrs": {
                            "openinference.span.kind": "TOOL",
                            "tool.name": "lookup_order",
                            "input.value": json.dumps(LOOKUP_ARGS),
                            "output.value": json.dumps(LOOKUP_RESULT),
                        },
                        "duration_ms": 320,
                    },
                    {
                        "name": "llm claude-sonnet-4-5",
                        "attrs": agent_llm_attrs({
                            "llm.input_messages.2.message.role": "assistant",
                            "llm.input_messages.2.message.tool_calls.0.tool_call.id": "call_order_1",
                            "llm.input_messages.2.message.tool_calls.0.tool_call.function.name": "lookup_order",
                            "llm.input_messages.2.message.tool_calls.0.tool_call.function.arguments": json.dumps(LOOKUP_ARGS),
                            "llm.input_messages.3.message.role": "tool",
                            "llm.input_messages.3.message.tool_call_id": "call_order_1",
                            "llm.input_messages.3.message.content": json.dumps(LOOKUP_RESULT),
                            "llm.output_messages.0.message.role": "assistant",
                            "llm.output_messages.0.message.content": AGENT_ANSWER,
                            "llm.token_count.prompt": 612,
                            "llm.token_count.completion": 94,
                            "llm.token_count.total": 706,
                        }),
                        "duration_ms": 1820,
                    },
                ],
            }
        ],
    },
    {
        "name": "travel-assistant",
        "traces": [
            {
                "root": "plan_city_break",
                "spans": [
                    {
                        "name": "chat gpt-4o",
                        "attrs": {
                            "gen_ai.operation.name": "chat",
                            "gen_ai.system": "openai",
                            "gen_ai.request.model": "gpt-4o",
                            "gen_ai.response.model": "gpt-4o-2024-08-06",
                            "gen_ai.request.temperature": 0.6,
                            "gen_ai.request.max_tokens": 512,
                            "gen_ai.response.finish_reasons": ["stop"],
                            "gen_ai.tool.definitions": json.dumps([
                                {
                                    "type": "function",
                                    "name": "get_weather",
                                    "description": "Get the current weather for a city.",
                                    "parameters": {
                                        "type": "object",
                                        "properties": {"location": {"type": "string", "description": "City name."}},
                                        "required": ["location"],
                                    },
                                }
                            ]),
                            "gen_ai.input.messages": json.dumps([
                                {"role": "system", "parts": [{"type": "text", "content": "You are a helpful travel assistant."}]},
                                {"role": "user", "parts": [{"type": "text", "content": "Is Paris a good choice for a city break this weekend?"}]},
                                {"role": "assistant", "parts": [{"type": "tool_call", "id": "call_weather_1", "name": "get_weather", "arguments": {"location": "Paris"}}]},
                                {"role": "tool", "parts": [{"type": "tool_call_response", "id": "call_weather_1", "response": "rainy, 14 C"}]},
                            ]),
                            "gen_ai.output.messages": json.dumps([
                                {
                                    "role": "assistant",
                                    "parts": [{"type": "text", "content": "Paris is rainy and about 14 C this weekend. It still works well for museums such as the Louvre, so pack an umbrella."}],
                                    "finish_reason": "stop",
                                }
                            ]),
                            "gen_ai.usage.input_tokens": 187,
                            "gen_ai.usage.output_tokens": 41,
                        },
                        "duration_ms": 1100,
                    }
                ],
            }
        ],
    },
]


def wait_for_tempo(timeout_s: int = 180) -> None:
    deadline = time.time() + timeout_s
    while time.time() < deadline:
        try:
            with urllib.request.urlopen(f"{TEMPO_URL}/ready", timeout=3) as response:
                if response.status == 200:
                    return
        except OSError:
            pass
        time.sleep(2)
    sys.exit(f"Tempo was not ready at {TEMPO_URL}/ready after {timeout_s}s")


def inject_service(service: dict):
    resource = Resource.create({"service.name": service["name"]})
    provider = TracerProvider(resource=resource)
    exporter = OTLPSpanExporter(endpoint=TEMPO_ENDPOINT)
    provider.add_span_processor(BatchSpanProcessor(exporter))
    tracer = provider.get_tracer("llm-trace-injector")

    for trace_def in service["traces"]:
        with tracer.start_as_current_span(trace_def["root"], kind=SpanKind.INTERNAL) as root_span:
            root_span.set_attribute("openinference.span.kind", "CHAIN")
            for k, v in trace_def.get("root_attrs", {}).items():
                root_span.set_attribute(k, v)
            for span_def in trace_def["spans"]:
                time.sleep(0.01)
                with tracer.start_as_current_span(span_def["name"], kind=SpanKind.INTERNAL) as span:
                    for k, v in span_def["attrs"].items():
                        span.set_attribute(k, v)
                    time.sleep(span_def["duration_ms"] / 1000)

    if not provider.force_flush():
        sys.exit(f"Failed to export traces for {service['name']} to {TEMPO_ENDPOINT}")
    provider.shutdown()
    print(f"Injected traces for {service['name']}")


if __name__ == "__main__":
    print("Injecting LLM traces into Tempo...")
    wait_for_tempo()
    for svc in SERVICES:
        inject_service(svc)
    print("Done.")
