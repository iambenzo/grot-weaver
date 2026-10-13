FROM python:3.12.12-slim
RUN pip install --no-cache-dir opentelemetry-sdk==1.45.1 opentelemetry-exporter-otlp-proto-http==1.45.1
COPY emit.py /app/emit.py
ENTRYPOINT ["python", "/app/emit.py"]
