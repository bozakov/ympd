# Multi-stage Dockerfile for ympd (ARM/Debian)
# Build stage
FROM --platform=linux/arm64 debian:bullseye-slim AS builder

# Install build dependencies
RUN apt-get update && apt-get install -y \
    build-essential \
    cmake \
    libmpdclient-dev \
    libssl-dev \
    && rm -rf /var/lib/apt/lists/*

# Set working directory
WORKDIR /app/build

# Copy source code
COPY . /app

# Build ympd
RUN cmake .. \
    -DCMAKE_BUILD_TYPE=Release \
    -DCMAKE_INSTALL_PREFIX=/usr \
    && make

# Runtime stage - minimal image
FROM --platform=linux/arm64 debian:bullseye-slim


# Install runtime dependencies (tini is now included in Docker, no need to install)
RUN apt-get update && apt-get install -y \
    libmpdclient2 \
    libssl1.1 \
    && rm -rf /var/lib/apt/lists/*

# Copy built binary from builder stage
COPY --from=builder /app/build/ympd /usr/bin/ympd
COPY --from=builder /app/build/mkdata /usr/bin/mkdata

# Expose web interface port
EXPOSE 8080


# Use Docker's built-in init for proper signal handling (no need for tini)
ENTRYPOINT ["ympd"]


# Default arguments (can be overridden)
CMD []