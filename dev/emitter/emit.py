import logging
import os
import random
import time

from opentelemetry import metrics, trace
from opentelemetry._logs import set_logger_provider
from opentelemetry.exporter.otlp.proto.http._log_exporter import OTLPLogExporter
from opentelemetry.exporter.otlp.proto.http.metric_exporter import OTLPMetricExporter
from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter
from opentelemetry.sdk._logs import LoggerProvider, LoggingHandler
from opentelemetry.sdk._logs.export import BatchLogRecordProcessor
from opentelemetry.sdk.metrics import MeterProvider
from opentelemetry.sdk.metrics.export import PeriodicExportingMetricReader
from opentelemetry.sdk.resources import Resource
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import BatchSpanProcessor
from opentelemetry.trace import SpanKind

RUN_SECONDS = int(os.environ.get("RUN_SECONDS", "60"))
SCOPE_NAME = "semconv.emitter.http"
SCOPE_VERSION = "0.1.0"


def build_providers():
    resource = Resource.create()
    print("resource:", dict(resource.attributes), flush=True)
    tracer_provider = TracerProvider(resource=resource)
    tracer_provider.add_span_processor(BatchSpanProcessor(OTLPSpanExporter()))
    trace.set_tracer_provider(tracer_provider)
    reader = PeriodicExportingMetricReader(OTLPMetricExporter(), export_interval_millis=5000)
    meter_provider = MeterProvider(resource=resource, metric_readers=[reader])
    metrics.set_meter_provider(meter_provider)
    logger_provider = LoggerProvider(resource=resource)
    logger_provider.add_log_record_processor(BatchLogRecordProcessor(OTLPLogExporter()))
    set_logger_provider(logger_provider)
    logging.getLogger().addHandler(LoggingHandler(level=logging.INFO, logger_provider=logger_provider))
    logging.getLogger().setLevel(logging.INFO)
    return tracer_provider, meter_provider, logger_provider


def build_instruments(meter):
    return {
        "server_duration": meter.create_histogram("http.server.request.duration", unit="s", description="semconv conformant"),
        "client_duration_wrong_unit": meter.create_histogram("http.client.request.duration", unit="ms", description="semconv metric with wrong unit"),
        "custom_counter": meter.create_counter("shop.orders.processed", unit="{order}", description="custom non-semconv metric"),
        "custom_ratio": meter.create_up_down_counter("shop.queue.depth", unit="1", description="custom non-semconv updowncounter"),
        "memory_usage": meter.create_up_down_counter("process.memory.usage", unit="By", description="semconv"),
    }


def emit_iteration(tracer, instruments, log):
    method = random.choice(["GET", "POST"])
    status = random.choice([200, 200, 500])
    with tracer.start_as_current_span("GET /orders/{id}", kind=SpanKind.SERVER, attributes={
        "http.request.method": method,
        "http.method": method,
        "http.route": "/orders/{id}",
        "http.response.status_code": status,
        "http.status_code": status,
        "url.scheme": "http",
    }):
        with tracer.start_as_current_span("SELECT orders", kind=SpanKind.CLIENT, attributes={
            "db.system": "postgresql",
            "db.system.name": "postgresql",
            "db.statement": "SELECT * FROM orders WHERE id=?",
            "net.peer.name": "db.local",
            "server.address": "db.local",
        }):
            time.sleep(0.005)
        log.info("order fetched", extra={"http.request.method": method, "http.method": method, "order.id": "o-123"})
        if status == 500:
            log.error("order fetch failed", extra={"error.type": "500", "exception.type": "OrderError"})
    instruments["server_duration"].record(random.random(), {"http.request.method": method, "http.response.status_code": status, "url.scheme": "http", "http.route": "/orders/{id}"})
    instruments["client_duration_wrong_unit"].record(random.random() * 1000, {"http.method": method, "http.status_code": status, "server.address": "api.local"})
    instruments["custom_counter"].add(1, {"shop.region": "eu", "http.method": method})
    instruments["custom_ratio"].add(random.choice([1, -1]), {"queue.name": "orders"})
    instruments["memory_usage"].add(1024, {})


def main():
    tracer_provider, meter_provider, logger_provider = build_providers()
    tracer = trace.get_tracer(SCOPE_NAME, SCOPE_VERSION)
    instruments = build_instruments(metrics.get_meter(SCOPE_NAME, SCOPE_VERSION))
    log = logging.getLogger("semconv.emitter.logs")
    deadline = time.time() + RUN_SECONDS
    while time.time() < deadline:
        emit_iteration(tracer, instruments, log)
        time.sleep(1)
    meter_provider.force_flush()
    tracer_provider.force_flush()
    logger_provider.force_flush()
    meter_provider.shutdown()
    tracer_provider.shutdown()
    logger_provider.shutdown()


if __name__ == "__main__":
    main()
