const { GoogleGenerativeAI } = require('@google/generative-ai');

class PredictionService {
    constructor(apiKey) {
        this.genAI = new GoogleGenerativeAI(apiKey);
        this.model = this.genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });
    }

    async getPrediction(matchData) {
        const prompt = `
        System: Professional Football Prediction Agent.
        Data: ${JSON.stringify(matchData)}
        Analyze H2H, news, and market odds to determine the most likely score.
        Return JSON ONLY: {"predictedScore": "X-Y", "confidence": 0-100, "analysis": "..."}`;

        try {
            const result = await this.model.generateContent(prompt);
            return JSON.parse(result.response.text().match(/\{.*\}/s)[0]);
        } catch (error) {
            console.error("AI Service Error:", error);
            return { predictedScore: "1-1", confidence: 0, analysis: "Service error" };
        }
    }
}

module.exports = PredictionService;

// Self-test logic
if (require.main === module) {
    const service = new PredictionService(process.env.GOOGLE_AI_API_KEY);
    service.getPrediction({ homeTeam: "Arsenal", awayTeam: "Chelsea", stats: "Arsenal 5 game win streak" })
        .then(res => console.log("Test Prediction:", res));
}