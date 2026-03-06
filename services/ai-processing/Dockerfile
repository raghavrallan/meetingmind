FROM python:3.12-slim

WORKDIR /app

COPY services/ai-processing/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY shared/ ./shared/
COPY services/ai-processing/ ./services/ai_processing/

ENV PYTHONPATH=/app

CMD ["uvicorn", "services.ai_processing.app.main:app", "--host", "0.0.0.0", "--port", "8004"]
