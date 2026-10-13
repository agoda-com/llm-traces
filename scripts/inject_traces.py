"""
Injects sample LLM traces into local Tempo for development and review:
plain OpenInference chats, an agent run with tool usage and a guardrail check,
an OTel GenAI span with structured messages and a tool call,
and a multi-agent OTel GenAI run that shows agent identity and the agent graph.
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


# ---- Multi-agent trip planning (OTel GenAI conventions) ----

LEAD_MODEL = "claude-sonnet-4-5"
SPECIALIST_MODEL = "claude-haiku-4-5"

LEAD_SYSTEM = (
    "You lead trip planning. Delegate flights to flight_agent and hotels to hotel_agent, "
    "check the weather with get_weather, then write a short itinerary. Keep the total under the traveller's budget."
)
TRIP_REQUEST = (
    "Plan a weekend in Lisbon for two. We fly from Berlin on Friday 14 March and come back on Sunday 16 March. "
    "The budget is 900 EUR in total. We like food and walking."
)
FLIGHT_SYSTEM = "You find flights. Use search_flights, then report the best option with the total price for all travellers."
HOTEL_SYSTEM = "You find hotels. Use search_hotels, then report the best-reviewed option that fits the price limit."

FLIGHT_TASK = "Cheapest return flights BER to LIS for 2 travellers, out on 14 March, back on 16 March."
HOTEL_TASK = "Hotel in central Lisbon for 2, 14-16 March, max 140 EUR a night."


def tool_def(name: str, description: str, properties: dict, required: list) -> dict:
    return {
        "type": "function",
        "name": name,
        "description": description,
        "parameters": {"type": "object", "properties": properties, "required": required},
    }


SEARCH_FLIGHTS_TOOL = tool_def(
    "search_flights",
    "Search flights between two airports on one date.",
    {
        "origin": {"type": "string", "description": "IATA code, for example BER."},
        "destination": {"type": "string", "description": "IATA code, for example LIS."},
        "date": {"type": "string", "description": "Departure date, YYYY-MM-DD."},
        "travellers": {"type": "integer", "description": "Number of travellers. Prices are totals for all of them."},
        "nonstop_only": {"type": "boolean", "description": "Only return nonstop flights."},
    },
    ["origin", "destination", "date", "travellers"],
)
SEARCH_HOTELS_TOOL = tool_def(
    "search_hotels",
    "Search hotels in a city for a date range.",
    {
        "city": {"type": "string"},
        "check_in": {"type": "string", "description": "YYYY-MM-DD."},
        "check_out": {"type": "string", "description": "YYYY-MM-DD."},
        "max_price_per_night": {"type": "number", "description": "Limit in EUR."},
    },
    ["city", "check_in", "check_out"],
)
GET_WEATHER_TOOL = tool_def(
    "get_weather",
    "Get the forecast for a city on one day.",
    {"city": {"type": "string"}, "date": {"type": "string", "description": "YYYY-MM-DD."}},
    ["city", "date"],
)
FLIGHT_AGENT_TOOL = tool_def(
    "flight_agent",
    "Ask the flight specialist to find and compare flights.",
    {"task": {"type": "string", "description": "What to search for, with airports, dates and travellers."}},
    ["task"],
)
HOTEL_AGENT_TOOL = tool_def(
    "hotel_agent",
    "Ask the hotel specialist to find a hotel.",
    {"task": {"type": "string", "description": "What to search for, with city, dates and price limit."}},
    ["task"],
)


def text_message(role: str, text: str) -> dict:
    return {"role": role, "parts": [{"type": "text", "content": text}]}


def call_message(*calls: tuple) -> dict:
    return {
        "role": "assistant",
        "parts": [{"type": "tool_call", "id": call_id, "name": name, "arguments": args} for call_id, name, args in calls],
    }


def result_message(call_id: str, result) -> dict:
    return {"role": "tool", "parts": [{"type": "tool_call_response", "id": call_id, "response": result if isinstance(result, str) else json.dumps(result)}]}


def agent_span(name: str, description: str, children: list) -> dict:
    return {
        "name": f"invoke_agent {name}",
        "attrs": {
            "gen_ai.operation.name": "invoke_agent",
            "gen_ai.agent.name": name,
            "gen_ai.agent.description": description,
        },
        "children": children,
    }


def chat_span(model: str, system: str, tools: list, history: list, output: dict, input_tokens: int, output_tokens: int,
              duration_ms: int, cache_read_tokens: int = 0) -> dict:
    attrs = {
        "gen_ai.operation.name": "chat",
        "gen_ai.system": "anthropic",
        "gen_ai.request.model": model,
        "gen_ai.response.model": model,
        "gen_ai.request.temperature": 0.2,
        "gen_ai.request.max_tokens": 1024,
        "gen_ai.response.finish_reasons": ["tool_use" if any(p["type"] == "tool_call" for p in output["parts"]) else "stop"],
        "gen_ai.tool.definitions": json.dumps(tools),
        "gen_ai.input.messages": json.dumps([text_message("system", system)] + history),
        "gen_ai.output.messages": json.dumps([output]),
        "gen_ai.usage.input_tokens": input_tokens,
        "gen_ai.usage.output_tokens": output_tokens,
        "gen_ai.usage.total_tokens": input_tokens + output_tokens,
    }
    if cache_read_tokens:
        attrs["gen_ai.usage.cache_read.input_tokens"] = cache_read_tokens
    return {"name": f"chat {model}", "attrs": attrs, "duration_ms": duration_ms}


def tool_span(name: str, call_id: str, args: dict, result, duration_ms: int, children: list = None) -> dict:
    span = {
        "name": f"execute_tool {name}",
        "attrs": {
            "gen_ai.operation.name": "execute_tool",
            "gen_ai.tool.name": name,
            "gen_ai.tool.call.id": call_id,
            "gen_ai.tool.call.arguments": json.dumps(args),
            "gen_ai.tool.call.result": result if isinstance(result, str) else json.dumps(result),
        },
        "duration_ms": duration_ms,
    }
    if children:
        span["children"] = children
    return span


def guardrail_span(name: str, text: str, verdict: str) -> dict:
    return {
        "name": f"guardrail {name}",
        "attrs": {"openinference.span.kind": "GUARDRAIL", "input.value": text, "output.value": verdict},
        "duration_ms": 260,
    }


def trip_planning_trace() -> dict:
    outbound_args = {"origin": "BER", "destination": "LIS", "date": "2025-03-14", "travellers": 2}
    return_args = {"origin": "LIS", "destination": "BER", "date": "2025-03-16", "travellers": 2}
    nonstop_args = {**outbound_args, "nonstop_only": True}
    outbound_result = [
        {"flight": "XA 412", "departs": "06:10", "arrives": "09:05", "stops": 1, "price_eur": 118},
        {"flight": "XA 780", "departs": "17:35", "arrives": "20:15", "stops": 0, "price_eur": 149},
    ]
    return_result = [{"flight": "XA 781", "departs": "19:10", "arrives": "23:45", "stops": 0, "price_eur": 137}]
    nonstop_result = [outbound_result[1]]
    flight_summary = "Best: nonstop XA 780 out on 14 March, XA 781 back on 16 March. 286 EUR for 2."
    hotel_args = {"city": "Lisbon", "check_in": "2025-03-14", "check_out": "2025-03-16", "max_price_per_night": 140}
    hotel_result = [
        {"name": "Hotel Miradouro", "area": "Alfama", "rating": 9.1, "price_per_night": 128},
        {"name": "Casa Tejo", "area": "Baixa", "rating": 8.4, "price_per_night": 109},
    ]
    hotel_summary = "Hotel Miradouro in Alfama, rated 9.1, at 128 EUR per night. For 2 nights that is 256 EUR."
    saturday_args = {"city": "Lisbon", "date": "2025-03-15"}
    sunday_args = {"city": "Lisbon", "date": "2025-03-16"}
    saturday_result = {"summary": "sunny", "high_c": 18, "low_c": 11}
    sunday_result = {"summary": "light rain in the afternoon", "high_c": 16, "low_c": 11}
    itinerary = (
        "Here is a weekend in Lisbon for **542 EUR**, under your 900 EUR budget.\n\n"
        "- **Flights:** nonstop XA 780 out on Friday 14 March, XA 781 back on Sunday 16 March (286 EUR for two)\n"
        "- **Hotel:** Hotel Miradouro in Alfama, 2 nights (256 EUR)\n\n"
        "**Saturday** is sunny, so walk through Alfama in the morning and have a long lunch in Baixa.\n\n"
        "**Sunday** has rain in the afternoon, so keep the morning for a pastry stop and a visit to the Tile Museum before the flight."
    )

    flight_history_1 = [text_message("user", FLIGHT_TASK)]
    flight_calls_1 = call_message(("call_f1", "search_flights", outbound_args), ("call_f2", "search_flights", return_args))
    flight_history_2 = flight_history_1 + [flight_calls_1, result_message("call_f1", outbound_result), result_message("call_f2", return_result)]
    flight_calls_2 = call_message(("call_f3", "search_flights", nonstop_args))
    flight_history_3 = flight_history_2 + [flight_calls_2, result_message("call_f3", nonstop_result)]

    hotel_history_1 = [text_message("user", HOTEL_TASK)]
    hotel_calls_1 = call_message(("call_h1", "search_hotels", hotel_args))
    hotel_history_2 = hotel_history_1 + [hotel_calls_1, result_message("call_h1", hotel_result)]

    lead_1 = call_message(("call_c1", "flight_agent", {"task": FLIGHT_TASK}))
    lead_2 = call_message(("call_c2", "hotel_agent", {"task": HOTEL_TASK}))
    lead_3 = call_message(("call_c3", "get_weather", saturday_args), ("call_c4", "get_weather", sunday_args))
    lead_history_1 = [text_message("user", TRIP_REQUEST)]
    lead_history_2 = lead_history_1 + [lead_1, result_message("call_c1", flight_summary)]
    lead_history_3 = lead_history_2 + [lead_2, result_message("call_c2", hotel_summary)]
    lead_history_4 = lead_history_3 + [
        lead_3,
        result_message("call_c3", saturday_result),
        result_message("call_c4", sunday_result),
    ]
    lead_tools = [FLIGHT_AGENT_TOOL, HOTEL_AGENT_TOOL, GET_WEATHER_TOOL]

    return {
        "root": "plan_weekend_trip",
        "root_attrs": {"input.value": TRIP_REQUEST, "output.value": itinerary},
        "spans": [
            agent_span("lead", "Sends flight and hotel questions to specialist agents and writes the itinerary", [
                guardrail_span("input_check", TRIP_REQUEST, "SAFE"),
                chat_span(LEAD_MODEL, LEAD_SYSTEM, lead_tools, lead_history_1, lead_1, 612, 74, 1150),
                tool_span("flight_agent", "call_c1", {"task": FLIGHT_TASK}, flight_summary, 40, [
                    agent_span("flight_agent", "Finds and compares flights", [
                        chat_span(SPECIALIST_MODEL, FLIGHT_SYSTEM, [SEARCH_FLIGHTS_TOOL], flight_history_1, flight_calls_1, 301, 96, 780),
                        tool_span("search_flights", "call_f1", outbound_args, outbound_result, 420),
                        tool_span("search_flights", "call_f2", return_args, return_result, 380),
                        chat_span(SPECIALIST_MODEL, FLIGHT_SYSTEM, [SEARCH_FLIGHTS_TOOL], flight_history_2, flight_calls_2, 584, 58, 640),
                        tool_span("search_flights", "call_f3", nonstop_args, nonstop_result, 350),
                        chat_span(SPECIALIST_MODEL, FLIGHT_SYSTEM, [SEARCH_FLIGHTS_TOOL], flight_history_3, text_message("assistant", flight_summary), 703, 71, 720),
                    ]),
                ]),
                chat_span(LEAD_MODEL, LEAD_SYSTEM, lead_tools, lead_history_2, lead_2, 748, 69, 1010, cache_read_tokens=520),
                agent_span("hotel_agent", "Finds a hotel that fits the price limit", [
                    chat_span(SPECIALIST_MODEL, HOTEL_SYSTEM, [SEARCH_HOTELS_TOOL], hotel_history_1, hotel_calls_1, 268, 63, 620),
                    tool_span("search_hotels", "call_h1", hotel_args, hotel_result, 460),
                    chat_span(SPECIALIST_MODEL, HOTEL_SYSTEM, [SEARCH_HOTELS_TOOL], hotel_history_2, text_message("assistant", hotel_summary), 412, 44, 560),
                ]),
                chat_span(LEAD_MODEL, LEAD_SYSTEM, lead_tools, lead_history_3, lead_3, 903, 82, 1080, cache_read_tokens=520),
                tool_span("get_weather", "call_c3", saturday_args, saturday_result, 240),
                tool_span("get_weather", "call_c4", sunday_args, sunday_result, 230),
                chat_span(LEAD_MODEL, LEAD_SYSTEM, lead_tools, lead_history_4, text_message("assistant", itinerary), 1046, 176, 2150, cache_read_tokens=520),
                guardrail_span("output_check", itinerary, "SAFE"),
            ]),
        ],
    }


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
    {
        "name": "trip-planner",
        "traces": [trip_planning_trace()],
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

    def emit(span_def: dict) -> None:
        with tracer.start_as_current_span(span_def["name"], kind=SpanKind.INTERNAL) as span:
            for k, v in span_def["attrs"].items():
                span.set_attribute(k, v)
            time.sleep(span_def.get("duration_ms", 0) / 1000)
            for child in span_def.get("children", []):
                time.sleep(0.01)
                emit(child)

    for trace_def in service["traces"]:
        with tracer.start_as_current_span(trace_def["root"], kind=SpanKind.INTERNAL) as root_span:
            root_span.set_attribute("openinference.span.kind", "CHAIN")
            for k, v in trace_def.get("root_attrs", {}).items():
                root_span.set_attribute(k, v)
            for span_def in trace_def["spans"]:
                time.sleep(0.01)
                emit(span_def)

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
