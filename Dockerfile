FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
WORKDIR /srv

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY alembic.ini ./
COPY alembic ./alembic
COPY db ./db
COPY app ./app
COPY scripts ./scripts

RUN useradd --system --no-create-home appuser
USER appuser

EXPOSE 8000
# 2-4 workers behind Nginx (design section 7). --proxy-headers so rate limits and audit rows see the real client IP.
# Run migrations on deploy:  alembic upgrade head
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "2", "--proxy-headers"]
