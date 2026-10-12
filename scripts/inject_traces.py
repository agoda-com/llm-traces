"""
Injects realistic OpenInference LLM traces into local Tempo for development.
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
