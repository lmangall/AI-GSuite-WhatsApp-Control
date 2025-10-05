#!/bin/bash
set -e

APP_NAME="nestjs-whatsapp"
APP_PATH="/home/ubuntu/repos/AI-GSuite-WhatsApp-Control"
PORT=3000

echo ""
echo "=============================="
echo "🚀 Starting deployment for $APP_NAME"
echo "=============================="
echo ""

cd $APP_PATH || { echo "❌ Failed to access $APP_PATH"; exit 1; }

echo "🛑 Stopping PM2 processes..."
sudo pm2 delete all >/dev/null 2>&1 || true

echo "🔪 Killing any process using port $PORT..."
PIDS=$(sudo lsof -t -i :$PORT 2>/dev/null || true)
if [ -n "$PIDS" ]; then
  sudo kill -9 $PIDS 2>/dev/null || true
  echo "✅ Killed processes on port $PORT"
else
  echo "ℹ️ No processes running on port $PORT"
fi

echo "🧹 Flushing PM2 logs..."
sudo pm2 flush >/dev/null 2>&1 || true

echo "⬇️ Pulling latest changes from Git..."
git reset --hard >/dev/null 2>&1
git pull

echo "📦 Installing dependencies..."
npm install 

echo "🏗️ Building project..."
npm run build

echo "🚀 Starting PM2 process..."
sudo pm2 start dist/main.js --name $APP_NAME --update-env

echo "💾 Saving PM2 startup configuration..."
sudo pm2 save

echo ""
echo "✅ Deployment completed successfully!"
echo "=============================="

