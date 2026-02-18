#!/bin/bash

# Quick start script for Forkscout agent

echo "🚀 Starting Forkscout Agent..."
echo ""
echo "📌 Using configuration from .env file"
echo "   Model: $(grep LLM_MODEL .env | cut -d= -f2)"
echo "   URL: $(grep LLM_BASE_URL .env | cut -d= -f2)"
echo ""
echo "💬 You can now chat with the agent!"
echo "   Type 'exit' to quit"
echo ""

pnpm start