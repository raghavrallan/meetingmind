FROM python:3.12-slim
WORKDIR /app
COPY services/task/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY shared/ ./shared/
COPY services/task/ ./services/task/
ENV PYTHONPATH=/app
CMD ["uvicorn", "services.task.app.main:app", "--host", "0.0.0.0", "--port", "8006"]
