# Multi-stage Dockerfile for building the AI Notetaker Electron distributable.
#
# Stage 1: Install dependencies and build TypeScript + Vite bundles
# Stage 2: Package with electron-builder into platform-specific distributables
#
# Usage:
#   docker build --build-arg PLATFORM=win -t ai-notetaker-agent .
#   docker cp <container>:/app/release ./release

# ── Stage 1: Build ─────────────────────────────────────────────────────
FROM node:20-bullseye AS builder

WORKDIR /app

# Copy package files and install dependencies
COPY package.json ./
RUN npm install --legacy-peer-deps

# Copy source code
COPY tsconfig.json electron-builder.yml ./
COPY src/ src/

# Build with electron-vite (transpile TS, bundle renderer with Vite)
RUN npx electron-vite build

# ── Stage 2: Package ───────────────────────────────────────────────────
FROM builder AS packager

# Argument for target platform: win, mac, linux
ARG PLATFORM=win

# Install system dependencies needed by electron-builder for packaging
RUN apt-get update && apt-get install -y --no-install-recommends \
    rpm \
    fakeroot \
    dpkg \
    && rm -rf /var/lib/apt/lists/*

# Copy electron-builder config and resources
COPY electron-builder.yml ./
COPY resources/ resources/ 2>/dev/null || true

# Package for the target platform
# Note: For Windows builds, wine is needed on Linux. For production,
# consider using GitHub Actions or a Windows CI runner instead.
RUN if [ "$PLATFORM" = "win" ]; then \
      npx electron-builder --win --x64 --dir; \
    elif [ "$PLATFORM" = "mac" ]; then \
      npx electron-builder --mac --x64 --dir; \
    else \
      npx electron-builder --linux --x64 --dir; \
    fi

# The packaged output is in /app/release/
# Use: docker cp <container>:/app/release ./release
