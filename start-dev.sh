#!/bin/bash
# Start development environment: database + app
# This is what you need to run the app and then the test

set -e

echo "🚀 Starting Development Environment"
echo "===================================="
echo ""

# Check Docker
if ! docker info > /dev/null 2>&1; then
    echo "❌ Docker Desktop is not running"
    echo ""
    echo "Please:"
    echo "1. Open Docker Desktop"
    echo "2. Wait for it to fully start"
    echo "3. Run this script again"
    exit 1
fi

echo "✅ Docker is running"
echo ""

# Start database
echo "📦 Starting database..."
docker compose -f docker-compose.dev.yml up -d postgres

echo "⏳ Waiting for database to be ready..."
sleep 5

# Verify database is running
if docker ps | grep -q postgres; then
    echo "✅ Database is running"
else
    echo "❌ Database failed to start"
    exit 1
fi

echo ""
echo "✅ Development environment is ready!"
echo ""
echo "Now you can:"
echo "  1. Run the app:     npm run dev"
echo "  2. Run the test:    npm run test:choco-tools"
echo ""
