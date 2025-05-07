import { GoogleGenerativeAI } from '@google/generative-ai';
import { LRUCache } from 'lru-cache';
import config from './config.js';
import { logger } from './logger.js';

const genAI = new GoogleGenerativeAI(config.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({
    model: "gemini-1.5-flash-latest",
    safetySettings: config.SAFETY_SETTINGS
});

const responseCache = new LRUCache({
    max: config.MAX_CACHE_SIZE,
    ttl: config.CACHE_TTL * 1000
});

export const generateResponse = async (prompt, context) => {
    try {
        const cacheKey = createCacheKey(prompt, context);

        if (responseCache.has(cacheKey)) {
            logger.debug(`Cache hit for key: ${cacheKey}`);
            return responseCache.get(cacheKey);
        }

        const fullPrompt = formatPrompt(prompt, context);
        const result = await model.generateContent(fullPrompt);
        const response = result.response.text().trim();

        if (isValidResponse(response)) {
            responseCache.set(cacheKey, response);
            return response;
        }

        throw new Error('Invalid AI response');

    } catch (error) {
        logger.error('AI generation failed', {
            error: error.message,
            prompt: prompt.substring(0, 50)
        });
        return getFallbackResponse();
    }
};

function createCacheKey(prompt, context) {
    return `${context.sender}:${prompt.substring(0, 50)}`;
}

function formatPrompt(prompt, context) {
    return `Respond as ${config.BOT_NAME} (Context: ${context.isGroup ? 'Group' : 'DM'} chat):
    ${prompt}`;
}

function isValidResponse(response) {
    return typeof response === 'string' && 
           response.length > 0 && 
           response.length <= 2000;
}

function getFallbackResponse() {
    const responses = [
        "I'm having trouble understanding that. Could you rephrase?",
        "Hmm, let me think about that again...",
        "My circuits are a bit fuzzy right now. Ask me later?"
    ];
    return responses[Math.floor(Math.random() * responses.length)];
}
