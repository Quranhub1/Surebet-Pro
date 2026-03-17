# SureBet Pro - Automated Sports Predictions

A professional betting prediction platform powered by AI ensemble models, featuring real-time football match data and comprehensive betting market predictions.

## 🚀 Features

- **AI-Powered Predictions**: Ensemble of multiple AI models for higher accuracy
- **Comprehensive Betting Markets**:
  - Match Result (1X2)
  - Double Chance (1X, 2X, 12)
  - Over/Under Goals (0.5, 1.5, 2.5, 3.5, 4.5)
  - Both Teams To Score (BTTS)
  - Draw No Bet (DNB)
  - Asian Handicap
  - Correct Score
- **Real-time Match Data**: Integration with Football-Data.org API
- **Professional UI**: Modern dark theme with responsive design
- **Bet Slip Management**: Add, remove, and manage bets
- **Prediction Explanations**: Detailed reasoning for each prediction

## 🛠️ Tech Stack

- **Frontend**: React + JSX (compiled to vanilla JS)
- **Styling**: Tailwind CSS
- **AI Models**: Groq, OpenAI, HuggingFace, Cohere, Anthropic, Google
- **Data Source**: Football-Data.org API
- **Deployment**: Render (static site hosting)

## 📦 Installation & Setup

### Prerequisites
- Node.js 14+ (for local development)
- API keys for:
  - Football-Data.org
  - AI providers (Groq, OpenAI, etc.)

### Local Development
```bash
# Clone the repository
git clone https://github.com/Quranhub1/Surebet-Pro.git
cd surebet-pro

# Install dependencies
npm install

# Test environment configuration
npm run test-env

# Start development server
npm run dev
```

### API Configuration

#### Option 1: In-App Configuration (Development)
1. Open the app in your browser
2. Click the settings icon (⚙️) in the top-right corner
3. Enter your API keys in the configuration modal
4. Select your preferred AI provider

#### Option 2: Environment Variables (Production/Render)
For secure production deployment, use environment variables:

1. **Copy the environment template**:
   ```bash
   cp .env.example .env
   ```

2. **Fill in your API keys** in the `.env` file:
   ```env
   # Football Data API (from football-data.org)
   FOOTBALL_DATA_API_KEY=your_actual_api_key_here

   # AI API Keys (at least one required)
   GROQ_API_KEY=your_groq_api_key_here
   OPENAI_API_KEY=your_openai_api_key_here
   ANTHROPIC_API_KEY=your_anthropic_api_key_here
   GOOGLE_API_KEY=your_google_ai_api_key_here
   HUGGINGFACE_API_KEY=your_huggingface_api_key_here
   COHERE_API_KEY=your_cohere_api_key_here

   # Default AI Provider
   DEFAULT_AI_PROVIDER=groq

   # Daily Target for Predictions
   DAILY_TARGET=100
   ```

3. **For Render Deployment**: Set these as environment variables in your Render dashboard:
   - Go to your Render service → Environment
   - Add each variable with its value
   - The app will automatically use these secure environment variables

## 🚀 Deployment on Render

### Automatic Deployment (Recommended)
1. **Connect GitHub Repository**:
   - Go to [Render Dashboard](https://dashboard.render.com)
   - Click "New +" → "Static Site"
   - Connect your GitHub account
   - Select the `Quranhub1/Surebet-Pro` repository

2. **Configure Build Settings**:
   - **Build Command**: `npm install`
   - **Publish Directory**: `.` (root directory)
   - **Node Version**: 18 or later

3. **Environment Variables** (Required for API functionality):
   - Go to your Render service → Environment
   - Add the following environment variables:
     ```
     FOOTBALL_DATA_API_KEY=your_football_data_api_key
     GROQ_API_KEY=your_groq_api_key
     OPENAI_API_KEY=your_openai_api_key
     ANTHROPIC_API_KEY=your_anthropic_api_key
     GOOGLE_API_KEY=your_google_ai_api_key
     HUGGINGFACE_API_KEY=your_huggingface_api_key
     COHERE_API_KEY=your_cohere_api_key
     DEFAULT_AI_PROVIDER=groq
     DAILY_TARGET=100
     ```
   - **Important**: At least one AI API key is required for predictions to work

4. **Deploy**:
   - Click "Create Static Site"
   - Render will automatically build and deploy on every push to main branch

### Manual Deployment
If you prefer manual deployment:
```bash
# Push to GitHub
git add .
git commit -m "Ready for deployment"
git push origin main
```

The site will be automatically deployed via Render's GitHub integration.

## 🔧 Configuration

### API Keys Setup
The app supports multiple AI providers for ensemble predictions:
- **Groq**: Fast inference, good for real-time predictions
- **OpenAI**: GPT models for detailed analysis
- **HuggingFace**: Open-source models
- **Cohere**: Specialized language models
- **Anthropic**: Claude models
- **Google**: Gemini models

Configure these in the app's settings modal or via environment variables.

## 📊 Betting Markets Explained

### Match Result (1X2)
- **1**: Home team wins
- **X**: Match ends in draw
- **2**: Away team wins

### Double Chance
- **1X**: Home win or draw
- **2X**: Away win or draw
- **12**: Home or away win (no draw)

### Over/Under Goals
- **O0.5**: Total goals > 0.5 (at least 1 goal)
- **U0.5**: Total goals < 0.5 (no goals)
- **O1.5**: Total goals > 1.5 (2+ goals)
- **U1.5**: Total goals < 1.5 (0-1 goals)
- **O2.5**: Total goals > 2.5 (3+ goals)
- **U2.5**: Total goals < 2.5 (0-2 goals)
- **O3.5**: Total goals > 3.5 (4+ goals)
- **U3.5**: Total goals < 3.5 (0-3 goals)
- **O4.5**: Total goals > 4.5 (5+ goals)
- **U4.5**: Total goals < 4.5 (0-4 goals)

### Both Teams To Score (BTTS)
- **Yes**: Both teams score at least one goal
- **No**: At least one team doesn't score

### Draw No Bet (DNB)
- **1**: Home team wins (draw returns stake)
- **2**: Away team wins (draw returns stake)

### Asian Handicap
- **H-0.5**: Home team wins by 1+ goals
- **A-0.5**: Away team wins by 1+ goals
- **H+1**: Home team loses by 0 goals or wins
- **A+1**: Away team loses by 0 goals or wins

### Correct Score
Top 15 most likely scorelines with their respective odds.

## 🤖 AI Prediction System

The platform uses an ensemble approach combining multiple AI models:

1. **Data Collection**: Real match statistics, form, head-to-head
2. **Multi-Model Analysis**: Each AI model provides predictions
3. **Ensemble Processing**: Weighted combination for final prediction
4. **Confidence Scoring**: Agreement level between models
5. **Odds Generation**: Probability-to-odds conversion

## 📱 Usage

1. **Load Matches**: Click "Refresh" to fetch latest matches
2. **View Predictions**: Expand matches to see AI predictions
3. **Add Bets**: Click betting market buttons to add to bet slip
4. **Manage Bets**: Adjust stakes and review potential returns
5. **Get Explanations**: Click "Show Explanation" for detailed reasoning

## 🔒 Security & Privacy

- All API keys are stored locally in browser storage
- No user data is collected or stored
- Predictions are generated client-side
- Secure HTTPS deployment on Render

## 📄 License

MIT License - see LICENSE file for details.

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test thoroughly
5. Submit a pull request

## 📞 Support

For issues or questions:
- Create an issue on GitHub
- Check the troubleshooting section below

## 🔧 Troubleshooting

### Common Issues

**Site not loading**:
- Check browser console for errors
- Ensure API keys are configured
- Verify internet connection

**Predictions not showing**:
- Check API key validity
- Ensure AI provider services are operational
- Try refreshing the page

**Bet slip not working**:
- Clear browser cache
- Check JavaScript console for errors

---

**Built with ❤️ for football enthusiasts and betting professionals**