#!/bin/bash

echo "🚀 SureBet Pro - Deployment Script"
echo "=================================="

# Configuration - Update these values for your repository
GITHUB_REPO="Quranhub1/Surebet-Pro"

# Check if git is initialized
if [ ! -d ".git" ]; then
    echo "📝 Initializing Git repository..."
    git init
    git add .
    git commit -m "Initial commit: SureBet Pro betting prediction platform"
fi

# Check if remote is set
if ! git remote get-url origin > /dev/null 2>&1; then
    echo "🔗 Setting up GitHub remote..."
    echo "Make sure to create the repository at: https://github.com/$GITHUB_REPO"
    echo "Then run: git remote add origin https://github.com/$GITHUB_REPO.git"
    echo "Finally run: git push -u origin main"
else
    echo "📤 Pushing to GitHub..."
    git add .
    git commit -m "Update: Enhanced betting markets and deployment ready" || echo "No changes to commit"
    git push origin main
fi

echo ""
echo "✅ Deployment files created!"
echo "📋 Next steps:"
echo "1. Create repository at: https://github.com/$GITHUB_REPO"
echo "2. Push code: git push -u origin main"
echo "3. Connect to Render:"
echo "   - Go to https://dashboard.render.com"
echo "   - New → Static Site"
echo "   - Connect GitHub repo"
echo "   - Build Command: npm install"
echo "   - Publish Directory: ."
echo "   - Create Static Site"
echo ""
echo "🎉 Your site will be live at: https://surebet-pro.onrender.com"