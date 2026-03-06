FROM python:3.12-slim

WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc \
    && rm -rf /var/lib/apt/lists/*

# Copy and install requirements
COPY services/meeting/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy shared module
COPY shared/ /app/shared/

# Copy meeting service
COPY services/meeting/ /app/services/meeting/

# Set Python path so shared module is importable
ENV PYTHONPATH=/app

EXPOSE 8002

CMD ["uvicorn", "services.meeting.app.main:app", "--host", "0.0.0.0", "--port", "8002"]
