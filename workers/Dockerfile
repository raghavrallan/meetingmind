FROM python:3.12-slim

WORKDIR /app

COPY workers/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY shared/ ./shared/
COPY workers/ ./

ENV PYTHONPATH=/app
