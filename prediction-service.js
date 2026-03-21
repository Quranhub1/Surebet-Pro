/**
 * Standalone Football Prediction Service
 * Uses Google Gemini AI for match predictions
 * 
 * Usage:
 *   node prediction-service.js
 * 
 * Or import as a module:
 *   const { predictMatch } = require('./prediction-service');
 */

const { GoogleGenerativeAI } = require('@google/generative-ai');

// Load API key from environment or use directly
const GEMINI_API_KEY = process.env.GOOGLE_AI_API_KEY || 'YOUR_GEMINI_API_KEY_HERE';

// Initialize Gemini AI
const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);

/**
 * Get prediction for a football match using Gemini 1.5 Flash
 * @param {string} homeTeam - Home team name
 * @param {string} awayTeam - Away team name
 * @param {string} recentStats - Recent form and statistics
 * @param {string} league - League name (optional)
 * @returns {Promise<Object>} Prediction result with confidence
 */
async function predictMatch(homeTeam, awayTeam, recentStats, league = 'Unknown League') {
    // Use gemini-1.5-flash for speed and efficiency
    const model = genAI.getGenerativeModel({ 
        model: 'gemini-1.5-flash',
    });

    const prompt = `
System: Act as a professional football analyst with 20 years of experience. Use Poisson distribution logic and statistical models for predictions.

Match: ${homeTeam} vs ${awayTeam}
League: ${league}
Context: ${recentStats}

Analyze this match deeply considering:
1. Recent form momentum (last 5 matches)
2. Home advantage factor (~12% boost)
3. Attack vs Defense strength comparison
4. Historical head-to-head patterns
5. Team motivation and match importance

Provide comprehensive predictions for ALL markets:

1. MATCH RESULT (1X2):
   - Home Win, Draw, Away Win probabilities

2. OVER/UNDER GOALS:
   - Over/Under 0.5, 1.5, 2.5, 3.5, 4.5

3. BOTH TEAMS TO SCORE:
   - Yes/No probabilities

4. DOUBLE CHANCE:
   - 1X, 2X, 12 probabilities

5. CORRECT SCORE:
   - Top 5 most likely scores

Respond with ONLY valid JSON:
{
    "matchResult": {
        "homeWin": number (0-100),
        "draw": number (0-100),
        "awayWin": number (0-100)
    },
    "overUnder": {
        "over1_5": number (0-100),
        "under1_5": number (0-100),
        "over2_5": number (0-100),
        "under2_5": number (0-100),
        "over3_5": number (0-100),
        "under3_5": number (0-100)
    },
    "btts": {
        "yes": number (0-100),
        "no": number (0-100)
    },
    "doubleChance": {
        "homeDraw": number (0-100),
        "awayDraw": number (0-100),
        "homeAway": number (0-100)
    },
    "correctScore": {
        "1-0": number (0-100),
        "2-0": number (0-100),
        "2-1": number (0-100),
        "1-1": number (0-100),
        "0-1": number (0-100)
    },
    "confidence": number (0-100),
    "predictedScore": "X-Y",
    "reasoning": "Brief analysis explanation"
}
`;

    try {
        console.log(`🤖 Generating prediction for ${homeTeam} vs ${awayTeam}...`);
        
        const result = await model.generateContent(prompt);
        const response = await result.response;
        const text = response.text();
        
        // Parse JSON from response
        const jsonMatch = text.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
            const prediction = JSON.parse(jsonMatch[0]);
            console.log(`✅ Prediction generated successfully`);
            return prediction;
        } else {
            throw new Error('Could not parse prediction from AI response');
        }
    } catch (error) {
        console.error('❌ Prediction Error:', error.message);
        throw error;
    }
}

/**
 * Example test case for local matches
 */
async function testPrediction() {
    try {
        const prediction = await predictMatch(
            "Vipers SC", 
            "KCCA FC", 
            "Vipers won last 3 home games; KCCA has 2 key defenders out.",
            "Uganda Premier League"
        );
        
        console.log('\n📊 Prediction Result:');
        console.log(JSON.stringify(prediction, null, 2));
        
        return prediction;
    } catch (error) {
        console.error('Test failed:', error.message);
    }
}

// Export for use as module
module.exports = { predictMatch, testPrediction };

// Run test if executed directly
if (require.main === module) {
    console.log('🏆 Football Prediction Service - Gemini 1.5 Flash');
    console.log('================================================\n');
    testPrediction();
}