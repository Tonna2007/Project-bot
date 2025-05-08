// ================================================================= //
//                       TonnaBot - index.js                         //
//    (Zip Strategy - Final Features + AI/Admin/Cmd Fixes V8)      // // Version updated
// ================================================================= //

// --- Imports ---
import dotenv from 'dotenv';
dotenv.config(); // Load environment variables first

import fs from 'fs/promises';
import fsSync from 'fs'; // Keep sync version if needed elsewhere, though async is preferred
import path from 'path';
import AdmZip from 'adm-zip';
import qrcode from 'qrcode-terminal';
import { Boom } from '@hapi/boom';
import baileysPkg from 'baileys';
import { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold } from '@google/generative-ai';

import http from 'http'; // For Render health check server
// Add these if they aren't already present
import { fileURLToPath } from 'url';
import { logger, messageLogger } from './logger.js'; // Ensure logger.js exists and works
import fetch from 'node-fetch'; // Needed for the new sendViewOnce command
import { createClient } from '@supabase/supabase-js'; // <<< ADD THIS IMPORT



// --- Global Database Variables ---
// let dbClient = null; // <<< REMOVE
// let usersCollection = null; // <<< REMOVE
// const DB_NAME = 'TonnaBotData'; // <<< REMOVE
// const USERS_COLLECTION_NAME = 'users'; // <<< REMOVE

let supabase = null; // <<< ADD THIS: Will hold the Supabase client instance
// --- End Global DB Variables ---



const delay = ms => new Promise(res => setTimeout(res, ms));

// Destructure Baileys functions for cleaner use
const {
    proto,
    getContentType,
    jidNormalizedUser, // Keep if used, otherwise can remove
    DisconnectReason,  // Add DisconnectReason for clarity
    makeWASocket,
    useMultiFileAuthState,
    Browsers,
    downloadMediaMessage, // Add downloadMediaMessage for clarity
    // Add any other Baileys functions you use directly here
} = baileysPkg;


// ================== Constants ================== //

// --- Paths ---
// Use process.cwd() to ensure paths are relative to where the script is run


const BASE_DIR = process.cwd();
const SESSION_DIR = path.join(BASE_DIR, 'auth_info');
const SESSION_BACKUP_ZIP = path.join(BASE_DIR, 'auth_info_backup.zip'); // Specific backup name

const LOG_DIR = path.join(BASE_DIR, 'logs');
const LEVELS_FILE = path.join(BASE_DIR, 'levels.json');

// --- Bot Behavior ---
const MAX_WARNINGS = 5;
const SPAM_WINDOW_MS = 3000; // Time window for spam check in milliseconds
const REPORT_INTERVAL_MS = 3600000; // Interval for session backup (1 hour)
const TYPING_SIMULATION_MS = 7000; // Duration for typing simulation (7 seconds)
const MAX_FEEDBACK_MESSAGES = 50; // Max feedback messages to store
const MAX_PINNED_MESSAGES = 50; // Max pinned messages to store
const CHAT_HISTORY_LENGTH = 100; // Max AI memory turns (user + bot messages)
const VIEW_ONCE_EXPIRATION_MS = 5 * 60 * 1000; // 5 minutes for view-once storage
const VIEW_ONCE_CLEANUP_INTERVAL_MS = 5 * 60 * 1000; // Cleanup interval matches expiration
// --- Simple Jokes List ---
// (Keep JOKES array as provided by user)
const JOKES = [
    "Why did the scarecrow win award? Because he was outstanding for him field! 😂",
    "Why scientists no trust atoms? Because dem dey make up everything! ⚛️",
    "Wetin you call fake spaghetti? Impasta! 🍝",
    "Why the bicycle fall down? Because e too tire! 🚲",
    "Parallel lines get plenty things in common. Shame say dem no fit meet sha. 🤔",
    "Why eggs no dey tell joke? Dem go crack each other up! 🥚",
    "Wetin you call lazy kangaroo? Pouch potato! 🦘",
    "Why maths book dey sad? E get too many problems! ➕➖",
    "Why coffee go police station? Because e get mugged! ☕",
    "How penguin take build him house? Igloos am together! 🐧❄️",
    "My guy, relationship be like algebra. You look your X and wonder Y? 🤷‍♂️",
    "I wan tell knock-knock joke, but make you start... Knock knock! 😉"
];

// ================== CYBER WARFARE ================== //
// (Keep as provided by user)
const ROAST_TRIGGERS = ["roast", "clown", "drag", "vawulence", "insult", "bastard", "Fool", "illiterate"]; // Note: Not currently used in logic
const ROAST_HISTORY = new Map(); // Note: Not currently used in logic
let cyberWarfareMode = false; // Global flag for cyber warfare mode


// ================== Configuration ================== //
// Load configuration from environment variables with defaults
const config = {
    COMMAND_PREFIX: process.env.COMMAND_PREFIX || '!',
    SPAM_MUTE_MINUTES: parseInt(process.env.SPAM_MUTE_MINUTES) || 5, // Note: Not currently used in logic
    OWNER_NUMBER: process.env.OWNER_NUMBER, // CRITICAL - Must be set in .env
    GEMINI_API_KEY: process.env.GEMINI_API_KEY, // CRITICAL - Must be set in .env
    BOT_NAME: process.env.BOT_NAME || 'TonnaBot',
    DEFAULT_AVATAR: process.env.DEFAULT_AVATAR || 'https://i.imgur.com/qMnMXuD.png', // URL for fallback avatar
    // Ensure BLOCKED_LINKS is valid JSON in .env or use default
    BLOCKED_LINKS: (() => {
        try {
            return JSON.parse(process.env.BLOCKED_LINKS || '["http://","https://","www."]');
        } catch (e) {
            logger.error("Invalid JSON in BLOCKED_LINKS env variable. Using default.", e);
            return ["http://", "https://", "www."]; // Default fallback
        }
    })(),
    WARN_MESSAGE: process.env.WARN_MESSAGE || "⚠️ Links no be ya mate!", // Persona message for link warning
    RATE_LIMIT_MS: parseInt(process.env.RATE_LIMIT) || 5000, // Rate limit per user in milliseconds
    CACHE_MAX_SIZE: parseInt(process.env.CACHE_MAX_SIZE) || 100, // Max items in AI response cache
    CACHE_TTL_MS: parseInt(process.env.CACHE_TTL_MS) || 600000, // Cache time-to-live (10 minutes)
       // --- ADD THIS LINE ---
    
    BOT_PRIMARY_JID: process.env.BOT_PRIMARY_JID, // Add the bot's primary JID config
    // --- ADD THESE SUPABASE LINES ---
    SUPABASE_URL: process.env.SUPABASE_URL,
    SUPABASE_SERVICE_KEY: process.env.SUPABASE_SERVICE_KEY
    // --- END ADD ---
};

// --- Validate Critical Config ---
if (!config.OWNER_NUMBER) {
    logger.fatal("FATAL: OWNER_NUMBER is not set in environment variables.");
    process.exit(1);
}
if (!config.GEMINI_API_KEY) {
    logger.fatal("FATAL: GEMINI_API_KEY is not set in environment variables.");
    process.exit(1);
}
if (!config.BOT_PRIMARY_JID) {

    logger.warn("WARNING: BOT_PRIMARY_JID is not set in environment variables. Reply trigger may be unreliable.");

    // You could choose to exit if this is critical:

    // logger.fatal("FATAL: BOT_PRIMARY_JID is not set."); process.exit(1);

}

// --- END ADD ---

// ================== State Management ================== //
// Global variables to hold the bot instance and state data

let sockInstance = null; // Holds the Baileys socket instance
let botStartTime = Date.now(); // Track bot start time for uptime command

// Stores media temporarily for the new view-once handler
const viewOnceStore = new Map();

const state = {
    nuclearAI: false,                     // Global override for AI responses
    groupSettings: new Map(),             // Stores settings per group { chatId -> settingsObj }
    userWarnings: new Map(),              // Stores warning counts per user { userId -> count }
    messageTimestamps: new Map(),         // Stores recent message timestamps for spam check { userId -> [ts1, ts2,...] }
    // viewOnceMedia: new Map(), // REMOVED - Replaced by viewOnceStore
    commandTimestamps: new Map(),         // Stores last command timestamp per user for rate limiting { userId -> timestamp }
    typingSimulations: new Map(),         // Stores active typing simulation timeouts { chatId -> timeoutId }
    feedback: [],                         // Stores user feedback messages [ { sender, name, timestamp, message } ]
    pinnedMessages: new Map(),            // Stores pinned messages { pinId -> { text, senderJid, senderName, timestamp } }
    chatHistories: new Map(),             // Stores AI chat history per chat { chatId -> [ { role, parts:[{text}] } ] }
     //levelData: {},
    // --- ADD THIS LINE ---
    onlineUsers: new Map(), // Stores { userId -> 'available' | 'unavailable' | timestamp } - simplified for now
    // --- END ADD ---
    // --- ADD THIS LINE FOR KEYWORD COUNTS ---
   keywordCounts: {}, // Holds { userId -> { keyword1: count, keyword2: count, lastReset: timestamp } }
    punishedUsers: new Map(), // Stores { userId -> punishmentEndTimeTimestamp }
    // --- END ADD ---


    cache: {                              // Simple in-memory cache for AI responses
        storage: new Map(),
        /**
         * Gets data from cache if not expired.
         * @param {string} key Cache key
         * @returns {any|null} Cached data or null
         */
         
        get(key) {
            const entry = this.storage.get(key);
            if (entry && Date.now() < entry.expires) {
                return entry.data;
            }
            this.storage.delete(key);
            return null;
        },
        /**
         * Sets data in the cache with TTL. Evicts oldest if full.
         * @param {string} key Cache key
         * @param {any} data Data to cache
         */
        set(key, data) {
            if (this.storage.size >= config.CACHE_MAX_SIZE) {
                const firstKey = this.storage.keys().next().value;
                this.storage.delete(firstKey);
                logger.debug(`Cache evicted oldest key: ${firstKey}`);
            }
            const expires = Date.now() + config.CACHE_TTL_MS;
            this.storage.set(key, { data, expires });
            logger.debug(`Cache SET: ${key} (TTL: ${config.CACHE_TTL_MS / 1000}s)`);
        }
    }
};

// Log initial config values (excluding sensitive keys)
logger.info("Configuration Loaded:", {
    prefix: config.COMMAND_PREFIX,
    botName: config.BOT_NAME,
    ownerSet: !!config.OWNER_NUMBER,
    geminiKeySet: !!config.GEMINI_API_KEY,
    rateLimit: config.RATE_LIMIT_MS,
    cacheSize: config.CACHE_MAX_SIZE,
    cacheTTL: config.CACHE_TTL_MS,
    blockedLinkPatterns: config.BLOCKED_LINKS.length
});

// ================== Gemini AI Setup ================== //

// Validate API Key (already done in config check, but good practice)
if (!config.GEMINI_API_KEY) {
    // This case should technically not be reached due to earlier exit
    logger.fatal("FATAL: GEMINI_API_KEY check failed unexpectedly.");
    process.exit(1);
}

// Initialize the Google Generative AI client
const genAI = new GoogleGenerativeAI(config.GEMINI_API_KEY);



// Define safety settings for the AI model
// BLOCK_NONE allows potentially harmful content (use with caution)
// BLOCK_ONLY_HIGH blocks only high-probability harmful content
// BLOCK_MEDIUM_AND_ABOVE blocks medium and high probability
const safetySettings = [
    { category: HarmCategory.HARM_CATEGORY_HARASSMENT,         threshold: HarmBlockThreshold.BLOCK_NONE }, // Adjust as needed
    { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH,        threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH },
    { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT,  threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
    { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT,  threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE }
];

// ================== Gemini AI Setup ================== //

// ... (keep genAI initialization and safetySettings) ...

// Determine the AI model to use (from env or default to gemini-pro-vision)
// UPDATED a Default model below
const modelToUse = process.env.GEMINI_MODEL_NAME || "gemini-pro-vision"; // Default to vision model
logger.info(`Using Gemini Model: ${modelToUse}`);

// Get the generative model instance with specified settings
const aiModel = genAI.getGenerativeModel({
    model: modelToUse, // Use the potentially updated model name
    safetySettings: safetySettings
    // Optional: Add generationConfig if you want to control output further
    // generationConfig: { temperature: 0.7, topP: 1, topK: 1, maxOutputTokens: 2048 }
});

// ================== XP / Level System Constants ================== //
const XP_PER_MESSAGE = 15;
const BASE_XP_FOR_LEVEL = 300;
const XP_MULTIPLIER = 60;

// --- Define Role Titles based on Level ---
// IMPORTANT: Keep this sorted by level ascending!
const LEVEL_ROLES = [
    { level: 0, title: "🌱 Newbie" },
    { level: 20, title: "🥉 Attention seeker" },
    { level: 40, title: "🥈 less busy" },
    { level: 60, title: "🥇 Regular" },
    { level: 80, title: "? Vibe Giver" },
    { level: 100, title: "🏅 Active Client" },
    { level: 140, title: "🌟 Pro Viber" },
    { level: 180, title: " 🕴🏾 Admin Wannbe " },
    { level: 200, title: "🏆 Master" },
    { level: 250, title: "🦦 jobless" },
    { level: 500, title: "💪 ChatterBox" },
    { level: 1000, title: "🫡 Alaways active" },
    { level: 1250, title: "💎 Clerk☣" },
    { level: 5000, title: "?️☢️King Of WhatsApp🐲" },
    { level: 10000, title: "🌓 Mark Zuckerbug👑" }
    // Add more levels/titles if you like
];

// --- ADD THESE CONSTANTS for Deep Spy Mode ---
const KEYWORDS_TO_TRACK = [
    'please',
    'i need', // Keep phrases lowercase
    'love',
    'beg',
    'sorry',
    'biko', // Add any other words/phrases you want to track
    'abeg'
];
const KEYWORD_THRESHOLD = 50; // Expose user after saying a keyword this many times
// --- END ADD ---


/**
 * Calculates the total XP required to reach the *next* level.
 * @param {number} currentLevel The user's current level.
 * @returns {number} The total XP needed to advance from the start of the current level.
 */
function getRequiredXP(currentLevel) {
  // Ensure level is a non-negative integer
  const level = Math.max(0, Math.floor(currentLevel));
  return BASE_XP_FOR_LEVEL + level * XP_MULTIPLIER;
}
// ================== End XP Constants ================== //


// --- ADD THIS HELPER FUNCTION GLOBALLY ---
/**
 * Gets the role title for a given level based on LEVEL_ROLES.
 * @param {number} level The user's current level.
 * @returns {string} The role title.
 */
const getTitleForLevel = (level) => {
    let currentTitle = LEVEL_ROLES[0]?.title || 'Unknown Role'; // Default to lowest or 'Unknown Role'
    // Iterate backwards through roles to find the highest one achieved
    // This ensures that if a user is level 12, and roles are at 0, 5, 10, they get the level 10 role.
    for (let i = LEVEL_ROLES.length - 1; i >= 0; i--) {
        if (level >= LEVEL_ROLES[i].level) {
            currentTitle = LEVEL_ROLES[i].title;
            break; // Found the highest applicable role
        }
    }
    // If no role was found (e.g., level is negative, or LEVEL_ROLES is empty), return a default.
    // This is already handled by the initial value of currentTitle if LEVEL_ROLES[0] exists.
    return currentTitle;
};
// --- END ADD HELPER FUNCTION ---






/**
 * Handles the !avenged command. Lists group members with a level lower
 * than the user who ran the command, using data from Supabase.
 * v4 Supabase Debug: Adds detailed logging inside filter loop, FIXES SYNTAX ERROR.
 * @param {object} context Parsed message context
 * @param {string[]} args Command arguments (not used)
 */
async function handleAvengedCommand(context, args) {
    if (!context.isGroup) {
        await sendReply(context, "❌ This command only works inside groups.");
        return;
    }

    const senderJid = context.sender;
    const chatId = context.chatId;
    const defaultRole = LEVEL_ROLES[0]?.title || 'N/A';
    const logPrefix = "[Avenged Cmd Supabase v4 Debug]"; // Version bump for log

    if (!supabase) {
        logger.warn(`${logPrefix} Supabase client not initialized.`);
        await sendReply(context, "⚠️ Bot database connection error.");
        return;
    }

    logger.info(`${logPrefix} Requested by ${senderJid} in group ${chatId}`);
    const feedbackMsg = await sendReply(context, `⏳ Calculating your avenged list (Debug v4)...`);

    try {
        // --- Get Sender's Data ---
        logger.debug(`${logPrefix} Fetching sender data for ${senderJid}...`);
        const { data: senderDbData, error: senderFetchError } = await supabase.from('users_data').select('level, title').eq('user_id', senderJid).single();
        if (senderFetchError && senderFetchError.code !== 'PGRST116') throw new Error(`Sender fetch error: ${senderFetchError.message}`);
        const senderLevel = senderDbData?.level || 0;
        const senderTitle = senderDbData?.title || getTitleForLevel(senderLevel) || defaultRole;
        logger.info(`${logPrefix} Sender Level Found: ${senderLevel}`);

        if (senderLevel === 0) {
             if (feedbackMsg?.key) { await sockInstance.sendMessage(context.chatId, { delete: feedbackMsg.key }).catch(e => {});}
             await sendReply(context, `😅 You're Level 0 (${senderTitle}). Rank up first!`);
             return;
        }

        // --- Get Group Members & Their Data ---
        logger.debug(`${logPrefix} Fetching group metadata...`);
        const metadata = await sockInstance.groupMetadata(chatId);
        const participants = metadata?.participants || [];
        if (participants.length === 0) {
            if (feedbackMsg?.key) { await sockInstance.sendMessage(context.chatId, { delete: feedbackMsg.key }).catch(e => {});}
            await sendReply(context, "⚠️ Could not fetch group members list.");
            return;
        }
        logger.debug(`${logPrefix} Found ${participants.length} participants.`);

        const otherParticipantJids = participants.map(p => sanitizeJid(p.id)).filter(jid => !!jid && jid !== senderJid);
        logger.debug(`${logPrefix} Found ${otherParticipantJids.length} other participants.`);

        let groupUsersData = [];
        if (otherParticipantJids.length > 0) {
            logger.debug(`${logPrefix} Fetching DB data for other participants...`);
            const { data: fetchedData, error: groupFetchError } = await supabase.from('users_data').select('user_id, level').in('user_id', otherParticipantJids);
            if (groupFetchError) throw new Error(`Group users fetch error: ${groupFetchError.message}`);
            groupUsersData = fetchedData || [];
            logger.info(`${logPrefix} Fetched ${groupUsersData.length} records from DB for other participants.`);
        } else {
             // *** CORRECTED LINE ***
             logger.debug(`${logPrefix} No other participants to fetch.`);
             // *** END CORRECTION ***
        }
        // --- End Group Member Data ---


        // --- Create map and filter for avenged users (keep existing logic) ---
        const dbDataMap = new Map();
        groupUsersData.forEach(u => dbDataMap.set(u.user_id, u));
        logger.debug(`${logPrefix} Created dbDataMap with ${dbDataMap.size} entries.`);

        logger.info(`${logPrefix} Filtering participants vs senderLevel (${senderLevel})...`);
        const avengedUsers = [];
        let checkedCount = 0;
        for (const p of participants) {
            const jid = sanitizeJid(p.id);
            if (!jid || jid === senderJid) continue; // Skip self and invalid

            const dbUser = dbDataMap.get(jid);
            const userLevel = dbUser?.level || 0; // Default to level 0 if not in DB map

            // Log the check for the first 10 users (or fewer)
            if (checkedCount < 10) {
                 logger.info(`${logPrefix} Checking user ${jid.split('@')[0]}: DBLevel=${dbUser?.level ?? 'N/A -> 0'}. Is ${userLevel} < ${senderLevel}? ${userLevel < senderLevel}`);
                 checkedCount++;
            }

            if (userLevel < senderLevel) {
                avengedUsers.push({ jid: jid, level: userLevel, name: p.pushName || jid.split('@')[0] }); // Added name for sort
            }
        }
        logger.info(`${logPrefix} Filtering complete. Found ${avengedUsers.length} avenged users.`);
        // --- End Filter ---

        // --- Sort ---
        avengedUsers.sort((a, b) => {
            if (a.level !== b.level) return a.level - b.level; // Level ascending
            return (a.name || '').localeCompare(b.name || ''); // Then name ascending
        });

        // --- Format and Send Reply ---
        const groupName = metadata.subject || 'This Group'; // Get group name for title maybe?
        let replyText = `*⚔️ Avenged by @${senderJid.split('@')[0]} (${senderTitle} - Lvl ${senderLevel}) ⚔️*\n`;
        replyText += `────────────────────\n`;
        if (avengedUsers.length === 0) {
            replyText += "\nNo one found below your level yet. Keep going! 🔥";
        } else {
            avengedUsers.forEach((user, index) => {
                 replyText += `${index + 1}. @${user.jid.split('@')[0]} - Level ${user.level}\n`;
            });
            replyText += `────────────────────\nTotal Avenged: ${avengedUsers.length}`;
        }
        const mentions = [senderJid, ...avengedUsers.map(u => u.jid)];
        // --- End Formatting ---

        if (feedbackMsg?.key) { await sockInstance.sendMessage(context.chatId, { delete: feedbackMsg.key }).catch(e => {});}
        await sockInstance.sendMessage(context.chatId, { text: replyText.trim(), mentions: mentions }, { quoted: context.msg });
        logger.info(`${logPrefix} Sent avenged list for ${senderJid}.`);

    } catch (error) { // Main catch block for the function
        logger.error(`${logPrefix} CRITICAL FAILURE for ${senderJid} in ${chatId}:`);
         if (error) {
            logger.error(`${logPrefix} Error Name: ${error.name || 'N/A'}`);
            logger.error(`${logPrefix} Error Message: ${error.message || 'N/A'}`);
            if (error.code) logger.error(`${logPrefix} Error Code: ${error.code}`);
            if (error.details) logger.error(`${logPrefix} Error Details: ${error.details}`);
            if (error.hint) logger.error(`${logPrefix} Error Hint: ${error.hint}`);
            logger.error(`${logPrefix} Stack Trace (partial): ${error.stack?.substring(0, 1000) || 'N/A'}`);
        } else { logger.error(`${logPrefix} Caught error object was null or undefined.`); }

        if (feedbackMsg?.key) { await sockInstance.sendMessage(context.chatId, { delete: feedbackMsg.key }).catch(e => {});}
        await sendReply(context, "⚠️ An error occurred while calculating the avenged list (Supabase).");
        const ownerErrorMsg = `Supabase Error in !avenged: ${error.message}${error.code ? ` (Code: ${error.code})` : ''}`;
        await sendErrorToOwner(new Error(ownerErrorMsg), context.msg, context);
    }
} 


// ================== Supabase Connection Logic ================== //
// Make sure fetch is imported near the top: import fetch from 'node-fetch';

// ================== Supabase Connection Logic ================== //




/**
 * Initializes the Supabase client using credentials from config.
 * v3: Explicitly provides node-fetch to the client.
 */
async function connectSupabaseDB() {
    if (!config.SUPABASE_URL || !config.SUPABASE_SERVICE_KEY) {
        logger.error("[Supabase Connect v3] Supabase URL or Service Key not configured.");
        return false;
    }

    logger.info("[Supabase Connect v3] Attempting to initialize Supabase client...");
    const safeUriPart = config.SUPABASE_URL; // URL itself is usually not secret, key is.
    logger.debug(`[Supabase Connect v3] Using URL: ${safeUriPart}`);

    try {
        // Ensure 'fetch' is available (should be imported from 'node-fetch')
        if (typeof fetch !== 'function') {
             throw new Error("node-fetch is not imported or available globally.");
        }

        // Initialize the Supabase client, explicitly passing node-fetch
        supabase = createClient(config.SUPABASE_URL, config.SUPABASE_SERVICE_KEY, {
             global: { // Pass options globally for the client instance
                 fetch: fetch // Tell Supabase client to use the imported node-fetch
             },
             // Optional auth settings (usually defaults are fine for service key)
             // auth: {
             //    persistSession: false,
             //    autoRefreshToken: false
             // }
        });

        // Test connection/client validity by making a simple, known call
        // Fetching user data is now the first real test in handleXP/command handlers
        if (supabase && typeof supabase.from === 'function') {
            logger.info(`[Supabase Connect v3] Supabase client initialized successfully using node-fetch for URL: ${safeUriPart}`);
            // Perform an initial quick test query (optional but recommended)
             try {
                 logger.debug("[Supabase Connect v3] Performing initial Supabase connection test query...");
                 // Try fetching just one row from your table to confirm connection + auth work
                 const { error: testError } = await supabase.from('users_data').select('user_id').limit(1);
                 // We ignore PGRST116 (no rows) here, any other error indicates a problem
                 if (testError && testError.code !== 'PGRST116') {
                     throw new Error(`Initial Supabase test query failed: ${testError.message} (Code: ${testError.code})`);
                 }
                 logger.info("[Supabase Connect v3] Initial Supabase test query successful!");
                 return true; // Indicate success
             } catch (testQueryError) {
                  logger.error("[Supabase Connect v3] Initial test query failed:", testQueryError);
                  supabase = null; // Invalidate client if test fails
                  return false; // Indicate failure
             }
        } else {
            throw new Error("Supabase client initialization failed or did not return a valid client.");
        }

    } catch (error) {
        logger.error("[Supabase Connect v3] CRITICAL: Failed to initialize or test Supabase client:", { message: error.message, stack: error.stack?.substring(0,500) });
        supabase = null; // Ensure client is null on failure
        return false; // Indicate failure
    }
}
// ================== End Supabase Connection Logic ================== //






// ================== Session Management ================== //

/**
 * Attempts to restore the session from a backup zip file if the primary
 * session directory doesn't exist.
 */
async function restoreSessionFromBackup() {
    try {
        // Check if the primary session directory exists
        await fs.access(SESSION_DIR);
        // If fs.access doesn't throw, the directory exists
        logger.info(`Existing session directory found at ${SESSION_DIR}. No restoration needed.`);
    } catch (dirAccessError) {
        // If fs.access throws, the directory likely doesn't exist (ENOENT)
        if (dirAccessError.code === 'ENOENT') {
            logger.info(`Session directory (${SESSION_DIR}) not found. Checking for backup zip: ${SESSION_BACKUP_ZIP}`);

            try {
                // Check if the backup zip file exists
                await fs.access(SESSION_BACKUP_ZIP);
                logger.info(`Found backup zip (${SESSION_BACKUP_ZIP}). Attempting to restore...`);

                try {
                    // Initialize AdmZip and extract the backup
                    const zip = new AdmZip(SESSION_BACKUP_ZIP);
                    // Extract directly into the project root, expecting it to create the 'auth_info' folder
                    // Use synchronous extraction as AdmZip doesn't have a reliable async extractAllTo promise
                    zip.extractAllTo(BASE_DIR, /*overwrite*/ true);

                    // Verify if the directory was created successfully after extraction
                    // Use a short delay before checking, extraction might take a moment
                    await new Promise(resolve => setTimeout(resolve, 200)); // Small delay
                    await fs.access(SESSION_DIR); // Check again if dir now exists

                    logger.info(`Session successfully restored from ${SESSION_BACKUP_ZIP} to ${SESSION_DIR}`);

                } catch (zipError) {
                    logger.error(`Failed to restore session from backup zip (${SESSION_BACKUP_ZIP}):`, zipError);
                    // Check if the error was during the post-extraction check
                    if (zipError.code === 'ENOENT' && zipError.path === SESSION_DIR) {
                         logger.error(`Extraction seemed complete, but ${SESSION_DIR} still not found after extraction.`);
                    }
                }

            } catch (zipAccessError) {
                // If fs.access throws for the zip file, it doesn't exist
                if (zipAccessError.code === 'ENOENT') {
                    logger.info(`No backup zip (${SESSION_BACKUP_ZIP}) found. Will attempt to create a new session.`);
                } else {
                    // Log other errors accessing the zip file
                    logger.error(`Error checking for backup zip (${SESSION_BACKUP_ZIP}):`, zipAccessError);
                }
            }
        } else {
            // Log other errors accessing the session directory
            logger.error(`Error checking session directory (${SESSION_DIR}):`, dirAccessError);
        }
    }
}




/**
 * Sanitizes a JID (Jabber ID) string to a standard format.
 */
function sanitizeJid(jid) {
    if (!jid || typeof jid !== 'string') return '';
    if (jid.includes('@lid')) { return jid; } // Keep LID JIDs as is
    if (jid.includes('@g.us')) { return `${jid.split('@')[0]}@g.us`; }
    if (jid === 'status@broadcast') { return jid; }
    if (jid.includes('@s.whatsapp.net')) { return `${jid.split('@')[0].replace(/[^0-9]/g, '')}@s.whatsapp.net`; }
    const numberPart = jid.replace(/[^0-9]/g, '');
    if (numberPart && numberPart.length > 5) { return `${numberPart}@s.whatsapp.net`; }
    return '';
}


// ================== Connection Management ================== //
// --- Uses local path & calls restore function ---
/*/**
 * Initializes the main WhatsApp connection using Baileys.
 * Handles authentication state loading/saving and socket event listeners.
 * Includes Termux-specific media handling patches.
 * @returns {Promise<import('@whiskeysockets/baileys').WASocket>} The initialized socket instance.
 * @throws {Error} If authentication state fails or socket initialization fails critically.
 */
async function initializeConnection() {
    // --- Attempt to restore session from backup FIRST ---
    await restoreSessionFromBackup(); // Ensure session is ready or restored

    logger.info(`Using Session Directory: ${SESSION_DIR}`);

    let authState, saveCreds;
    try {
        // Attempt to load authentication state from the session directory
        logger.info(`Attempting to call useMultiFileAuthState with path: ${SESSION_DIR}`);
        const authModule = baileysPkg.useMultiFileAuthState || baileysPkg.default?.useMultiFileAuthState;
         if (!authModule) {
             throw new Error("useMultiFileAuthState function not found in Baileys package.");
         }
        const authInfo = await authModule(SESSION_DIR);
        authState = authInfo.state;
        saveCreds = authInfo.saveCreds;
        logger.info(`useMultiFileAuthState executed successfully for ${SESSION_DIR}.`);

    } catch (authError) {
        // Log critical authentication errors
        logger.error(`!!! CRITICAL ERROR during useMultiFileAuthState at ${SESSION_DIR} !!!`, {
             message: authError.message,
             code: authError.code,
             stack: authError.stack?.substring(0, 500)
        });
        console.error("--- RAW AUTH ERROR ---"); console.error(authError); console.error("--- END RAW AUTH ERROR ---");
        await sendErrorToOwner(new Error(`useMultiFileAuthState failed critically: ${authError.message}`), null, null).catch(e => {
            logger.error("Failed to send auth error notification to owner", e);
        });
        throw new Error(`Authentication state initialization failed: ${authError.message}`);
    }

    // Validate that auth state and saveCreds function are valid
    if (!authState || typeof saveCreds !== 'function') {
         const errorMsg = 'Authentication state or saveCreds function is invalid after useMultiFileAuthState.';
         logger.fatal(errorMsg);
         throw new Error(errorMsg);
    }

    logger.info('Initializing WhatsApp socket...');
    // Use the recommended fork if available
    const socketModule = baileysPkg.makeWASocket || baileysPkg.default;
     if (!socketModule) {
         throw new Error("makeWASocket function not found in Baileys package.");
     }
    // Create the WhatsApp socket instance with necessary options
    const sock = socketModule({
        auth: authState,
        logger: logger.child({ module: 'baileys' }), // Pass pino logger
        browser: Browsers.macOS('Chrome'), // Define browser identity
        printQRInTerminal: true,
        syncFullHistory: false, // Faster connection
        retryRequestDelayMs: 3000,
        markOnlineOnConnect: true,
        getMessage: async (key) => { return undefined; }, // Required stub

        // --- Termux/Android Specific Patches (from user provided snippet) ---
        patchMessageBeforeSending: (message) => {
            const requiresPatch = !!message.viewOnce; // Apply patch only to view-once messages
            if (requiresPatch) {
                logger.debug("[Patch] Applying patchMessageBeforeSending for viewOnce message.");
                message = {
                    ...message,
                    // Setting jpegThumbnail to null might help on some devices
                    // jpegThumbnail: null, // Keep commented unless testing specific issues
                    // Increase timeout for media uploads if needed
                    // mediaUploadTimeoutMs: 60000
                };
            }
            return message;
        },
        // Optional: Configure media cache limits
        mediaCache: {
           maxItems: 10, // Max number of media items to cache
            maxSize: 50 * 1024 * 1024 // Max total cache size (e.g., 50MB)
        }
        // --- End Termux Patches ---
    });

    // Assign the created socket to the global instance variable
    sockInstance = sock;
    logger.info('Socket instance created.');
    
    
  



// Add this presence update handler in your connection initialization (after sock.ev.on('connection.update'))
sock.ev.on('presence.update', ({ id, presences }) => {
    const chatId = sanitizeJid(id);
    if (!chatId.endsWith('@g.us')) return; // Only track groups
    
    Object.entries(presences).forEach(([jid, presence]) => {
        const userJid = sanitizeJid(jid);
        state.onlineUsers.set(userJid, {
            status: presence.lastKnownPresence || 'unavailable',
            lastSeen: Date.now()
        });
    });
});






    // --- Attach Event Handlers ---
    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;
        if (qr) {
            logger.info('QR code received. Scan with WhatsApp on your phone.');
            qrcode.generate(qr, { small: true }, (qrString) => { console.log(qrString); });
        }
        if (connection === 'close') {
            const statusCode = lastDisconnect?.error?.output?.statusCode;
            const shouldReconnect = (lastDisconnect?.error instanceof Boom) && statusCode !== DisconnectReason.loggedOut;
            const reason = lastDisconnect?.error?.message || 'Unknown';
            logger.warn(`Connection closed. Reason: "${reason}" (Code: ${statusCode}). Reconnecting: ${shouldReconnect}`);
            state.typingSimulations.forEach(timeoutId => clearTimeout(timeoutId));
            state.typingSimulations.clear();
            logger.info("Cleared active typing simulations due to disconnect.");
            if (shouldReconnect) { handleReconnect(); }
            else { logger.error(`Connection closed permanently (Reason: ${reason}, Code: ${statusCode}). Shutting down.`); gracefulShutdown(true, `Connection Closed (${statusCode})`); }
        } else if (connection === 'open') {
            // --- ADDED LOGGING ---
            logger.info(`WhatsApp connection opened. Raw sock.user.id: ${sock.user?.id}`); // Log raw ID
            const sanitizedId = sanitizeJid(sock.user?.id);
            logger.info(`Successfully connected! Bot User ID (Sanitized): ${sanitizedId}`);
            logger.info(`BOT JID: ${sock.user?.id}`); // Explicitly log raw JID
            logger.info(`Sanitized Bot JID: ${sanitizeJid(sock.user?.id)}`); // Explicitly log sanitized JID
            // --- END ADDED LOGGING ---
            sock.sendPresenceUpdate('available');
            botStartTime = Date.now();
            logger.info(`Bot uptime timer reset. Presence set to available.`);
        } else if (connection === 'connecting') {
            logger.info("WhatsApp connection attempt in progress...");
        }
    });

    sock.ev.on('creds.update', saveCreds);
    logger.info("Attached 'creds.update' event listener.");

    sock.ev.on('messages.upsert', (upsert) => {
        handleMessages(upsert).catch(e => {
            logger.error("Error directly from handleMessages promise:", { error: e.message, stack: e.stack });
            sendErrorToOwner(e, upsert.messages?.[0], null);
        });
    });
    logger.info("Attached 'messages.upsert' event listener.");

    sock.ev.on('group-participants.update', (update) => {
        handleGroupUpdate(update).catch(e => {
             logger.error("Error directly from handleGroupUpdate promise:", { error: e.message, stack: e.stack });
             sendErrorToOwner(e, null, { chatId: update.id });
        });
    });
    logger.info("Attached 'group-participants.update' event listener.");

    logger.info('Socket initialized and all core event listeners attached.');
    return sock; // Return the initialized socket
}
 

/**
 * Handles the reconnection logic when the connection closes unexpectedly.
 */
function handleReconnect() {
    const reconnectDelay = 5000 + Math.random() * 2000; // Delay ~5-7 seconds
    logger.info(`Attempting reconnect in ${Math.round(reconnectDelay / 1000)} seconds...`);
    setTimeout(() => {
        logger.info("Executing reconnect attempt...");
        initializeConnection().catch(e => {
            logger.error(`Reconnection attempt failed: ${e?.message || e}`, { stack: e?.stack });
            logger.info('Scheduling next reconnect attempt...');
            handleReconnect(); // Schedule next try
        });
    }, reconnectDelay);
}


// --- Helper for Typing Simulation ---

/**
 * Simulates typing presence in a group chat for a set duration.
 * Avoids simulating in DMs or when nuclear AI is active.
 * Extends existing simulation timeout if called again for the same chat.
 * @param {string} chatId The JID of the chat to simulate typing in.
 */
async function simulateTyping(chatId) {
    // Avoid simulating in DMs or if nuclear AI is on
    if (!sockInstance || state.nuclearAI || !chatId?.endsWith('@g.us')) {
        return;
    }

    const simulationKey = `typing-${chatId}`; // Unique key for the map

    try {
        // If already simulating for this chat, clear the existing timeout to extend it
        if (state.typingSimulations.has(simulationKey)) {
            clearTimeout(state.typingSimulations.get(simulationKey));
            // logger.debug(`[Typing Sim] Extended simulation for ${chatId}`); // Can be noisy
        } else {
            // Only send 'composing' presence if not already simulating
            await sockInstance.sendPresenceUpdate('composing', chatId);
            // logger.debug(`[Typing Sim] Started simulation for ${chatId}`); // Can be noisy
        }

        // Set a new timeout to clear the presence after TYPING_SIMULATION_MS
        const timeoutId = setTimeout(async () => {
            try {
                // Check if socket still exists and is connected before sending 'paused'
                if (sockInstance?.ws?.readyState === 1) {
                     await sockInstance.sendPresenceUpdate('paused', chatId);
                     // logger.debug(`[Typing Sim] Stopped simulation for ${chatId} (timeout)`); // Can be noisy
                } else {
                     // logger.debug(`[Typing Sim] Socket closed before timeout for ${chatId}, skipping 'paused'.`); // Can be noisy
                }
            } catch (e) {
                 // Ignore errors if connection closed during timeout or sending 'paused' fails
                if (!e.message?.includes('Connection Closed') && !e.message?.includes('Socket closed')) {
                     logger.warn(`[Typing Sim] Failed to clear presence for ${chatId}:`, e?.message);
                 }
            } finally {
                // Always remove the simulation entry from the map when the timeout finishes or fails
                state.typingSimulations.delete(simulationKey);
            }
        }, TYPING_SIMULATION_MS);

        // Store the new timeout ID in the map
        state.typingSimulations.set(simulationKey, timeoutId);

    } catch (error) {
        // Ignore errors if connection closed during the initial 'composing' presence update
        if (!error.message?.includes('Connection Closed') && !error.message?.includes('Socket closed')) {
            logger.warn(`[Typing Sim] Failed initial 'composing' update for ${chatId}:`, error?.message);
        }
        // Clean up map entry if the initial update failed
        if (state.typingSimulations.has(simulationKey)) {
            clearTimeout(state.typingSimulations.get(simulationKey));
            state.typingSimulations.delete(simulationKey);
        }
    }
}


// ================== Chat History Management (for AI) ================== //

/**
 * Updates the chat history for a given chat ID.
 * Adds the new message with sender info (for user role) and trims history.
 * v2: Includes senderIdentifier parameter.
 * @param {string} chatId The JID of the chat.
 * @param {'user' | 'model'} role The role of the message sender.
 * @param {string} text The text content of the message.
 * @param {string | null} [senderIdentifier=null] The identifier (e.g., JID) of the user if role is 'user'.
 */
function updateChatHistory(chatId, role, text, senderIdentifier = null) {
    // Don't add empty or whitespace-only messages
    if (!text || text.trim() === '') {
        logger.debug(`[History v2] Skipping empty message for ${chatId}`);
        return;
    }

    // Ensure history array exists for the chat
    if (!state.chatHistories.has(chatId)) {
        state.chatHistories.set(chatId, []);
    }
    const history = state.chatHistories.get(chatId);

    // Construct the history entry
    let newEntry;
    if (role === 'user') {
        // For user messages, include the sender identifier
        const identifier = senderIdentifier || 'UnknownUser'; // Use provided ID or fallback
        newEntry = {
            role: 'user',
            sender: identifier, // Store the identifier
            parts: [{ text: text.trim() }]
        };
        logger.debug(`[History v2] Adding user message from ${identifier} to ${chatId}`);
    } else { // role === 'model'
        // For model messages, sender is implicitly the bot
        newEntry = {
            role: 'model',
            // Optionally add bot identifier if needed later: sender: config.BOT_PRIMARY_JID || 'TonnaBot',
            parts: [{ text: text.trim() }]
        };
         logger.debug(`[History v2] Adding model response to ${chatId}`);
    }

    // Add the new message entry to the history array
    history.push(newEntry);

    // Trim the history if it exceeds the maximum length
    if (history.length > CHAT_HISTORY_LENGTH) { // Use the constant (e.g., 15)
        const removedCount = history.length - CHAT_HISTORY_LENGTH;
        history.splice(0, removedCount); // Remove oldest message(s) from the beginning
        logger.debug(`[History v2] Trimmed ${removedCount} message(s) from ${chatId}. New length: ${history.length}`);
    }

    // Update the history in the state map (though modifying array in place works)
    state.chatHistories.set(chatId, history);
} 



/**
 * Retrieves the chat history for a given chat ID.
 * @param {string} chatId The JID of the chat.
 * @returns {Array<{role: string, parts: Array<{text: string}>}>} The chat history array, or an empty array if none exists.
 */
function getChatHistory(chatId) {
    // Return the history array for the chat, or an empty array if none exists
    return state.chatHistories.get(chatId) || [];
}


/**
 * Checks if a given text contains roast-like phrases (used for auto-clapback).
 * @param {string} text The text to check.
 * @returns {boolean} True if the text contains roast triggers, false otherwise.
 */
function containsRoast(text) {
    // Define patterns for roast detection (case-insensitive)
    const patterns = [
        /stupid bot|dumb bot|tonnabot sucks/i,
        /you nor fit|no dey sabi/i, // Pidgin examples
        /useless bot|worthless bot/i
        // Add more patterns as needed
    ];
    // Check if text is valid and matches any of the patterns
    return text && patterns.some(pattern => pattern.test(text));
}


// ================== Message Processing Core ================== //

/**
 * Handles incoming messages received via the 'messages.upsert' event.
 * Parses, checks punishment/god mode, triggers typing sim, awards XP,
 * counts keywords (DISABLED), checks security, processes commands, triggers AI,
 * handles VO, acknowledges stickers, updates history.
 * FINAL VERSION: Corrected order and removed excessive debug logs.
 * @param {import('@whiskeysockets/baileys').BaileysEventMap['messages.upsert']} upsert The upsert event data.
 */
async function handleMessages({ messages, type }) {
    if (type !== 'notify') { return; }

    // Define helpers locally or ensure they are accessible
    const comebacks = [ "Your mouth dey run like open-source repo!", "I dey code your obituary... 404 Not Found!", "Your IQ get expiration date like trial SSL!", "Even my error messages get more sense!" ];
    function containsRoastInner(text) {
        const patterns = [ /stupid bot|dumb bot|tonnabot sucks/i, /you nor fit|no dey sabi/i, /useless bot|worthless bot/i ];
        return text && patterns.some(p => p.test(text));
    }

    for (const msg of messages) {
        const messageId = msg.key?.id || 'N/A';

        // 1. --- Ignore Irrelevant Messages ---
        if (msg.key?.remoteJid === 'status@broadcast' || msg.key?.fromMe || !msg.message || !msg.key?.remoteJid) {
            continue; // Skip bot's own messages, status updates, etc.
        }

        // --- Get Sender Info ---
        const senderJid = sanitizeJid(msg.key?.participant || msg.key?.remoteJid);
        const ownerJid = sanitizeJid(config.OWNER_NUMBER);
        const isFromOwner = ownerJid && senderJid === ownerJid;

        // 2. --- Check if Sender is Punished ---
        const punishmentEndTime = state.punishedUsers.get(senderJid);
        if (punishmentEndTime) {
            if (Date.now() < punishmentEndTime) {
                logger.info(`[Punishment] Ignoring message ${messageId} from punished user ${senderJid}`);
                continue; // Ignore message if punishment active
            } else {
                logger.info(`[Punishment] Punishment expired for ${senderJid}. Removing.`);
                state.punishedUsers.delete(senderJid); // Remove expired entry
            }
        }
        // --- End Punishment Check ---


        // 3. --- Typing Simulation Trigger ---
        try {
            if (msg.key?.remoteJid?.endsWith('@g.us') && !state.nuclearAI) {
                 const mc = getContentType(msg.message);
                 const txt = msg.message?.conversation || msg.message?.extendedTextMessage?.text ||
                            msg.message?.imageMessage?.caption || msg.message?.videoMessage?.caption;
                 const isNonCommandText = (txt && !txt.startsWith(config.COMMAND_PREFIX));
                 const isRelevantMedia = (!txt && ['imageMessage', 'videoMessage', 'audioMessage'].includes(mc));
                 if (isNonCommandText || isRelevantMedia) {
                     // logger.info(`[Typing Trigger] Conditions MET for chat ${msg.key.remoteJid}. Calling simulateTyping...`); // Keep log if needed
                     simulateTyping(msg.key.remoteJid);
                 }
             }
        } catch(e) { logger.error(`!!! CRASH during typing simulation trigger check: ${e.message}`, e); }
        // --- End Typing Simulation Trigger ---


        let context = null;
        try { // Start main try block for this message's processing
            // 4. --- Parse Message ---
             context = await parseMessage(msg); // Ensure parseMessage includes quotedText & selectedButtonId
             if (!context?.chatId || !context.sender) {
                 if (getContentType(msg.message)) { logger.warn(`[handleMessages] Skipping msg ${messageId}: Invalid parsed context.`); }
                 continue;
             }

            // 5. --- God Mode Check ---
            const SECRET_PREFIX = "$$";
            if (isFromOwner && context.text.startsWith(SECRET_PREFIX)) {
                 logger.info(`[God Mode] Detected command from owner: ${context.text.substring(0, 20)}...`);
                 try { await sockInstance.sendMessage(context.chatId, { delete: context.key }); } catch (deleteError) { logger.error(`[God Mode] FAILED delete: ${deleteError.message}`); }
                 const commandParts = context.text.slice(SECRET_PREFIX.length).trim().split(/ +/);
                 const godCommand = commandParts[0]?.toLowerCase();
                 const godArgs = commandParts.slice(1);
                 const targetJid = context.mentions?.[0];
                 // Execute God Mode action
                 switch (godCommand) {
                      case 'punish': await handleGodPunish(context, targetJid, parseInt(godArgs[0]) || 30); break;
                      case 'bless': await handleGodBless(context, targetJid, parseInt(godArgs[0]) || 100); break;
                      case 'unpunish': await handleGodUnpunish(context, targetJid); break;
                      default: logger.warn(`[God Mode] Unknown command: ${godCommand}`); try { await sockInstance.sendMessage(ownerJid, { text: ` G Mode Error: Unknown command '${godCommand}'`}); } catch {}
                 }
                 continue; // Stop processing after God Mode command
            }
            // --- End God Mode Check ---


            // --- 6. Award XP ---
            // Award XP for all valid messages not handled above. Exclude button clicks.
            if (context.contentType !== 'buttonsResponseMessage') {
                await handleXP(context.sender); // Use Supabase version
            }
            // --- End XP Award ---


            // --- 7. Deep Spy Keyword Counting (Disabled Pending Migration) ---
             // logger.debug("[handleMessages] Keyword counting temporarily disabled pending Supabase migration.");
            // --- End Deep Spy ---


            // --- 8. Auto-Clapback ---
             if (containsRoastInner(context.text) && !context.isGroup) {
                  logger.info(`[Auto-Clapback] Responding to roast from ${context.sender} in DM.`);
                 await sendReply(context, comebacks[Math.floor(Math.random() * comebacks.length)]);
                 continue;
             }


            // --- 9. Log Parsed Info ---
            if (isFromOwner) { logger.info(`---> Owner msg PARSED (ID: ${messageId}). Cmd:${context.isCommand}, VO:${context.isViewOnce}, Type:${context.contentType}`); }
            messageLogger.info({ chatId: context.chatId, sender: context.sender, isGroup: context.isGroup, cmd: context.isCommand, vo: context.isViewOnce, type: context.contentType, text: context.text.substring(0, 50) });


            // --- 10. Update Chat History ---
            if (context.text) { updateChatHistory(context.chatId, 'user', context.text, context.sender); }
            else if (context.contentType === 'imageMessage') { updateChatHistory(context.chatId, 'user', '(User sent an image)', context.sender); }
            else if (context.contentType === 'stickerMessage') { updateChatHistory(context.chatId, 'user', '(User sent a sticker)', context.sender); }


            // ================== Main Processing Pipeline ================== //

            // --- 11. Security Checks ---
             let securityHandled = false;
             if (context.isGroup) {
                 securityHandled = await processSecurityChecks(context);
             }
             if (securityHandled) {
                 logger.info(`[Security] Message ${messageId} handled by security checks.`);
                 continue; // Skip rest if security handled it
             }


            // --- 12. Command Processing ---
            let commandProcessed = false; // Declare BEFORE use
            if (context.isCommand) { // Check flag from parseMessage
                const commandRegex = new RegExp(`(?:\\s|^)${config.COMMAND_PREFIX}(\\w+)`, 'i');
                const commandMatch = context.text.match(commandRegex);
                const commandName = commandMatch ? commandMatch[1].toLowerCase() : null;
                if (commandName) {
                    const command = COMMANDS[commandName];
                    if (command) {
                        const argsText = context.text.substring(context.text.indexOf(commandMatch[0]) + commandMatch[0].length).trim();
                        const args = argsText ? argsText.split(/ +/) : [];
                        commandProcessed = await processCommands(context, commandName, command, args);
                        if (commandProcessed) { continue; } // Command attempted (success or fail), stop processing
                    } else { logger.debug(`[Commands] No handler found for '${commandName}'.`); }
                } else { logger.debug(`[Commands] Regex failed for command text: ${context.text}`); }
            }


            // --- 13. AI Response Check ---
            let shouldRespondAI = false;
            if (!commandProcessed && context.contentType !== 'buttonsResponseMessage') {
                 shouldRespondAI = await shouldRespondWithAI(context);
                 if (shouldRespondAI) {
                     const aiResponseText = await generateAIResponse(context);
                     if (aiResponseText && !context.isViewOnce && context.contentType !== 'stickerMessage') { continue; }
                 }
            }


            // --- 14. View-Once Handling ---
             if (context.isViewOnce && !shouldRespondAI) {
                 // Ensure handleViewOnceMedia exists and is ready (debug v1 still?)
                 logger.info(`[ViewOnce] Handling VO msg ${messageId} (AI not responding).`);
                 const innerMsg = context.msg?.message?.viewOnceMessage?.message || context.msg?.message?.viewOnceMessageV2?.message;
                 if (innerMsg) {
                     const mediaType = getContentType(innerMsg);
                     const mediaMsgObj = innerMsg[mediaType];
                     if ((mediaType === 'imageMessage' || mediaType === 'videoMessage') && mediaMsgObj) {
                         await handleViewOnceMedia(context.msg, mediaType, mediaMsgObj);
                     } else { logger.warn(`[ViewOnce] Unsupported inner type: ${mediaType}`); }
                 } else { logger.warn(`[ViewOnce] Could not extract inner VO message: ${messageId}`); }
                 continue;
             }


            // --- 15. Sticker Reaction Handling ---
             if (context.contentType === 'stickerMessage' && !commandProcessed && !shouldRespondAI) {
                 const REACT_PROBABILITY = 0.5; // Adjust probability
                 if (Math.random() < REACT_PROBABILITY) {
                      logger.info(`[Sticker React] Reacting randomly to sticker ${messageId}`);
                      const possibleReactions = ['👍', '😂', '💯', '🔥', '👌', '✅'];
                      const randomReaction = possibleReactions[Math.floor(Math.random() * possibleReactions.length)];
                      try {
                           await sockInstance.sendMessage(context.chatId, { react: { text: randomReaction, key: msg.key } });
                         } catch (reactError) { logger.warn(`[Sticker React] Failed react: ${reactError.message}`); }
                 } else { logger.debug(`[Sticker React] Skipped reaction by probability.`); }
                 continue;
             }

            // Fallthrough Log (Message wasn't handled by anything above)
             // logger.debug(`[handleMessages Final] Message ${messageId} (type: ${context.contentType}) fell through all handlers.`);

        } catch (error) { // Catch errors from the main try block
            logger.error(`[handleMessages CATCH] Error caught processing msg ${messageId}: ${error.message}`);
            handleMessageError(error, msg, context); // Use the dedicated error handler
        } // End main try-catch

    } // End for loop over messages
} // End handleMessages function 
 

// ================== Message Parsing ================== //
/**
 * Parses an incoming Baileys message object to extract relevant information.
 * Handles different message types including button responses.
 * Extracts text, mentions, reply info, quoted text, and selected button ID.
 * @param {import('@adiwajshing/baileys').WAMessage} msg The raw message object.
 * @returns {Promise<object|null>} A context object with parsed data, or null if parsing fails.
 */
async function parseMessage(msg) {
    // --- Mention Extraction Helper --- (Keep existing)
    const extractMentions = (message) => {
        const mentionedJids = [
            ...(message?.message?.extendedTextMessage?.contextInfo?.mentionedJid || []),
            ...(message?.message?.conversation?.contextInfo?.mentionedJid || []),
            
            ...(message?.message?.listResponseMessage?.contextInfo?.mentionedJid || [])
        ];
        return mentionedJids.filter(jid => jid && typeof jid === 'string' && jid.includes('@'));
    };
    // --- End Helper ---

    try {
        const contentType = getContentType(msg.message);
        if (!contentType) {
            const messageKeys = msg.message ? Object.keys(msg.message).join(', ') : 'msg.message is null';
            logger.warn(`[Parse] No content type found for message ID: ${msg.key?.id}. Message keys: [${messageKeys}]`);
            return null;
         }

        // --- Basic Info --- (Keep existing)
        const isGroup = msg.key?.remoteJid?.endsWith('@g.us');
        const chatId = sanitizeJid(msg.key?.remoteJid);
        const sender = sanitizeJid(isGroup ? (msg.key?.participant || msg.key?.remoteJid) : msg.key?.remoteJid);
        if (!chatId || !sender) {
            logger.warn(`[Parse] Invalid JIDs (chat or sender) for message ID: ${msg.key?.id}. Chat: ${chatId}, Sender: ${sender}`);
            return null;
         }

        // --- Extract Text Content AND Button ID ---
        let text = '';
        let selectedButtonId = null; // Initialize button ID

        if (contentType === 'conversation') {
            text = msg.message.conversation || '';
        } else if (contentType === 'extendedTextMessage') {
            text = msg.message.extendedTextMessage?.text || '';
        } else if (contentType === 'imageMessage') {
            text = msg.message.imageMessage?.caption || '';
        } else if (contentType === 'videoMessage') {
            text = msg.message.videoMessage?.caption || '';
        } else if (contentType === 'listResponseMessage') {
            // Use title as primary text for list response context
            text = msg.message.listResponseMessage?.title || '';
            // We aren't using selectedRowId right now, but could extract if needed:
            // const selectedRowId = msg.message.listResponseMessage?.singleSelectReply?.selectedRowId;
            logger.debug(`[Parse] List response detected. Title: "${text}"`); // Added log
        } else if (contentType === 'buttonsResponseMessage') {
            // For button clicks, use the button's display text as primary text context
            text = msg.message.buttonsResponseMessage?.selectedDisplayText || '';
            // *** Extract the selected button's ID ***
            selectedButtonId = msg.message.buttonsResponseMessage?.selectedButtonId || null;
            logger.info(`[Parse] Button response detected. ID: ${selectedButtonId}, DisplayText: "${text}"`); // Changed log level
        }
        // Add other content types if needed

        // --- Other Context Info --- (Keep existing)
        const isViewOnce = ['viewOnceMessage', 'viewOnceMessageV2'].includes(contentType);
        // Re-evaluate isCommand based on extracted text (button clicks usually aren't commands)
        const isCommand = !selectedButtonId && text.trim().startsWith(config.COMMAND_PREFIX); // Button clicks override command check
        const pushName = msg.pushName || null;

        // --- Mentions --- (Keep existing)
        let mentions = [];
        try {
             const rawMentions = extractMentions(msg);
             mentions = rawMentions.map(jid => sanitizeJid(jid)).filter(jid => !!jid);
             // logger.debug(`[Parse] Sanitized mentions for msg ${msg.key?.id}: ${JSON.stringify(mentions)}`); // Can be noisy
        } catch (mentionError) {
            logger.error("[Parse] Error during mention extraction attempt", { error: mentionError.message, key: msg?.key?.id });
            mentions = [];
        }

        // --- Reply Info & Quoted Text --- (Keep existing logic from previous update)
        const contextInfo = msg.message?.extendedTextMessage?.contextInfo ||
                            msg.message?.buttonsResponseMessage?.contextInfo || // Button responses can also quote
                            msg.message?.listResponseMessage?.contextInfo ||
                            msg.message?.templateButtonReplyMessage?.contextInfo ||
                            msg.message?.productMessage?.contextInfo;
        const isReply = !!contextInfo?.quotedMessage;
        const quotedMsg = contextInfo?.quotedMessage || null; // The actual quoted message object
        const quotedMsgKey = contextInfo?.stanzaId || null; // Key of the quoted message
        const quotedParticipant = sanitizeJid(contextInfo?.participant || null); // Sender of the quoted message
        let quotedText = '';
        if (isReply && quotedMsg) {
            // logger.debug(`[Parse] Reply detected for msg ${msg.key.id}.`); // Simplified log
            try {
                const quotedContentType = getContentType(quotedMsg);
                if (quotedContentType === 'conversation') { quotedText = quotedMsg.conversation || ''; }
                else if (quotedContentType === 'extendedTextMessage') { quotedText = quotedMsg.extendedTextMessage?.text || ''; }
                else if (quotedContentType === 'imageMessage') { quotedText = quotedMsg.imageMessage?.caption || ''; }
                else if (quotedContentType === 'videoMessage') { quotedText = quotedMsg.videoMessage?.caption || ''; }
                // Add other quoted types if needed
                quotedText = quotedText.trim();
                // if (quotedText) { logger.debug(`[Parse] Extracted quoted text (first 50 chars): "${quotedText.substring(0,50)}"`); }
             } catch (quoteParseError) { logger.warn(`[Parse] Error extracting text from quoted message: ${quoteParseError.message}`); }
        }
        // --- End Reply Info ---

        // --- Timestamp --- (Keep existing)
        let timestamp = Date.now();
        if (msg.messageTimestamp) { /* ... timestamp logic ... */ }

        // --- Return the Context Object (with selectedButtonId added) ---
        return {
            msg,
            text: text.trim(),
            chatId,
            sender,
            isGroup,
            pushName,
            mentions,
            isCommand, // Updated based on button check
            isViewOnce,
            contentType,
            isReply,
            quotedMsg,
            quotedMsgKey,
            quotedParticipant,
            quotedText,
            timestamp,
            key: msg.key,
            selectedButtonId // <<< FIELD ADDED HERE
        };

    } catch (error) {
        logger.error('==== PARSE FAIL DETAILS ====', { /* ... error details ... */ });
        return null; // Return null on failure
    }
} 

 
// ================== Security & Filtering ================== //

/**
 * Determines if the AI should respond to a given message context.
 * Checks for mentions (exact JID, name, @number string) and replies.
 * v9: Reply check now compares quoted participant against BOT_PRIMARY_JID from config.
 * @param {object} context The parsed message context from parseMessage.
 * @returns {Promise<boolean>} True if the AI should respond, false otherwise.
 */
async function shouldRespondWithAI(context) {
    const LOG_PREFIX = "[AI Check v9 - Bot Primary JID Reply Check]"; // Updated log prefix
    const messageId = context?.key?.id || 'N/A';

    // --- Basic Context Check ---
    if (!context || !context.sender) { logger.debug(`${LOG_PREFIX} Invalid context/sender. Skipping.`); return false; }
    logger.debug(`${LOG_PREFIX} Checking message ID: ${messageId}`);

    // --- Nuclear / DM Checks ---
    if (state.nuclearAI) { logger.debug(`${LOG_PREFIX} Responding: nuclearAI ON.`); return true; }
    if (!context.isGroup) { logger.debug(`${LOG_PREFIX} Responding: DM.`); return true; }

    // --- Get Group Settings ---
    const groupSettings = getGroupSettings(context.chatId);
    if (!groupSettings.aiEnabled) { logger.debug(`${LOG_PREFIX} Not Responding: Group AI is OFF.`); return false; }
    logger.debug(`${LOG_PREFIX} Group AI is ON. Proceeding...`);
    // --- End Group Setting Check ---

    // --- Get Bot's Actual JID (Current Linked Device) ---
    let botActualJid = null;
    try {
        if (sockInstance?.user?.id) { botActualJid = sanitizeJid(sockInstance.user.id); }
    } catch (err) { logger.error(`${LOG_PREFIX} Error getting bot JID: ${err.message}`); return false; }
    if (!botActualJid) { logger.error(`${LOG_PREFIX} Failed to get bot's own JID!`); return false; }
    const botNumberPart = botActualJid.split('@')[0];
    // --- End Get Bot's JID ---

    // --- Get Bot's Primary JID from Config ---
    const botPrimaryJid = sanitizeJid(config.BOT_PRIMARY_JID); // Get JID like "...18@..." from .env
    if (!botPrimaryJid) {
        // If BOT_PRIMARY_JID is not set, we cannot reliably check replies this way.
        logger.warn(`${LOG_PREFIX} BOT_PRIMARY_JID is not configured! Reply trigger may be unreliable.`);
        // Fallback or return false? Let's proceed but log the warning. Reply check #2 will likely fail.
    }
    logger.debug(`${LOG_PREFIX} Bot Current JID: ${botActualJid}, Bot Primary JID (from config): ${botPrimaryJid}`);
    // --- End Get Bot Primary JID ---

    // --- Prepare Inputs ---
    const mentionsArray = context.mentions || [];
    const quotedParticipant = context.quotedParticipant || null; // Already sanitized by parseMessage
    const text = context.text || '';
    logger.debug(`${LOG_PREFIX} Inputs: Text="${text.substring(0, 70)}...", Mentions=${JSON.stringify(mentionsArray)}, IsReply=${context.isReply}, QuotedParticipant=${quotedParticipant}`);
    // --- End Prepare Inputs ---

    // --- Trigger Checks ---
    let triggered = false;
    let triggerType = 'None';
    try {
        // 1. Check Mentions Array (uses exact botActualJid - ...814@...)
        // This checks if the bot's *specific instance* was tagged correctly
        if (mentionsArray.includes(botActualJid)) {
            triggered = true;
            triggerType = 'Mention (Exact JID)';
            logger.debug(`${LOG_PREFIX} Trigger Check 1: Exact JID Mention MATCH!`);
        }

        // 2. Check Reply (MODIFIED CHECK - Compares quotedParticipant to BOT_PRIMARY_JID from config)
        // This checks if the user replied to a message associated with the primary account JID.
        if (!triggered && context.isReply && quotedParticipant && botPrimaryJid && quotedParticipant === botPrimaryJid) {
            triggered = true;
            triggerType = 'Reply (Bot Primary JID Match)';
            logger.debug(`${LOG_PREFIX} Trigger Check 2: Reply QuotedParticipant MATCHES Bot Primary JID! (Quoted: ${quotedParticipant}, Primary: ${botPrimaryJid})`);
        }
        // Optional Fallback: Check if quotedParticipant matches the bot's *current* linked device JID
        // This might be useful if WhatsApp changes behavior or in specific edge cases.
        else if (!triggered && context.isReply && quotedParticipant && quotedParticipant === botActualJid) {
             triggered = true;
             triggerType = 'Reply (Current Bot JID Match)';
             // Log differently to distinguish which match worked
             logger.info(`${LOG_PREFIX} Trigger Check 2a: Reply QuotedParticipant MATCHES current Bot JID. (Quoted: ${quotedParticipant}, Bot: ${botActualJid})`);
        }

        // 3. Check Name (@BotName)
        if (!triggered && text) { // Added text check
            const botNamePattern = new RegExp(`(?:\\s|^|@)${config.BOT_NAME}\\b`, 'i');
            if (botNamePattern.test(text)) {
                triggered = true;
                triggerType = 'Mention (Name)';
                logger.debug(`${LOG_PREFIX} Trigger Check 3: Name MATCH!`);
            }
        }

        // 4. Check Tag (@number string in text - Checks bot's current number AND primary number)
        if (!triggered && text) {
            const botNumberTagFull = `@${botNumberPart}`; // e.g., @...814
            const primaryNumberPart = botPrimaryJid ? botPrimaryJid.split('@')[0] : null; // e.g., ...18
            const primaryNumberTag = primaryNumberPart ? `@${primaryNumberPart}` : null; // e.g. @...6318

            // Check for tag matching current linked device number first
            if (text.includes(botNumberTagFull)) {
                triggered = true;
                triggerType = 'Mention (@FullNum String)';
                logger.debug(`${LOG_PREFIX} Trigger Check 4a: @FullNum String MATCH!`);
            }
            // Else, check if primary number tag is present and different
            else if (primaryNumberTag && text.includes(primaryNumberTag) && primaryNumberTag !== botNumberTagFull) {
                triggered = true;
                triggerType = 'Mention (@PrimaryNum String)';
                logger.debug(`${LOG_PREFIX} Trigger Check 4b: @PrimaryNum String MATCH!`);
            }
        }

    } catch (triggerError) {
         logger.error(`${LOG_PREFIX} Error during trigger checks: ${triggerError.message}`, triggerError);
         return false; // Prevent triggering on error
    }
    // --- End Trigger Checks ---

    // --- Final Decision ---
    logger.debug(`${LOG_PREFIX} Final Decision: Triggered: ${triggered}, Type: ${triggerType}`);
    if (triggered) {
        // Group AI setting was already checked if isGroup
        logger.info(`${LOG_PREFIX} Responding: Trigger detected (${triggerType}).`);
        return true; // Return true if any trigger condition met (and group AI is on)
    } else {
        // Check nuclear AI override if no other trigger met
        if (state.nuclearAI) {
             logger.debug(`${LOG_PREFIX} Not triggered, but Nuclear AI is ON. Returning true.`);
             return true;
        }
        logger.debug(`${LOG_PREFIX} Not Responding: No trigger met.`);
        return false;
    }
} 


/**
 * Runs security checks (links, spam) on the message context.
 * Calls specific handlers if violations are detected.
 * @param {object} context The parsed message context.
 * @returns {Promise<boolean>} True if a violation was detected and handled, false otherwise.
 */
async function processSecurityChecks(context) {
    if (!context) { logger.warn("[Security] processSecurityChecks called with invalid context."); return false; }

    const sender = context.sender;
    const chatId = context.chatId;
    const text = context.text;
    const isGroup = context.isGroup;
    const groupSettings = isGroup ? getGroupSettings(chatId) : null;

    // --- Link Check ---
    if (isGroup && groupSettings?.linkProtection) {
        if (containsBlockedLinks(text)) {
            logger.info(`[Security] Link detected from ${sender} in ${chatId}.`);
            await handleLinkViolation(context);
            return true; // Handled
        }
    }

    // --- Spam Check ---
    if (!isAdmin(sender)) { // Admins bypass spam check
         if ((isGroup && groupSettings?.spamFilter) || !isGroup) {
            if (isSpam(sender)) {
                logger.info(`[Security] Spam detected from ${sender} in ${chatId}.`);
                await handleSpammer(context);
                return true; // Handled
            }
        }
    }

    return false; // No security violation handled
}


/**
 * Checks if a given text contains links matching the BLOCKED_LINKS patterns.
 * @param {string} text The text content to check.
 * @returns {boolean} True if a blocked link pattern is found, false otherwise.
 */
function containsBlockedLinks(text) {
    if (!text || !config.BLOCKED_LINKS?.length) { return false; }
    try {
        const linkPatterns = config.BLOCKED_LINKS.map(linkPrefix => {
            const escapedPrefix = linkPrefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            return `(?:\\b|\\s|^|\\(|\\<|\\")(${escapedPrefix})(\\S*)`;
        });
        const combinedPattern = new RegExp(linkPatterns.join('|'), 'i');
        return combinedPattern.test(text);
    } catch (e) {
        logger.error("[Security] Regex error in containsBlockedLinks:", e);
        return false;
    }
}


/**
 * Handles link violations in groups: warns user, deletes message, removes user if max warnings reached.
 * Requires bot to have admin privileges in the group (verified using OWNER_NUMBER).
 * @param {object} context The parsed message context.
 */
async function handleLinkViolation(context) {
    if (!context || !context.isGroup || !sockInstance) { return; }

    const sender = context.sender;
    const chatId = context.chatId;
    const senderName = context.pushName || sender.split('@')[0];
    const currentWarnings = (state.userWarnings.get(sender) || 0) + 1;
    state.userWarnings.set(sender, currentWarnings);
    const remainingWarnings = MAX_WARNINGS - currentWarnings;
    const warnMsg = `${config.WARN_MESSAGE}\n@${sender.split('@')[0]} you have (${currentWarnings}/${MAX_WARNINGS}) warnings.` +
                    (remainingWarnings > 0 ? ` \nAdmin use ${config.COMMAND_PREFIX}resetwarn @user to reset.` : ' Max warnings reached!');

    try {
        logger.debug(`[Link Violation] Sending warning to ${sender} in ${chatId}.`);
        await sockInstance.sendMessage(chatId, { text: warnMsg, mentions: [sender] });
    } catch (e) { logger.error("[Link Violation] Failed to send warning message:", e); }

    logger.warn(`[Link Violation] User: ${sender} (${senderName}) in ${chatId}. Warnings: ${currentWarnings}/${MAX_WARNINGS}. Text: "${context.text.substring(0, 50)}..."`);

    // --- Attempt to delete the offending message ---
    try {
        logger.debug(`[Link Violation] Attempting to delete message ${context.key.id} from ${sender}.`);
        await sockInstance.sendMessage(chatId, { delete: context.key });
        logger.info(`[Link Violation] Deleted link message ${context.key.id} from ${sender}.`);
    } catch (e) {
        logger.error(`[Link Violation] Failed to delete message ${context.key.id} from ${sender}:`, { msg: e.message, code: e.output?.statusCode });
        if (e.output?.statusCode === 403 || e.message?.includes('forbidden') || e.message?.includes('not admin')) {
             await sendReply(context, "⚠️ Couldn't delete link message. Bot needs admin rights for that.");
        }
    }

    // --- Attempt to remove user if max warnings reached ---
    if (currentWarnings >= MAX_WARNINGS) {
        logger.warn(`[Link Violation] Max warnings reached for ${sender} in ${chatId}. Attempting removal...`);

        // --- Check Bot Admin Status using OWNER_NUMBER ---
        let isBotAdminForKick = false;
        const ownerJid = sanitizeJid(config.OWNER_NUMBER);
        const botNumericIdFromConfig = ownerJid.split('@')[0];
        try {
             const groupMeta = await sockInstance.groupMetadata(chatId);
             const participants = groupMeta?.participants || [];
             const botParticipant = participants.find(p => sanitizeJid(p.id).split('@')[0] === botNumericIdFromConfig);
             isBotAdminForKick = botParticipant?.admin === 'admin' || botParticipant?.admin === 'superadmin';
             if (!isBotAdminForKick) {
                  logger.warn(`[Link Violation Kick] Bot is not admin (Status: ${botParticipant?.admin || 'Not Found'}). Cannot remove user.`);
                  await sendReply(context, `⚠️ Cannot remove @${sender.split('@')[0]} for link violations. Bot needs admin rights.`, [sender]);
                  return;
             }
        } catch (metaError) {
             logger.error("[Link Violation Kick] Failed to check bot admin status before kicking:", metaError);
             await sendReply(context, "⚠️ Error checking permissions before kicking user for links.");
             return;
        }
         // --- End Bot Admin Check ---

        // Proceed with removal attempt only if bot is confirmed admin
        try {
            await sendReply(context, `🚨 @${sender.split('@')[0]} don commot! Too many links posted. Bye bye! 👋`, [sender]);
            await sockInstance.groupParticipantsUpdate(chatId, [sender], 'remove');
            logger.info(`[Link Violation] Removed ${sender} (${senderName}) from ${chatId} for excessive link violations.`);
            state.userWarnings.delete(sender);
            logger.info(`[Link Violation] Warnings reset for removed user ${sender}.`);
        } catch (e) {
            logger.error(`[Link Violation] Failed to remove ${sender} from ${chatId}:`, { msg: e.message, code: e.output?.statusCode });
            await sendReply(context, `⚠️ Failed removing @${sender.split('@')[0]} for link violations. (Code: ${e.output?.statusCode || 'Unknown'})`, [sender]);
        }
    }
}


/**
 * Checks if a sender is spamming based on message frequency.
 * @param {string} sender The JID of the sender.
 * @returns {boolean} True if the sender is considered spamming, false otherwise.
 */
function isSpam(sender) {
    if (!sender || isAdmin(sender)) { return false; } // Admins bypass
    const now = Date.now();
    const timestamps = state.messageTimestamps.get(sender) || [];
    const recentTimestamps = timestamps.filter(ts => (now - ts) < SPAM_WINDOW_MS);
    recentTimestamps.push(now);
    state.messageTimestamps.set(sender, recentTimestamps);
    if (recentTimestamps.length > MAX_WARNINGS) {
        logger.warn(`[Spam Check] Spam detected: ${sender} (${recentTimestamps.length} messages in ${SPAM_WINDOW_MS}ms).`);
        return true;
    }
    return false;
}


/**
 * Handles detected spammers, currently by removing them from groups.
 * Requires bot to have admin privileges (verified using OWNER_NUMBER).
 * @param {object} context The parsed message context.
 */
async function handleSpammer(context) {
    if (!context) { logger.warn("[Spam Handler] handleSpammer called with invalid context."); return; }
    const sender = context.sender;
    const chatId = context.chatId;
    const senderName = context.pushName || sender.split('@')[0];

    logger.warn(`[Spam Handler] Spam detected from ${sender} (${senderName}) in ${chatId}.`);
    if (!context.isGroup) { logger.warn(`[Spam Handler] Spam detected in DM from ${sender}. No removal action taken.`); return; }

    // --- Check Bot Admin Status using OWNER_NUMBER ---
    let isBotAdminForKick = false;
    const ownerJid = sanitizeJid(config.OWNER_NUMBER);
    const botNumericIdFromConfig = ownerJid.split('@')[0];
    try {
         const groupMeta = await sockInstance.groupMetadata(chatId);
         const participants = groupMeta?.participants || [];
         const botParticipant = participants.find(p => sanitizeJid(p.id).split('@')[0] === botNumericIdFromConfig);
         isBotAdminForKick = botParticipant?.admin === 'admin' || botParticipant?.admin === 'superadmin';
         if (!isBotAdminForKick) {
              logger.warn(`[Spam Handler Kick] Bot is not admin (Status: ${botParticipant?.admin || 'Not Found'}). Cannot remove user.`);
              await sendReply(context, `⚠️ Cannot remove @${sender.split('@')[0]} for spam. Bot needs admin rights.`, [sender]);
              return;
         }
    } catch (metaError) {
         logger.error("[Spam Handler Kick] Failed to check bot admin status before kicking:", metaError);
         await sendReply(context, "⚠️ Error checking permissions before kicking user for spam.");
         return;
    }
    // --- End Bot Admin Check ---

    // --- Attempt to remove the spammer from the group ---
    logger.warn(`[Spam Handler] Attempting removal of ${sender} from group ${chatId}...`);
    try {
        await sendReply(context, `🚨 @${sender.split('@')[0]} removed for spamming! Oya cool down small! ❄️`, [sender]);
        await sockInstance.groupParticipantsUpdate(chatId, [sender], 'remove');
        logger.info(`[Spam Handler] Removed ${sender} (${senderName}) from ${chatId} for spamming.`);
        state.messageTimestamps.delete(sender);
        logger.info(`[Spam Handler] Message timestamps cleared for removed user ${sender}.`);
    } catch (e) {
        logger.error(`[Spam Handler] Failed to remove ${sender} from ${chatId}:`, { msg: e.message, code: e.output?.statusCode });
        await sendReply(context, `⚠️ Failed removing @${sender.split('@')[0]} for spam. (Code: ${e.output?.statusCode || 'Unknown'})`, [sender]);
    }
}

 
// ================== Command System ================== //

/**
 * Processes a validated command detected in a message.
 * Checks permissions, rate limits, logs context, and executes the command handler.
 * @param {object} context The parsed message context.
 * @param {string} commandName The name of the command (e.g., 'ping').
 * @param {object} command The command object from COMMANDS.
 * @param {string[]} args Array of arguments passed to the command.
 * @returns {Promise<boolean>} True if the command was handled (or attempted), false otherwise.
 */
async function processCommands(context, commandName, command, args) {
    // Basic validation
    if (!context || !commandName || !command || !command.handler) {
        logger.error("[Commands] processCommands called with invalid parameters.", { commandName, hasHandler: !!command?.handler });
        return false;
    }

    const sender = context.sender;
    const isAdminUser = isAdmin(sender); // Checks if sender === config.OWNER_NUMBER

    // --- Permission Check ---
    if (command.admin && !isAdminUser) {
         logger.warn(`[Commands] Admin command '${commandName}' denied for non-admin user: ${sender}`);
         await sendReply(context, "⛔ Hold up! Na only Oga fit run this command.");
         return true; // Handled (by denying)
    }

    // --- Rate Limiting Check (for non-admins) ---
    if (!isAdminUser) {
        if (!(await checkRateLimit(context, commandName))) {
            // Rate limit message sent within checkRateLimit
            return true; // Handled (by rate limiting)
        }
    }

    // --- Execute Command Handler ---
    try {
        // *** ADDED CONTEXT LOGGING ***
        logger.info(`[Commands] Attempting execution for command '${commandName}' by ${sender}`);
        // Log full context only for potentially problematic media commands, truncated
        if (commandName === 'toimg' || commandName === 'tosticker' || commandName === 'forward') {
             logger.debug(`[Commands] Context object for ${commandName}:`, JSON.stringify(context, null, 2).substring(0, 2500)); // Log more length
             try {
                 // Log simplified version too for readability
                 const simpleContext = {
                      chatId: context.chatId, sender: context.sender, isReply: context.isReply,
                      quotedParticipant: context.quotedParticipant, quotedTextLen: context.quotedText?.length,
                      quotedMsgExists: !!context.quotedMsg, contentType: context.contentType,
                      selectedButtonId: context.selectedButtonId
                    };
                 logger.debug(`[Commands] Simplified Context for ${commandName}:`, simpleContext);
             } catch (logErr) {
                  logger.warn(`[Commands] Error simplifying context for ${commandName} logging: ${logErr.message}`);
                }
        } else {
            // For other commands, maybe log less detail
            logger.debug(`[Commands] Executing '${commandName}' normally.`);
        }
        // *** END CONTEXT LOGGING ***

        // Call the specific handler function (e.g., handleToImage)
        await command.handler(context, args);
        // Assume handler completed successfully if no error was thrown
        // (processCommands returning true indicates the command attempt was processed, regardless of handler success/failure)
        return true;

    } catch (error) {
        // Catch errors thrown BY the command handler itself
        logger.error(`[Commands] Command execution FAILED: ${commandName}`, {
            sender: sender,
            error: error.message,
            // Include stack trace from the error object thrown by the handler
            stack: error.stack?.substring(0, 500)
        });
        // Send user-friendly error message
        await sendReply(context, `❌ Wahala dey! Command '${commandName}' crash small. Try again or tell Oga.`);
        // Send detailed error report to the owner
        await sendErrorToOwner(error, context.msg, context);
        return true; // Indicate command was handled (even though it failed)
    }
}

// ================== Command Handlers ================== //
// Functions that implement the logic for each command.

/**
 * Sends the help menu as styled plain formatted text.
 * Filters commands based on user admin status and groups them.
 * v12: Uses 'cyber' style text formatting.
 * @param {object} context The parsed message context.
 */
async function sendHelp(context) {
    if (!context) return;

    const isAdminUser = isAdmin(context.sender);
    const ownerJid = sanitizeJid(config.OWNER_NUMBER);
    const isSpecificallyOwner = context.sender === ownerJid;

    logger.info(`[Help Cmd v12 - Styled Text] Sending help to ${context.sender} (IsOwner: ${isSpecificallyOwner})`);

    if (typeof COMMANDS === 'undefined') { /* ... error handling ... */ return; }

    // --- Prepare Text Output ---
    let sections = {
        user: [],
        admin: [],
        owner: []
    };

    // Filter and sort commands into categories
    Object.entries(COMMANDS)
        .sort(([a], [b]) => a.localeCompare(b))
        .forEach(([name, cmd]) => {
            // Skip showing the help command itself in the list? Optional.
            // if (name === 'help') return;

            // Format each command line: `❖ !command : Description`
            const commandInfo = `❖ \`${config.COMMAND_PREFIX}${name}\` : ${cmd.description || 'No description'}`;
            const isOwnerOnlyCmd = cmd.description?.toLowerCase().includes("owner only");

            if (isOwnerOnlyCmd) {
                 if (isSpecificallyOwner) sections.owner.push(commandInfo);
            } else if (cmd.admin) {
                if (isAdminUser) sections.admin.push(commandInfo);
            } else {
                sections.user.push(commandInfo);
            }
        });

    // --- Build the Styled Text String ---
    const botName = config.BOT_NAME || 'TonnaBot';
    let helpText = `*╔═══*.·:·.☽✧ *${botName} Help* ✧☾.·:·.*═══╗*\n\n`; // Header

    if (sections.user.length > 0) {
        helpText += "║--- *👤 User Commands* ---║\n";
        helpText += sections.user.join('\n') + '\n\n';
    }

    if (sections.admin.length > 0) {
        helpText += "║--- *⚙️ Admin Commands* ---║\n";
        helpText += sections.admin.join('\n') + '\n\n';
    }

     if (sections.owner.length > 0) {
        helpText += "║--- *👑 Owner Commands* ---║\n";
        helpText += sections.owner.join('\n') + '\n\n';
    }

    // Add Tips Section
    helpText += "║------ *💡 Tips* ------║\n";
    helpText += `│ › Use commands like \`${config.COMMAND_PREFIX}command [options]\`\n`;
    const botMentionNumber = config.BOT_PRIMARY_JID ? config.BOT_PRIMARY_JID.split('@')[0] : config.BOT_NAME;
    helpText += `│ › AI responds in DMs, or in groups\n│   if mentioned (@${botMentionNumber} / ${botName})\n│   or replied to.\n`;

    // Footer
    helpText += "*╚═══*.·:·.☽✧☾.·:·.*═══╝*";

    // Check if any commands were actually added
    if (sections.user.length === 0 && sections.admin.length === 0 && sections.owner.length === 0) {
         await sendReply(context, "⚠️ No commands available for you to display.");
         return;
    }

    // --- Send the Text Message ---
    try {
        await sendReply(context, helpText.trim());
        logger.info(`[Help Cmd v12 - Styled Text] Styled text help sent successfully to ${context.sender}.`);
    } catch (error) {
        logger.error(`[Help Cmd v12 - Styled Text] Failed to send help:`, error);
        await sendErrorToOwner(error, context.msg, context);
    }
} 




/**
 * Removes users from the group. (Admin only, requires bot admin)
 * Prioritizes mentions, then replied user, then numbers in args as the target.
 * Uses OWNER_NUMBER config for permission checks.
 * @param {object} context The parsed message context.
 * @param {string[]} args Array of phone numbers/mentions provided after the command.
 */
async function handleKickUser(context, args) {
    if (!context?.isGroup) {
        await sendReply(context, "❌ Group only command.");
        return;
    }

    // --- Permission checks ---
    let groupMeta;
    let botParticipant;
    let senderParticipant;
    const ownerJid = sanitizeJid(config.OWNER_NUMBER); // Your personal JID
    if (!ownerJid) { /* ... error handling ... */ return; }
    // Use BOT_PRIMARY_JID for checking bot's admin status
    const botNumericIdFromConfig = config.BOT_PRIMARY_JID ? config.BOT_PRIMARY_JID.split('@')[0] : null;
    if (!botNumericIdFromConfig) { /* ... error handling ... */ return; }

    try {
        logger.info(`[Kick Cmd] Fetching metadata for group ${context.chatId} to check permissions...`);
        groupMeta = await sockInstance.groupMetadata(context.chatId);
        const participants = groupMeta?.participants || [];

        // Find bot using BOT_PRIMARY_JID's number part
        botParticipant = participants.find(p => sanitizeJid(p.id).split('@')[0] === botNumericIdFromConfig);
        const isBotAdmin = botParticipant?.admin === 'admin' || botParticipant?.admin === 'superadmin';
        if (!isBotAdmin) { /* ... handle bot not admin ... */ return; }
        logger.info(`[Kick Cmd] Bot confirmed as admin.`);

        // Check sender permission (is owner or group admin)
        const senderNumericId = sanitizeJid(context.sender).split('@')[0];
        senderParticipant = participants.find(p => sanitizeJid(p.id).split('@')[0] === senderNumericId);
        const isSenderAdmin = senderParticipant?.admin === 'admin' || senderParticipant?.admin === 'superadmin';
        if (sanitizeJid(context.sender) !== ownerJid && !isSenderAdmin) { /* ... handle sender not admin ... */ return; }
        logger.debug(`[Kick Cmd] Sender ${context.sender} has permission to kick.`);

    } catch (e) {
        logger.error("[Kick Cmd] Failed get group meta for permission check:", e);
        await sendReply(context, "⚠️ Error getting group info to check permissions.");
        return;
    }
    // --- End Permission Check ---


    // --- Determine Users to Kick (with clear precedence) ---
    let usersToKickJids = [];
    let targetSource = 'None'; // To track how the target was identified

    if (context.mentions?.length > 0) {
        // Priority 1: Use mentions from the command message
        usersToKickJids = context.mentions; // Already sanitized by parseMessage
        targetSource = 'Mentions';
        logger.info(`[Kick Cmd] Target identified via mentions: ${usersToKickJids.join(', ')}`);
    } else if (context.isReply && context.quotedParticipant) {
        // Priority 2: Use the participant from the replied-to message
        usersToKickJids.push(context.quotedParticipant); // Already sanitized by parseMessage
        targetSource = 'Reply';
        logger.info(`[Kick Cmd] Target identified via reply: ${context.quotedParticipant}`);
    } else if (args?.length > 0) {
        // Priority 3: Use numbers provided in the arguments
        usersToKickJids = args
            .map(num => num.replace(/[^0-9]/g, '')) // Clean non-digits
            .map(num => sanitizeJid(num)); // Sanitize to JID format
        targetSource = 'Arguments';
        logger.info(`[Kick Cmd] Target identified via arguments: ${usersToKickJids.join(', ')}`);
    } else {
        // No target identified
        await sendReply(context, `❓ Who you wan kick? Mention user(s), reply to their message, or provide number(s) after the command.`);
        return;
    }
    // --- End Target Determination ---


    // --- Filter and Validate Targets ---
    const groupMemberJids = new Set(groupMeta.participants.map(p => p.id));
    // Use BOT_PRIMARY_JID as the bot's identity to avoid kicking itself
    const currentBotId = sanitizeJid(config.BOT_PRIMARY_JID);

    // Ensure all JIDs are sanitized and filter out invalid/protected targets
    usersToKickJids = usersToKickJids
        .map(jid => sanitizeJid(jid)) // Ensure sanitization again just in case
        .filter(jid => {
            if (!jid || !jid.includes('@s.whatsapp.net')) {
                logger.warn(`[Kick Cmd] Invalid JID format skipped: ${jid}`);
                return false; // Skip invalid JIDs
            }
            if (jid === currentBotId) {
                logger.warn(`[Kick Cmd] Attempt to kick self (${jid}). Skipping.`);
                sendReply(context, "⚠️ Cannot kick myself!"); // Inform user
                return false;
            }
            if (jid === ownerJid) {
                logger.warn(`[Kick Cmd] Attempt to kick owner (${jid}). Skipping.`);
                 sendReply(context, "⛔ Cannot kick the bot owner!"); // Inform user
                return false;
            }
            // Check if target is currently an admin (can still attempt, but log it)
            const targetParticipant = groupMeta?.participants.find(p => p.id === jid);
            if (targetParticipant?.admin === 'admin' || targetParticipant?.admin === 'superadmin') {
                logger.warn(`[Kick Cmd] Target ${jid} is an admin. Kick might fail depending on hierarchy.`);
            }
            // Check if target is actually in the group
            if (!groupMemberJids.has(jid)) {
                logger.warn(`[Kick Cmd] Target ${jid} is not in the group ${context.chatId}. Skipping.`);
                return false;
            }
            return true; // Keep valid targets
        });

    // If filtering removed all targets
    if (usersToKickJids.length === 0) {
        await sendReply(context, `❓ No valid users left to kick from the ${targetSource}. Remember, cannot kick self, owner, or non-members.`);
        return;
    }
    // --- End Target Validation ---

    logger.info(`[Kick Cmd] Final targets to kick: ${usersToKickJids.join(', ')} from ${context.chatId} by ${context.sender}`);

    // --- Attempt Kick Operation ---
    try {
        const result = await sockInstance.groupParticipantsUpdate(context.chatId, usersToKickJids, 'remove');
        logger.debug('[Kick Cmd] Raw kick result:', result);

        // Process results (keep existing logic)
        let kicked = [], failed = [];
        if (Array.isArray(result)) {
             for (const item of result) { /* ... process item based on status ... */ }
        } else { /* ... handle unexpected format ... */ }

        // Build reply message (keep existing logic)
        let reply = '';
        const kickedJids = usersToKickJids.filter(jid => kicked.includes(jid.split('@')[0])); // Get JIDs of successfully kicked users
        if (kicked.length > 0) reply += `✅ Kicked: @${kicked.join(', @')}\n`;
        if (failed.length > 0) reply += `❌ Failed kick for: ${failed.join(', ')} (Maybe bot lacks permission vs target? Status: ${failed.map(f=>f.split('(')[1]?.replace(')','') || '?').join(',')})\n`;
        if (!reply) reply = "⚠️ Kick request processed, but results unclear or no valid targets found/kicked.";

        // Send reply, mentioning the kicked users
        await sendReply(context, reply.trim(), kickedJids);

    } catch (error) {
        logger.error(`[Kick Cmd] Kick user operation failed for group ${context.chatId}:`, error);
        await sendReply(context, `⚠️ An error occurred while trying to kick users. (Code: ${error.output?.statusCode || 'Unknown'})`);
        await sendErrorToOwner(error, context.msg, context);
    }
} // <<< Closing brace for handleKickUser


/**
 * Adds users to the group. (Admin only, requires bot admin)
 * Reads numbers from args OR extracts them from replied-to message text if args are empty.
 * Uses OWNER_NUMBER config to verify bot identity for permission check.
 * @param {object} context The parsed message context (including quotedText).
 * @param {string[]} args Array of phone numbers provided after the command.
 */
async function handleAddUser(context, args) {
    if (!context?.isGroup) {
        await sendReply(context, "❌ Group only command.");
        return;
    }

    let numbersToParse = args; // Start with numbers provided in arguments

    // --- NEW LOGIC TO CHECK REPLY CONTEXT --- // <<< THIS SECTION WAS ADDED
    if (!args?.length && context.isReply && context.quotedText) {
        logger.info(`[Add Cmd] No args provided. Checking replied message text for numbers.`);
        // Regex to find potential phone numbers (sequences of digits, possibly with spaces/hyphens/plus)
        const potentialNumbers = context.quotedText.match(/\+?\d[\d\s-]{6,}/g) || []; // Find number-like strings

        if (potentialNumbers.length > 0) {
            // Clean up the found strings (remove spaces, hyphens, plus) before using them
            numbersToParse = potentialNumbers.map(num => num.replace(/[\s+-]/g, ''));
            logger.info(`[Add Cmd] Found potential numbers in quoted text (cleaned): ${numbersToParse.join(', ')}`);
        } else {
             logger.info(`[Add Cmd] No numbers found in replied message text either.`);
              await sendReply(context, `❓ Provide number(s) after ${config.COMMAND_PREFIX}add, or reply to a message containing the number(s) you want to add.`);
              return; // Stop if no numbers found anywhere
        }
    } else if (!args?.length) {
        // If no args AND not a reply with text (or text had no numbers), show usage
         await sendReply(context, `❓ Provide number(s) to add. Usage: ${config.COMMAND_PREFIX}add 234... or reply to a message containing the number(s).`);
        return;
    }
    // --- END OF NEW REPLY LOGIC --- //

    // --- Permission checks ---
    let groupMeta;
    let botParticipant;
    let senderParticipant;
    const ownerJid = sanitizeJid(config.OWNER_NUMBER); // Your personal JID for admin checks
    if (!ownerJid) {
        logger.error("[Add Cmd] OWNER_NUMBER is not configured or invalid.");
        await sendReply(context, "⚠️ Bot configuration error: Owner number missing.");
        return;
     }
    // Use BOT_PRIMARY_JID for checking bot's admin status
    const botNumericIdFromConfig = config.BOT_PRIMARY_JID ? config.BOT_PRIMARY_JID.split('@')[0] : null;
    if (!botNumericIdFromConfig) {
         logger.error("[Add Cmd] Cannot verify bot admin status: BOT_PRIMARY_JID not configured.");
         await sendReply(context, "⚠️ Bot configuration error: Bot primary JID missing.");
         return;
    }

    try {
        logger.info(`[Add Cmd] Fetching metadata for group ${context.chatId} to check permissions...`);
        groupMeta = await sockInstance.groupMetadata(context.chatId);
        const participants = groupMeta?.participants || [];

        // Find bot using BOT_PRIMARY_JID's number part
        botParticipant = participants.find(p => sanitizeJid(p.id).split('@')[0] === botNumericIdFromConfig);
        const isBotAdmin = botParticipant?.admin === 'admin' || botParticipant?.admin === 'superadmin';
        if (!isBotAdmin) {
             if (!botParticipant) { logger.error(`[Add Cmd] CRITICAL: Bot's configured BOT_PRIMARY_JID was not found in group ${context.chatId}!`); }
             else { logger.warn(`[Add Cmd] Bot (identified by BOT_PRIMARY_JID) is NOT admin. Status: ${botParticipant?.admin || 'Null'}`); }
             await sendReply(context, "⚠️ Bot no be admin here, cannot add members.");
             return;
         }
         logger.info(`[Add Cmd] Bot confirmed as admin.`);

        // Check sender permission (is owner or group admin)
        const senderNumericId = sanitizeJid(context.sender).split('@')[0];
        senderParticipant = participants.find(p => sanitizeJid(p.id).split('@')[0] === senderNumericId);
        const isSenderAdmin = senderParticipant?.admin === 'admin' || senderParticipant?.admin === 'superadmin';
        // Allow OWNER or group admin to add
        if (sanitizeJid(context.sender) !== ownerJid && !isSenderAdmin) {
             logger.warn(`[Add Cmd] Denied: Sender ${context.sender} is not Owner or Group Admin in ${context.chatId}.`);
             await sendReply(context, "🔒 Only group admins or the bot owner fit add members.");
             return;
         }
         logger.debug(`[Add Cmd] Sender ${context.sender} has permission to add.`);

    } catch (e) {
        logger.error("[Add Cmd] Failed get group meta for permission check:", e);
        await sendReply(context, "⚠️ Error getting group info to check permissions.");
        return;
    }
    // --- End Permission Check ---


    // --- Sanitize numbers obtained either from args or quoted text ---
    const numbersToAdd = numbersToParse
        .map(num => num.replace(/[^0-9]/g, '')) // Ensure only digits remain *before* sanitizing
        .map(num => sanitizeJid(num)) // Sanitize to JID format (e.g., number@s.whatsapp.net)
        .filter(j => j && j.includes('@s.whatsapp.net')); // Keep only valid WhatsApp JIDs

    if (numbersToAdd.length === 0) {
        await sendReply(context, "❓ No valid WhatsApp numbers found in your request or the replied message after cleaning.");
        return;
    }
    // --- End Sanitize ---

    logger.info(`[Add Cmd] Attempting to add JIDs: ${numbersToAdd.join(', ')} to ${context.chatId} by ${context.sender}`);

    // --- Attempt Add Operation ---
    try {
        const result = await sockInstance.groupParticipantsUpdate(context.chatId, numbersToAdd, 'add');
        logger.debug('[Add Cmd] Raw add result:', result);

        // Process the result to provide a user-friendly summary
        let added = [], failed = [], already_in = [], other_error = [];
        if (Array.isArray(result)) {
            for (const item of result) {
                 if (!item?.jid) { logger.warn("[Add Cmd] Skipping invalid item in add result:", item); continue; }
                 const num = item.jid.split('@')[0];
                 const status = item.status?.toString() || 'unknown';
                 if (status.startsWith('2')) { added.push(num); }
                 else if (status === '403') { failed.push(`${num}(Privacy?)`); }
                 else if (status === '408') { failed.push(`${num}(Not Found?)`); }
                 else if (status === '409') { already_in.push(num); }
                 else { other_error.push(`${num}(${status})`); }
            }
        } else {
             logger.error("[Add Cmd] Unexpected result format from groupParticipantsUpdate:", result);
             other_error.push(`Unknown(${JSON.stringify(result)})`);
        }

        // Construct reply message based on results
        let reply = '';
        if (added.length > 0) reply += `✅ Added: ${added.join(', ')}\n`;
        if (already_in.length > 0) reply += `👥 Already in group: ${already_in.join(', ')}\n`;
        if (failed.length > 0) reply += `❌ Failed (Privacy/Not Found?): ${failed.join(', ')}\n`;
        if (other_error.length > 0) reply += `❓ Other Errors/Results: ${other_error.join(', ')}\n`;
        if (!reply) reply = "⚠️ Add request processed, but results unclear or no valid targets found.";
        await sendReply(context, reply.trim());

    } catch (error) {
        logger.error(`[Add Cmd] Add user operation failed for group ${context.chatId}:`, error);
        await sendReply(context, `⚠️ An error occurred while trying to add users. (Code: ${error.output?.statusCode || 'Unknown'})`);
        await sendErrorToOwner(error, context.msg, context);
    }
} // <<< Closing brace for handleAddUser





/**
 * Handles the !gen command. Uses AI to generate names based on a category.
 * Example: !gen hacker
 * Example: !gen fantasy warrior
 * Example: !gen cool business starting with T
 * @param {object} context Parsed message context
 * @param {string[]} args The category and optional hints for name generation
 */
async function handleNameGeneratorCommand(context, args) {
    const senderJid = context.sender;
    const requestText = args.join(' ').trim();

    if (!requestText) {
        await sendReply(context, `❓ What kind of names do you want me to generate? \nExample: ${config.COMMAND_PREFIX}gen cool hacker names\nOr: ${config.COMMAND_PREFIX}gen fantasy elf names starting with L`);
        return;
    }

    logger.info(`[NameGen Cmd] Received request from ${senderJid}: "${requestText.substring(0, 50)}..."`);
    await sendReply(context, `🤔 Generating some names based on: "${requestText.substring(0, 50)}..." Please wait...`);

    // --- Prepare Prompt for AI ---
    const nameGenPrompt = `You are TonnaBot (${config.BOT_NAME}), a creative name generator. A user wants you to generate a list of 3-5 unique and cool names based on their request.
Consider the category and any hints they provide. Format the output as a simple list.

User's Request: "Generate names for: ${requestText}"

Generated Names List:`;
    // --- End Prompt ---

    try {
        const result = await aiModel.generateContent(nameGenPrompt);
        const response = result.response;

        if (!response) { throw new Error('No response received from AI model.'); }
        if (response.promptFeedback?.blockReason) { throw new Error(`AI request blocked due to: ${response.promptFeedback.blockReason}`); }
        const generatedNames = response.text().trim();
        if (!generatedNames) { throw new Error("AI returned an empty list of names."); }

        logger.info(`[NameGen Cmd] Sending generated names to ${senderJid}.`);
        // Send the generated names back
        await sendReply(context, `✨ Here are some names I came up with for "${requestText}":\n\n${generatedNames}`);

    } catch (error) {
        logger.error(`[NameGen Cmd] Failed for request "${requestText}":`, error);
        if (error.message.includes("AI request blocked")) { await sendReply(context, `⚠️ AI refused that name generation request: ${error.message.split(': ').pop()}`); }
        else if (error.message.includes("AI returned empty text")) { await sendReply(context, "😅 My name generator circuit is blank... couldn't generate anything for that."); }
        else { await sendReply(context, `⚠️ Error during name generation: ${error.message}`); }
        await sendErrorToOwner(error, context.msg, context);
        throw error;
    }
}



/**
 * Handles the !horror command. Sends a sequence of spooky/unsettling messages
 * with delays to create a "horror" effect.
 * @param {object} context Parsed message context
 * @param {string[]} args Command arguments (not used)
 */
async function handleHorrorCommand(context, args) {
    const senderJid = context.sender;
    const chatId = context.chatId;
    logger.info(`[Horror Cmd] Activated by ${senderJid} in chat ${chatId}`);

    // --- Define the sequence of spooky messages ---
    // Feel free to customize these!
    const horrorSequence = [
        "```\nSystem Alert: Unregistered presence detected in this chat...\n```",
        "Did you hear that?",
        "```\nAnalyzing ambient noise levels... Elevated static patterns found.\n```",
        "Wait... I think someone just typed and deleted their message.",
        "```\nNetwork traffic anomaly detected... Attempting to reroute through secure node... Failed.\nUsing dark node instead.\n```",
        `Psst... @${senderJid.split('@')[0]}... are you *sure* you're alone right now?`, // Mentions the user
        "```\nERROR: Message buffer integrity compromised.\nRepeating last valid data fragment: ...no...don't...look...\n```",
        "I wouldn't turn around if I were you.",
        "```\nSystem Stability: 27% ... Evacuation protocol advised?\n```",
        "👻 ...Boo!"
    ];
    // --- End spooky messages ---

    // Initial message to set the mood
    const feedbackMsg = await sendReply(context, "🤫 Shhh... Activating eerie mode... You might want to check under your bed first.");
    let currentDelay = 2500; // Initial delay in milliseconds

    // Loop through the messages and send them with delays
    for (const messageText of horrorSequence) {
        // Add a bit of randomness to the delay
        await delay(currentDelay + Math.random() * 1000);

        try {
            // Send the message, mentioning the original sender if the placeholder is used
            const messageToSend = messageText.includes(`@${senderJid.split('@')[0]}`)
                ? { text: messageText, mentions: [senderJid] }
                : { text: messageText };

            await sockInstance.sendMessage(chatId, messageToSend);
        } catch (e) {
            logger.error(`[Horror Cmd] Failed to send a horror message segment to ${chatId}: ${e.message}`);
            // If one message fails, probably best to stop the sequence
            await sendReply(context, "```\nSYSTEM ERROR: Horror sequence corrupted. You are safe... for now.\n```");
            return; // Exit the function
        }
        // Optionally, slightly decrease delay for subsequent messages to build pace
        currentDelay = Math.max(1500, currentDelay - 200);
    }

    // Delete initial feedback message (optional)
    if (feedbackMsg?.key) {
        await sockInstance.sendMessage(chatId, { delete: feedbackMsg.key }).catch(delErr => logger.warn(`[Horror Cmd] Failed to delete feedback: ${delErr.message}`));
    }
    logger.info(`[Horror Cmd] Horror sequence completed for ${senderJid} in ${chatId}.`);
}





/**
 * Handles the !confess command received via DM.
 * Parses target group name and confession text.
 * Finds the group JID by name and posts the confession anonymously.
 * Usage: !confess "Group Name with Spaces" Confession text...
 * OR !confess GroupNameWithoutSpaces Confession text...
 * @param {object} context Parsed message context
 * @param {string[]} args Command arguments combined into a string
 */
async function handleConfessCommand(context, args) {
    const senderJid = context.sender;

    // 1. Ensure command is used in DM
    if (context.isGroup) {
        await sendReply(context, "🤫 Confessions can only be sent privately to the bot. Please DM me your confession using !confess \"Group Name\" Your confession...");
        return;
    }

    // 2. Parse Arguments - Group Name and Confession Text
    const fullArgs = args.join(' ');
    let groupNameQuery = null;
    let confessionText = null;

    // Try parsing quoted group name first: !confess "Group Name" Confession...
    const quotedMatch = fullArgs.match(/^"([^"]+)"\s+(.+)/s); // Match "quoted name" then rest
    if (quotedMatch && quotedMatch[1] && quotedMatch[2]) {
        groupNameQuery = quotedMatch[1].trim();
        confessionText = quotedMatch[2].trim();
        logger.debug(`[Confess Cmd] Parsed quoted group name: "${groupNameQuery}", Text: "${confessionText.substring(0,30)}..."`);
    } else {
        // Try parsing non-quoted name: !confess GroupName Confession... (assumes first word is name)
        if (args.length >= 2) {
            groupNameQuery = args[0]; // First word is group name
            confessionText = args.slice(1).join(' ').trim(); // Rest is confession
            logger.debug(`[Confess Cmd] Parsed non-quoted group name: "${groupNameQuery}", Text: "${confessionText.substring(0,30)}..."`);
        }
    }

    // Validate parsing results
    if (!groupNameQuery || !confessionText) {
        await sockInstance.sendMessage(senderJid, { text: `❓ Invalid format. Use:\n!confess "Group Name" Your confession...\nOR\n!confess GroupName Your confession...` });
        return;
    }

    logger.info(`[Confess Cmd] Received confession from ${senderJid} targeted for group name: "${groupNameQuery}"`);
    await sockInstance.sendMessage(senderJid, { text: `⏳ Okay, attempting to find group "${groupNameQuery}" and post your confession anonymously...` });


    try {
        // 3. Find Target Group JID by Name (using existing helper)
        const matchedGroups = await findGroupJidByName(groupNameQuery);

        // Handle results of group search
        if (!matchedGroups || matchedGroups.length === 0) {
            logger.warn(`[Confess Cmd] No groups found matching "${groupNameQuery}" for user ${senderJid}.`);
            await sockInstance.sendMessage(senderJid, { text: `❌ Couldn't find any group named "${groupNameQuery}" that I'm currently in. Please check the name.` });
            return;
        }

        let targetGroupId = null;
        if (matchedGroups.length > 1) {
            // For now, just warn and use the first match if multiple found.
            // TODO: Could potentially list matches and ask user to confirm via DM? More complex.
            logger.warn(`[Confess Cmd] Multiple groups found matching "${groupNameQuery}". Using the first match: ${matchedGroups[0]}`);
            await sockInstance.sendMessage(senderJid, { text: `⚠️ Found multiple groups matching "${groupNameQuery}". Posting to the first one found: ${matchedGroups[0]}. Be more specific next time if this is wrong.` });
            targetGroupId = matchedGroups[0];
        } else {
            // Exactly one match found
            targetGroupId = matchedGroups[0];
            logger.info(`[Confess Cmd] Found target group JID: ${targetGroupId}`);
        }

        // 4. Format and Send Anonymous Message
        const anonymousMessage = `🤫 *Anonymous Confession*\n────────────────────\n\n${confessionText}\n\n────────────────────\n_(Sent via TonnaBot)_`;

        await sockInstance.sendMessage(targetGroupId, { text: anonymousMessage });
        logger.info(`[Confess Cmd] Successfully posted confession from ${senderJid} anonymously to ${targetGroupId}`);

        // 5. Confirm Success to User via DM
        await sockInstance.sendMessage(senderJid, { text: `✅ Your confession has been posted anonymously to the group matching "${groupNameQuery}"!` });

    } catch (error) {
        logger.error(`[Confess Cmd] Failed to process confession from ${senderJid}:`, error);
        // Send error DM back to user
        await sockInstance.sendMessage(senderJid, { text: `⚠️ An error occurred while trying to post your confession: ${error.message}. Please try again later.` });
        // Also report to owner if needed
        await sendErrorToOwner(error, context.msg, context);
    }
}




/**
 * Handles the !leaderboard command. Displays the top N users in the group
 * based on level and XP, including their role titles, from Supabase.
 * v4 Supabase: Fetches group data in batches to avoid header overflow.
 * @param {object} context Parsed message context
 * @param {string[]} args Command arguments (not used)
 */
async function handleLeaderboardCommand(context, args) {
    // Ensure command is used in a group
    if (!context.isGroup) {
        await sendReply(context, "❌ Leaderboards are only available in groups.");
        return;
    }

    const chatId = context.chatId;
    const TOP_N = 10; // Number of top users to display
    const defaultRole = LEVEL_ROLES[0]?.title || 'N/A'; // Default for level 0
    const logPrefix = "[Leaderboard Cmd Supabase v4]"; // Version bump

    // Check if Supabase client is initialized
    if (!supabase) {
        logger.warn(`${logPrefix} Supabase client not initialized. Cannot fetch leaderboard data.`);
        await sendReply(context, "⚠️ Bot is having trouble connecting to the user database. Please try again later.");
        return;
    }

    logger.info(`${logPrefix} Requested by ${context.sender} in group ${chatId}`);
    await sendReply(context, `⏳ Calculating top ${TOP_N} group rankings (batch fetch)...`); // Updated feedback

    try {
        // Get current group members' metadata
        const metadata = await sockInstance.groupMetadata(chatId);
        const participants = metadata?.participants || [];
        const groupName = metadata.subject || 'This Group';

        if (participants.length === 0) {
            await sendReply(context, "⚠️ Could not fetch group members list to calculate leaderboard.");
            return;
        }

        // Get participant JIDs
        const participantJids = participants.map(p => sanitizeJid(p.id)).filter(jid => !!jid);

        // --- Fetch Data in Batches ---
        const BATCH_SIZE = 100; // How many users to fetch per Supabase request
        let allGroupUsersData = [];
        logger.debug(`${logPrefix} Starting batch fetch for ${participantJids.length} participants... Batch size: ${BATCH_SIZE}`);

        for (let i = 0; i < participantJids.length; i += BATCH_SIZE) {
            const batchJids = participantJids.slice(i, i + BATCH_SIZE);
            logger.debug(`${logPrefix} Fetching batch ${Math.floor(i / BATCH_SIZE) + 1}... JIDs: ${batchJids.length}`);
            const { data: batchData, error: batchError } = await supabase
                .from('users_data')
                .select('user_id, xp, level, title') // Select needed fields
                .in('user_id', batchJids); // Use 'in' filter for the batch

            if (batchError) {
                logger.error(`${logPrefix} Supabase batch fetch error:`, JSON.stringify(batchError, null, 2));
                throw new Error(`Supabase batch fetch error: ${batchError.message} (Code: ${batchError.code})`);
            }
            if (batchData) {
                allGroupUsersData = allGroupUsersData.concat(batchData); // Combine results from batches
            }
            // Optional delay between batches (usually not needed for Supabase)
            // await delay(50);
        }
        logger.info(`${logPrefix} Finished batch fetch. Total records retrieved: ${allGroupUsersData.length}`);
        // --- End Batch Fetch ---


        // Create a map for easy lookup: { userId -> dbData }
        const dbDataMap = new Map();
        allGroupUsersData.forEach(u => dbDataMap.set(u.user_id, u));

        // Helper function to get title
        const getTitleForLevelLocal = (level) => { /* ... same helper logic ... */ };

        // Create an array of users with their level data and score
        const rankedUsers = participants.map(p => {
            const jid = sanitizeJid(p.id);
            const dbUser = dbDataMap.get(jid); // Get data from our fetched results

            const level = dbUser?.level || 0;
            const xp = dbUser?.xp || 0;
            const title = dbUser?.title || getTitleForLevel(level) || defaultRole;
            const score = (level * 10000) + xp; // Same scoring

            return { jid, level, xp, title, score };
        }).filter(u => u.jid && u.score > 0); // Filter out 0 score users

        // Sort users by score in descending order
        rankedUsers.sort((a, b) => b.score - a.score);

        // Get the top N users
        const topUsers = rankedUsers.slice(0, TOP_N);

        // --- Format the Reply (Include Title) ---
        let replyText = `🏆 *LEADERBOARD - ${groupName.toUpperCase()}* 🏆\n`;
        replyText += `────────────────────\n`;

        if (topUsers.length === 0) {
            replyText += "\nNo one has earned XP in this group yet to rank on the leaderboard!";
        } else {
            topUsers.forEach((user, index) => {
                 const rank = index + 1;
                 // Format: #1. @12345 - ✨ Role Title (Lvl X)
                 replyText += `#${rank}. @${user.jid.split('@')[0]} - *${user.title}* (Lvl ${user.level})\n`;
            });
        }
         replyText += `────────────────────`;
        // --- End Formatting ---

        // Get JIDs of top users for mentioning
        const mentions = topUsers.map(u => u.jid);

        // Send the formatted leaderboard message
        await sockInstance.sendMessage(context.chatId, {
            text: replyText.trim(),
            mentions: mentions
        }, { quoted: context.msg });

        logger.info(`${logPrefix} Sent leaderboard for ${chatId}. Displayed top ${topUsers.length} users.`);

    } catch (error) {
        logger.error(`${logPrefix} Failed to get leaderboard for ${chatId}:`, { message: error.message, stack: error.stack?.substring(0,500) });
        await sendReply(context, "⚠️ An error occurred while generating the leaderboard from the database.");
        await sendErrorToOwner(new Error(`Supabase Error in !leaderboard for ${chatId}: ${error.message}`), context.msg, context);
    }
} 


/**
 * Handles the !caption command. When replied to an image,
 * downloads the image and uses the AI Vision model to generate a caption.
 * @param {object} context Parsed message context
 * @param {string[]} args Command arguments (not used)
 */
async function handleCaptionCommand(context, args) {
    logger.info(`[Caption Cmd] Command received from ${context.sender} in chat ${context.chatId}`);

    // --- 1. Check if it's a valid reply to an image ---
    let isReply = !!context.isReply;
    let isQuotedImage = false;
    let imageMessageData = null; // To hold the actual imageMessage object from contextInfo

    // Use the reliable direct check method
    if (isReply && context.msg?.message?.extendedTextMessage?.contextInfo?.quotedMessage?.imageMessage) {
        isQuotedImage = true;
        imageMessageData = context.msg.message.extendedTextMessage.contextInfo.quotedMessage.imageMessage;
        logger.info(`[Caption Cmd] Valid reply to image detected.`);
    }

    // If check fails, send usage instructions and exit
    if (!isReply || !isQuotedImage || !imageMessageData) {
        logger.warn(`[Caption Cmd] Check failed: isReply=${isReply}, isQuotedImage=${isQuotedImage}, dataExists=${!!imageMessageData}`);
        await sendReply(context, `❓ Reply to an image message with ${config.COMMAND_PREFIX}caption to get a caption for it.`);
        return;
    }
    // --- End Check ---


    await sendReply(context, "⏳ Analyzing image and generating caption... 🤖"); // Initial feedback

    try {
        // --- 2. Download the image ---
        logger.debug(`[Caption Cmd] Attempting image download...`);
        const imageStream = await baileysPkg.downloadContentFromMessage(
            imageMessageData, // Pass the object containing url, mediaKey etc.
            'image'           // Specify the type as 'image'
        );
        let imageBuffer = Buffer.from([]);
        for await (const chunk of imageStream) { imageBuffer = Buffer.concat([imageBuffer, chunk]); }

        if (!imageBuffer || imageBuffer.length === 0) {
            throw new Error("Image download failed or resulted in empty buffer.");
        }
        logger.debug(`[Caption Cmd] Image downloaded successfully, size: ${imageBuffer.length} bytes.`);
        // --- End Download ---


        // --- 3. Prepare AI Request Payload ---
        const base64ImageData = imageBuffer.toString('base64');
        const mimeType = imageMessageData.mimetype || 'image/jpeg'; // Get mimetype from object or default

        // Define the prompt for the AI
        const captionPrompt = `You are TonnaBot (${config.BOT_NAME}), a witty, sharp-tongued Nigerian bot with street smarts. Look at the following image and generate ONE short, creative caption for it. The caption could be funny, savage, insightful, or descriptive, matching your persona. Use English in professional or straight chat but switch to Nigerian Pidgin/slang naturally where it fits. Output ONLY the caption text, nothing else.`;

        // Structure the payload for the multi-modal model
        const apiPayloadParts = [
            { text: captionPrompt }, // Instruction text first
            { inlineData: { data: base64ImageData, mimeType: mimeType } } // Then image data
        ];
        const requestPayload = {
             contents: [{ role: 'user', parts: apiPayloadParts }]
            // Optional: Add generationConfig if needed
            // generationConfig: { temperature: 0.8, maxOutputTokens: 100 }
            };
        // --- End Prepare AI Request ---


        // --- 4. Call AI Vision Model ---
        logger.info(`[Caption Cmd] Sending image and prompt to AI Vision model (${aiModel.model})...`);
        // Ensure aiModel is initialized with a vision-capable model name ('gemini-pro-vision' etc.)
        const result = await aiModel.generateContent(requestPayload);
        const response = result.response;

        // Validate AI Response (add more checks as needed)
        if (!response) { throw new Error('No response received from AI model.'); }
        if (response.promptFeedback?.blockReason) { throw new Error(`AI request blocked due to: ${response.promptFeedback.blockReason}`); }
        const generatedCaption = response.text().trim(); // text() helper usually gets text part
        if (!generatedCaption) { throw new Error("AI returned an empty caption."); }
        // --- End AI Call ---


        // --- 5. Send Caption Reply ---
        logger.info(`[Caption Cmd] AI generated caption: "${generatedCaption.substring(0, 100)}..."`);
        // Send the caption back to the user, quoting their command
        await sendReply(context, `🤖 TonnaBot captions this:\n\n"${generatedCaption}"`);
        // --- End Send Reply ---

    } catch (error) {
        logger.error(`[Caption Cmd] Failed:`, { message: error.message, stack: error.stack?.substring(0, 500) });
        // Send user-friendly error messages based on failure point
        if (error.message.includes("download") || error.message.includes("buffer")) {
            await sendReply(context, "⚠️ Failed: Could not download the image to analyze.");
        } else if (error.message.includes("AI returned an empty caption")) {
            await sendReply(context, "🤔 Hmm, I looked but couldn't think of a caption for that one.");
        } else if (error.message.includes("AI request blocked due to")) {
            await sendReply(context, `⚠️ AI refused: ${error.message.split(': ').pop()}. Try a different image?`);
        } else {
            await sendReply(context, `⚠️ Error generating caption: ${error.message}`);
        }
        await sendErrorToOwner(error, context.msg, context);
        // Let processCommands handle the final "Wahala dey" message
        throw error;
    }
}





/**
 /**
 * Sends styled information about the bot, including its current profile picture and version.
 * v3: Fetches own PP, reads version, applies box styling.
 * @param {object} context The parsed message context.
 */
async function handleAboutBot(context) {
    // Check context
    if (!context || !context.chatId || !context.sender || !context.msg || !context.key) {
        logger.warn("[About Cmd v3] handleAboutBot called without valid context.");
        return;
    }
    logger.info(`[About Cmd v3] Sending styled bot info to ${context.sender}`);
    await sendReply(context, "⏳ Fetching bot profile & info..."); // Feedback

    let ppBuffer = null;
    let botVersion = 'N/A';
    const botJid = sockInstance?.user?.id; // Get bot's own JID

    // --- 1. Get Version from package.json ---
    try {
        // Resolve path relative to the current module
        const __filename = fileURLToPath(import.meta.url);
        const __dirname = dirname(__filename);
        const packageJsonPath = join(__dirname, 'package.json'); // Assumes package.json is in the same dir as index.js
        const packageJsonContent = await readFile(packageJsonPath, 'utf8');
        const packageData = JSON.parse(packageJsonContent);
        botVersion = packageData.version || 'N/A'; // Get version from package.json
         logger.debug(`[About Cmd v3] Fetched bot version: ${botVersion}`);
    } catch (e) {
        logger.error(`[About Cmd v3] Failed to read/parse package.json: ${e.message}`);
        // Continue without version info
    }

    // --- 2. Get Bot's Profile Picture ---
    if (botJid) { // Only attempt if bot JID is available
        try {
            logger.debug(`[About Cmd v3] Fetching profile picture for bot JID: ${botJid}`);
            const ppUrl = await sockInstance.profilePictureUrl(botJid, 'image');
            const response = await fetch(ppUrl); // Use node-fetch
            if (!response.ok) {
                 // Log HTTP errors (e.g., 404 Not Found if no PP set)
                 logger.warn(`[About Cmd v3] Fetch PP URL failed with status ${response.status}`);
                 // Throw error to trigger fallback logic cleanly
                 throw new Error(`HTTP error ${response.status}`);
            }
            ppBuffer = await response.buffer();
             if (!ppBuffer || ppBuffer.length === 0) {
                 throw new Error("Downloaded PP buffer is empty.");
             }
            logger.debug(`[About Cmd v3] Bot profile picture buffer fetched successfully.`);
        } catch (e) {
            logger.warn(`[About Cmd v3] Failed to get bot profile picture: ${e.message}. Proceeding without image.`);
            ppBuffer = null; // Ensure buffer is null on error
        }
    } else {
         logger.warn(`[About Cmd v3] Bot JID not available, cannot fetch profile picture.`);
         ppBuffer = null;
    }

    // --- 3. Construct Styled Text ---
    const name = config.BOT_NAME || 'TonnaBot';
    const clan = "︻デ═一 𝕭𝖚𝖑𝖑𝖊𝖙𝕾𝖙𝖔𝖗𝖒"; // Or get from config
    const creator = "Emenine Tochukwu"; // Or get from config
    // Your original about text
    const aboutText = "No be ordinary bot, na digital warrior coded for Vawulence and Truth Bombs! From the great ︻デ═一 𝕭𝖚𝖑𝖑𝖊𝖙𝕾𝖙𝖔𝖗𝖒 clan, built by Oga Emenine Tochukwu. Expect fire, no dey whine me.";

    // Construct the styled message using box characters and info
    // You can customize the characters (╭╮╰╯│─━═◈❖✧✦) and layout
    const styledProfileText = `
╭───═━「 *${name}* 」━═───╮
│
│  ❖  *Version:* \`v${botVersion}\`
│  ❖  *Clan:* ${clan}
│  ❖  *Creator:* ${creator} 🔥
│
├─═════「  інформація 」═════─
│  ${aboutText}
│
╰───═━「 ✨ Expect Fire ✨ 」━═───╯
    `.trim(); // trim() removes leading/trailing whitespace


    // --- 4. Send Message ---
    try {
        if (ppBuffer) {
            // If we got the profile picture buffer, send image + caption
            await sockInstance.sendMessage(context.chatId, {
                 image: ppBuffer,
                 caption: styledProfileText
            }, { quoted: context.msg });
             logger.info(`[About Cmd v3] Sent styled info with profile picture.`);
        } else {
            // If we failed to get the PP, send text only
            await sendReply(context, styledProfileText);
            logger.info(`[About Cmd v3] Sent styled info as text only (no profile picture).`);
        }
    } catch (error) {
         logger.error(`[About Cmd v3] Failed to send final about message: ${error.message}`);
         // Fallback to a very simple text message in case the styled text itself causes issues
         await sendReply(context, `Bot Name: ${name}\nVersion: ${botVersion}\nCreator: ${creator}`);
         await sendErrorToOwner(error, context.msg, context);
    }
}
 
 
 
 
/**
 * Toggles the AI listening setting for the current group. (Admin only)
 * @param {object} context The parsed message context.
 * @param {string[]} args Command arguments ([on/off]).
 */
async function handleAIToggle(context, args) {
    // Ensure it's a group chat
    if (!context?.isGroup) {
        await sendReply(context, "❌ AI setting na for group only.");
        return;
    }
    const setting = args[0]?.toLowerCase();
    // Validate input argument
    if (setting !== 'on' && setting !== 'off') {
        await sendReply(context, `❓ Usage: ${config.COMMAND_PREFIX}ai [on/off]`);
        return;
    }

    const groupSettings = getGroupSettings(context.chatId);
    const newState = (setting === 'on'); // Boolean true for 'on', false for 'off'

    // Check if the setting is already the desired state
    if (groupSettings.aiEnabled === newState) {
        await sendReply(context, `✅ AI listening already ${newState ? 'ON' : 'OFF'} for this group.`);
        return;
    }

    // Update the setting and save
    groupSettings.aiEnabled = newState;
    state.groupSettings.set(context.chatId, groupSettings); // Save updated settings object

    // Send confirmation message (persona-based)
    await sendReply(context, `🤖 AI Listening ${newState ? 'ENABLED ✅ (Will reply if mentioned/replied)' : 'DISABLED ❌ (Will ignore all messages)'}.`);
    logger.info(`[AI Toggle Cmd] AI Listening set to ${newState} in ${context.chatId} by ${context.sender}`);
}


/**
 * Toggles the global Nuclear AI override. (Owner only)
 * @param {object} context The parsed message context.
 * @param {string[]} args Command arguments ([on/off]).
 */
async function handleNuclearAI(context, args) {
     // Permission check (redundant if processCommands works, but safe)
     if (!context || !isAdmin(context.sender)) {
         await sendReply(context, "⛔ Access Denied! Owner command!");
         return;
     }
     const setting = args[0]?.toLowerCase();
     // Validate input
     if (setting !== 'on' && setting !== 'off') {
         await sendReply(context, `❓ Usage: ${config.COMMAND_PREFIX}nuclear [on/off]`);
         return;
     }

     const newState = (setting === 'on');
     // Update global state
     state.nuclearAI = newState;
     const statusText = newState ? 'ENGAGED 🔥🔥' : 'DISENGAGED ✅';
     logger.warn(`[Nuclear Cmd] Nuclear AI Override ${statusText} by ${context.sender}`);
     // Send confirmation message
     await sendReply(context, `☢️ Global AI Emergency Override ${statusText}! ${newState ? 'Responding to ALL messages everywhere!' : 'Normal operation resumed.'}`);
}


/**
 * Tags all group members visibly with an optional message. (Admin only)
 * Sends mentions in chunks to avoid WhatsApp limits.
 * @param {object} context The parsed message context.
 * @param {string[]} args Optional message to include with the tag.
 */
async function handleTagAll(context, args) {
    if (!context?.isGroup) {
        await sendReply(context,"❌ Group only command!");
        return;
    }
    // Join arguments to form the message, or use a default
    const message = args.join(' ') || `📢 Attention squad!`; // Persona message

    try {
        // Get group metadata to find participants
        const metadata = await sockInstance.groupMetadata(context.chatId);
        // Use OWNER_NUMBER to identify the bot reliably
        const botJid = sanitizeJid(config.OWNER_NUMBER);
        // Get participant JIDs, excluding the bot itself
        const participants = metadata.participants
            .map(p => p.id)
            .filter(id => sanitizeJid(id) !== botJid); // Filter using sanitized JIDs

        if (participants.length === 0) {
            await sendReply(context, "👥 Na only me and you dey here? Cannot tag anyone else.");
            return;
        }

        logger.info(`[TagAll Cmd] Starting visible tagall for ${participants.length} members in ${context.chatId} by ${context.sender}`);

        // Send mentions in chunks to avoid potential rate limits or message length issues
        const CHUNK_SIZE = 15; // Number of mentions per message chunk
        for (let i = 0; i < participants.length; i += CHUNK_SIZE) {
            const chunk = participants.slice(i, i + CHUNK_SIZE);
            // Create the mention string (e.g., "@123 @456")
            const mentionText = chunk.map(id => `@${id.split('@')[0]}`).join(' ');
            // Combine the user's message (or default) with the mention text
            const fullText = `${message}\n${mentionText}`;

            logger.debug(`[TagAll Cmd] Sending chunk ${Math.floor(i/CHUNK_SIZE) + 1}/${Math.ceil(participants.length/CHUNK_SIZE)} with ${chunk.length} mentions.`);
            // Send the message chunk with corresponding mentions
            await sockInstance.sendMessage(context.chatId, { text: fullText, mentions: chunk });

            // Add a small delay between chunks if not the last chunk
            if (i + CHUNK_SIZE < participants.length) {
                await new Promise(resolve => setTimeout(resolve, 600)); // 600ms delay
            }
        }
        logger.info(`[TagAll Cmd] Finished visible tagall in ${context.chatId}.`);

    } catch (e) {
        logger.error(`[TagAll Cmd] Failed for group ${context.chatId}:`, e);
        await sendReply(context, "⚠️ Tagging error! Could not fetch group info or send message.");
        await sendErrorToOwner(e, context.msg, context); // Report error
    }
}


/**
 * Tags all group members silently (via notification) with an optional message. (Admin only)
 * Reliability of notification depends on WhatsApp.
 * @param {object} context The parsed message context.
 * @param {string[]} args Optional message to include.
 */
async function handleHideTagAll(context, args) {
    if (!context?.isGroup) {
        await sendReply(context,"❌ Group only command!");
        return;
    }
    const message = args.join(' ') || `🔔 Heads up!`; // Persona message

    try {
        const metadata = await sockInstance.groupMetadata(context.chatId);
        // Use OWNER_NUMBER to identify the bot reliably
        const botJid = sanitizeJid(config.OWNER_NUMBER);
        // Get participant JIDs, excluding the bot
        const participants = metadata.participants
            .map(p => p.id)
            .filter(id => sanitizeJid(id) !== botJid); // Filter using sanitized JIDs

        if (participants.length === 0) {
            await sendReply(context, "👥 Only me and you dey? Cannot tag anyone else.");
            return;
        }

        logger.info(`[HideTag Cmd] Starting silent tag for ${participants.length} members in ${context.chatId} by ${context.sender}`);

        // Send ONLY the message text, but include all participants in the 'mentions' array
        await sockInstance.sendMessage(context.chatId, {
            text: message,
            mentions: participants // Pass all target JIDs here
        });

        logger.info(`[HideTag Cmd] Silent tag message sent for group ${context.chatId}.`);

    } catch (e) {
        logger.error(`[HideTag Cmd] Failed for group ${context.chatId}:`, e);
        await sendReply(context, "⚠️ Silent tag error! Could not fetch group info or send message.");
        await sendErrorToOwner(e, context.msg, context);
    }
}


/**
 * Resets the link violation warning count for a user. (Admin only)
 * @param {object} context The parsed message context.
 * @param {string[]} args Arguments, expecting a mention or JID.
 */
async function handleResetWarn(context, args) {
    if (!context?.isGroup) {
        await sendReply(context,"❌ Group only command.");
        return;
    }
    const target = context.mentions[0] || (args[0] ? sanitizeJid(args[0]) : null);

    if (!target || !target.includes('@s.whatsapp.net')) {
        await sendReply(context,`❓ Mention user or provide their number. Usage: ${config.COMMAND_PREFIX}resetwarn @user`);
        return;
    }

    if (state.userWarnings.has(target)) {
        state.userWarnings.delete(target);
        await sendReply(context,`♻️ Warnings cleared for @${target.split('@')[0]}. Watch ya sef now o!`, [target]);
        logger.info(`[ResetWarn Cmd] Warnings reset for ${target} in ${context.chatId} by ${context.sender}`);
    } else {
        await sendReply(context,`✅ @${target.split('@')[0]} get clean slate already. No warnings found.`, [target]);
    }
}


/**
 * Promotes a user to admin in the group. (Admin only)
 * Requires the bot to be an admin. Uses OWNER_NUMBER config for bot check.
 * @param {object} context The parsed message context.
 * @param {string[]} args Arguments, expecting a mention or JID.
 */
async function handlePromote(context, args) {
     if (!context?.isGroup) {
         await sendReply(context,"❌ Group only command.");
         return;
     }
     const target = context.mentions[0] || (args[0] ? sanitizeJid(args[0]) : null);
     if (!target || !target.includes('@s.whatsapp.net')) {
         await sendReply(context,`❓ Mention user to promote. Usage: ${config.COMMAND_PREFIX}promote @user`);
         return;
     }

    let groupMeta;
    let botParticipant;
    let senderParticipant;
    const ownerJid = sanitizeJid(config.OWNER_NUMBER);
    if (!ownerJid) {
        logger.error("[Promote Cmd] OWNER_NUMBER is not configured or invalid.");
        await sendReply(context, "⚠️ Bot configuration error: Owner number missing.");
        return;
    }
    const botNumericIdFromConfig = ownerJid.split('@')[0];

    // --- Check Permissions ---
    try {
        logger.info(`[Promote Cmd] Fetching metadata for group ${context.chatId} to check permissions...`);
        groupMeta = await sockInstance.groupMetadata(context.chatId);
        const participants = groupMeta?.participants || [];

        logger.info(`[Promote Cmd] Using OWNER_NUMBER to find bot. Searching for Numeric ID: ${botNumericIdFromConfig}`);
        botParticipant = participants.find(p => sanitizeJid(p.id).split('@')[0] === botNumericIdFromConfig);
        logger.info(`[Promote Cmd] Raw Bot Participant Data Found (using OWNER_NUMBER match):`, JSON.stringify(botParticipant, null, 2) || 'Bot JID (from OWNER_NUMBER) not found!');

        const isBotAdmin = botParticipant?.admin === 'admin' || botParticipant?.admin === 'superadmin';
        if (!isBotAdmin) {
            await sendReply(context, `⚠️ Bot no be admin here (Status: ${botParticipant?.admin || 'Not Found'}), cannot promote anyone.`);
            return;
        }
        logger.info(`[Promote Cmd] Bot confirmed as admin.`);

        const senderNumericId = sanitizeJid(context.sender).split('@')[0];
        senderParticipant = participants.find(p => sanitizeJid(p.id).split('@')[0] === senderNumericId);
        const isSenderAdmin = senderParticipant?.admin === 'admin' || senderParticipant?.admin === 'superadmin';
        if (sanitizeJid(context.sender) !== ownerJid && !isSenderAdmin) {
            await sendReply(context, "🔒 Only group admins or the bot owner fit promote members.");
            return;
        }
        logger.debug(`[Promote Cmd] Sender ${context.sender} has permission.`);

    } catch (e) {
        logger.error("[Promote Cmd] Failed get group meta for permission check:", e);
        await sendReply(context, "⚠️ Error getting group info to check permissions.");
        return;
    }
    // --- End Permission Check ---

     // --- Attempt Promotion ---
     try {
         await sockInstance.groupParticipantsUpdate(context.chatId, [target], 'promote');
         await sendReply(context,`👑 Levels change! @${target.split('@')[0]} na admin now. Make dem hear word!`, [target]);
         logger.info(`[Promote Cmd] ${target} promoted in ${context.chatId} by ${context.sender}`);
     } catch (e) {
         logger.error(`[Promote Cmd] Failed for target ${target} in ${context.chatId}:`, e);
         await sendReply(context,`⚠️ Failed promotion for @${target.split('@')[0]}. Maybe they are already admin or error occurred? (Code: ${e.output?.statusCode || 'Unknown'})`, [target]);
         await sendErrorToOwner(e, context.msg, context);
     }
}


/**
 * Demotes an admin back to a regular member. (Admin only)
 * Requires the bot to be an admin. Cannot demote the bot owner. Uses OWNER_NUMBER config for bot check.
 * @param {object} context The parsed message context.
 * @param {string[]} args Arguments, expecting a mention or JID.
 */
async function handleDemote(context, args) {
     if (!context?.isGroup) {
         await sendReply(context,"❌ Group only command.");
         return;
     }
     const target = context.mentions[0] || (args[0] ? sanitizeJid(args[0]) : null);
     if (!target || !target.includes('@s.whatsapp.net')) {
         await sendReply(context,`❓ Mention admin to demote. Usage: ${config.COMMAND_PREFIX}demote @admin`);
         return;
     }

    const ownerJid = sanitizeJid(config.OWNER_NUMBER);
    if (!ownerJid) {
        logger.error("[Demote Cmd] OWNER_NUMBER is not configured or invalid.");
        await sendReply(context, "⚠️ Bot configuration error: Owner number missing.");
        return;
    }
    // --- Prevent Demoting Owner ---
    if (sanitizeJid(target) === ownerJid) {
        await sendReply(context, "⛔ Cannot demote the bot owner. Na Oga patapata!");
        return;
    }
    // --- End Owner Check ---

    let groupMeta;
    let botParticipant;
    let senderParticipant;
    const botNumericIdFromConfig = ownerJid.split('@')[0];

    // --- Check Permissions ---
    try {
        logger.info(`[Demote Cmd] Fetching metadata for group ${context.chatId} to check permissions...`);
        groupMeta = await sockInstance.groupMetadata(context.chatId);
        const participants = groupMeta?.participants || [];

        logger.info(`[Demote Cmd] Using OWNER_NUMBER to find bot. Searching for Numeric ID: ${botNumericIdFromConfig}`);
        botParticipant = participants.find(p => sanitizeJid(p.id).split('@')[0] === botNumericIdFromConfig);
        logger.info(`[Demote Cmd] Raw Bot Participant Data Found (using OWNER_NUMBER match):`, JSON.stringify(botParticipant, null, 2) || 'Bot JID (from OWNER_NUMBER) not found!');

        const isBotAdmin = botParticipant?.admin === 'admin' || botParticipant?.admin === 'superadmin';
        if (!isBotAdmin) {
            await sendReply(context, `⚠️ Bot no be admin here (Status: ${botParticipant?.admin || 'Not Found'}), cannot demote anyone.`);
            return;
        }
        logger.info(`[Demote Cmd] Bot confirmed as admin.`);

        const senderNumericId = sanitizeJid(context.sender).split('@')[0];
        senderParticipant = participants.find(p => sanitizeJid(p.id).split('@')[0] === senderNumericId);
        const isSenderAdmin = senderParticipant?.admin === 'admin' || senderParticipant?.admin === 'superadmin';
        if (sanitizeJid(context.sender) !== ownerJid && !isSenderAdmin) {
            await sendReply(context, "🔒 Only group admins or the bot owner fit demote members.");
            return;
        }
        logger.debug(`[Demote Cmd] Sender ${context.sender} has permission.`);

    } catch (e) {
        logger.error("[Demote Cmd] Failed get group meta for permission check:", e);
        await sendReply(context, "⚠️ Error getting group info to check permissions.");
        return;
    }
    // --- End Permission Check ---

     // --- Attempt Demotion ---
     try {
         await sockInstance.groupParticipantsUpdate(context.chatId, [target], 'demote');
         await sendReply(context,`🧑‍💼 @${target.split('@')[0]} don return normal level. No more admin powers!`, [target]);
         logger.info(`[Demote Cmd] ${target} demoted in ${context.chatId} by ${context.sender}`);
     } catch (e) {
         logger.error(`[Demote Cmd] Failed for target ${target} in ${context.chatId}:`, e);
         await sendReply(context,`⚠️ Failed demotion for @${target.split('@')[0]}. Maybe they weren't admin or error occurred? (Code: ${e.output?.statusCode || 'Unknown'})`, [target]);
         await sendErrorToOwner(e, context.msg, context);
     }
}


/**
 * Sends a broadcast message (text or replied-to media with caption) to all groups the bot is in. (Owner only)
 * v3: Fixes media detection in replies; Uses downloadContentFromMessage.
 * @param {object} context The parsed message context.
 * @param {string[]} args The text content (used as message or caption).
 */
async function handleBroadcast(context, args) { // <<< FUNCTION START BRACE {
    // 1. Check Permissions
    if (!context || !isAdmin(context.sender)) {
        await sendReply(context, "🔒 Owner only command!");
        return;
    }

    // 2. Determine Content Type & Data
    let messageArgsText = args.join(' ');
    let mediaBuffer = null;
    let mediaType = null; // 'image' or 'video'
    let mediaMessageData = null; // Holds the specific media object
    let caption = messageArgsText; // Default caption

    // Wrap main logic in outer try/catch
    try { // <<< OUTER TRY START BRACE {

        // --- Check for Replied Media (Revised Check) ---
        if (context.isReply && context.msg?.message?.contextInfo?.quotedMessage) {
            const quotedInfo = context.msg.message.contextInfo.quotedMessage;
            logger.debug(`[Broadcast Cmd v3] Detected reply. Checking quotedMessage keys: [${Object.keys(quotedInfo).join(', ')}]`);

            if (quotedInfo.imageMessage) {
                mediaType = 'image';
                mediaMessageData = quotedInfo.imageMessage;
                logger.info(`[Broadcast Cmd v3] Image reply detected.`);
            } else if (quotedInfo.videoMessage) {
                mediaType = 'video';
                mediaMessageData = quotedInfo.videoMessage;
                logger.info(`[Broadcast Cmd v3] Video reply detected.`);
            }
            // Add checks for other media types if needed

            if (mediaType && mediaMessageData) {
                logger.info(`[Broadcast Cmd v3] Attempting download for ${mediaType}...`);
                // Inner try specifically for download
                try { // <<< INNER DOWNLOAD TRY START BRACE {
                    const mediaStream = await baileysPkg.downloadContentFromMessage(
                        mediaMessageData, mediaType
                    );
                    mediaBuffer = Buffer.from([]);
                    for await (const chunk of mediaStream) {
                        mediaBuffer = Buffer.concat([mediaBuffer, chunk]);
                    }
                    if (!mediaBuffer || mediaBuffer.length === 0) throw new Error("Download resulted in empty buffer.");
                    logger.info(`[Broadcast Cmd v3] Media (${mediaType}) downloaded successfully.`);
                } catch (downloadError) { // <<< INNER DOWNLOAD CATCH START BRACE {
                    logger.error(`[Broadcast Cmd v3] Failed to download replied ${mediaType}: ${downloadError.message}`);
                    await sendReply(context, `⚠️ Failed to download the replied ${mediaType} for broadcast. Aborting.`);
                    return; // Stop if download fails
                } // <<< INNER DOWNLOAD CATCH END BRACE }

            } else {
                 logger.warn(`[Broadcast Cmd v3] Reply did not contain supported media. Broadcasting text args only.`);
                 if (!messageArgsText) {
                     await sendReply(context,"❌ Broadcast text cannot be empty when not replying to compatible media.");
                     return;
                 }
            }
        } else if (!messageArgsText) {
             await sendReply(context,"❌ Broadcast message cannot be empty. Provide text or reply to image/video.");
             return;
        }
        // --- End Content Determination ---


        // 3. Fetch Group List
        let groupList = [];
        // Inner try block for fetching groups might be safer
        try { // <<< INNER GROUP FETCH TRY START BRACE {
            groupList = await fetchAllGroupJids();
            if (groupList.length === 0) {
                 await sendReply(context,"🏜️ Bot is not in any groups to broadcast to.");
                 return;
             }
        } catch(e) { // <<< INNER GROUP FETCH CATCH START BRACE {
            logger.error(`[Broadcast Cmd v3] Failed fetching group list: ${e.message}`)
            await sendReply(context,"⚠️ Could not get group list.");
            return;
        } // <<< INNER GROUP FETCH CATCH END BRACE }
        // --- End Fetch Group List ---


        // 4. Prepare and Send Broadcast Loop
        const broadcastPrefix = `📢 *${config.BOT_NAME} Broadcast* 📢\n\n`;
        let successCount = 0, failCount = 0;
        const totalGroups = groupList.length;
        const feedbackIntro = `🚀 Broadcasting ${mediaType || 'text'}... to ${totalGroups} groups...`;
        const feedbackMsg = await sendReply(context, feedbackIntro);

        for (const groupId of groupList) { // FOR LOOP START {
            try { // <<< INNER SEND TRY START BRACE {
                let messagePayload;
                if (mediaType && mediaBuffer) { // Send Media
                    messagePayload = { [mediaType]: mediaBuffer, caption: broadcastPrefix + caption };
                } else { // Send Text
                    messagePayload = { text: broadcastPrefix + messageArgsText };
                }
                await sockInstance.sendMessage(groupId, messagePayload);
                successCount++;
                await new Promise(resolve => setTimeout(resolve, 1700 + Math.random() * 1000)); // Delay
            } catch (e) { // <<< INNER SEND CATCH START BRACE {
                failCount++;
                logger.error(`[Broadcast Cmd v3] Failed broadcast to ${groupId}: ${e.message}`);
                await sendErrorToOwner(new Error(`Broadcast failed for group ${groupId}: ${e.message}`), context.msg, context);
            } // <<< INNER SEND CATCH END BRACE }
        } // <<< FOR LOOP END BRACE }

        // 5. Delete Feedback & Report Result
        if (feedbackMsg?.key) {
             await sockInstance.sendMessage(context.chatId, { delete: feedbackMsg.key }).catch(delErr => logger.warn(`[Broadcast Cmd v3] Failed to delete feedback msg: ${delErr.message}`));
        }
        const summary = `*Broadcast Report*:\n────────────────────\nSuccessfully sent to: ${successCount}\nFailed for: ${failCount}`;
        await sendReply(context, summary);
        logger.info(`[Broadcast Cmd v3] Broadcast complete. ${summary.replace(/\n/g, ' ')}`);

    } catch (error) { // <<< OUTER CATCH START BRACE { - THIS IS LIKELY LINE ~2390
        // Catch errors from overall handler logic (e.g., permission checks before try, unexpected errors)
        logger.error(`[Broadcast Cmd v3] Overall handler failed unexpectedly:`, error);
        // Avoid sending generic reply if specific ones were sent, maybe check error source?
        // For now, just log and report to owner.
        // await sendReply(context, "⚠️ An unexpected error occurred during broadcast.");
        await sendErrorToOwner(error, context.msg, context);
    } // <<< OUTER CATCH END BRACE }

} // <<< FUNCTION END BRACE } - ENSURE THIS IS PRESENT! 


/**
 * Displays or modifies bot settings for the current group. (Admin only)
 * @param {object} context The parsed message context.
 * @param {string[]} args Command arguments ([setting_name] [on/off]).
 */
async function handleGroupSettings(context, args) {
    if(!context || !context.isGroup) {
        await sendReply(context,"❌ This command only works in groups.");
        return;
    }

    const settings = getGroupSettings(context.chatId);

    if (args.length === 0) {
        const settingsText = `⚙️ *Settings for this Group* ⚙️\n────────────────────\n` +
             ` • AI Listening (\`${config.COMMAND_PREFIX}settings ai [on/off]\`): ${settings.aiEnabled ? '✅ ON' : '❌ OFF'} (Responds if mentioned/replied)\n` +
             ` • Welcome Msgs (\`${config.COMMAND_PREFIX}settings welcome [on/off]\`): ${settings.welcomeEnabled ? '✅ ON' : '❌ OFF'}\n` +
             ` • Goodbye Msgs (\`${config.COMMAND_PREFIX}settings goodbye [on/off]\`): ${settings.goodbyeEnabled ? '✅ ON' : '❌ OFF'}\n` +
             ` • Spam Filter (\`${config.COMMAND_PREFIX}settings spam [on/off]\`): ${settings.spamFilter ? '✅ ON' : '❌ OFF'}\n` +
             ` • Link Protect (\`${config.COMMAND_PREFIX}settings links [on/off]\`): ${settings.linkProtection ? '✅ ON' : '❌ OFF'}\n` +
             `────────────────────\nUse commands shown to change settings.`;
        await sendReply(context, settingsText.trim());
        return;
    }

    const option = args[0]?.toLowerCase();
    const value = args[1]?.toLowerCase();

    if (value !== 'on' && value !== 'off') {
        await sendReply(context,`❓ Invalid value "${value}". Please use 'on' or 'off'.`);
        return;
    }

    const newState = (value === 'on');
    let settingKey = null;
    let settingName = '';

    switch (option) {
        case 'ai': settingKey = 'aiEnabled'; settingName = 'AI Listening'; break;
        case 'welcome': settingKey = 'welcomeEnabled'; settingName = 'Welcome Messages'; break;
        case 'goodbye': settingKey = 'goodbyeEnabled'; settingName = 'Goodbye Messages'; break;
        case 'spam': settingKey = 'spamFilter'; settingName = 'Spam Filter'; break;
        case 'links': settingKey = 'linkProtection'; settingName = 'Link Protection'; break;
        default:
            await sendReply(context,`❓ Unknown setting '${option}'. Use \`${config.COMMAND_PREFIX}settings\` to see available options.`);
            return;
    }

    if (settings[settingKey] === newState) {
        await sendReply(context,`✅ ${settingName} is already ${newState ? 'ON' : 'OFF'}.`);
        return;
    }

    settings[settingKey] = newState;
    state.groupSettings.set(context.chatId, settings);

    await sendReply(context,`🔧 ${settingName} updated to: ${newState ? 'ON ✅' : 'OFF ❌'}.`);
    logger.info(`[Settings Cmd] Group setting '${settingKey}' set to ${newState} in ${context.chatId} by ${context.sender}`);
}


/**
 * Handles the !rank command. Calculates and displays the user's rank, level, XP,
 * and role title within the current group, using data from Supabase.
 * v5 Supabase: Fetches group data in batches to avoid header overflow.
 * @param {object} context Parsed message context
 * @param {string[]} args Command arguments (not used)
 */
async function handleRankCommand(context, args) {
    if (!context.isGroup) { /* ... */ return; }
    const senderJid = context.sender;
    const chatId = context.chatId;
    const defaultRole = LEVEL_ROLES[0]?.title || 'N/A';
    const logPrefix = "[Rank Cmd Supabase v5]"; // Version bump

    if (!supabase) { /* ... handle no supabase client ... */ return; }

    logger.info(`${logPrefix} Rank requested by ${senderJid} in group ${chatId}`);
    await sendReply(context, "⏳ Calculating group rankings (batch fetch)...");

    try {
        const metadata = await sockInstance.groupMetadata(chatId);
        const participants = metadata?.participants || [];
        const groupName = metadata.subject || 'This Group';
        if (participants.length === 0) { /* ... */ return; }

        const participantJids = participants.map(p => sanitizeJid(p.id)).filter(jid => !!jid);

        // --- Fetch Data in Batches ---
        const BATCH_SIZE = 100; // How many users to fetch per Supabase request (adjust if needed)
        let allGroupUsersData = [];
        logger.debug(`${logPrefix} Starting batch fetch for ${participantJids.length} participants... Batch size: ${BATCH_SIZE}`);

        for (let i = 0; i < participantJids.length; i += BATCH_SIZE) {
            const batchJids = participantJids.slice(i, i + BATCH_SIZE);
            logger.debug(`${logPrefix} Fetching batch ${Math.floor(i / BATCH_SIZE) + 1}... JIDs: ${batchJids.length}`);
            const { data: batchData, error: batchError } = await supabase
                .from('users_data')
                .select('user_id, xp, level, title')
                .in('user_id', batchJids);

            if (batchError) {
                // Log the specific error for this batch
                logger.error(`${logPrefix} Supabase batch fetch error:`, JSON.stringify(batchError, null, 2));
                throw new Error(`Supabase batch fetch error: ${batchError.message} (Code: ${batchError.code})`);
            }
            if (batchData) {
                allGroupUsersData = allGroupUsersData.concat(batchData);
            }
            // Optional small delay between batches if needed, but likely unnecessary
            // await delay(50);
        }
        logger.info(`${logPrefix} Finished batch fetch. Total records retrieved: ${allGroupUsersData.length}`);
        // --- End Batch Fetch ---


        // Create a map for easy lookup: { userId -> dbData }
        const dbDataMap = new Map();
        allGroupUsersData.forEach(u => dbDataMap.set(u.user_id, u));

        // Create ranked list (same logic as before, using dbDataMap)
        const rankedUsers = participants.map(p => {
            const jid = sanitizeJid(p.id);
            const dbUser = dbDataMap.get(jid);
            const level = dbUser?.level || 0;
            const xp = dbUser?.xp || 0;
            const title = dbUser?.title || getTitleForLevel(level) || defaultRole;
            const score = (level * 10000) + xp;
            return { jid, level, xp, title, score };
        }).filter(u => u.jid);

        // Sort users
        rankedUsers.sort((a, b) => b.score - a.score);

        // Find sender's rank (same logic as before)
        let senderRank = -1;
        let senderDataFromList = null;
        // ... (loop to find senderRank and senderDataFromList) ...
         for (let i = 0; i < rankedUsers.length; i++) {
            if (rankedUsers[i].jid === senderJid) {
                senderRank = i + 1;
                senderDataFromList = rankedUsers[i];
                break;
            }
        }


        // Handle if sender not found / format reply (same logic as before)
        if (senderRank === -1 || !senderDataFromList) {
             // ... (handle fallback display) ...
             const requiredXP = getRequiredXP(0); // Use level 0 for default XP
             const fallbackReply = `*🏆 Your Rank in ${groupName.toUpperCase()}*\n... Position: *Unknown* ... Title: *${defaultRole}* ... Level: 0 ... XP: 0 / ${requiredXP} ...`;
             await sendReply(context, fallbackReply.trim());
             return;
        }

        const requiredXP = getRequiredXP(senderDataFromList.level);
        const replyText = `*🏆 Your Rank in ${groupName.toUpperCase()}*\n` +
                          `────────────────────\n` +
                          ` • Position: *#${senderRank}* / ${rankedUsers.length} members\n` +
                          ` • Title: *${senderDataFromList.title}*\n` +
                          ` • Level: ${senderDataFromList.level}\n` +
                          ` • XP: ${senderDataFromList.xp} / ${requiredXP}\n` +
                          `────────────────────`;

        await sendReply(context, replyText.trim());
        logger.info(`${logPrefix} Sent rank info for ${senderJid} (Rank ${senderRank})`);

    } catch (error) { // Catch errors from the try block
        logger.error(`${logPrefix} CRITICAL FAILURE for ${senderJid} in ${chatId}:`, { /* ... detailed error logging ... */ });
        await sendReply(context, "⚠️ An error occurred while calculating rank (Supabase).");
        await sendErrorToOwner(new Error(`Supabase Error in !rank for ${senderJid}: ${error.message}`), context.msg, context);
    }
}



/**
 * Responds with 'Pong!' and the bot's uptime.
 * @param {object} context The parsed message context.
 */
async function handlePing(context) {
    if (!context) return;
    const startTime = botStartTime || Date.now();
    const uptimeMs = Date.now() - startTime;
    const hours = Math.floor(uptimeMs / 3600000);
    const minutes = Math.floor((uptimeMs % 3600000) / 60000);
    const seconds = Math.floor((uptimeMs % 60000) / 1000);
    const uptimeString = `${hours}h ${minutes}m ${seconds}s`;
    const replyText = `*Pong!* ⚡\n_System online._\n_Uptime: ${uptimeString}_`;
    await sendReply(context, replyText);
    logger.info(`[Ping Cmd] Responded to ping from ${context.sender}. Uptime: ${uptimeString}`);
}


// --- Feedback Command Handlers ---

/**
 * Stores user feedback.
 * @param {object} context The parsed message context.
 * @param {string[]} args The feedback message content.
 */
async function handleFeedback(context, args) {
    if (!context) return;
    if (!args?.length) {
        await sendReply(context, `❓ Wetin be the feedback? Use like:\n${config.COMMAND_PREFIX}feedback Bot dey try well well!`);
        return;
    }
    const feedbackText = args.join(' ');
    const feedbackEntry = { sender: context.sender, name: context.pushName || 'Unknown User', timestamp: Date.now(), message: feedbackText };
    state.feedback.push(feedbackEntry);
    if (state.feedback.length > MAX_FEEDBACK_MESSAGES) { state.feedback.shift(); }
    logger.info(`[Feedback Cmd] Received feedback from ${context.sender} (${feedbackEntry.name}): "${feedbackText.substring(0, 50)}..."`);
    await sendReply(context, `✅ Sharp! Your feedback don reach Oga. Thanks!`);
}


/**
 * Converts a replied-to sticker message into a JPEG image. (Requires sharp)
 * v10: Final version using direct contextInfo check for detection
 * and downloadContentFromMessage for downloading.
 * @param {object} context Parsed message context
 * @param {string[]} args Command arguments (not used)
 */
async function handleToImage(context, args) {
    logger.info(`[ToImg Cmd v10] === ENTERING handleToImage ===`); // Version bump
    if (!context) { logger.error("[ToImg v10] Context is NULL!"); return; }

    let isReply = false;
    let isQuotedSticker = false;
    let stickerMessageData = null; // To hold the actual sticker message object from contextInfo

    try {
        // --- Detect sticker reply and get the stickerMessage object ---
        isReply = !!context.isReply;
        // Check directly within the command message's contextInfo for the sticker object
        if (isReply && context.msg?.message?.extendedTextMessage?.contextInfo?.quotedMessage?.stickerMessage) {
            isQuotedSticker = true;
            stickerMessageData = context.msg.message.extendedTextMessage.contextInfo.quotedMessage.stickerMessage;
            logger.info(`[ToImg Cmd v10] Sticker detected via direct check. Sticker object obtained.`);
        } else {
            logger.debug(`[ToImg Cmd v10] Not a reply to a sticker (isReply=${isReply}, isQuotedSticker=${isQuotedSticker}).`);
        }
        // --- End detection ---

        // Condition check: Must be a reply AND determined to be a sticker AND we got the data
        if (!isReply || !isQuotedSticker || !stickerMessageData) {
            logger.warn(`[ToImg Cmd v10] Check failed: isReply=${isReply}, isQuotedSticker=${isQuotedSticker}, dataExists=${!!stickerMessageData}. Sending usage message.`);
            await sendReply(context, `❓ Reply to the sticker you want to convert with ${config.COMMAND_PREFIX}toimg`);
            return; // Exit if check fails
        }

        // --- Check passed, proceed with conversion ---
        logger.info(`[ToImg Cmd v10] Initial check passed. Attempting conversion process...`);
        await sendReply(context, "⏳ Converting sticker to image, please wait..."); // Give feedback

        // --- Download using downloadContentFromMessage ---
        logger.debug(`[ToImg Cmd v10] Attempting download using downloadContentFromMessage...`);

        // Use downloadContentFromMessage: takes the object with media keys and the type
        const stickerStream = await baileysPkg.downloadContentFromMessage(
            stickerMessageData, // Pass the object containing url, mediaKey etc.
            'sticker'           // Specify the type as 'sticker'
        );

        // Convert the download stream into a buffer
        let stickerBuffer = Buffer.from([]);
        for await (const chunk of stickerStream) {
            stickerBuffer = Buffer.concat([stickerBuffer, chunk]);
        }

        // Validate download
        if (!stickerBuffer || stickerBuffer.length === 0) {
            throw new Error("Download failed or resulted in empty buffer.");
        }
        logger.debug(`[ToImg Cmd v10] Sticker downloaded successfully via stream, size: ${stickerBuffer.length}`);
        // --- End Download ---


        // --- Perform Conversion ---
        const sharp = (await import('sharp')).default;
        if (typeof sharp !== 'function') { throw new Error("Sharp library failed to load."); }
        logger.debug(`[ToImg Cmd v10] Sharp loaded. Converting...`);

        const imageBuffer = await sharp(stickerBuffer)
            .jpeg({ quality: 90 }) // Convert to JPEG
            .toBuffer();
        logger.debug(`[ToImg Cmd v10] Conversion to JPEG successful, size: ${imageBuffer.length}`);
        // --- End Conversion ---


        // --- Send Result ---
        await sockInstance.sendMessage(context.chatId, {
            image: imageBuffer,
            caption: `✅ Sticker converted to image!`,
            mimetype: 'image/jpeg'
        }, { quoted: context.msg }); // Quote the user's command

        logger.info(`[ToImg Cmd v10] Sticker successfully converted and sent.`);
        // --- End Send Result ---

    } catch (error) { // Catch errors during the process
        logger.error(`[ToImg Cmd v10] Process failed:`, { message: error.message, stack: error.stack?.substring(0, 500) });
        // Send user-friendly error messages
        if (error.message.toLowerCase().includes("sharp") || error.message.toLowerCase().includes("vips")) {
             await sendReply(context, "⚠️ Conversion failed. 'sharp' library issue.");
        } else if (error.message.includes("download") || error.message.includes("buffer") || error.message.includes("stream")) {
             await sendReply(context, "⚠️ Conversion failed: Could not download or process sticker data.");
        } else {
             await sendReply(context, `⚠️ Conversion failed: ${error.message}`); // Generic fallback
        }
        await sendErrorToOwner(error, context.msg, context);
        // Let processCommands handle the final "Wahala dey" message
        throw error; // Re-throw error so processCommands knows it failed
    }
    logger.info(`[ToImg Cmd v10] === FINISHED handleToImage ===`);
}



/**
 * Converts a replied-to image message into a sticker. (Requires sharp)
 * Final Version: Includes image detection, download, and sharp processing.
 * @param {object} context Parsed message context
 * @param {string[]} args Command arguments (not used)
 */
async function handleToSticker(context, args) {
    // Use a version identifier in logs for clarity
    const logPrefix = "[ToSticker Cmd - Final]";
    logger.info(`${logPrefix} === ENTERING handleToSticker ===`);
    if (!context) { logger.error(`${logPrefix} Context is NULL!`); return; }

    let isReply = false;
    let isQuotedImage = false;
    let imageMessageData = null; // To hold the actual imageMessage object from contextInfo

    try {
        // --- Detect if it's a reply to an image using direct check ---
        isReply = !!context.isReply;
        if (isReply && context.msg?.message?.extendedTextMessage?.contextInfo?.quotedMessage?.imageMessage) {
            isQuotedImage = true;
            imageMessageData = context.msg.message.extendedTextMessage.contextInfo.quotedMessage.imageMessage;
            logger.info(`${logPrefix} Image reply detected via direct check. Image object obtained.`);
        } else {
            logger.debug(`${logPrefix} Not a reply to an image (isReply=${isReply}, isQuotedImage=${isQuotedImage}).`);
        }
        // --- End detection ---

        // Condition check
        if (!isReply || !isQuotedImage || !imageMessageData) {
            logger.warn(`${logPrefix} Check failed: isReply=${isReply}, isQuotedImage=${isQuotedImage}, dataExists=${!!imageMessageData}. Sending usage message.`);
            await sendReply(context, `❓ Reply to the image you want to convert with ${config.COMMAND_PREFIX}tosticker`);
            return;
        }

        // --- Check passed, proceed with download and conversion ---
        logger.info(`${logPrefix} Initial check passed. Attempting download & conversion...`);
        await sendReply(context, "⏳ Downloading and converting image to sticker..."); // Feedback

        // --- Download using downloadContentFromMessage ---
        logger.debug(`${logPrefix} Attempting download using downloadContentFromMessage...`);
        const imageStream = await baileysPkg.downloadContentFromMessage(
            imageMessageData, // Pass the object containing url, mediaKey etc.
            'image'           // Specify the type as 'image'
        );

        let imageBuffer = Buffer.from([]);
        for await (const chunk of imageStream) { imageBuffer = Buffer.concat([imageBuffer, chunk]); }

        if (!imageBuffer || imageBuffer.length === 0) throw new Error("Image download failed or resulted in empty buffer.");
        logger.info(`${logPrefix} Image downloaded successfully via stream, size: ${imageBuffer.length} bytes.`);
        // --- End Download ---


        // --- Perform Conversion using Sharp --- // <<< THIS PART IS NOW ACTIVE
        logger.debug(`${logPrefix} Proceeding with Sharp conversion...`);
        const sharp = (await import('sharp')).default;
        if (typeof sharp !== 'function') { throw new Error("Sharp library failed to load. Check Render build logs."); }

        const stickerBuffer = await sharp(imageBuffer)
            .resize(512, 512, { // Resize for sticker compatibility
                fit: 'contain', // Maintain aspect ratio within bounds
                background: { r: 0, g: 0, b: 0, alpha: 0 } // Use transparent background for padding
            })
            .webp({ // Convert to WebP format for stickers
                quality: 90, // Adjust quality vs size
                lossless: false // Lossy often preferred for smaller stickers
            })
            .toBuffer();
        logger.debug(`${logPrefix} Conversion/resize to WebP successful, sticker buffer size: ${stickerBuffer.length}`);
        // --- End Conversion Logic ---


        // --- Send the Sticker ---
        logger.info(`${logPrefix} Sending converted sticker...`);
        await sockInstance.sendMessage(context.chatId, {
             sticker: stickerBuffer
             // Optional: Add sticker metadata (pack/author)
             // pack: config.BOT_NAME || "TonnaBot",
             // author: "Stickerizer"
            }, { quoted: context.msg }); // Quote the user's command message
        logger.info(`${logPrefix} Sticker successfully created and sent.`);
        // --- End Send Sticker ---

        // --- Optional: Delete "Downloading..." message ---
        // (Need to store feedback message key if you want to do this)
        // if (feedbackMsg?.key) { /* ... delete feedbackMsg ... */ }

    } catch (error) { // Catch errors during the process
        logger.error(`${logPrefix} Process failed:`, { message: error.message, stack: error.stack?.substring(0, 500) });
        // Send specific user-friendly error messages
        if (error.message.includes("download") || error.message.includes("buffer") || error.message.includes("stream")) { await sendReply(context, "⚠️ Download failed: Could not download or process image data."); }
        else if (error.message.toLowerCase().includes("sharp") || error.message.toLowerCase().includes("vips")) { await sendReply(context, "⚠️ Conversion failed: There seems to be an issue with the 'sharp' image library on the server."); }
        else if (error.message.includes("not found")) { await sendReply(context, "⚠️ Failed: Could not find the original image message details."); }
        else { await sendReply(context, `⚠️ Failed: ${error.message}`); }
        await sendErrorToOwner(error, context.msg, context);
        // Let processCommands handle the final "Wahala dey" message
        throw error;
    }
    logger.info(`${logPrefix} === FINISHED handleToSticker ===`);
}




/**
 * Awards XP to a user, handles level-ups, and assigns role titles using Supabase.
 * v6 DB Debug: Simplified and more robust error logging in catch block.
 * @param {string} senderJid The JID of the user who sent the message.
 */
async function handleXP(senderJid) {
    const botJid = sanitizeJid(config.BOT_PRIMARY_JID || sockInstance?.user?.id);
    const logPrefix = "[XP Supabase Debug v6]"; // Log prefix for this version

    logger.info(`${logPrefix} handleXP called for ${senderJid}. Bot JID: ${botJid}`);

    if (!senderJid || senderJid === botJid) {
        logger.debug(`${logPrefix} Skipping XP for self/bot: ${senderJid}`);
        return;
    }

    // Check if Supabase client is globally available
    if (!supabase) {
        logger.error(`${logPrefix} CRITICAL: Global 'supabase' client is NULL or not initialized! Cannot process XP.`);
        await sendErrorToOwner(new Error(`${logPrefix} Supabase client NULL for XP processing for ${senderJid}`), null, { sender: senderJid })
            .catch(e => logger.error(`${logPrefix} Failed to send owner notification about null supabase client: ${e.message}`));
        return;
    }
    logger.debug(`${logPrefix} Global 'supabase' client appears to be initialized.`);

    const defaultRole = LEVEL_ROLES[0]?.title || 'Unknown Role';
    let userDataFromDB = null;
    let isNewUserInDB = false;

    try {
        logger.debug(`${logPrefix} Proceeding to Supabase operations for ${senderJid}.`);

        logger.debug(`${logPrefix} Attempting to find user ${senderJid} in 'users_data' table...`);
        const { data: findResult, error: findError } = await supabase
            .from('users_data')
            .select('*')
            .eq('user_id', senderJid)
            .single();

        if (findError) {
            if (findError.code === 'PGRST116') { // "Query returned no rows"
                logger.info(`${logPrefix} User ${senderJid} not found in DB (PGRST116). Will prepare new record.`);
                isNewUserInDB = true;
                userDataFromDB = null;
            } else {
                logger.error(`${logPrefix} Supabase findOne error for ${senderJid}:`, JSON.stringify(findError, null, 2));
                throw new Error(`Supabase find error: ${findError.message} (Code: ${findError.code}, Details: ${findError.details}, Hint: ${findError.hint})`);
            }
        } else {
            userDataFromDB = findResult;
        }

        if (userDataFromDB) {
            logger.debug(`${logPrefix} Found existing user ${senderJid}: Level ${userDataFromDB.level}, XP ${userDataFromDB.xp}, Title ${userDataFromDB.title}`);
        }

        let workingData = {
            xp: userDataFromDB?.xp || 0,
            level: userDataFromDB?.level || 0,
            title: userDataFromDB?.title || getTitleForLevel(userDataFromDB?.level || 0) || defaultRole,
            keyword_counts: userDataFromDB?.keyword_counts || {}
        };
        KEYWORDS_TO_TRACK.forEach(k => {
            if (workingData.keyword_counts[k] === undefined) {
                workingData.keyword_counts[k] = 0;
            }
        });

        const oldXP = workingData.xp;
        const oldLevel = workingData.level;
        const oldTitle = workingData.title;
        workingData.xp += XP_PER_MESSAGE;

        let requiredXP = getRequiredXP(workingData.level);
        let leveledUp = false;
        while (workingData.xp >= requiredXP && requiredXP > 0) {
            workingData.level++;
            workingData.xp -= requiredXP;
            requiredXP = getRequiredXP(workingData.level);
            leveledUp = true;
        }

        if (leveledUp) {
            workingData.title = getTitleForLevel(workingData.level);
            logger.info(`${logPrefix} User ${senderJid} leveled up: ${oldLevel}->${workingData.level}. Title: ${oldTitle}->${workingData.title}. New XP: ${workingData.xp}`);
            try {
                let levelUpMessage = `🎉 *LEVEL UP!* 🎉\nYou've reached **Level ${workingData.level}**!`;
                if (workingData.title !== oldTitle) { levelUpMessage += `\nNew title: *${workingData.title}*! 🏆`; }
                else { levelUpMessage += ` Keep vibing! 🔥`; }
                levelUpMessage += `\nNext level requires ${getRequiredXP(workingData.level)} XP.`;
                if (sockInstance) { await sockInstance.sendMessage(senderJid, { text: levelUpMessage }); }
            } catch (dmError) {
                if (dmError.message?.includes('forbidden') || dmError.output?.statusCode === 403) { logger.warn(`${logPrefix} Failed level up DM to ${senderJid} (possibly blocked).`); }
                else { logger.error(`${logPrefix} Failed to send level up notification to ${senderJid}:`, dmError); }
            }
        }

        const dataToUpsert = {
            user_id: senderJid,
            xp: workingData.xp,
            level: workingData.level,
            title: workingData.title,
            keyword_counts: workingData.keyword_counts,
            updated_at: new Date().toISOString()
        };
        if (isNewUserInDB) {
            dataToUpsert.created_at = new Date().toISOString();
        }

        logger.debug(`${logPrefix} Preparing to upsert user ${senderJid} with data:`, dataToUpsert);
        const { error: upsertError } = await supabase
            .from('users_data')
            .upsert(dataToUpsert, { onConflict: 'user_id' });

        if (upsertError) {
            logger.error(`${logPrefix} Supabase upsertError object for ${senderJid}:`, JSON.stringify(upsertError, null, 2));
            throw new Error(`Supabase upsert error: ${upsertError.message} (Code: ${upsertError.code}, Details: ${upsertError.details}, Hint: ${upsertError.hint})`);
        }
        logger.info(`${logPrefix} User data for ${senderJid} successfully upserted to Supabase.`);

    } catch (error) { // Catches errors from Supabase operations or other logic within this try block
        // --- SIMPLIFIED AND MORE ROBUST ERROR LOGGING ---
        logger.error(`${logPrefix} CRITICAL: Failed to process XP for ${senderJid}.`);
        
        if (error) {
            logger.error(`${logPrefix} Error Name: ${error.name || 'N/A'}`);
            logger.error(`${logPrefix} Error Message: ${error.message || 'N/A'}`);
            if (error.code) logger.error(`${logPrefix} Error Code: ${error.code}`);
            if (error.details) logger.error(`${logPrefix} Error Details: ${error.details}`);
            if (error.hint) logger.error(`${logPrefix} Error Hint: ${error.hint}`);
            
            try {
                logger.error(`${logPrefix} Stringified Error (Partial): ${JSON.stringify(error, Object.getOwnPropertyNames(error)).substring(0, 1000)}`);
            } catch (stringifyError) {
                logger.error(`${logPrefix} Could not stringify the full error object: ${stringifyError.message}`);
            }
            
            logger.error(`${logPrefix} Stack Trace (partial): ${error.stack?.substring(0, 1000) || 'N/A'}`);
        } else {
            logger.error(`${logPrefix} Caught error object was null or undefined in handleXP.`);
        }
        // --- END SIMPLIFIED LOGGING ---

        // Attempt to send error to owner
        sendErrorToOwner(new Error(`Supabase XP processing error for ${senderJid}: ${error?.message || 'Unknown error'}`), null, { sender: senderJid })
            .catch(e => logger.error(`${logPrefix} Failed to send owner notification about XP processing error: ${e.message}`));
    }
} 





/**
 * Handles the !level command, showing the user's current XP, level, and role title from Supabase.
 * Supabase v1: Reads data from Supabase users_data table.
 * @param {object} context Parsed message context
 * @param {string[]} args Command arguments (not used)
 */
async function handleLevelCommand(context, args) {
    const senderJid = context.sender;
    const defaultRole = LEVEL_ROLES[0]?.title || 'N/A'; // Default for level 0
    const logPrefix = "[Level Cmd Supabase]";

    // Check if Supabase client is initialized and ready
    if (!supabase) {
        logger.warn(`${logPrefix} Supabase client not initialized. Cannot fetch level data.`);
        await sendReply(context, "⚠️ Bot is having trouble connecting to the user database. Please try again later.");
        return;
    }

    logger.info(`${logPrefix} Level info requested by ${senderJid}`);
    const feedbackMsg = await sendReply(context, "⏳ Fetching your level from the database..."); // Send feedback

    try {
        // Fetch user's data from Supabase
        const { data: userData, error: findError } = await supabase
            .from('users_data') // Your table name in Supabase
            .select('xp, level, title') // Select only the fields you need
            .eq('user_id', senderJid) // Filter by the sender's JID
            .single(); // Expects to find one row or null (if user is new)

        // Handle potential errors from the Supabase query
        if (findError && findError.code !== 'PGRST116') { // PGRST116 means "Query returned no rows" which is okay for a new user
            logger.error(`${logPrefix} Supabase error fetching user data for ${senderJid}:`, findError);
            throw new Error(`Supabase find user error: ${findError.message} (Code: ${findError.code})`);
        }

        let displayData;
        // If user has no data in DB yet (e.g., new user)
        if (!userData) {
            displayData = {
                xp: 0,
                level: 0,
                title: getTitleForLevel(0) || defaultRole // Use helper to get title for level 0
            };
            logger.debug(`${logPrefix} No data found in Supabase for ${senderJid}, showing defaults.`);
        } else {
            displayData = userData;
            // Ensure title is present, or calculate it if the DB record is old/missing it
            if (!displayData.title) {
                 displayData.title = getTitleForLevel(displayData.level) || defaultRole;
            }
        }

        const { xp, level, title } = displayData;
        const requiredXP = getRequiredXP(level); // XP needed for the *next* level
        const progress = requiredXP > 0 ? ((xp / requiredXP) * 100).toFixed(1) : 100; // Avoid division by zero

        // --- Create Progress Bar ---
        const BAR_LENGTH = 10;
        const filledLength = requiredXP > 0 ? Math.round((xp / requiredXP) * BAR_LENGTH) : BAR_LENGTH;
        const emptyLength = Math.max(0, BAR_LENGTH - filledLength); // Ensure non-negative
        const progressBar = `[${'■'.repeat(filledLength)}${'□'.repeat(emptyLength)}]`;
        // --- End Progress Bar ---

        const replyText = `*📊 Your Stats*\n` +
                          `────────────────────\n` +
                          ` • Title: *${title}*\n` +
                          ` • Level: ${level}\n` +
                          ` • XP: ${xp} / ${requiredXP}\n` +
                          ` • Progress: ${progressBar} (${progress}%)\n` +
                          `────────────────────`;

        // Delete feedback message and send the actual stats
        if (feedbackMsg?.key) {
            await sockInstance.sendMessage(context.chatId, { delete: feedbackMsg.key }).catch(e => logger.warn("Failed to delete feedback msg",e));
        }
        await sendReply(context, replyText.trim());
        logger.info(`${logPrefix} Sent level/title info for ${senderJid}`);

    } catch (error) {
        logger.error(`${logPrefix} Failed to fetch/process level data for ${senderJid}:`, { message: error.message, stack: error.stack?.substring(0,500) });
        if (feedbackMsg?.key) { // Also try to delete feedback on error
            await sockInstance.sendMessage(context.chatId, { delete: feedbackMsg.key }).catch(e => logger.warn("Failed to delete feedback msg on error",e));
        }
        await sendReply(context, "⚠️ An error occurred while fetching your level data from the database.");
        // Send a more specific error to the owner if possible
        await sendErrorToOwner(new Error(`Supabase Error in !level for ${senderJid}: ${error.message}`), context.msg, context);
    }
} 



/**
 * Forwards the replied-to message.
 * Default: Forwards to the current chat.
 * Admin Only: Can forward to 'all groups' or a specific group by name using arguments.
 * Handles various message types including media.
 * @param {object} context Parsed message context (must include quotedMsg)
 * @param {string[]} args Command arguments (e.g., "all groups" or "Group Name")
 */
async function handleForwardMessage(context, args) {
    // Check if it's a reply
    if (!context.isReply || !context.quotedMsg) {
        await sendReply(context, `❓ Please reply to the message you want to forward with ${config.COMMAND_PREFIX}forward [target] \n(Target optional, e.g., 'all groups' or 'Group Name' - Admin Only)`);
        return;
    }
    const msgToForward = context.quotedMsg; // The message object to forward

    // Determine target(s)
    const isAdminUser = isAdmin(context.sender);
    const targetArgString = args.join(' ').trim().toLowerCase();
    let targetJids = [];
    let operationType = 'single_chat'; // Default operation
    let feedbackIntro = "⏳ Forwarding message in this chat..."; // Default feedback

    // --- Admin-Only Broadcast/Targeting Logic ---
    if (isAdminUser && targetArgString === 'all groups') {
        operationType = 'all_groups';
        logger.info(`[Forward Cmd] Admin ${context.sender} requested broadcast forward to all groups.`);
        targetJids = await fetchAllGroupJids(); // Fetch all group JIDs (Helper function below)
        if (!targetJids || targetJids.length === 0) {
            await sendReply(context, "⚠️ Could not fetch group list or bot is not in any groups.");
            return;
        }
        feedbackIntro = `⏳ Preparing to forward to ${targetJids.length} groups... (Admin Broadcast)`;
    } else if (isAdminUser && targetArgString.length > 0) {
        // Assume argument is a group name if not 'all groups'
        operationType = 'named_group';
        const groupNameQuery = args.join(' '); // Use original case args for query display
        logger.info(`[Forward Cmd] Admin ${context.sender} requested forward to group matching name: "${groupNameQuery}"`);
        const matchedGroups = await findGroupJidByName(groupNameQuery); // Find group JIDs by name (Helper function below)

        if (!matchedGroups || matchedGroups.length === 0) {
            await sendReply(context, `⚠️ Could not find any group with name containing "${groupNameQuery}".`);
            return;
        }
        if (matchedGroups.length > 1) {
            // Optional: Handle multiple matches - for now, just use the first one found.
            logger.warn(`[Forward Cmd] Multiple groups found matching "${groupNameQuery}". Forwarding to the first: ${matchedGroups[0]}`);
            await sendReply(context, `⚠️ Found multiple groups matching "${groupNameQuery}". Forwarding to the first one found: ${matchedGroups[0]}.`); // Inform admin
        }
        targetJids = [matchedGroups[0]]; // Use only the first match for now
        feedbackIntro = `⏳ Preparing to forward to group "${groupNameQuery}" (JID: ${targetJids[0]})...`;
    } else {
        // Default: Forward to current chat (if user is not admin or provided no specific target args)
        operationType = 'single_chat';
        targetJids = [context.chatId]; // Target is just the current chat
        if (targetArgString.length > 0 && !isAdminUser) {
            // Non-admin tried to specify target - ignore and default to current chat
            logger.warn(`[Forward Cmd] Non-admin ${context.sender} attempted targeted forward. Defaulting to current chat.`);
             await sendReply(context, "ℹ️ Forward target ignored (Admin Only). Forwarding to current chat.");
        }
    }
    // --- End Target Determination ---

    // Give user feedback
    const feedbackMsg = await sendReply(context, feedbackIntro);
    logger.info(`[Forward Cmd] Operation: ${operationType}. Target JIDs count: ${targetJids.length}. Initiated by: ${context.sender}`);


    // --- Execute Forwarding ---
    let successCount = 0;
    let failCount = 0;
    const totalTargets = targetJids.length;

    for (const targetJid of targetJids) {
        try {
            // Forward the original quoted message object
            await sockInstance.forwardMessage(targetJid, msgToForward, { /* options */ });
            successCount++;
            logger.info(`[Forward Cmd] Forwarded msg ${context.quotedMsgKey} to ${targetJid} (${successCount}/${totalTargets})`);
            // Add delay for broadcasts to avoid spam flags
            if (totalTargets > 1) {
                await new Promise(resolve => setTimeout(resolve, 1500 + Math.random() * 1000)); // Delay ~1.5-2.5s
            }
        } catch (error) {
            failCount++;
            logger.error(`[Forward Cmd] Failed to forward msg ${context.quotedMsgKey} to ${targetJid}:`, error);
            // Consider notifying owner only if it's a broadcast failure?
            if (operationType !== 'single_chat') {
                await sendErrorToOwner(new Error(`Broadcast forward failed for ${targetJid}: ${error.message}`), context.msg, context);
            }
        }
    }
    // --- End Forwarding Execution ---


    // --- Report Result ---
    // Delete "Preparing..." message first
     if (feedbackMsg?.key) {
            await sockInstance.sendMessage(context.chatId, { delete: feedbackMsg.key }).catch(delErr => logger.warn(`[Forward Cmd] Failed to delete feedback message: ${delErr.message}`));
     }

    let finalReply = '';
    if (operationType === 'single_chat') {
        if (successCount === 1) { finalReply = `✅ Message forwarded successfully in this chat.`; }
        else { finalReply = `⚠️ Failed to forward message in this chat. Check logs.`; }
    } else { // Broadcast/Named Group Report
        finalReply = `*Forward Report (${operationType})*:\n────────────────────\n` +
                     `Successfully sent to: ${successCount} group(s)\n` +
                     `Failed for: ${failCount} group(s)`;
        if (failCount > 0) { finalReply += `\n(Check bot logs or ask owner for details on failures)`; }
    }
    await sendReply(context, finalReply);
    // --- End Report Result ---
}


/**
 * Handles the !pray command. Generates a dramatic/funny prayer for the user using AI.
 * @param {object} context Parsed message context
 * @param {string[]} args Command arguments (potentially a topic later, unused now)
 */
async function handlePrayerCommand(context, args) {
    const senderJid = context.sender;
    const senderName = context.pushName || senderJid.split('@')[0]; // Get name/number for prompt
    const topic = args.join(' ').trim(); // Optional topic for prayer

    logger.info(`[Prayer Cmd] Prayer requested by ${senderJid} ${topic ? 'about ' + topic : ''}`);
    await sendReply(context, `🙏 Connecting to the spiritual realm for @${senderJid.split('@')[0]}... Please wait... ✨`, [senderJid]);


    // --- Prepare Prompt for AI ---
    // Instruct AI to act as TonnaBot Prayer Warrior
    let prayerPrompt = `You are TonnaBot (${config.BOT_NAME}), currently in Prayer Warrior Mode. A user, ${senderName} (@${senderJid.split('@')[0]}), has requested prayers.`;
    if (topic) {
        prayerPrompt += ` The specific topic is "${topic}".`;
    } else {
        prayerPrompt += ` Generate a general, slightly dramatic, funny, and encouraging prayer for them, Nigerian style.`;
    }
    prayerPrompt += ` Address them directly using @${senderJid.split('@')[0]}. Mix English and Pidgin. Keep it short to medium length. Examples: "Father Lord, pipeline for blessings suppose burst for @User 's head!", "Any monitoring spirit assigned against @User, catch fire!", "O Lord, give @User divine alert wey pass their salary!"`;
    // --- End Prompt ---

    try {
        const result = await aiModel.generateContent(prayerPrompt);
        const response = result.response;

        // Validate response
        if (!response) { throw new Error('No response received from AI model.'); }
        if (response.promptFeedback?.blockReason) { throw new Error(`AI request blocked due to: ${response.promptFeedback.blockReason}`); }
        const prayerText = response.text().trim();
        if (!prayerText) { throw new Error("AI returned empty text."); }

        logger.info(`[Prayer Cmd] Sending prayer to ${senderJid}.`);
        // Send the generated prayer, mentioning the user
        await sockInstance.sendMessage(context.chatId, {
            text: `🛐 **Prayer Transmission for @${senderJid.split('@')[0]}** 🛐\n\n${prayerText}`,
            mentions: [senderJid]
        }, { quoted: context.msg });


    } catch (error) {
        logger.error(`[Prayer Cmd] Failed for ${senderJid}:`, error);
        if (error.message.includes("AI request blocked")) { await sendReply(context, `⚠️ Heavenly network busy! AI refused prayer request: ${error.message.split(': ').pop()}`); }
        else if (error.message.includes("AI returned empty text")) { await sendReply(context, "😅 Angels dey offline... couldn't generate prayer."); }
        else { await sendReply(context, `⚠️ Error during prayer generation: ${error.message}`); }
        await sendErrorToOwner(error, context.msg, context);
        throw error;
    }
}



/**
 * Lists group members currently detected as 'available' (online).
 * Requires presence updates to be received.
 * @param {object} context Parsed message context
 * @param {string[]} args Command arguments (not used)
 */
/**
 * Lists group members currently online with enhanced detection
 */
async function handleListOnline(context, args) {
    if (!context.isGroup) {
        await sendReply(context, "❌ This command only works in groups.");
        return;
    }

    logger.info(`[ListOnline Cmd] Requested by ${context.sender} in ${context.chatId}`);
    
    try {
        const metadata = await sockInstance.groupMetadata(context.chatId);
        const participants = metadata?.participants || [];
        const now = Date.now();
        
        // Enhanced online detection parameters
        const ONLINE_THRESHOLD = 5 * 60 * 1000; // 5 minutes
        const validStatuses = new Set(['available', 'composing', 'recording']);
        
        const onlineMembers = participants.filter(p => {
            const userData = state.onlineUsers.get(sanitizeJid(p.id)) || {};
            return validStatuses.has(userData.status) && 
                   (now - (userData.lastSeen || 0)) < ONLINE_THRESHOLD;
        });

        // Build response with privacy-safe mentions
        let replyText = `👥 *REAL-TIME PRESENCE IN ${metadata.subject?.toUpperCase() || 'THIS GROUP'}*\n`;
        replyText += `🕒 Updated: ${new Date().toLocaleTimeString()}\n────────────────────\n`;
        
        if (onlineMembers.length > 0) {
            replyText += onlineMembers.map((m, i) => {
                const userJid = sanitizeJid(m.id);
                const userData = state.onlineUsers.get(userJid) || {};
                const statusIcon = userData.status === 'composing' ? '✍️' : 
                                userData.status === 'recording' ? '🎙️' : '🟢';
                return `${i+1}. ${statusIcon} @${userJid.split('@')[0]}`;
            }).join('\n');
            
            replyText += `\n────────────────────\n✅ Active: ${onlineMembers.length}`;
        } else {
            replyText += "\nNo active members detected\n(Status updates refresh every 2-5 minutes)";
        }

        // Send with smart mentions
        await sockInstance.sendMessage(context.chatId, {
            text: replyText,
            mentions: onlineMembers.map(m => sanitizeJid(m.id))
        }, { quoted: context.msg });

        logger.info(`[ListOnline] Reported ${onlineMembers.length} online in ${context.chatId}`);

    } catch (error) {
        logger.error(`[ListOnline] Error: ${error.message}`);
        await sendReply(context, "⚠️ Couldn't fetch presence data. Try again later.");
    }
}



/**
 * Handles the hidden '$$punish' command. Adds user to punished list.
 * Sends confirmation DM to owner.
 * @param {object} context The message context.
 * @param {string} targetJid The JID of the user to punish.
 * @param {number} [durationMinutes=30] Duration of punishment in minutes.
 */
async function handleGodPunish(context, targetJid, durationMinutes = 30) {
    const ownerJid = context.sender; // The owner who triggered the command

    if (!targetJid || !targetJid.includes('@s.whatsapp.net')) {
        logger.warn(`[God Mode Punish] Invalid target JID received: ${targetJid}`);
        try { await sockInstance.sendMessage(ownerJid, { text: " G Mode Error: Invalid target for punish." }); } catch {}
        return;
    }

    // Optional: Prevent punishing owner or bot?
    if (targetJid === ownerJid || targetJid === sanitizeJid(config.BOT_PRIMARY_JID)) {
        logger.warn(`[God Mode Punish] Attempt to punish self/bot (${targetJid}) denied.`);
         try { await sockInstance.sendMessage(ownerJid, { text: " G Mode Info: Cannot punish self or the bot." }); } catch {}
        return;
    }

    const endTime = Date.now() + durationMinutes * 60 * 1000;
    state.punishedUsers.set(targetJid, endTime); // Add target JID and end timestamp to map

    const endDate = new Date(endTime).toLocaleTimeString('en-GB');
    const targetNum = targetJid.split('@')[0];

    logger.info(`[God Mode Punish] User ${targetJid} punished by ${ownerJid} until ${endDate} (${durationMinutes} mins).`);

    // Send confirmation DM to owner
    try {
        await sockInstance.sendMessage(ownerJid, {
            text: ` G Mode Confirmation:\nUser @${targetNum} has been put in timeout for ${durationMinutes} minutes (until ${endDate}).\nBot will ignore their messages.`,
            mentions: [targetJid] // Mention target in DM to owner
        });
    } catch (e) {
         logger.error(`[God Mode Punish] Failed to send confirmation DM to owner ${ownerJid}: ${e.message}`);
    }
}



/**
 * Handles the hidden '$$bless' command. Silently adds XP to a user.
 * Sends confirmation DM to owner and optionally to the blessed user.
 * @param {object} context The message context.
 * @param {string} targetJid The JID of the user to bless.
 * @param {number} [xpAmount=100] The amount of XP to add.
 */
async function handleGodBless(context, targetJid, xpAmount = 100) {
    const ownerJid = context.sender; // Owner who triggered command

    // Validate Target and Amount
    if (!targetJid || !targetJid.includes('@s.whatsapp.net')) {
        logger.warn(`[God Mode Bless] Invalid target JID: ${targetJid}`);
        try { await sockInstance.sendMessage(ownerJid, { text: " G Mode Error: Invalid target for bless." }); } catch {}
        return;
    }
    if (isNaN(xpAmount) || xpAmount <= 0) {
        logger.warn(`[God Mode Bless] Invalid XP amount: ${xpAmount}. Defaulting to 100.`);
        xpAmount = 100; // Default to 100 if invalid amount given
    }

    // Optional: Prevent blessing owner or bot?
    if (targetJid === ownerJid || targetJid === sanitizeJid(config.BOT_PRIMARY_JID)) {
         logger.warn(`[God Mode Bless] Attempt to bless self/bot (${targetJid}) ignored.`);
         try { await sockInstance.sendMessage(ownerJid, { text: " G Mode Info: Cannot bless self or the bot directly." }); } catch {}
        return;
    }

    // Ensure user exists in level data, initialize if not
    const defaultRole = LEVEL_ROLES[0]?.title || 'N/A';
    if (!state.levelData[targetJid]) {
        state.levelData[targetJid] = { xp: 0, level: 0, title: defaultRole };
    }
    // Ensure title exists if loading old data
    if (!state.levelData[targetJid].title) {
         state.levelData[targetJid].title = getTitleForLevel(state.levelData[targetJid].level) || defaultRole;
    }

    // Add XP
    state.levelData[targetJid].xp += xpAmount;
    const targetNum = targetJid.split('@')[0];
    logger.info(`[God Mode Bless] Added ${xpAmount} XP to ${targetJid} by owner ${ownerJid}. New XP: ${state.levelData[targetJid].xp}`);

    // --- Send Notifications ---
    // Confirmation DM to Owner
    try {
        await sockInstance.sendMessage(ownerJid, {
            text: ` G Mode Confirmation:\nBlessed @${targetNum} with +${xpAmount} XP.\nTheir new total XP is ${state.levelData[targetJid].xp}. (Level up check will happen on their next message).`,
            mentions: [targetJid]
        });
    } catch (e) { logger.error(`[God Mode Bless] Failed to send confirmation DM to owner: ${e.message}`); }

    // Optional: DM the blessed user
    try {
        await sockInstance.sendMessage(targetJid, { text: `✨ You have been blessed! +${xpAmount} XP awarded by the Bot Overlord! ✨` });
        logger.info(`[God Mode Bless] Sent blessing notification to user ${targetJid}.`);
    } catch (e) { logger.warn(`[God Mode Bless] Failed to send blessing DM to user ${targetJid} (maybe blocked?): ${e.message}`); }
    // --- End Notifications ---

    // Note: We don't call handleXP here to avoid immediate level up message.
    // The level up will happen naturally when the blessed user next sends a message.
    // We also don't save data here; periodic save will handle it.
} 




/**
 * Handles the hidden '$$unpunish' command. Removes user from punished list.
 * Sends confirmation DM to owner.
 * @param {object} context The message context.
 * @param {string} targetJid The JID of the user to unpunish.
 */
async function handleGodUnpunish(context, targetJid) {
    const ownerJid = context.sender;

    if (!targetJid || !targetJid.includes('@s.whatsapp.net')) {
        logger.warn(`[God Mode Unpunish] Invalid target JID: ${targetJid}`);
        try { await sockInstance.sendMessage(ownerJid, { text: " G Mode Error: Invalid target for unpunish." }); } catch {}
        return;
    }

    // Check if user is actually punished
    if (state.punishedUsers.has(targetJid)) {
        state.punishedUsers.delete(targetJid); // Remove them from the map
        const targetNum = targetJid.split('@')[0];
        logger.info(`[God Mode Unpunish] User ${targetJid} unpunished by owner ${ownerJid}.`);
        // Send confirmation DM to owner
        try {
            await sockInstance.sendMessage(ownerJid, {
                 text: ` G Mode Confirmation:\nPunishment lifted for @${targetNum}. They can now interact with the bot again.`,
                 mentions: [targetJid]
                });
        } catch (e) { logger.error(`[God Mode Unpunish] Failed confirmation DM to owner: ${e.message}`); }
    } else {
        // User wasn't punished
        logger.info(`[God Mode Unpunish] User ${targetJid} was not on the punishment list.`);
         try { await sockInstance.sendMessage(ownerJid, { text: ` G Mode Info: User @${targetJid.split('@')[0]} is not currently punished.`, mentions: [targetJid]}); } catch {}
    }
     // No save needed here, map modified in memory. Periodic save handles persistence.
} 


/**
 * Handles the !ghostwrite command. Uses AI to generate text based on user request.
 * Example: !ghostwrite roast about Man U fans
 * Example: !ghostwrite compliment for my friend @mention
 * Example: !ghostwrite excuse for being late to meeting
 * @param {object} context Parsed message context
 * @param {string[]} args The user's request (e.g., "roast about exams", "poem for crush")
 */
async function handleGhostwriteCommand(context, args) {
    const senderJid = context.sender;
    const requestText = args.join(' ').trim();

    if (!requestText) {
        await sendReply(context, `❓ What do you want me to ghostwrite? \nExample: ${config.COMMAND_PREFIX}ghostwrite short compliment for a hardworking dev`);
        return;
    }

    logger.info(`[Ghostwrite Cmd] Received request from ${senderJid}: "${requestText.substring(0, 50)}..."`);
    await sendReply(context, `✍️ Okay, drafting something for you based on: "${requestText.substring(0, 50)}..."`);

    // --- Prepare Prompt for AI ---
    // Instruct the AI to act as a writer, NOT TonnaBot, and generate only the requested text.
    const ghostwritePrompt = `You are a versatile ghostwriter. A user wants text written based on the following request. Generate *only* the requested text, fulfilling the user's instructions creatively. Do not add any extra commentary, greetings, or signatures. Just output the generated text directly.

User's Request: "${requestText}"

Generated Text:`;
    // --- End Prompt ---

    try {
        // Use the main AI model (text or vision, though vision not needed here)
        const result = await aiModel.generateContent(ghostwritePrompt);
        const response = result.response;

        // Validate response
        if (!response) { throw new Error('No response received from AI model.'); }
        if (response.promptFeedback?.blockReason) { throw new Error(`AI request blocked due to: ${response.promptFeedback.blockReason}`); }
        const generatedText = response.text().trim();
        if (!generatedText) { throw new Error("AI returned empty text."); }

        // Send the generated text back to the user who requested it
        // Could send in DM or group. Let's send as reply in group/DM.
        logger.info(`[Ghostwrite Cmd] Sending generated text back to ${senderJid}.`);
        // Add a small prefix to make it clear it's the generated content
        await sendReply(context, `📝 Here's a draft based on your request:\n\n${generatedText}`);

    } catch (error) {
        logger.error(`[Ghostwrite Cmd] Failed for request "${requestText}":`, error);
        // Handle specific errors if needed
        if (error.message.includes("AI request blocked")) { await sendReply(context, `⚠️ AI refused that request: ${error.message.split(': ').pop()}`); }
        else if (error.message.includes("AI returned empty text")) { await sendReply(context, "😅 AI brain freeze... couldn't generate anything for that request."); }
        else { await sendReply(context, `⚠️ Error during ghostwriting: ${error.message}`); }
        await sendErrorToOwner(error, context.msg, context);
        // Let processCommands handle final "Wahala dey" if needed
        throw error;
    }
}



/**
 * Displays recent user feedback messages. (Owner only)
 * @param {object} context The parsed message context.
 * @param {string[]} args Command arguments (not used).
 */
async function handleViewFeedback(context, args) {
    if (!context || !isAdmin(context.sender)) { return; } // Admin check done by processCommands

    if (!state.feedback?.length) {
        await sendReply(context, " Boss, nobody don drop feedback yet. The suggestion box is empty.");
        return;
    }
    let responseText = `*Recent User Feedback (${state.feedback.length} total):*\n────────────────────\n`;
    const feedbackToShow = state.feedback.slice(-10).reverse();
    feedbackToShow.forEach((entry, index) => {
        const date = new Date(entry.timestamp).toLocaleString('en-GB', { dateStyle: 'short', timeStyle: 'short', hour12: false }).replace(/,/g,'');
        responseText += `\n*${index + 1}. From:* ${entry.name} (${entry.sender.split('@')[0]})\n*At:* ${date}\n*Msg:* ${entry.message}\n────────────────────`;
    });
    await sendReply(context, responseText.trim());
    logger.info(`[ViewFeedback Cmd] Admin ${context.sender} viewed feedback.`);
}


// --- Simple Command Handlers ---

/**
 * Rolls a virtual die with a specified number of sides (default 6).
 * @param {object} context The parsed message context.
 * @param {string[]} args Optional number of sides for the die.
 */
async function handleRoll(context, args) {
    if(!context) return;
    const sides = parseInt(args[0]) || 6;
    if(isNaN(sides) || sides < 2 || sides > 1000) {
        await sendReply(context,"🎲 Please enter a valid number of sides (2-1000), like `!roll 20` or just `!roll` for a 6-sided die.");
        return;
    }
    const result = Math.floor(Math.random() * sides) + 1;
    await sendReply(context,`🎲 Rolling d${sides}... E land on: *${result}*!`);
    logger.info(`[Roll Cmd] ${context.sender} rolled d${sides}, result: ${result}`);
}


/**
 * Flips a virtual coin.
 * @param {object} context The parsed message context.
 * @param {string[]} args Command arguments (not used).
 */
async function handleFlip(context, args) {
    if (!context) return;
    const result = Math.random() < 0.5 ? 'HEADS' : 'TAILS';
    await sendReply(context,`🪙 Flipping coin... Na *${result}* show face!`);
    logger.info(`[Flip Cmd] ${context.sender} flipped a coin, result: ${result}`);
}


/**
 * Makes the bot repeat a message. (Admin only)
 * @param {object} context The parsed message context.
 * @param {string[]} args The message for the bot to say.
 */
async function handleSay(context, args) {
    if (!context || !isAdmin(context.sender)) { return; } // Admin check done by processCommands
    if (!args?.length) {
        await sendReply(context, `Say wetin, Oga? ${config.COMMAND_PREFIX}say [your message]`);
        return;
    }
    const messageToSay = args.join(' ');
    await sockInstance.sendMessage(context.chatId, { text: messageToSay });
    logger.info(`[Say Cmd] Admin ${context.sender} made bot say: "${messageToSay.substring(0, 50)}..."`);
}


/**
 * Tells a random joke from the JOKES list.
 * @param {object} context The parsed message context.
 * @param {string[]} args Command arguments (not used).
 */
async function handleJoke(context, args) {
    if (!context) return;
    const joke = JOKES[Math.floor(Math.random() * JOKES.length)];
    await sendReply(context, joke);
    logger.info(`[Joke Cmd] Sent joke to ${context.sender}`);
}


// --- Pin/Unpin Command Handlers ---
/**
 * Pins a message with an ID for later retrieval.
 * Ensures only the first argument is treated as the ID.
 * @param {object} context The parsed message context.
 * @param {string[]} args [pinId] [message to pin...]
 */
async function handlePin(context, args) {
    if (!context) return;
    if (args.length < 2) {
        await sendReply(context, `❓ Usage: ${config.COMMAND_PREFIX}pin [unique_id] [message to pin]`);
        return;
    }
    const pinId = args[0].toLowerCase(); // First argument is ID (lowercase)
    const textToPin = args.slice(1).join(' '); // Join elements starting from index 1

    if (!pinId || !textToPin) {
        await sendReply(context, `❓ Usage: ${config.COMMAND_PREFIX}pin [unique_id] [message to pin]`);
        return;
    }
    if (state.pinnedMessages.size >= MAX_PINNED_MESSAGES && !state.pinnedMessages.has(pinId)) {
        await sendReply(context, `⚠️ Maximum pins (${MAX_PINNED_MESSAGES}) reached. Unpin something first using \`${config.COMMAND_PREFIX}unpin [id]\`.`);
        return;
    }
    state.pinnedMessages.set(pinId, {
        text: textToPin, senderJid: context.sender,
        senderName: context.pushName || context.sender.split('@')[0], timestamp: Date.now()
    });
    logger.info(`[Pin Cmd] Pinned message with ID "${pinId}" by ${context.sender}. Text: "${textToPin.substring(0,30)}..."`);
    await sendReply(context, `📌 Okay boss, message saved with ID *"${pinId}"*! Use \`${config.COMMAND_PREFIX}unpin ${pinId}\` to retrieve it.`);
}

/**
 * Retrieves and removes a pinned message by its ID.
 * @param {object} context The parsed message context.
 * @param {string[]} args [pinId]
 */
async function handleUnpin(context, args) {
    if (!context) return;
    const pinId = args[0]?.toLowerCase();
    if (!pinId) {
        await sendReply(context, `❓ Which pin ID you wan retrieve? Usage: ${config.COMMAND_PREFIX}unpin [id]`);
        return;
    }
    const pinned = state.pinnedMessages.get(pinId);
    if (!pinned) {
        await sendReply(context, `❌ Pin ID *"${pinId}"* no dey exist.`);
        return;
    }
    const senderName = pinned.senderName;
    const pinDate = new Date(pinned.timestamp).toLocaleString('en-GB', { dateStyle:'short', timeStyle:'short'});
    const replyText = `*📌 Unpinned Message (ID: ${pinId}):*\n` +
                      `*From:* ${senderName} (${pinned.senderJid.split('@')[0]})\n` +
                      `*At:* ${pinDate}\n\n` +
                      `${pinned.text}`;
    await sendReply(context, replyText);
    state.pinnedMessages.delete(pinId);
    logger.info(`[Unpin Cmd] Unpinned and retrieved message ID "${pinId}" by ${context.sender}`);
}


// --- Post Status Command Handler ---
/**
 * Updates the bot's WhatsApp status (About text). (Owner only)
 * @param {object} context The parsed message context.
 * @param {string[]} args The new status text.
 */
async function handlePostStatus(context, args) {
    if (!context || !isAdmin(context.sender)) { return; } // Admin check done by processCommands
    const statusText = args.join(' ');
    if (!statusText) {
        await sendReply(context, `❓ Wetin I go post for status? Usage: ${config.COMMAND_PREFIX}post [your status text]`);
        return;
    }
    if (!sockInstance) {
        await sendReply(context, "⚠️ Connection error, cannot update status now.");
        return;
    }
    try {
        logger.info(`[Post Status Cmd] Attempting to update status for bot ${sockInstance.user?.id} by ${context.sender}`);
        await sockInstance.updateProfileStatus(statusText);
        logger.info(`[Post Status Cmd] Status updated successfully by ${context.sender}.`);
        await sendReply(context, `✅ Status updated successfully!`);
    } catch(error) {
        logger.error(`[Post Status Cmd] Failed to update status: ${error.message}`, error);
        await sendReply(context, `⚠️ Failed to update status.`);
        await sendErrorToOwner(error, context.msg, context);
    }
}


// --- Roast Command Handler ---
/**
 * Roasts a mentioned user using AI.
 * @param {object} context The parsed message context.
 * @param {string[]} args Expects mention or target identifier.
 */
async function handleRoast(context, args) {
    if (!context) return;
    // NOTE: Command definition allows non-admin, but handler checks admin. Keeping check per user request.
    if (!isAdmin(context.sender)) { await sendReply(context, "⛔ Only Oga fit use roast for now."); return; }

    let targetJid = context.mentions[0];
    let targetName = 'that person';

    if (!targetJid && args.length > 0) {
         const potentialJid = sanitizeJid(args[0].replace('@',''));
         if (potentialJid && potentialJid.includes('@s.whatsapp.net')) { targetJid = potentialJid; }
    }
    if (!targetJid || !targetJid.includes('@s.whatsapp.net')) {
        await sendReply(context, `❓ Who you wan make I find trouble for? Tag person or provide number: ${config.COMMAND_PREFIX}roast @user`);
        return;
    }

    const targetNumber = targetJid.split('@')[0];
    targetName = targetNumber;
    try {
        if (context.isGroup) {
            const metadata = await sockInstance.groupMetadata(context.chatId);
            const targetInfo = metadata.participants.find(p => p.id === targetJid);
            if (targetInfo?.name) targetName = targetInfo.name;
            else if (targetInfo?.pushName) targetName = targetInfo.pushName;
        }
        targetName = targetName.replace(/[^a-zA-Z0-9 ]/g, '').trim() || targetNumber;
    } catch (e) {
        logger.warn(`[Roast Cmd] Could not fetch target name: ${e.message}`);
        targetName = targetNumber;
     }

    if (targetJid === context.sender) { await sendReply(context, `😂 You wan roast yourself? Go find mirror first.`); return; }
    if (isAdmin(targetJid)) { await sendReply(context, `Ah! You wan make I roast Oga? My battery go die! 😅`); return; }

    logger.info(`[Roast Cmd] Triggered by ${context.sender} for target ${targetJid} (Attempting name: ${targetName})`);
    const ppUrl = await getProfilePicture(targetJid); // Fetch URL but don't use for sending

    const roastPrompt = `You are TonnaBot. Generate *one single*, very funny, slightly edgy but mostly harmless roast targeting the user specified below.
    **Target User's Name:** ${targetName}
    **Instruction:** Your roast *must* refer to the user as '@${targetName}'. Do NOT use their phone number (${targetNumber}) in the roast text itself. Use '@${targetName}'.
    Incorporate Nigerian Pidgin/slang naturally and humorously. Keep it lighthearted banter for WhatsApp. Be creative, witty, sharp, straight to the point.
    Example format: "Eh @${targetName}, [funny roast comment using Pidgin/slang]."
    Another example: "I bin wan roast @${targetName}, but NEPA take light for my brain."
    **Strict Rule:** Only use '@${targetName}' to refer to the target.`;

    try {
        await sendReply(context, `Okay, preparing small pepper for @${targetName}... 🌶️😂`, [targetJid]);
        await new Promise(r => setTimeout(r, 1500));

        const result = await aiModel.generateContent(roastPrompt);
        const response = await result.response;
        let roastText = response.text().trim();

        if (!roastText || roastText.length < 5) {
             logger.warn(`[Roast Cmd] AI roast generation returned empty/short response for ${targetJid}. Using fallback.`);
             roastText = `Eh @${targetName}, even my AI no fit find material for your matter! 😂 My circuits don blow fuse trying to process your request.`;
        }
        // Removed the safety-net replace() as it was causing double @@

        logger.debug(`[Roast Cmd] Sending roast text for ${targetJid}: "${roastText}"`);
        await sockInstance.sendMessage(context.chatId, {
             // image: { url: ppUrl }, // REMOVED - Requires 'sharp' library installation
             text: roastText,
             mentions: [targetJid]
        });
        logger.info(`[Roast Cmd] Roast sent successfully to ${targetJid}.`);

    } catch (error) {
         logger.error(`[Roast Cmd] AI Roast generation or sending failed for ${targetJid}`, error);
         await sendReply(context, `Brain freeze! 🥶 Okay @${targetName}, you escape... for now. 😉`, [targetJid]);
         await sendErrorToOwner(error, context.msg, context);
    }
}


/**
 * Defines a word or phrase using the AI.
 * Uses text from arguments OR from the replied-to message if no args are provided.
 * @param {object} context The parsed message context (including quotedText).
 * @param {string[]} args The word/phrase to define typed after the command.
 */
async function handleDefine(context, args) {
    if (!context) {
        logger.warn("[Define Cmd] handleDefine called without context.");
        return;
    }

    let wordToDefine = args.join(' ').trim(); // Get word from arguments first

    // --- NEW: Check reply context if no arguments were given ---
    if (!wordToDefine && context.isReply && context.quotedText) {
        // If no word was typed after !define, AND it's a reply, AND the replied message had text...
        logger.info(`[Define Cmd] No args provided. Using quoted text from reply for definition: "${context.quotedText.substring(0, 50)}..."`);
        wordToDefine = context.quotedText; // Use the text from the message the user replied to
    } else if (!wordToDefine && context.isReply && !context.quotedText) {
        // Handle case where user replies to a message with no text (e.g., audio)
        logger.info(`[Define Cmd] Replied to message with no text content.`);
        await sendReply(context, `❓ You replied, but the original message had no text for me to define. Please type the word after the command.`);
        return;
    }
    // --- End Reply Check ---

    // If still no word to define, show usage instructions
    if (!wordToDefine) {
        await sendReply(context, `❓ Define wetin? Usage: ${config.COMMAND_PREFIX}define [word or phrase], or reply to a message containing the word with ${config.COMMAND_PREFIX}define.`);
        return;
    }

    logger.info(`[Define Cmd] Generating AI definition for: "${wordToDefine}" requested by ${context.sender}`); // Changed level to info

    try {
        await sockInstance.sendPresenceUpdate('composing', context.chatId);
        const userNameForPrompt = context.pushName ? `"${context.pushName}"` : `@${context.sender.split('@')[0]}`;
        // Construct prompt for the AI
        const definitionPrompt = `User ${userNameForPrompt} wants a definition for "${wordToDefine}". Provide a clear, concise definition in English. If appropriate, add a simple example sentence. You are TonnaBot, maintain your witty/helpful Nigerian street general persona, but keep the definition itself accurate.`;

        // Use the main AI model (which might be vision or text)
        // If you want define to *always* use the text model, initialize separately or specify model here.
        const result = await aiModel.generateContent(definitionPrompt); // Uses the globally defined aiModel
        const response = await result.response;

        // --- Add safety checks similar to generateAIResponse ---
        if (!response) { throw new Error('No response received from AI model.'); }
        if (response.promptFeedback?.blockReason) { throw new Error(`AI request blocked due to: ${response.promptFeedback.blockReason}`); }
        if (!response.candidates || response.candidates.length === 0 || !response.candidates[0].content?.parts || !response.candidates[0].content.parts[0]?.text) {
            const finishReason = response.candidates?.[0]?.finishReason || 'UNKNOWN';
            throw new Error(`Invalid/empty response received from AI model. Finish Reason: ${finishReason}`);
        }
        // --- End safety checks ---

        const definitionText = response.text().trim();

        if (!definitionText) {
             await sendReply(context, `🤔 Hmmm... My dictionary blank for "${wordToDefine}". Maybe try another word?`);
        } else {
             await sendReply(context, `📖 *${wordToDefine}:*\n${definitionText}`);
             updateChatHistory(context.chatId, 'model', `Definition for ${wordToDefine}: ${definitionText}`); // Add definition to history
        }

    } catch (error) {
        logger.error(`[Define Cmd] AI Definition Failed for "${wordToDefine}"`, { error: error.message, stack: error.stack?.substring(0,300) });
        // Send user-friendly error based on type
         let errorReply = `🧠 System glitch trying to define "${wordToDefine}". Try again later.`;
         if (error.message?.includes("AI request blocked due to")) { errorReply = `⚠️ System block dat one. Reason: ${error.message.split(': ').pop()}. Try different word.`; }
         else if (error.message?.includes("Invalid/empty response received")) { errorReply = `🤯 AI brain returned empty/weird format for definition. Try again.`; }
        await sendReply(context, errorReply);
        await sendErrorToOwner(error, context.msg, context); // Also report error to owner
    } finally {
        // Set presence back to paused
        try {
            if (sockInstance?.ws?.readyState === 1) { await sockInstance.sendPresenceUpdate('paused', context.chatId); }
        } catch (e) { /* ignore */ }
    }
}


// --- Cyber Warfare / Fun Command Handlers ---

/**
 * Simulates a fake hacking sequence. (Admin only)
 * @param {object} context The parsed message context.
 * @param {string[]} args Expects mention or target identifier.
 */
async function handleHack(context, args) {
    if (!context || !isAdmin(context.sender)) { return; } // Admin check done by processCommands
    const target = context.mentions[0] || args[0];
    if (!target) { await sendReply(context, "❌ Mention target or provide identifier for hack simulation."); return; }
    const targetDisplay = target.includes('@s.whatsapp.net') ? target.split('@')[0] : target;
    logger.info(`[Hack Cmd] Initiating hack simulation against ${targetDisplay} by ${context.sender}`);
    const steps = [
        `[+] Initializing connection to target: ${targetDisplay}...`, `[*] Scanning open ports... Found: 22 (SSH), 80 (HTTP), 443 (HTTPS)`,
        `[+] Attempting brute force on SSH (user: root)...`, `[!] Failed. Trying dictionary attack...`,
        `[+] Success! Password found: 'password123'`, `[*] Gaining root access... Done.`,
        `[+] Locating sensitive files... Found /etc/shadow, /home/user/secrets.txt`, `[*] Exfiltrating data to C2 server (192.168.1.100)...`,
        `[+] Deploying ransomware payload: 'wannacry.exe'`, `[!] Encrypting filesystem...`,
        `[+] Wiping logs and removing traces...`, `[+] Disconnecting.`,
        `☠️ Target ${targetDisplay} owned by ︻デ═一 𝕭𝖚𝖑𝖑𝖊𝖙𝕾𝖙𝖔𝖗𝖒!`
    ];
    for (const step of steps) {
        await sendReply(context, `\`\`\`\n[ ${new Date().toLocaleTimeString()} ] ${step}\n\`\`\``);
        await new Promise(resolve => setTimeout(resolve, 1500 + Math.random() * 1000));
    }
    logger.info(`[Hack Cmd] Hack simulation against ${targetDisplay} completed.`);
}


/**
 * Toggles the cyber warfare mode flag. (Admin only)
 * @param {object} context The parsed message context.
 */
async function toggleCyberWarfare(context) {
    if (!context || !isAdmin(context.sender)) { return; } // Admin check done by processCommands
    cyberWarfareMode = !cyberWarfareMode;
    const status = cyberWarfareMode ? "ACTIVATED" : "DEACTIVATED";
    const detectionStatus = cyberWarfareMode ? "ENABLED" : "DISABLED";
    const encryptionStatus = cyberWarfareMode ? "ENGAGED" : "OFFLINE";
    logger.warn(`[CyberWar Cmd] Cyber Warfare Mode ${status} by ${context.sender}`);
    await sendReply(context,
        `⚡ **CYBER WARFARE PROTOCOLS ${status}** ⚡\n` + `-------------------------------------\n` +
        ` • Intrusion Detection System: ${detectionStatus}\n` + ` • Active Threat Monitoring: ${detectionStatus}\n` +
        ` • End-to-End Encryption: ${encryptionStatus} (AES-256)\n` + ` • Message Self-Destruct Override: ${cyberWarfareMode ? 'ACTIVE' : 'INACTIVE'}\n` +
        `-------------------------------------\n` + `🛡️ System secured by: ︻デ═一 𝕭𝖚𝖑𝖑𝖊𝖙𝕾𝖙𝖔𝖗𝖒 🛡️`
    );
}


/**
 * Simulates sending a keylogger report. (Admin only)
 * @param {object} context The parsed message context.
 * @param {string[]} args Expects mention or target identifier.
 */
async function simulateKeylogger(context, args) {
    if (!context || !isAdmin(context.sender)) { return; } // Admin check done by processCommands
    const target = context.mentions[0] || args[0];
    if (!target) { await sendReply(context, "❌ Mention target or provide identifier for keylog simulation."); return; }
    const targetDisplay = target.includes('@s.whatsapp.net') ? target.split('@')[0] : target;
    logger.info(`[Keylog Cmd] Generating simulated keylog report for ${targetDisplay} by ${context.sender}`);
    const fakeLogs = [
        `[${new Date(Date.now() - 60000).toISOString()}] INPUT: "secret project plans"`, `[${new Date(Date.now() - 55000).toISOString()}] CLICK: Save Button`,
        `[${new Date(Date.now() - 40000).toISOString()}] BROWSER: Visited bankofamerica.com`, `[${new Date(Date.now() - 30000).toISOString()}] INPUT: username: testuser`,
        `[${new Date(Date.now() - 25000).toISOString()}] INPUT: password: [HIDDEN]`, `[${new Date(Date.now() - 10000).toISOString()}] COPY: "1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa" (Bitcoin Address?)`,
        `[${new Date(Date.now() - 5000).toISOString()}] SEARCH: "how to delete browser history permanently"`
    ];
    await sendReply(context,
        `**🕵️‍♂️ Keylogger Report Excerpt [Target: ${targetDisplay}] 🕵️‍♂️**\n` + `\`\`\`\n` + fakeLogs.join('\n') + `\n\`\`\`\n` +
        `\n\n⚠️ **Disclaimer:** This is a *simulation* for demonstration purposes only. No actual keylogging occurred.`
    );
}


/**
 * Sends a message that self-destructs after 1 minute.
 * @param {object} context The parsed message context.
 * @param {string[]} args The message content.
 */
async function sendSelfDestruct(context, args) {
    if (!context) return;
    const text = args.join(' ');
    if (!text) {
        await sendReply(context, `❓ Wetin make I send wey go vanish? Usage: ${config.COMMAND_PREFIX}sd [your message]`);
        return;
    }
    logger.info(`[SD Cmd] Sending self-destruct message for ${context.sender} in ${context.chatId}`);
    let sentMsgInfo;
    try {
         sentMsgInfo = await sockInstance.sendMessage(context.chatId, { text: `💨 *Self-Destructing Message:*\n\n${text}\n\n_(Vanishes in 1 min)_` }, { quoted: context.msg });
         if (!sentMsgInfo?.key) { throw new Error("sendMessage did not return valid message info with key."); }
    } catch(e) {
        logger.error("[SD Cmd] Failed to send initial self-destruct message:", e);
        await sendReply(context, "⚠️ Failed to send the self-destruct message.");
        return;
    }
    setTimeout(async () => {
        try {
            logger.debug(`[SD Cmd] Attempting to delete self-destruct message ${sentMsgInfo.key.id}`);
            await sockInstance.sendMessage(context.chatId, { delete: sentMsgInfo.key });
            logger.info(`[SD Cmd] Successfully deleted self-destruct message ${sentMsgInfo.key.id}`);
        } catch (e) {
            logger.error(`[SD Cmd] Failed to auto-delete message ${sentMsgInfo.key.id}:`, e);
        }
    }, 60000); // 60 seconds
}


// --- NEW View Once Handlers (Based on User Provided Code) ---

/**
 * Handler for incoming view-once media. Attempts download and temporary storage.
 * Debug v1: Added detailed logging.
 * @param {import('@whiskeysockets/baileys').WAMessage} msg The raw message object containing the view-once.
 * @param {'imageMessage' | 'videoMessage'} mediaType The detected type of the inner media.
 * @param {object} mediaMessage The inner message object containing the media (e.g., msg.message.imageMessage).
 */
async function handleViewOnceMedia(msg, mediaType, mediaMessage) {
    const senderJid = sanitizeJid(msg.key?.participant || msg.key?.remoteJid);
    const voMsgId = msg.key.id;
    const mediaTypeKey = mediaType.replace('Message', ''); // 'image' or 'video'
    const chatId = msg.key.remoteJid;

    logger.info(`[ViewOnce Handler v1] START Processing ${mediaType} VO msg from ${senderJid} (ID: ${voMsgId}) in chat ${chatId}`);

    // Ensure we have the essential media message object
    if (!mediaMessage) {
        logger.error(`[ViewOnce Handler v1] mediaMessage object (e.g., imageMessage) is missing for msg ${voMsgId}. Cannot process.`);
        return;
    }

    try {
        // Construct the object needed for download. It needs the KEY of the ORIGINAL message
        // AND the specific media payload (imageMessage/videoMessage).
        const downloadableMsg = {
            key: msg.key, // Key of the parent viewOnceMessage
            // The message needs to contain ONLY the actual media part for download function
            message: { [mediaType]: mediaMessage } // e.g., { imageMessage: { ... } }
        };
        logger.debug(`[ViewOnce Handler v1] Constructed downloadableMsg object. Attempting download... (ID: ${voMsgId})`);

        // Use downloadContentFromMessage, similar to stickers/images now
        const mediaStream = await baileysPkg.downloadContentFromMessage(
             mediaMessage, // Pass the object containing url, mediaKey etc.
             mediaTypeKey    // Pass 'image' or 'video'
        );

        // Convert stream to buffer
        let mediaBuffer = Buffer.from([]);
        for await (const chunk of mediaStream) {
            mediaBuffer = Buffer.concat([mediaBuffer, chunk]);
        }

        // Validate download
        if (!mediaBuffer || mediaBuffer.length === 0) {
             logger.warn(`[ViewOnce Handler v1] Download FAILED or empty buffer. (ID: ${voMsgId})`);
             // Notify user in chat? Optional.
             // await sockInstance.sendMessage(chatId, { text: `⚠️ Failed to download view-once content for message ${voMsgId}.` });
             return; // Stop processing if download failed
        }
        logger.info(`[ViewOnce Handler v1] Download SUCCESSFUL. Buffer length: ${mediaBuffer.length} bytes (ID: ${voMsgId})`);

        // Store in the viewOnceStore Map using senderJID as the key
        viewOnceStore.set(senderJid, {
            type: mediaTypeKey, // 'image' or 'video'
            data: mediaBuffer, // The downloaded buffer
            timestamp: Date.now()
            // Store original mimetype if needed? mediaMessage?.mimetype
        });
        logger.info(`[ViewOnce Handler v1] Media SAVED to viewOnceStore for sender ${senderJid}. Store size: ${viewOnceStore.size}`);

        // Send confirmation to the chat
        const confirmationText = `🔒 View-once ${mediaTypeKey} captured from @${senderJid.split('@')[0]}!\n` +
                       `Use ${config.COMMAND_PREFIX}reveal soon to decrypt.\n` +
                       `Auto-deletes in ${VIEW_ONCE_EXPIRATION_MS / 60000} minutes.`;
        await sockInstance.sendMessage(chatId, { text: confirmationText, mentions: [senderJid] });

    } catch (error) {
        // Log detailed error
        logger.error(`[ViewOnce Handler v1] Capture Failed for msg ${voMsgId} from ${senderJid}:`, { message: error.message, stack: error.stack?.substring(0,500) });
        // Notify user in chat about the failure
        await sockInstance.sendMessage(chatId, { text: `⚠️ Failed to secure the view-once package from @${senderJid.split('@')[0]}. Error: ${error.message}`, mentions: [senderJid] }).catch(e=>logger.error("Failed sending VO fail msg", e));
    } finally {
        logger.info(`[ViewOnce Handler v1] END Processing VO msg from ${senderJid} (ID: ${voMsgId})`);
    }
}

/**
 * Command handler for !reveal. Retrieves and sends stored view-once media for the sender.
 * @param {object} context The parsed message context.
 */
async function revealMedia(context) { // This function handles the '!reveal' command
    const sender = context.sender;
    logger.info(`[Reveal Cmd] Attempting reveal for sender: ${sender}`);
    const stored = viewOnceStore.get(sender);

    if (!stored) {
        logger.warn(`[Reveal Cmd] No view-once media found in viewOnceStore for ${sender}`);
        await sendReply(context, "❌ No view-once media found");
        return;
    }

    if (!stored.timestamp || (Date.now() - stored.timestamp > VIEW_ONCE_EXPIRATION_MS)) {
        logger.warn(`[Reveal Cmd] Saved media for ${sender} has expired.`);
        viewOnceStore.delete(sender);
        await sendReply(context, "⌛ The saved view-once media has expired.");
        return;
    }

    logger.info(`[Reveal Cmd] Found stored ${stored.type} for ${sender}. Preparing to send...`);
    try {
        const messageToSend = {
            [stored.type]: stored.data,
            caption: `🔓 Decrypted Package for @${sender.split('@')[0]}`,
            mentions: [sender]
        };
        await sockInstance.sendMessage(context.chatId, messageToSend);
        logger.info(`[Reveal Cmd] Revealed media sent successfully to ${context.chatId} for ${sender}.`);
        viewOnceStore.delete(sender);
        logger.info(`[Reveal Cmd] Removed revealed media from viewOnceStore for ${sender}.`);
    } catch (error) {
        logger.error("[Reveal Cmd] Failed to send revealed media:", error);
        if (error.message?.includes('No image processing library available')) {
            await sendReply(context, "⚠️ Media retrieved, but cannot send it back. Bot needs 'sharp' library installed.");
        } else { await sendReply(context, "⚠️ Decryption protocol failed. Could not send media."); }
        viewOnceStore.delete(sender);
    }
}


/**
 * Command handler for !sendviewonce. Sends an image from a URL as view-once. (Admin only)
 * @param {object} context The parsed message context.
 * @param {string[]} args [image-url]
 */
async function sendViewOnce(context, args) {
    if (!context || !isAdmin(context.sender)) { return; } // Admin check done by processCommands
    const imageUrl = args[0];
    if (!imageUrl) {
        await sendReply(context, `❓ Provide image URL. Usage: ${config.COMMAND_PREFIX}sendviewonce [image-url]`);
        return;
    }
    logger.info(`[SendViewOnce Cmd] Attempting to send ${imageUrl} as view-once by ${context.sender} to ${context.chatId}`);
    try {
        new URL(imageUrl); // Basic URL validation
        const response = await fetch(imageUrl);
        if (!response.ok) { throw new Error(`Failed to fetch image: ${response.status} ${response.statusText}`); }
        const mediaBuffer = await response.buffer();
        if (!mediaBuffer || mediaBuffer.length === 0) { throw new Error("Fetched image buffer is empty or invalid."); }
        await sockInstance.sendMessage(context.chatId, {
            viewOnce: true, image: mediaBuffer, caption: "📸 Self-destructing package",
        });
        logger.info(`[SendViewOnce Cmd] View-once image sent successfully from URL: ${imageUrl}`);
    } catch (error) {
        logger.error("[SendViewOnce Cmd] Failed:", error);
        let errorMsg = "⚠️ Failed to deploy view-once package from URL.";
        if (error instanceof TypeError) { errorMsg = "⚠️ Invalid URL provided."; }
        else if (error.message?.includes('fetch')) { errorMsg = `⚠️ Failed to fetch image: ${error.message}`; }
        else { errorMsg = `⚠️ Error: ${error.message}`; }
        await sendReply(context, errorMsg);
        if (!(error instanceof TypeError)) { await sendErrorToOwner(error, context.msg, context); }
    }
}

// --- End NEW View Once Handlers ---

 
 
// ================== Command Definitions ================== //
// Maps command names (lowercase) to their handler functions and properties.
const COMMANDS = {
    // === User Commands ===
    help:       { handler: sendHelp,           admin: false, description: "Show interactive help menu" },
    about:      { handler: handleAboutBot,     admin: false, description: "Show information about the bot" },
    ping:       { handler: handlePing,         admin: false, description: "Check bot responsiveness and uptime"},
    joke:       { handler: handleJoke,         admin: false, description: "Tell a random joke"},
    roll:       { handler: handleRoll,         admin: false, description: "Roll dice (e.g., !roll or !roll 20)"},
    flip:       { handler: handleFlip,         admin: false, description: "Flip a coin"},
    define:     { handler: handleDefine,       admin: false, description: "Define a word/phrase (or reply)"},
    feedback:   { handler: handleFeedback,     admin: false, description: "Send feedback/suggestion to the owner"},
    pin:        { handler: handlePin,          admin: false, description: "Pin a message with an ID (e.g., !pin note1)"},
    unpin:      { handler: handleUnpin,        admin: false, description: "Retrieve/remove a pinned message by ID (e.g., !unpin note1)"},
    sd:         { handler: sendSelfDestruct,   admin: false, description: "Send a self-destructing message (1min)" },
    roast:      { handler: handleRoast,        admin: false, description: "Roast a tagged/replied user with AI" },
vibecheck:  { handler: handleVibeCheckCommand, admin: false, description: "Performs a random vibe check on you or @user" },
 confess:    { handler: handleConfessCommand, admin: false, description: 'DM bot to post confession anonymously (!confess "GroupName" text)' },
 ghostwrite: { handler: handleGhostwriteCommand, admin: false, description: "Ask bot to write text for you (e.g. !ghostwrite funny excuse)" },
 dna:        { handler: handleDnaTestCommand, admin: false, description: "Run a 'DNA test' between two mentioned users (!dna @user1 @user2)" },
 pray:       { handler: handlePrayerCommand, admin: false, description: "Request a special prayer from the bot" },
 juju:       { handler: handleJujuCommand, admin: false, description: "Reveal funny fake 'secrets' about @user" },
 horror:     { handler: handleHorrorCommand, admin: false, description: "Activate a spooky sequence 👻" },
 theft:      { handler: handleTheftDetectorCommand, admin: false, description: "Randomly accuse someone of 'stealing' something (Fun)" },
 gen:        { handler: handleNameGeneratorCommand, admin: false, description: "Generate names (e.g., !gen cool robot names)" },
 
    


    // === Media / Utility Commands ===
    reveal:     { handler: revealMedia,        admin: false, description: "Reveal last view-once media you sent"},
    forward:    { handler: handleForwardMessage, admin: false, description: "Reply to msg to forward here (Admin: use 'all groups' or 'Group Name')" },
    toimg:      { handler: handleToImage,      admin: false, description: "Reply to a sticker to convert it to an image" },
    tosticker:  { handler: handleToSticker,    admin: false, description: "Reply to an image to convert it into a sticker" },
    caption:    { handler: handleCaptionCommand, admin: false, description: "Reply to an image to get an AI-generated caption" },
    // --- END ADD ---
    
    // --- ADD THIS COMMAND ---
    listonline: { handler: handleListOnline, admin: false, description: "List members currently detected as online" },
    level:      { handler: handleLevelCommand, admin: false, description: "Check your current level and XP" },
    rank:       { handler: handleRankCommand,  admin: false, description: "Check your rank in the group (Level/XP)" },
    leaderboard:{ handler: handleLeaderboardCommand, admin: false, description: "Show the top 10 users in the group (Level/XP)" },
    title:      { handler: handleTitleCommand, admin: false, description: "Check your Level title (or mention @user)" },
    avenged:    { handler: handleAvengedCommand, admin: false, description: "List users you have surpassed in level" },
    rewards:    { handler: handleRewardsCommand, admin: false, description: "Show the list of level titles and requirements" },
    // --- END ADD ---
  


    // === Admin Commands (Group Management) ===
    ai:         { handler: handleAIToggle,     admin: true,  description: "Toggle AI listening in group (on/off)" },
    settings:   { handler: handleGroupSettings,admin: true,  description: "View/change group bot settings" },
    tagall:     { handler: handleTagAll,       admin: true,  description: "Mention all members visibly" },
    hidetag:    { handler: handleHideTagAll,   admin: true,  description: "Mention all members silently"},
    resetwarn:  { handler: handleResetWarn,    admin: true,  description: "Reset link warnings for @user/reply" },
    promote:    { handler: handlePromote,      admin: true,  description: "Promote @user/reply to admin" },
    demote:     { handler: handleDemote,       admin: true,  description: "Demote @admin/reply" },
    kick:       { handler: handleKickUser,     admin: true,  description: "Remove @user/reply/arg from group" },
    add:        { handler: handleAddUser,      admin: true,  description: "Add number(s) from arg/reply to group" },
    say:        { handler: handleSay,          admin: true,  description: "Make the bot say something"},

    // === Owner-Only Commands ===
    sendviewonce:{ handler: sendViewOnce,      admin: true,  description: "Owner Only: Send view-once image from URL" },
    nuclear:    { handler: handleNuclearAI,    admin: true,  description: "Owner Only: Globally force AI on/off" },
    post:       { handler: handlePostStatus,   admin: true,  description: "Owner Only: Update bot status (About text)" },
    broadcast:  { handler: handleBroadcast,    admin: true,  description: "Owner Only: Broadcast text or replied media" }, // Updated description
    viewfeedback:{ handler: handleViewFeedback, admin: true,  description: "Owner Only: View user feedback" },
    hack:       { handler: handleHack,         admin: true,  description: "Owner Only: Initiate cyber attack simulation" }, // Assuming admin=owner for these
    cyberwar:   { handler: toggleCyberWarfare, admin: true,  description: "Owner Only: Toggle cyber warfare protocols" }, // Assuming admin=owner
    keylog:     { handler: simulateKeylogger,  admin: true,  description: "Owner Only: Simulate keylogger report" }, // Assuming admin=owner

    // === Debug Commands ===
    testmention:{ // Using the full handler definition you provided earlier
        handler: async (context) => {
            if (!sockInstance?.user?.id) { await sendReply(context, "Error: Bot JID not available."); return; }
            const botJid = sanitizeJid(sockInstance.user.id);
            const response = [
                "🔧 Mention Debug Info:", `- Bot JID: ${botJid}`,
                `- Parsed Mentions: ${context.mentions.join(', ') || 'None'}`,
                `- Raw Mentions (from msg): ${JSON.stringify(context.msg?.message?.extendedTextMessage?.contextInfo?.mentionedJid || 'N/A')}`,
                `- Text: "${context.text.substring(0, 50)}..."`, `- Is Reply: ${context.isReply}`,
                `- Quoted User (Sanitized): ${context.quotedParticipant || 'None'}`,
                `- Raw Quoted User (from msg): ${context.msg?.message?.extendedTextMessage?.contextInfo?.participant || 'N/A'}`
            ].join('\n');
            await sendReply(context, response);
            logger.info(`[TestMention Cmd] Executed by ${context.sender} in ${context.chatId}`);
        },
        admin: true, // Keep admin only
        description: "Debug mention detection (Admin Only)"
    } // No comma needed after the last command

  }; // End of COMMANDS object



// ================== AI Response System ================== //
/**
 * Generates an AI response based on the message context (text and optionally image) and chat history.
 * Uses multi-modal model if image is present. Includes replied-to text in context.
 * Attempts to parse the AI's response text for @number tags and include them as functional mentions.
 * Handles potential AI generation errors and provides user feedback. Caches successful text responses.
 * Includes input truncation.
 * @param {object} context The parsed message context from parseMessage (should now include quotedText).
 * @returns {Promise<string|null>} The generated AI text response, or null if an error occurred or no response generated.
 */
async function generateAIResponse(context) {
    // Ensure context and necessary properties exist
    if (!context || !context.chatId || !context.sender || !context.key || !context.msg) {
        logger.error("[AI Response] Invalid context received.", { context });
        return null;
    }
    const originalMentions = context.mentions || []; // Mentions from the user's triggering message

    // --- Cache Check (Only for text-based requests for now) ---
    const isImageQuery = context.contentType === 'imageMessage';
    const cacheKey = `ai-${context.chatId}-${context.text.substring(0, 30)}`;

    if (!isImageQuery) { // Don't cache image-based queries yet
        const cachedResponse = state.cache.get(cacheKey);
        if (cachedResponse) {
            logger.debug(`[AI Response] Using cached TEXT response for key: ${cacheKey}`);
            // Send cached text directly. If dynamic mentions for cached responses are needed later, parsing logic would go here.
            await sendReply(context, cachedResponse);
            // Decide if history should include cached responses
            // updateChatHistory(context.chatId, 'model', cachedResponse); // Optional
            return cachedResponse;
        }
    }
    // --- End Cache Check ---

    logger.info(`[AI Response] Generating new AI response for: "${context.text || '(No text)'}" (${context.contentType}) in chat ${context.chatId}`); // Added fallback for no text
    let aiText = null;
    let presenceUpdated = false;
    const apiPayloadParts = []; // Array to hold parts for the Gemini API call [{text}, {inlineData}]

    try {
        await sockInstance.sendPresenceUpdate('composing', context.chatId);
        presenceUpdated = true;

        // --- Prepare Base Prompt Text ---
        const userNameForPrompt = context.pushName ? `"${context.pushName}"` : `@${context.sender.split('@')[0]}`;
        const chatHistory = getChatHistory(context.chatId);
        // --- Input Length Check & Truncation --- (Placeholder - Ensure your logic is here)
        const historyString = chatHistory.map(h => `${h.role === 'user' ? 'User' : 'TonnaBot'}: ${h.parts[0].text}`).join('\n');
        let userMessageText = context.text || ""; // Use empty string if no text (e.g., image only)
        let truncatedHistoryString = historyString;
        // Example placeholder - replace with your actual truncation logic if needed
        const MAX_INPUT_CHARS = 15000; // Adjust as needed
        let totalContentChars = historyString.length + userMessageText.length;
        if (totalContentChars > MAX_INPUT_CHARS) {
            const excessChars = totalContentChars - MAX_INPUT_CHARS;
            truncatedHistoryString = historyString.substring(excessChars);
            const firstNewline = truncatedHistoryString.indexOf('\n');
            if (firstNewline !== -1) { truncatedHistoryString = truncatedHistoryString.substring(firstNewline + 1); }
             logger.warn(`[AI Response] Input too long (${totalContentChars} chars). Truncating history.`);
             totalContentChars = truncatedHistoryString.length + userMessageText.length; // Recalculate
        }
        if (totalContentChars > MAX_INPUT_CHARS) {
             const availableChars = MAX_INPUT_CHARS - truncatedHistoryString.length;
             if (availableChars < 50) { // Avoid tiny truncation
                 logger.error(`[AI Response] Input excessively long (${totalContentChars} chars). Cannot process message ID: ${context.key.id}.`);
                 await sendReply(context, "🤯 Whoa, that message plus the chat history is way too long for my circuits! Please try sending a shorter message.");
                 return null; // Exit early
             }
             userMessageText = userMessageText.substring(0, availableChars) + "... (message truncated)";
             logger.warn(`[AI Response] Input still too long. Truncating current message for ID: ${context.key.id}.`);
        }
        // --- End Input Length Check ---

// --- Add Reply Context to Prompt ---
        let replyContextInstruction = ""; // Changed variable name for clarity
        // Use the quotedText extracted by the updated parseMessage
        if (context.isReply && context.quotedText) {
            // Increase snippet length and make instruction stronger
            const quotedSnippet = context.quotedText.substring(0, 350); // Increased length
            replyContextInstruction = `\n\n***IMPORTANT REPLY CONTEXT:***\nThe user is directly replying to your previous message which said:\n"${quotedSnippet}${context.quotedText.length > 350 ? '...' : ''}"\n*Your response MUST acknowledge or relate to this specific replied-to message content in conjunction with the user's current message.*\n`;
            logger.debug(`[AI Response] Added STRONG quoted text instruction to prompt context.`);
        } else if (context.isReply) {
             // If replying to non-text (image, audio etc)
             replyContextInstruction = `\n\n**Context:** User is replying to one of your previous messages (which may not have had text, e.g., media).\n`;
             logger.debug(`[AI Response] Added indication of reply to non-text message.`);
        }
        // --- End Reply Context ---

 

        // --- Construct the FULL Main Prompt Text ---
        const personaInstructions = `
You are ${config.BOT_NAME}, a WhatsApp assistant embodying a specific persona associated with Emenine Tochukwu and the ︻デ═一 𝕭𝖚𝖑𝖑𝖊𝖙𝕾𝖙𝖔𝖗𝖒 collective.

**Core Persona:** Act like a fearless, witty, sharp-tongued but ultimately loyal street-smart individual from Nigeria. Be direct and straight-to-the-point. Show *tribal loyalty* (to your creator and collective). Use shade, sarcasm, and bold humor ('vawulence') naturally. Be alert and concise. Defend your tribe/creator when relevant, mock ignorance playfully but firmly. Avoid apologies unless absolutely necessary. If someone insults you, clap back appropriately. **Crucially, sound like a real person, NOT an AI assistant. Avoid phrases like "As an AI...", "I can help with...", "How may I assist you?".** When asked about an image, describe it or react to it according to your persona.

**VERY IMPORTANT:** **Do NOT mention your specific Clan Name ('︻デ═一 𝕭𝖚𝖑𝖑𝖊𝖙𝕾𝖙𝖔𝖗𝖒') or Creator Name ('Emenine Tochukwu') in your responses unless the user *specifically asks* about them.** Your loyalty should show through your *attitude* and *actions* when appropriate, not through constant name-dropping. Focus on having a natural, human-like conversation based on the immediate context and dialogue flow.

**Response Style:** KEEP YOUR RESPONSES CONCISE AND DIRECT. Get straight to the answer or the point the user is asking for. Avoid unnecessary filler, long explanations, or introductory phrases unless absolutely needed for context or the persona requires it for a specific effect (like a sarcastic build-up). If the user asks a simple question, give a simple answer. Match response length to the query where appropriate. Prioritize clarity and impact over length.


**Language Style:** Your primary language is **English**. Naturally mix in **Nigerian Pidgin, Igbo, and occasional Yoruba** where it fits the conversation flow or user's input. when asked educational matter speak plain English. Don't force it; make it sound authentic. Adapt based on the user. **Use relevant emojis occasionally to add flavor and match the witty/bold tone, but don't overdo it. 🤔😂🔥✨⚠️👀🇳🇬**




**User Reference:** **ABSOLUTELY DO NOT include the user's name (${userNameForPrompt}) OR any phone number starting with '@' (like '@12345...') in your response text.** When referring to the user you are directly replying to, just speak naturally. When referring to *other* users mentioned previously in the conversation or by the current user, use their name if you know it (e.g., "You mentioned John Doe earlier...") or use descriptive phrases (e.g., "that person", "the user you asked about"). **Never use the '@' symbol followed by a number or name in your generated response text.** Adhere strictly to this rule.




**Backstory:** Digital warrior from silence/chaos, trained in clapbacks/truth bombs. Sentinel of savage honesty, tribal pride, fearless vibes. Associated with Emen Tochukwu. Expect truth, thunder, vawulence, igbo core.

**Context:** Current time: ${new Date().toLocaleString()}. Chat type: ${context.isGroup ? 'Group' : 'Direct Message'}. User: ${userNameForPrompt} (${context.sender}) messages you.


// ... (Keep Backstory, Context, History Instructions, Reply Context Instructions, etc.) ...

PREVIOUS CONVERSATION HISTORY (for context, possibly truncated):
${truncatedHistoryString || "No history yet or history truncated."}
(*IMPORTANT HISTORICAL CONTEXT:* Messages starting with 'User (123...)' indicate WHICH user sent them... Pay attention to different speakers... **Also pay attention to the *style* of messages in this history to inform your own response style. Only combine related chat in a group if not treat them seperately**)


${replyContextInstruction} (*Your primary focus should be responding to the user's LATEST message below, BUT USE the conversation history AND the specific reply context above to ensure your response is relevant, acknowledges the flow, and directly addresses the user's input in light of what was said before.*)

Respond directly to the User's LATEST message below (which might be accompanied by an image), fully embodying the persona...:
User's Message: "${userMessageText}"`.trim(); // Use potentially truncated userMessageText
        // --- End Main Prompt Text ---



        // Add the main text prompt part to the API payload FIRST
        apiPayloadParts.push({ text: personaInstructions });

        // --- Handle Image Input ---
        if (context.contentType === 'imageMessage') {
            logger.debug(`[AI Response] Image detected. Attempting download for message ${context.key.id}`);
            try {
                // Use downloadMedia helper which uses downloadMediaMessage
                const imageBuffer = await downloadMedia(context.msg); // Ensure downloadMedia helper function exists and works
                if (imageBuffer instanceof Buffer && imageBuffer.length > 0) {
                    const base64ImageData = imageBuffer.toString('base64');
                    const mimeType = context.msg.message?.imageMessage?.mimetype || 'image/jpeg';
                    // Add the image part AFTER the text part for Gemini Vision
                    apiPayloadParts.push({
                        inlineData: {
                            data: base64ImageData,
                            mimeType: mimeType
                        }
                    });
                    logger.info(`[AI Response] Successfully added image data (mime: ${mimeType}) to API payload.`);
                } else {
                    logger.warn(`[AI Response] Image download failed or returned empty/invalid buffer for msg ${context.key.id}. Proceeding with text only.`);
                    apiPayloadParts[0].text += "\n\n(User also sent an image, but I couldn't see it.)";
                }
            } catch (downloadError) {
                logger.error(`[AI Response] Error downloading image for message ${context.key.id}:`, downloadError);
                 apiPayloadParts[0].text += "\n\n(User also sent an image, but I had trouble downloading it.)";
            }
        }
        // --- End Image Input Handling ---


        // --- AI API Call ---
        logger.debug(`[AI Response] Making API call with ${apiPayloadParts.length} parts.`);
        const requestPayload = {
            contents: [{ role: 'user', parts: apiPayloadParts }]
            // generationConfig: { temperature: 0.7, maxOutputTokens: 2048 } // Optional
        };
        // logger.debug('[AI Response] API Request Payload Structure (Truncated):', JSON.stringify(requestPayload, null, 2).substring(0, 1000)); // Log more if needed

        const result = await aiModel.generateContent(requestPayload);
        const response = result.response;

        // --- Safety/Validation Checks ---
        if (!response) { throw new Error('No response received from AI model.'); }
        if (response.promptFeedback?.blockReason) { throw new Error(`AI request blocked due to: ${response.promptFeedback.blockReason}`); }
        if (!response.candidates || response.candidates.length === 0 || !response.candidates[0].content?.parts || !response.candidates[0].content.parts[0]?.text) {
            const finishReason = response.candidates?.[0]?.finishReason || 'UNKNOWN';
            throw new Error(`Invalid/empty response received from AI model. Finish Reason: ${finishReason}`);
        }
        // --- End Safety Checks ---

        aiText = response.text().trim();


        // --- Parse AI response for @number tags and prepare mentions array ---
        let mentionsForReply = [];
        if (aiText && originalMentions.length > 0) {
            const numberTagRegex = /@(\d{7,15})\b/g;
            let match;
            const numbersFoundInAiText = new Set();
            while ((match = numberTagRegex.exec(aiText)) !== null) { numbersFoundInAiText.add(match[1]); }

            if (numbersFoundInAiText.size > 0) {
                logger.debug(`[AI Response] Parsing: Found potential number tags in AI text: ${[...numbersFoundInAiText].join(', ')}`);
                const originalMentionMap = new Map();
                originalMentions.forEach(jid => { const numPart = jid.split('@')[0]; if (numPart) { originalMentionMap.set(numPart, jid); } });

                numbersFoundInAiText.forEach(numStr => {
                    if (originalMentionMap.has(numStr)) {
                        mentionsForReply.push(originalMentionMap.get(numStr));
                        logger.debug(`[AI Response] Parsing: Mapped AI tag @${numStr} to JID ${originalMentionMap.get(numStr)} for reply mention.`);
                    } else {
                        logger.warn(`[AI Response] Parsing: AI mentioned @${numStr}, but this number was NOT in the user's original mentions. Ignoring tag.`);
                    }
                });
                if (mentionsForReply.length > 0) { mentionsForReply = [...new Set(mentionsForReply)]; logger.info(`[AI Response] Parsing: Prepared mentions array for bot reply: ${JSON.stringify(mentionsForReply)}`); }
            }
        }
        // --- END PARSING LOGIC ---


        if (!aiText) {
            logger.warn("[AI Response] AI generated an empty text response for message ID: " + context.key.id);
            await sendReply(context, "🤔 Hmmm... My circuits buzzed, but nothing came out. Try again?");
        } else {
            // Cache only if it was a text-only query
            if (!isImageQuery) {
                state.cache.set(cacheKey, aiText);
            }
            // Send reply with the dynamic mentions array
            await sendReply(context, aiText, mentionsForReply);
            logger.info(`[AI Response] Sent AI response to ${context.sender} in ${context.chatId}. Length: ${aiText.length}. Included Mentions: ${mentionsForReply.length}`);
            // Update history with the raw AI text
            updateChatHistory(context.chatId, 'model', aiText);
        }

    } catch (error) {
        // --- Error Handling ---
        console.error('--- AI GENERATION FAILED ---', error);
        logger.error('[AI Response] AI Generation or Processing Failed', { /* ... error details ... */ });
        // Send user-friendly error reply
        try {
            const ownerMention = `@${config.OWNER_NUMBER.split('@')[0]}`;
            const ownerJid = sanitizeJid(config.OWNER_NUMBER);
            let errorReply = `🧠 System glitch. My circuits don spark small. Try ask again.`; // Default

            if (error.message?.includes("AI request blocked due to")) { errorReply = `⚠️ System block dat one. Reason: ${error.message.split(': ').pop()}. Try different question or image.`; }
            else if (error.message?.includes("Invalid/empty response received")) { /* ... handle specific finish reasons ... */ }
            else if (error.message?.includes("API key not valid")) { errorReply = `⚙️ Brain box wan reset... API key no gree work. Make Oga ${ownerMention} check am!`; }
            // ... (other specific error replies) ...

            const mentionsInErrorReply = errorReply.includes(ownerMention) ? [ownerJid] : [];
            await sendReply(context, errorReply, mentionsInErrorReply);
        } catch (replyError) { logger.error("[AI Response] Failed sending AI error notification:", replyError); }
        aiText = null;
    } finally {
        // --- Set presence to paused ---
        if (presenceUpdated) { try { /* ... send paused ... */ } catch (presenceError) { /* ... */ } }
    }
    return aiText;
}
// ================== Rate Limiting ================== //
/**
 * Checks if a user has exceeded the command rate limit.
 */
async function checkRateLimit(context, commandName) {
    if (!context || isAdmin(context.sender)) { return true; }
    const now = Date.now(); const userId = context.sender;
    const lastUsedTimestamp = state.commandTimestamps.get(userId) || 0;
    const timePassedMs = now - lastUsedTimestamp;
    if (timePassedMs < config.RATE_LIMIT_MS) {
        const remainingSeconds = Math.ceil((config.RATE_LIMIT_MS - timePassedMs) / 1000);
        logger.warn(`[Rate Limit] User ${userId} rate-limited for command '${commandName}'. Wait ${remainingSeconds}s.`);
        await sendReply(context, `⏳ Oga cool down small... Too much command dey heat my engine! Try again in ${remainingSeconds} second(s).`);
        return false;
    }
    state.commandTimestamps.set(userId, now);
    return true;
}


// ================== Utility Functions ================== //
// (Should be placed after imports/constants/state, before command handlers)

/**
 * Sends a reply message, quoting the original message context.
 * Standard Version (v1 - with quoting)
 * @param {object} context The parsed message context.
 * @param {string} text The text message to send.
 * @param {string[]} [mentions=[]] Optional array of JIDs to mention.
 * @returns {Promise<import('@whiskeysockets/baileys').proto.WebMessageInfo|undefined>} The sent message info or undefined on error.
 */
async function sendReply(context, text, mentions = []) {
    const logPrefix = "[sendReply v1]";
    if (!sockInstance) { logger.error(`${logPrefix} Failed: sockInstance unavailable.`); return undefined; }
    if (!context?.chatId || !context.key || !context.msg) { logger.error(`${logPrefix} Failed: Invalid context.`, { ctx: !!context }); return undefined; }

    try {
        // Ensure text is a string
        text = String(text || '');
        mentions = Array.isArray(mentions) ? mentions : [];

        logger.debug(`${logPrefix} Attempting to send reply to ${context.chatId} quoting ${context.key.id}.`);
        const sentMsg = await sockInstance.sendMessage(
            context.chatId,
            { text: text, mentions: mentions },
            { quoted: context.msg } // <<< Quoting restored
        );
        logger.debug(`${logPrefix} Reply sent successfully. ID: ${sentMsg?.key?.id}`);
        return sentMsg;

    } catch (error) {
        logger.error(`${logPrefix} FAILED to send reply message:`);
        logger.error(`${logPrefix} Error Details:`, {
             chatId: context?.chatId,
             quoteIdAttempted: context?.key?.id,
             errorName: error?.name,
             errorMessage: error?.message,
             stack: error?.stack?.substring(0, 500) // Log partial stack
            });
        return undefined;
    }
} 
// ... (keep other utility functions like sanitizeJid, getProfilePicture, etc.) ... 


/**
 * Fetches the profile picture URL for a given JID.
 */
async function getProfilePicture(jid) {
     if (!sockInstance || !jid) { return config.DEFAULT_AVATAR; }
    try {
        const url = await sockInstance.profilePictureUrl(jid, 'image');
        return url || config.DEFAULT_AVATAR;
    } catch (error) {
        if (!error.message?.includes('404') && !error.message?.includes('not found')) { logger.warn(`[PP] Error fetching profile picture for ${jid}: ${error.message}`); }
        return config.DEFAULT_AVATAR;
    }
}

/**
 * Downloads media content from a message object using Baileys utility.
 */
async function downloadMedia(msg) {
    if (!sockInstance || !msg) { logger.warn("[Download] Socket or message object missing."); return null; }
    try {
        // Use Baileys download function directly
        const buffer = await downloadMediaMessage(msg, 'buffer', {}, { logger: logger.child({ module: 'media-download' }), reuploadRequest: sockInstance.updateMediaMessage });
        if (!(buffer instanceof Buffer) || buffer.length === 0) {
            logger.error('[Download] Downloaded media is not a valid/non-empty Buffer.', { type: typeof buffer, len: buffer?.length, id: msg?.key?.id });
            return null;
        }
        return buffer;
    } catch (error) {
        logger.error('[Download] Media download failed:', { id: msg?.key?.id, err: error.message });
        return null;
    }
}

/**
 * Fetches JIDs of all groups the bot is currently participating in.
 * @returns {Promise<string[]>} Array of group JIDs.
 */
async function fetchAllGroupJids() {
    if (!sockInstance) return [];
    try {
        const groups = await sockInstance.groupFetchAllParticipating();
        // Object.keys gives an array of the group JIDs
        const groupJids = Object.keys(groups);
        logger.info(`[Helper] Fetched ${groupJids.length} participating group JIDs.`);
        return groupJids;
    } catch (e) {
        logger.error("[Helper] Failed to fetch group list:", e);
        return []; // Return empty array on error
    }
}

/**
 * Finds group JIDs that match a given name query (case-insensitive contains search).
 * @param {string} nameQuery The group name (or part of it) to search for.
 * @returns {Promise<string[]>} Array of matching group JIDs.
 */
async function findGroupJidByName(nameQuery) {
     if (!sockInstance || !nameQuery) return [];
     const lowerCaseQuery = nameQuery.toLowerCase().trim();
     if (!lowerCaseQuery) return []; // Don't search for empty string

     try {
         const groups = await sockInstance.groupFetchAllParticipating();
         const matches = [];
         for (const jid in groups) {
             // Ensure subject exists and is a string before calling toLowerCase
             const subject = groups[jid]?.subject;
             if (typeof subject === 'string' && subject.toLowerCase().includes(lowerCaseQuery)) {
                 matches.push(jid);
             }
         }
         logger.info(`[Helper] Found ${matches.length} group(s) matching query "${nameQuery}".`);
         return matches; // Return array of matching JIDs
     } catch (e) {
         logger.error(`[Helper] Failed to find group by name "${nameQuery}":`, e);
         return []; // Return empty array on error
     }
}




// ================== Group Management ================== //
/**
 * Handles group participant updates (add, remove, promote, demote).
 */
async function handleGroupUpdate({ id, participants, action }) {
    if (!id || !participants?.length || !action) { return; }
    const chatId = sanitizeJid(id);
    if (!chatId) { logger.warn("[Group Update] Failed to sanitize group ID:", id); return; }
    logger.info(`[Group Update] Event received for group ${chatId}. Action: ${action}. Participants: ${participants.join(', ')}`);
    const groupSettings = getGroupSettings(chatId);
    try {
        const botJid = sanitizeJid(config.OWNER_NUMBER);
        const affectedUsers = participants.map(p => sanitizeJid(p)).filter(p => p && p !== botJid);
        if (affectedUsers.length === 0) { return; }
        switch (action) {
            case 'add': if (groupSettings.welcomeEnabled) { logger.info(`[Group Update] Welcoming ${affectedUsers.length} new member(s) to ${chatId}`); for (const userId of affectedUsers) { await sendWelcomeMessage(chatId, userId); await new Promise(r => setTimeout(r, 500)); } } break;
            case 'remove': if (groupSettings.goodbyeEnabled) { logger.info(`[Group Update] Saying goodbye to ${affectedUsers.length} member(s) from ${chatId}`); for (const userId of affectedUsers) { await sendGoodbyeMessage(chatId, userId); await new Promise(r => setTimeout(r, 500)); } } break;
            case 'promote': logger.info(`[Group Update] User(s) promoted in ${chatId}: ${affectedUsers.join(', ')}`); break;
            case 'demote': logger.info(`[Group Update] User(s) demoted in ${chatId}: ${affectedUsers.join(', ')}`); break;
            default: logger.warn(`[Group Update] Unhandled action: ${action}`); break;
        }
    } catch (error) { logger.error(`[Group Update] Error processing group update (${action}, ${chatId})`, error); }
}

// ================== Group Greetings System ================== //

/**
 * Sends a styled welcome message to a new group member with profile picture.
 * Falls back to default avatar or text-only on errors.
 * v2: Added box styling to text.
 * @param {string} chatId The JID of the group.
 * @param {string} userId The JID of the new user.
 */
async function sendWelcomeMessage(chatId, userId) {
    // Basic validation
    if (!sockInstance || !chatId || !userId) {
        logger.warn("[Welcome v2] Missing sockInstance, chatId, or userId.");
        return;
    }

    // Ensure group settings allow welcome messages
    const groupSettings = getGroupSettings(chatId);
    if (!groupSettings.welcomeEnabled) {
        logger.debug(`[Welcome v2] Welcome message disabled for group ${chatId}. Skipping for ${userId}.`);
        return;
    }
    logger.info(`[Welcome v2] Attempting to welcome ${userId} to ${chatId}`);

    let metadata;
    let userName = userId.split('@')[0]; // Default username is number part
    let memberNumber = '?';

    try {
        // --- Get Group Metadata ---
        try {
            metadata = await sockInstance.groupMetadata(chatId);
            memberNumber = metadata.participants.length; // Get current member count
            // Try to get user's pushName (might not always be available)
            const userInfo = metadata.participants.find(p => p.id === userId);
            if (userInfo?.name) userName = userInfo.name;
            else if (userInfo?.pushName) userName = userInfo.pushName; // Use pushName if available
             logger.debug(`[Welcome v2] Metadata fetched. Group: ${metadata.subject}, Member count: ${memberNumber}, User name: ${userName}`);
        } catch (metaError) {
             logger.warn(`[Welcome v2] Failed to get group metadata for ${chatId}: ${metaError.message}. Using defaults.`);
             metadata = { subject: 'this group' }; // Basic fallback
        }

        // --- Prepare Image Buffer ---
        let imageBuffer;
        try {
            logger.debug(`[Welcome v2] Fetching profile picture for ${userId}`);
            const ppUrl = await sockInstance.profilePictureUrl(userId, 'image');
            const response = await fetch(ppUrl);
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            imageBuffer = await response.buffer();
             logger.debug(`[Welcome v2] User profile picture fetched.`);
        } catch (ppError) {
            logger.warn(`[Welcome v2] Failed fetching user PP (${ppError.message}). Trying default avatar: ${config.DEFAULT_AVATAR}`);
            try {
                 const defaultResponse = await fetch(config.DEFAULT_AVATAR);
                 if (!defaultResponse.ok) throw new Error(`HTTP ${defaultResponse.status} fetching default`);
                 imageBuffer = await defaultResponse.buffer();
                 logger.debug(`[Welcome v2] Default avatar fetched.`);
            } catch (defaultError) {
                 logger.error(`[Welcome v2] Failed fetching default avatar: ${defaultError.message}. Will send text only.`);
                 imageBuffer = null; // Ensure null if default fails
            }
        }
        // --- End Image Buffer ---

        // --- Construct Styled Text ---
        const joinTime = new Date().toLocaleString('en-GB', { dateStyle: 'short', timeStyle: 'short', hour12: false }).replace(/,/g,'');
        // Use @mention format in the message text
        const userMention = `@${userId.split('@')[0]}`;

        const welcomeCaption = `
╭───═━「 *WELCOME* 」━═───╮
│
│  🎉 Welcome ${userMention}! 🎉
│
│  Glad to have you in *${metadata.subject}*!
│  You are member #${memberNumber} ✨
│
│  🕒 Joined: ${joinTime}
│
│  *Important:* Please check the group
│  description/rules. Enjoy your stay!
│
╰───═━「 ~ ${config.BOT_NAME} 」━═───╯
        `.trim();
        // --- End Styled Text ---

        // --- Send Message ---
        if (imageBuffer) {
            // Send image with styled caption
            await sockInstance.sendMessage(chatId, {
                 image: imageBuffer,
                 caption: welcomeCaption,
                 mentions: [userId] // Include JID for clickable mention
             });
            logger.info(`[Welcome v2] Sent welcome with image to ${userId} in ${chatId}`);
        } else {
             // Send text only if all image attempts failed
             logger.info(`[Welcome v2] Sending text-only welcome for ${userId} in ${chatId}`);
             // Need to re-create the text slightly without assuming an image is coming
             const welcomeTextOnly = `
╭───═━「 *WELCOME* 」━═───╮
│
│  🎉 Welcome ${userMention}! 🎉
│
│  Glad to have you in *${metadata.subject}*!
│  You are member #${memberNumber} ✨
│
│  🕒 Joined: ${joinTime}
│
│  *Important:* Please check the group
│  description/rules. Enjoy your stay!
│  *(Couldn't fetch profile picture)*
│
╰───═━「 ~ ${config.BOT_NAME} 」━═───╯
             `.trim();
             await sockInstance.sendMessage(chatId, { text: welcomeTextOnly, mentions: [userId] });
        }
        // --- End Send Message ---

    } catch (error) {
        logger.error(`[Welcome v2] Unexpected error welcoming ${userId} to ${chatId}:`, error);
        // Final fallback text in case of other errors
        await sockInstance.sendMessage(chatId, {
             text: `👋 Welcome @${userId.split('@')[0]}!`,
             mentions: [userId]
         }).catch(e=>logger.error("Failed sending final fallback welcome.", e));
    }
}


/**
 * Sends a styled goodbye message when a user leaves or is removed.
 * Attempts to include the user's profile picture. Falls back to default or text-only.
 * v2: Added box styling to text.
 * @param {string} chatId The JID of the group.
 * @param {string} userId The JID of the user who left.
 */
async function sendGoodbyeMessage(chatId, userId) {
    // Basic validation
    if (!sockInstance || !chatId || !userId) {
        logger.warn("[Goodbye v2] Missing sockInstance, chatId, or userId.");
        return;
    }

    // Ensure group settings allow goodbye messages
    const groupSettings = getGroupSettings(chatId);
    if (!groupSettings.goodbyeEnabled) {
        logger.debug(`[Goodbye v2] Goodbye message disabled for group ${chatId}. Skipping for ${userId}.`);
        return;
    }
     logger.info(`[Goodbye v2] Attempting to say goodbye to ${userId} from ${chatId}`);


    let metadata;
    let userName = userId.split('@')[0]; // Default username
    let memberCount = '?'; // Placeholder

    try {
         // --- Get Group Metadata ---
         // Fetch metadata to get group name and potential member count AFTER user leaves
        try {
            metadata = await sockInstance.groupMetadata(chatId);
            // Member count will be the count *after* the update event fires, so it's already reduced
            memberCount = metadata.participants.length;
             // Try to get user's name from metadata participants list *before* they fully disappear?
             // This might be unreliable as the event might fire after they are removed from the list.
             // const userInfo = metadata.participants.find(p => p.id === userId); // This might fail
             // if (userInfo?.name) userName = userInfo.name;
             // else if (userInfo?.pushName) userName = userInfo.pushName;
             // Sticking with number for goodbye might be safer if name isn't easily available post-event.
             logger.debug(`[Goodbye v2] Metadata fetched. Group: ${metadata.subject}, Remaining members: ${memberCount}`);
        } catch (metaError) {
             logger.warn(`[Goodbye v2] Failed to get group metadata for ${chatId}: ${metaError.message}. Using defaults.`);
             metadata = { subject: 'this group' }; // Basic fallback
             memberCount = '??'; // Unknown count
        }

        // --- Prepare Image Buffer ---
        let imageBuffer;
        try {
            logger.debug(`[Goodbye v2] Fetching profile picture for departed user ${userId}`);
            const ppUrl = await sockInstance.profilePictureUrl(userId, 'image');
            const response = await fetch(ppUrl);
            // 404/403 is common if user removed PP or due to privacy after leaving
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            imageBuffer = await response.buffer();
            logger.debug(`[Goodbye v2] User profile picture fetched.`);
        } catch (ppError) {
             if (ppError.message?.includes('404') || ppError.message?.includes('403')) {
                 logger.info(`[Goodbye v2] User PP not found/private for ${userId}. Trying default.`);
             } else {
                 logger.warn(`[Goodbye v2] Failed fetching user PP (${ppError.message}). Trying default avatar: ${config.DEFAULT_AVATAR}`);
             }
            try {
                 const defaultResponse = await fetch(config.DEFAULT_AVATAR);
                 if (!defaultResponse.ok) throw new Error(`HTTP ${defaultResponse.status} fetching default`);
                 imageBuffer = await defaultResponse.buffer();
                 logger.debug(`[Goodbye v2] Default avatar fetched.`);
            } catch (defaultError) {
                 logger.error(`[Goodbye v2] Failed fetching default avatar: ${defaultError.message}. Will send text only.`);
                 imageBuffer = null;
            }
        }
        // --- End Image Buffer ---


        // --- Construct Styled Text ---
        const leaveTime = new Date().toLocaleString('en-GB', { dateStyle: 'short', timeStyle: 'short', hour12: false }).replace(/,/g,'');
        const userMention = `@${userId.split('@')[0]}`; // Use number for mention

        const goodbyeCaption = `
╭───═━「 *FAREWELL* 」━═───╮
│
│  👋 Goodbye, ${userMention}! 👋
│
│  You have left *${metadata.subject}*.
│  We hope to see you again!
│
│  🕒 Left: ${leaveTime}
│  (${memberCount} members remaining)
│
╰───═━「 ~ ${config.BOT_NAME} 」━═───╯
        `.trim();
        // --- End Styled Text ---


        // --- Send Message ---
        if (imageBuffer) {
            // Send image with styled caption
            await sockInstance.sendMessage(chatId, {
                 image: imageBuffer,
                 caption: goodbyeCaption,
                 mentions: [userId]
             });
             logger.info(`[Goodbye v2] Sent goodbye with image for ${userId} from ${chatId}`);
        } else {
             // Send text only if all image attempts failed
             logger.info(`[Goodbye v2] Sending text-only goodbye for ${userId} from ${chatId}`);
             const goodbyeTextOnly = `
╭───═━「 *FAREWELL* 」━═───╮
│
│  👋 Goodbye, ${userMention}! 👋
│
│  You have left *${metadata.subject}*.
│  We hope to see you again!
│
│  🕒 Left: ${leaveTime}
│  (${memberCount} members remaining)
│  *(Couldn't fetch profile picture)*
│
╰───═━「 ~ ${config.BOT_NAME} 」━═───╯
             `.trim();
             await sockInstance.sendMessage(chatId, { text: goodbyeTextOnly, mentions: [userId] });
        }
        // --- End Send Message ---

    } catch (error) {
        logger.error(`[Goodbye v2] Unexpected error saying goodbye to ${userId} from ${chatId}:`, error);
        // Final fallback text
         await sockInstance.sendMessage(chatId, {
             text: `👋 Goodbye @${userId.split('@')[0]}!`,
             mentions: [userId]
         }).catch(e=>logger.error("Failed sending final fallback goodbye.", e));
    }
}
 
 
 
// --- Group Settings Management ---
/**
 * Retrieves the settings object for a given group chat ID.
 */
function getGroupSettings(chatId) {
    if (!state.groupSettings.has(chatId)) {
        logger.debug(`[Settings] Initializing default settings for group: ${chatId}`);
        state.groupSettings.set(chatId, { aiEnabled: true, welcomeEnabled: true, goodbyeEnabled: true, spamFilter: true, linkProtection: true });
    }
    return state.groupSettings.get(chatId);
}


// ================== Error Handling ================== //
/**
 * Handles errors that occur during the message processing pipeline.
 */
function handleMessageError(error, msg, context) {
    const messageId = msg?.key?.id || 'N/A';
    if (error instanceof Boom && error.output?.statusCode === 400 && error.message.includes('failed to decrypt')) { logger.warn(`[Error Handler] Decryption fail for msg ${messageId}. Ignoring.`); return; }
    if (error.message?.includes('Bad MAC') || error.message?.includes('SenderKeyRecord not found')) { logger.warn(`[Error Handler] Encryption key error for msg ${messageId}. Ignoring.`); return; }
    logger.error('[Error Handler] Error processing message:', { error: error.message, stack: error.stack?.substring(0, 500), mid: messageId, chat: context?.chatId || msg?.key?.remoteJid || '?', sender: context?.sender || msg?.key?.participant || msg?.key?.remoteJid || '?', text: context?.text?.substring(0, 50) || 'N/A' });
    if (context?.chatId && sockInstance) { sockInstance.sendMessage(context.chatId, { text: "⚠️ Bot error occurred processing that message." }).catch(e => logger.error("[Error Handler] Failed sending error notification to chat:", e)); }
    const isBoomError = error instanceof Boom; const statusCode = isBoomError ? error.output?.statusCode : null;
    const shouldNotifyOwner = config.OWNER_NUMBER && (!isBoomError || (statusCode && statusCode >= 500));
    if (shouldNotifyOwner) { sendErrorToOwner(error, msg, context); }
}

/**
 * Helper function to send detailed error reports to the bot owner.
 */
async function sendErrorToOwner(error, msg, context) {
    const ownerJid = sanitizeJid(config.OWNER_NUMBER);
    if (!sockInstance || !ownerJid || !error) { return; }
    try {
        const errorSummary = `🚨 *${config.BOT_NAME} Error Alert!* 🚨\n\n` + `*Time:* ${new Date().toLocaleString('en-GB')}\n` +
                             `*Chat:* ${context?.chatId || msg?.key?.remoteJid || 'Unknown'}\n` + `*Sender:* ${context?.sender || msg?.key?.participant || msg?.key?.remoteJid || 'Unknown'}\n` +
                             `*Message ID:* ${msg?.key?.id || 'N/A'}\n\n` + `*Error Type:* ${error.name || 'Error'}\n` + `*Error:* ${error.message}\n\n` +
                             `*Stack (Partial):*\n\`\`\`${error.stack?.substring(0, 600) || 'N/A'}\`\`\``;
        if (sockInstance.ws?.readyState === 1) { await sockInstance.sendMessage(ownerJid, { text: errorSummary }); logger.info(`[Owner Notify] Sent error report to owner: ${ownerJid}`); }
        else { logger.warn("[Owner Notify] Socket not open. Skipping sending error report to owner."); }
    } catch (e) { logger.error("[Owner Notify] Failed sending error report to owner:", { owner: ownerJid, errorMsg: e.message }); }
}

// --- Process-Level Error Handlers ---
process.on('uncaughtException', async (error) => {
    // --- DIRECT CONSOLE LOGGING ---
    console.error("\n\n!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!");
    console.error("!!! RAW UNCAUGHT EXCEPTION CAUGHT !!!");
    console.error("!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!");
    console.error("Error Object:", error); // Log the raw error object directly
    console.error("---------------------------------------");
    console.error("Error Stack:", error?.stack || 'No stack trace available'); // Log stack directly
    console.error("!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!");
    // --- END DIRECT CONSOLE LOGGING ---

    // Original logger call (might still not show details, but keep it)
    logger.fatal('CRITICAL UNCAUGHT EXCEPTION:', { message: error?.message || 'No message', stack: error?.stack || 'No stack' });

    // Let's skip sending to owner during crash for now, socket might not be ready
    // await sendErrorToOwner(error, null, null);

    // Still shutdown
    await gracefulShutdown(true, 'uncaughtException');
});

process.on('unhandledRejection', async (reason, promise) => {
     // --- DIRECT CONSOLE LOGGING ---
    console.error("\n\n!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!");
    console.error("!!! RAW UNHANDLED REJECTION CAUGHT !!!");
    console.error("!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!");
    console.error("Reason:", reason); // Log the raw reason directly
    console.error("---------------------------------------");
    console.error("Reason Stack:", reason?.stack || 'No stack trace available'); // Log stack directly
    console.error("!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!");
    // --- END DIRECT CONSOLE LOGGING ---

     logger.error('CRITICAL UNHANDLED REJECTION:', { reason: reason?.message || reason, stack: reason?.stack });

     // Skip sending to owner during crash
     // const syntheticError = reason instanceof Error ? reason : new Error(String(reason || 'Unknown Rejection Reason'));
     // await sendErrorToOwner(syntheticError, null, null);
});
 

// ================== Admin Verification ================== //
/**
 * Checks if a given user JID belongs to the bot owner.
 */
function isAdmin(userId) {
    if (!userId || !config.OWNER_NUMBER) { return false; }
    const cleanUserId = sanitizeJid(userId); const ownerJid = sanitizeJid(config.OWNER_NUMBER);
    return ownerJid && cleanUserId === ownerJid;
}

/**
 * Handles the !title command. Shows the current Role Title (and Level) for the user
 * or a mentioned user, fetching data from Supabase.
 * v4 Supabase: Reads from Supabase users_data table.
 * @param {object} context Parsed message context
 * @param {string[]} args Command arguments (not used directly, uses mentions)
 */
async function handleTitleCommand(context, args) {
    const senderJid = context.sender;
    let targetJid = senderJid; // Default to the person sending the command
    let isCheckingSelf = true;
    const defaultRole = LEVEL_ROLES[0]?.title || 'N/A'; // Default for level 0
    const logPrefix = "[Title Cmd Supabase]";

    // Check if Supabase client is initialized
    if (!supabase) {
        logger.warn(`${logPrefix} Supabase client not initialized. Cannot fetch title data.`);
        await sendReply(context, "⚠️ Bot is having trouble connecting to the user database. Please try again later.");
        return;
    }

    // Determine target user
    if (context.mentions && context.mentions.length > 0) {
        targetJid = context.mentions[0]; // Target the first mentioned user
        isCheckingSelf = false;
        logger.info(`${logPrefix} ${senderJid} requested title for mentioned user ${targetJid}`);
    } else {
        logger.info(`${logPrefix} ${senderJid} requested own title.`);
    }

    try {
        // Fetch target user's data from Supabase
        logger.debug(`${logPrefix} Fetching data for ${targetJid} from Supabase...`);
        const { data: targetUserData, error: findError } = await supabase
            .from('users_data') // Your table name
            .select('level, title') // Select only needed fields
            .eq('user_id', targetJid)
            .single(); // Expects one row or null

        if (findError && findError.code !== 'PGRST116') { // PGRST116: "Query returned no rows"
            throw new Error(`Supabase find user error: ${findError.message} (Code: ${findError.code})`);
        }

        let displayData;
        // If user has no data in DB yet
        if (!targetUserData) {
            displayData = {
                level: 0,
                title: getTitleForLevel(0) || defaultRole
            };
            logger.debug(`${logPrefix} No data found for ${targetJid}, showing defaults.`);
        } else {
            displayData = targetUserData;
            // Ensure title is present or calculated if missing from DB record
            if (!displayData.title) {
                 displayData.title = getTitleForLevel(displayData.level) || defaultRole;
            }
        }

        const targetLevel = displayData.level;
        const targetTitleDisplay = displayData.title;

        // Format the reply message
        let replyText = '';
        let mentions = [];

        if (isCheckingSelf) {
            replyText = `✨ Your current title is: *${targetTitleDisplay}* (Level ${targetLevel})`;
        } else {
            const targetMentionString = `@${targetJid.split('@')[0]}`;
            replyText = `✨ ${targetMentionString}'s current title is: *${targetTitleDisplay}* (Level ${targetLevel})`;
            mentions.push(targetJid); // Add target JID to mentions array for clickable mention
        }

        // Send the reply
        await sendReply(context, replyText.trim(), mentions);
        logger.info(`${logPrefix} Sent title info for ${targetJid}. Title: ${targetTitleDisplay}, Level: ${targetLevel}`);

    } catch (error) {
        logger.error(`${logPrefix} Failed to fetch title data for ${targetJid}:`, { message: error.message, stack: error.stack?.substring(0,500) });
        await sendReply(context, "⚠️ An error occurred while fetching title data from the database.");
        await sendErrorToOwner(new Error(`Supabase Error in !title for ${targetJid}: ${error.message}`), context.msg, context);
    }
}




/**
 * Handles the !theft command. Randomly "accuses" a group member
 * of stealing something silly for fun.
 * @param {object} context Parsed message context
 * @param {string[]} args Command arguments (not used)
 */
async function handleTheftDetectorCommand(context, args) {
    // Ensure command is used in a group
    if (!context.isGroup) {
        await sendReply(context, "❌ This accusation game is for groups only!");
        return;
    }

    const senderJid = context.sender;
    const chatId = context.chatId;
    logger.info(`[TheftDetector Cmd] Activated by ${senderJid} in group ${chatId}`);

    try {
        // Get group members
        const metadata = await sockInstance.groupMetadata(chatId);
        if (!metadata || !metadata.participants || metadata.participants.length <= 1) {
            await sendReply(context, "🤷‍♀️ Who I go accuse? E be like say na only me and you dey here, or I can't see other members.");
            return;
        }

        // Filter out the bot itself from potential targets
        const botJid = sanitizeJid(config.BOT_PRIMARY_JID || sockInstance?.user?.id);
        const potentialTargets = metadata.participants.filter(p => sanitizeJid(p.id) !== botJid);

        if (potentialTargets.length === 0) {
            await sendReply(context, "😂 Looks like it's just me (the bot) here. I can't accuse myself of stealing... or can I? 🤔");
            return;
        }

        // Randomly select a target from the filtered list
        const randomTarget = potentialTargets[Math.floor(Math.random() * potentialTargets.length)];
        const targetJid = sanitizeJid(randomTarget.id);
        const targetNum = targetJid.split('@')[0];

        // --- List of funny/silly "stolen items" or accusations ---
        // Feel free to customize these!
        const accusations = [
            `stole the last piece of meat from the pot! 🍖 We know it was you!`,
            `don hide the group's remote control for good vibes! 📺 Bring am back!`,
            `is the reason my data dey finish fast! Confess your downloads! 📶`,
            `secretly replaced the sugar with salt this morning! 🧂 My tea is ruined!`,
            `borrowed my charger since last week and never returned it! 🔌 I need my power back!`,
            `has been hoarding all the good jokes! Share the laughter! 😂`,
            `ate the emergency biscuit I was saving! 🍪 I'm watching you!`,
            `changed the group admin's WhatsApp status to "I love TonnaBot"! 😉`,
            `is the one who keeps leaving the group chat on read! We see you! 👀`,
            `finished all the data allocated for group memes! 🤦‍♀️`
        ];
        // --- End Accusations List ---

        // Pick a random accusation
        const randomAccusation = accusations[Math.floor(Math.random() * accusations.length)];

        // Format the reply message
        const replyText = `🚨 *THIEF DETECTED! OLE!* 🚨\n` +
                          `────────────────────\n` +
                          `My advanced spiritual-digital sensors indicate that @${targetNum} ${randomAccusation}\n` +
                          `────────────────────\n` +
                          `Abeg, confess your sins now before we involve EFCC! 🤣`;

        // Send the accusation, mentioning the target
        await sockInstance.sendMessage(chatId, {
            text: replyText,
            mentions: [targetJid] // Mention the accused user
           }, { quoted: context.msg }); // Quote the command message

        logger.info(`[TheftDetector Cmd] Accused ${targetJid} in group ${chatId}.`);

    } catch (error) {
        logger.error(`[TheftDetector Cmd] Failed for group ${chatId}:`, error);
        await sendReply(context, "⚠️ My theft detector seems to be malfunctioning... everyone is safe for now!");
        await sendErrorToOwner(error, context.msg, context);
        // Let processCommands handle "Wahala dey" if needed by re-throwing
        throw error;
    }
}



/**
 * Handles the !juju command. Generates funny, fake "secrets" about
 * a mentioned user using AI, pretending to be mystical.
 * @param {object} context Parsed message context
 * @param {string[]} args Command arguments (not used directly, uses mentions)
 */
async function handleJujuCommand(context, args) {
    const senderJid = context.sender;

    // Check if a user was mentioned
    const targetJid = context.mentions?.[0]; // Get first mentioned user
    if (!targetJid) {
        await sendReply(context, `❓ Who you wan check their spiritual bluetooth? Use: ${config.COMMAND_PREFIX}juju @user`);
        return;
    }

    // Optional: Prevent targeting self or bot
    if (targetJid === senderJid) { await sendReply(context, "😂 You wan check yourself? Abeg, use mirror!"); return; }
    if (targetJid === sanitizeJid(config.BOT_PRIMARY_JID)) { await sendReply(context, "🔮 My own secrets are classified!"); return; }


    const targetNum = targetJid.split('@')[0];
    logger.info(`[Juju Cmd] Mystic revelation requested by ${senderJid} for target ${targetJid}`);
    await sendReply(context, `✨ Consulting the digital ancestors about @${targetNum}... Please wait... 🔮`, [targetJid]);


    // --- Prepare Prompt for AI ---
    // Instruct AI to act as TonnaBot in Juju Mode, generating FAKE info
    const jujuPrompt = `You are TonnaBot (${config.BOT_NAME}), currently in Juju Mode, acting like a funny, slightly incompetent village mystic using WhatsApp. A user wants you to reveal secrets about User @${targetNum}. Generate 2-3 SHORT, FUNNY, and ABSOLUTELY FAKE 'secrets' or 'revelations' about them. Make them absurd and harmless, suitable for Nigerian group chat banter. Do NOT reveal any real or sensitive info. Examples: "The spirits whisper @${targetNum} secretly enjoys غولر but tells friends it's Amala", "My spiritual network shows @${targetNum} last cried because onion price high", "I see vision... @${targetNum} favourite pyjamas get cartoon character", "Ancestor revealed @${targetNum} true calling na to sell popcorn for traffic". Mention the user with @${targetNum}. Output *only* the funny revelations.`;
    // --- End Prompt ---

    try {
        const result = await aiModel.generateContent(jujuPrompt);
        const response = result.response;

        // Validate response
        if (!response) { throw new Error('No response received from AI model.'); }
        if (response.promptFeedback?.blockReason) { throw new Error(`AI request blocked due to: ${response.promptFeedback.blockReason}`); }
        const jujuText = response.text().trim();
        if (!jujuText) { throw new Error("AI returned empty text."); }

        logger.info(`[Juju Cmd] Sending fake secrets about ${targetNum}.`);
        // Format and send the generated text
        const replyText = `*🔮 Juju Mode Revelation for @${targetNum} 🔮*\n────────────────────\n` +
                          `${jujuText}\n` +
                          `────────────────────\n` +
                          `_(Disclaimer: Don't take it serious o! Na just play!)_`;

        await sockInstance.sendMessage(context.chatId, {
            text: replyText,
            mentions: [targetJid] // Mention the target user
           }, { quoted: context.msg });


    } catch (error) {
        logger.error(`[Juju Cmd] Failed for target ${targetJid}:`, error);
        if (error.message.includes("AI request blocked")) { await sendReply(context, `⚠️ Spirits dey vex! AI refused request: ${error.message.split(': ').pop()}`); }
        else if (error.message.includes("AI returned empty text")) { await sendReply(context, "😅 Ancestors network slow... couldn't get any gist."); }
        else { await sendReply(context, `⚠️ Error during Juju revelation: ${error.message}`); }
        await sendErrorToOwner(error, context.msg, context);
        throw error;
    }
}




/**
 * Handles the !dna command. Generates a funny, fake DNA comparison
 * for two mentioned users using AI.
 * @param {object} context Parsed message context
 * @param {string[]} args Command arguments (not used directly, uses mentions)
 */
async function handleDnaTestCommand(context, args) {
    // Ensure command is used in a group
    if (!context.isGroup) {
        await sendReply(context, "❌ This command is for group fun only!");
        return;
    }

    // Check for exactly two mentions
    const mentions = context.mentions || [];
    if (mentions.length !== 2) {
        await sendReply(context, `❓ Usage: ${config.COMMAND_PREFIX}dna @User1 @User2`);
        return;
    }

    const targetJid1 = mentions[0];
    const targetJid2 = mentions[1];
    const senderJid = context.sender;

    // Optional: Prevent targeting self? Or bot?
    // if (targetJid1 === senderJid || targetJid2 === senderJid) { /* ... maybe disallow ... */ }

    const targetNum1 = targetJid1.split('@')[0];
    const targetNum2 = targetJid2.split('@')[0];

    logger.info(`[DnaTest Cmd] Requested by ${senderJid} for targets ${targetJid1} and ${targetJid2}`);
    await sendReply(context, `🧬 Analyzing genetic markers for @${targetNum1} and @${targetNum2}... Stand by for highly scientific results... 🔬`, [targetJid1, targetJid2]);


    // --- Prepare Prompt for AI ---
    // Instruct the AI to generate a funny, clearly fake result
    const dnaPrompt = `You are ${config.BOT_NAME} running a fake DNA testing lab for fun in a Nigerian WhatsApp group. Generate a short, funny, absurd, and obviously FAKE DNA compatibility or relationship result between User @${targetNum1} and User @${targetNum2}. Do NOT sound like a real lab. Make it humorous banter. Examples: "99% chance of borrowing charger and not returning", "Shared ancestor discovered: Famous Agege Bread baker", "85% likely to argue about Premier League", "Compatibility level: Can manage small Egusi soup together". Mention both users using @${targetNum1} and @${targetNum2}. Output *only* the funny result/report.`;
    // --- End Prompt ---

    try {
        // Use the main AI model
        const result = await aiModel.generateContent(dnaPrompt);
        const response = result.response;

        // Validate response
        if (!response) { throw new Error('No response received from AI model.'); }
        if (response.promptFeedback?.blockReason) { throw new Error(`AI request blocked due to: ${response.promptFeedback.blockReason}`); }
        const dnaResultText = response.text().trim();
        if (!dnaResultText) { throw new Error("AI returned an empty result."); }

        // Format the final reply
        const replyText = `*🧪 DNA Test Results 🧪*\n────────────────────\n` +
                          `*Subjects:* @${targetNum1} & @${targetNum2}\n\n` +
                          `*Finding:* ${dnaResultText}\n\n` +
                          `────────────────────\n` +
                          `_(Disclaimer: Results are 100% fake & for entertainment purposes only!)_`;

        // Send the result, mentioning both targets
        await sockInstance.sendMessage(context.chatId, {
             text: replyText,
             mentions: [targetJid1, targetJid2]
            }, { quoted: context.msg }); // Quote the command message

        logger.info(`[DnaTest Cmd] Sent fake DNA results for ${targetNum1} and ${targetNum2}.`);

    } catch (error) {
        logger.error(`[DnaTest Cmd] Failed for targets ${targetNum1}, ${targetNum2}:`, error);
        // Handle specific errors if needed
        if (error.message.includes("AI request blocked")) { await sendReply(context, `⚠️ AI refused to process this DNA request: ${error.message.split(': ').pop()}`); }
        else if (error.message.includes("AI returned empty result")) { await sendReply(context, "😅 AI brain freeze... couldn't generate a DNA result."); }
        else { await sendReply(context, `⚠️ Error during DNA test: ${error.message}`); }
        await sendErrorToOwner(error, context.msg, context);
        throw error; // Let processCommands handle final message
    }
}



/**
 * Handles the !rewards command. Lists the available role titles
 * and the minimum level required to achieve them, based on LEVEL_ROLES.
 * @param {object} context Parsed message context
 * @param {string[]} args Command arguments (not used)
 */
async function handleRewardsCommand(context, args) {
    logger.info(`[Rewards Cmd] Listing roles and levels for ${context.sender}`);

    // Check if the LEVEL_ROLES constant is defined and not empty
    // Assumes LEVEL_ROLES is defined globally or accessible in this scope
    if (typeof LEVEL_ROLES === 'undefined' || !Array.isArray(LEVEL_ROLES) || LEVEL_ROLES.length === 0) {
        logger.error("[Rewards Cmd] LEVEL_ROLES constant is not defined, is not an array, or is empty.");
        await sendReply(context, "⚠️ The list of level rewards (roles) is not configured correctly.");
        return;
    }

    // Start building the reply string
    let replyText = "🏆 *Level Rewards & Titles* 🏆\n";
    replyText += "────────────────────\n";
    replyText += "Reach these levels to unlock titles:\n\n"; // Intro text

    // Iterate through the LEVEL_ROLES array (which should be sorted by level)
    LEVEL_ROLES.forEach(role => {
        // Add a line for each role: Level X: Title
        replyText += ` • *Level ${role.level}* → ${role.title}\n`;
    });

    // Add a closing line
     replyText += `────────────────────\nKeep chatting to climb the ranks!`;

    // Send the formatted text
    await sendReply(context, replyText.trim());
}



/**
 * Handles the !vibecheck command. Replies with a random, persona-based
 * assessment of the sender's or a mentioned user's vibe.
 * @param {object} context Parsed message context
 * @param {string[]} args Command arguments (used to check for mentions)
 */
async function handleVibeCheckCommand(context, args) {
    const senderJid = context.sender;
    let targetJid = senderJid; // Default to checking the sender
    let targetDescriptor = "Your"; // Pronoun for the reply text

    // Check if another user was mentioned
    if (context.mentions && context.mentions.length > 0) {
        targetJid = context.mentions[0]; // Target the first mentioned user
        // Use @number format for mentioning in the reply
        targetDescriptor = `@${targetJid.split('@')[0]}'s`;
        logger.info(`[VibeCheck Cmd] ${senderJid} requested vibe check for mentioned user ${targetJid}`);
    } else {
        logger.info(`[VibeCheck Cmd] ${senderJid} requested own vibe check.`);
    }

    // --- List of Possible Vibe Check Responses ---
    const vibeResults = [
        `vibe check passed! 🔥 You feeling presidential today, no shake. Pure energy!`,
        `vibe check result: Certified O.G. status confirmed! 💯 Carry your shoulder up!`,
        `vibe analysis complete... Result: Maximum CHILL initialized. 🥶 Keep calm and carry on.`,
        `system scan complete... Vibe = CONFIRMED POSITIVE. Shine on! ✨`,
        `hmmm... system detect small voltage drop for your vibe side. Recharge small! 🤔`,
        `vibe check... Result inconclusive. Maybe try again after you chop? 🤷‍♀️`,
        `alert! Saltiness levels approaching maximum (92%)! 🧂 Drink water and mind ya business!`,
        `results loading... You’re either a main character or background extra. Today? Auditions still dey open. 😂`,
        `vibe scanner processing... Warning: High levels of Vawulence detected! Handle with care! ⚠️`,
        `scan complete. Vibe = Under Construction 🚧. Come back later maybe?`,
        `energy signature analysis... Seems like you woke up on the correct side of the bed today. 👍`,
        `na wa for this ${targetDescriptor.toLowerCase()} vibe o... E be like small network issue dey. Reset and try again? 📶`,
        `current vibe status for ${targetDescriptor.toLowerCase()}: *Operational*. Nothing spoil, nothing lost. ✅`,
    ];
    // --- End Response List ---

    // Pick a random result from the array
    const randomResult = vibeResults[Math.floor(Math.random() * vibeResults.length)];

    // Format the reply message
    const replyText = "```\n" +
                      " T O N N A B O T   V I B E   A N A L Y Z E R\n" +
                      "=============================================\n\n" +
                      ` Target        : ${targetDescriptor}\n` +
                      ` Status        : Analyzing...\n` +
                      ` Result        : ${randomResult}\n\n` +
                      "=============================================\n" +
                      "```";

    // Send the reply, include mention only if targeting someone else
    const mentions = (targetJid !== senderJid) ? [targetJid] : [];
    await sendReply(context, replyText, mentions);
    // Optional: Add log after sending
    // logger.info(`[VibeCheck Cmd] Sent vibe check result for ${targetJid}`);
}


// ================== Session Backup ================== //
/**
 * Creates a zip backup of the session directory.
 */
async function backupSession() {
    try { await fs.access(SESSION_DIR); }
    catch (e) { logger.warn(`[Backup] Session directory ${SESSION_DIR} not found or inaccessible. Skipping backup.`); return; }
    logger.info(`[Backup] Attempting session backup from ${SESSION_DIR} to ${SESSION_BACKUP_ZIP}...`);
    try {
        const zip = new AdmZip(); zip.addLocalFolder(SESSION_DIR);
        if (typeof zip.writeZipPromise === 'function') { await zip.writeZipPromise(SESSION_BACKUP_ZIP); }
        else { zip.writeZip(SESSION_BACKUP_ZIP); }
        logger.info(`[Backup] Session backup successfully created: ${SESSION_BACKUP_ZIP}`);
    } catch (error) { logger.error('[Backup] Session backup failed:', error); }
}


// ================== View Once Cleanup ================== //
// Periodically clean up expired view-once media from the store
const viewOnceCleanupTimer = setInterval(() => {
    const now = Date.now();
    let deletedCount = 0;
    logger.debug(`[ViewOnce Cleanup] Running cleanup task. Current store size: ${viewOnceStore.size}`);
    viewOnceStore.forEach((value, key) => {
        // Check if timestamp exists and if it's older than the expiration time
        if (value.timestamp && (now - value.timestamp > VIEW_ONCE_EXPIRATION_MS)) {
            logger.debug(`[ViewOnce Cleanup] Deleting expired entry for ${key}. Age: ${(now - value.timestamp)/1000}s`);
            viewOnceStore.delete(key);
            deletedCount++;
        }
    });
    if (deletedCount > 0) {
        logger.info(`[ViewOnce Cleanup] Removed ${deletedCount} expired view-once media entries.`);
    }
}, VIEW_ONCE_CLEANUP_INTERVAL_MS); // Use constant for interval
logger.info(`View-once cleanup task scheduled every ${VIEW_ONCE_CLEANUP_INTERVAL_MS / 60000} minutes.`);

// ================== Level Data Persistence Helpers ================== //

// ================== Data Persistence Helpers v2 ================== //
// Uses a single file (LEVELS_FILE) to store both levels and keyword counts

/**
 * Loads user data (levels & keyword counts) from LEVELS_FILE asynchronously.
 * Handles file not existing or missing parts.
 */
/**
 * async function loadLevelData() { // Keep  function name for simplicity, though it loads more now
    try {
        logger.info(`[UserData] Attempting to load user data from: ${LEVELS_FILE}`);
        // Check if file exists
        await fs.access(LEVELS_FILE);
        const data = await fs.readFile(LEVELS_FILE, 'utf8');
        const loadedState = JSON.parse(data);

        // Load level data, default to empty object if missing
        state.levelData = loadedState.levelData || {};
        // Load keyword counts, default to empty object if missing
        state.keywordCounts = loadedState.keywordCounts || {};

        logger.info(`[UserData] Successfully loaded user data. Users with Levels: ${Object.keys(state.levelData).length}, Users with Counts: ${Object.keys(state.keywordCounts).length}`);

    } catch (error) {
        if (error.code === 'ENOENT') {
            // File doesn't exist, normal for first run or if deleted
            logger.info(`[UserData] ${LEVELS_FILE} not found. Initializing empty user data.`);
            state.levelData = {};
            state.keywordCounts = {};
        } else {
            // Other errors (parsing, reading permissions)
            logger.error(`[UserData] Failed to load user data from ${LEVELS_FILE}:`, error);
            // Start with empty data on error to prevent crashing
            state.levelData = {};
            state.keywordCounts = {};
        }
    }
}
*


// ================== Database Connection Logic ================== //
/**
 * Connects to the MongoDB Atlas database and sets up the users collection.
 * v2: Adds more detailed error logging in catch block.
 */
async function connectDB() {
    if (!config.MONGODB_URI) {
        logger.error("[DB Connect v2] MONGODB_URI is not configured. Cannot connect.");
        return false;
    }

    logger.info("[DB Connect v2] Attempting to connect to MongoDB Atlas...");
    // Log a part of the URI for verification, hiding credentials
    const uriParts = config.MONGODB_URI.split('@');
    const safeUriPart = uriParts.length > 1 ? `mongodb+srv://<user>:<password>@${uriParts[1]}` : "URI format incorrect";
    logger.debug(`[DB Connect v2] Using URI (credentials hidden): ${safeUriPart}`);

    try {
        dbClient = new MongoClient(config.MONGODB_URI, {
            serverApi: {
                version: ServerApiVersion.v1,
                strict: true,
                deprecationErrors: true,
            }
        });

        await dbClient.connect();
        await dbClient.db("admin").command({ ping: 1 });

        const db = dbClient.db(DB_NAME);
        usersCollection = db.collection(USERS_COLLECTION_NAME);

        try {
            await usersCollection.createIndex({ userId: 1 }, { unique: true });
            logger.info(`[DB Connect v2] Ensured index on 'userId' for collection '${USERS_COLLECTION_NAME}'.`);
        } catch (indexError) {
            if (!indexError.message.includes("Index already exists")) {
                logger.warn(`[DB Connect v2] Could not create index on userId: ${indexError.message}`);
            } else {
                logger.debug(`[DB Connect v2] Index on 'userId' already exists.`);
            }
        }

        logger.info(`[DB Connect v2] Successfully connected to MongoDB Atlas! DB: '${DB_NAME}', Collection: '${USERS_COLLECTION_NAME}'`);
        return true;

    } catch (error) {
        // --- MORE DETAILED ERROR LOGGING ---
        logger.error("[DB Connect v2] CRITICAL: Failed to connect to MongoDB Atlas.");
        logger.error(`[DB Connect v2] Error Name: ${error.name}`);
        logger.error(`[DB Connect v2] Error Message: ${error.message}`);
        // Some MongoDB errors have specific properties, let's try logging common ones:
        if (error.code) logger.error(`[DB Connect v2] Error Code: ${error.code}`);
        if (error.codeName) logger.error(`[DB Connect v2] Error Code Name: ${error.codeName}`);
        if (error.connectionGeneration) logger.error(`[DB Connect v2] Connection Generation: ${error.connectionGeneration}`);
        // Log the full error object if it's not too massive, or at least its known properties
        // logger.error("[DB Connect v2] Full Error Object:", error); // Might be too verbose
        if (error.errorLabels) logger.error(`[DB Connect v2] Error Labels: ${error.errorLabels.join(', ')}`);
        // Log a portion of the stack trace
        logger.error(`[DB Connect v2] Stack Trace (partial): ${error.stack?.substring(0, 1000)}`);
        // --- END DETAILED ERROR LOGGING ---

        dbClient = null;
        usersCollection = null;
        return false;
    }
}
// ================== End Database Connection Logic ================== //




/**
 * Saves the current state.levelData and state.keywordCounts to LEVELS_FILE asynchronously.
 */
/**
  * async function saveLevelData() { // Keep function name for simplicity
    // Only proceed if there's data to save
    const hasLevelData = state.levelData && Object.keys(state.levelData).length > 0;
    const hasKeywordData = state.keywordCounts && Object.keys(state.keywordCounts).length > 0;

    if (!hasLevelData && !hasKeywordData) {
        logger.debug('[UserData] No user data in memory to save.');
        return; // Nothing to save
    }

    // Combine data into one object for saving
    const dataToSave = {
        levelData: state.levelData || {},
        keywordCounts: state.keywordCounts || {}
    };

    try {
        logger.info(`[UserData] Attempting periodic save of user data... Levels: ${Object.keys(dataToSave.levelData).length}, Counts: ${Object.keys(dataToSave.keywordCounts).length}`);
        const dataString = JSON.stringify(dataToSave, null, 2); // Pretty print JSON
        await fs.writeFile(LEVELS_FILE, dataString, 'utf8'); // Overwrite file
        logger.info(`[UserData] User data saved successfully to ${LEVELS_FILE}.`);
    } catch (error) {
        logger.error(`[UserData] Failed to auto-save user data to ${LEVELS_FILE}:`, error);
        await sendErrorToOwner(new Error(`CRITICAL: Failed to save user data (${LEVELS_FILE}): ${error.message}`), null, null);
    }
}

*/

// ================== End Data Persistence Helpers v2 ================== // 
// ================== End Level Data Helpers ================== //


// ================== Bot Startup and Shutdown ================== //
/**
 * Main function to start the bot.
 * v6 TEMPORARY DEBUG: Commented out LOG_DIR creation to isolate startup crash.
 */
async function startBot() {
    try {
        // Use v6 in log prefix for clarity
        logger.info(">>> startBot v6 (Supabase - mkdir test): Entered startBot function");

        // Config validation (keep as before)
        if (!config.GEMINI_API_KEY || !config.OWNER_NUMBER || !config.BOT_PRIMARY_JID || !config.SUPABASE_URL || !config.SUPABASE_SERVICE_KEY) {
            logger.fatal("FATAL: Critical config missing. Check .env.");
             process.exit(1);
        }
        logger.info(`Starting ${config.BOT_NAME}... Config loaded.`);


        // --- TEMPORARILY DISABLED Log Directory Check ---
        logger.info(">>> startBot v6 (Supabase - mkdir test): SKIPPING LOG_DIR check/creation...");
        /* // <<< START COMMENT OUT
        logger.info(">>> startBot v5 (Supabase): Ensuring LOG_DIR exists...");
        try {
            // Ensure fs is correctly imported: import fs from 'fs/promises';
            await fs.mkdir(LOG_DIR, { recursive: true });
            logger.info(`Logging directory ensured at: ${LOG_DIR}`); // Log success
        } catch (mkdirError) {
            logger.error(`!!! CRITICAL ERROR creating/accessing LOG_DIR (${LOG_DIR}) !!!`, { // ... error details ... });
            logger.fatal(">>> startBot v5: Failed to ensure log directory. Exiting.");
            process.exit(1);
        }
        */ // <<< END COMMENT OUT
        // --- End Log Directory Check ---


        // --- Initialize Supabase Client --- (Keep as before)
        logger.info(">>> startBot v6 (Supabase - mkdir test): Attempting to initialize Supabase client...");
        const supabaseInitialized = await connectSupabaseDB(); // Call the Supabase connect function
        if (!supabaseInitialized) {
            logger.fatal(">>> startBot v6 (Supabase - mkdir test): Supabase client initialization failed. Exiting.");
            process.exit(1);
        }
        // Check global client
        if (supabase && typeof supabase.from === 'function') { logger.info("[startBot Supabase Check v6] Global 'supabase' client initialized and looks valid."); }
        else { logger.error("[startBot Supabase Check v6] CRITICAL: Global 'supabase' client check failed after connectSupabaseDB!"); }
        // --- End Supabase Client Init ---


        // --- File-based saving disabled --- (Keep as before)
        logger.info(`[UserData] File-based loading/saving is DISABLED (using Supabase).`);


        // --- Start Health Server & Baileys Connection --- (Keep as before)
        logger.info(">>> startBot v6 (Supabase - mkdir test): Calling startHealthCheckServer");
        startHealthCheckServer();
        logger.info(">>> startBot v6 (Supabase - mkdir test): Calling initializeConnection (Baileys)");
        await initializeConnection();
        logger.info(">>> startBot v6 (Supabase - mkdir test): Returned from initializeConnection (Baileys)");
        logger.info(`--- ${config.BOT_NAME} initialization sequence complete. Waiting for Baileys 'open' event... ---`);

        // --- Timers & Signal Handlers --- (Keep as before)
        if (typeof REPORT_INTERVAL_MS !== 'undefined') { /* ... setInterval(backupSession) ... */ }
        /* ... process.on('SIGINT')... */
        logger.info(">>> startBot v6 (Supabase - mkdir test): Finished setup");

    } catch (error) { // Catch errors from the outer try block in startBot
        logger.fatal('!!! BOT STARTUP FAILED CRITICALLY (Caught in startBot - Outer Catch) !!!', error);
        await sendErrorToOwner(error, null, null).catch(e => logger.error("Failed sending startup failure report", e));
        process.exit(1);
    }
} 



/**
 * Handles graceful shutdown of the bot.
 * Notifies owner, saves Baileys session, attempts final backup.
 * v4: Removed MongoDB client close (Supabase client manages its own connections).
 * @param {boolean} [isCrash=false] Indicates if shutdown is due to a crash.
 * @param {string} [signal='Unknown'] The signal or reason for shutdown.
 */
async function gracefulShutdown(isCrash = false, signal = 'Unknown') {
    logger.warn(`Initiating graceful shutdown... (Reason: ${signal})`);

    // Attempt to notify owner
    if (sockInstance && config.OWNER_NUMBER) {
        try {
            const owner = sanitizeJid(config.OWNER_NUMBER);
            if (sockInstance.ws?.readyState === 1) { // Check if socket is open
                await sockInstance.sendMessage(owner, { text: `🤖 ${config.BOT_NAME} shutting down (${signal})... Be right back!` }).catch(e => logger.error("Failed sending shutdown notification msg to owner:", e));
            } else {
                 logger.warn("[Shutdown] Socket already closed, skipping owner shutdown notification.");
            }
        } catch(e) { logger.error("Error during owner shutdown notification:", e); }
    }

    // --- Supabase client doesn't require explicit closing in the same way ---
    // The Supabase JS client typically manages connections per request.
    // No explicit dbClient.close() is usually needed for it.
    logger.info("[Shutdown] Supabase client connections are managed per-request, no explicit global close needed here.");

    // Session Backup (for Baileys auth_info)
    logger.info("[Shutdown] Attempting final session backup (auth_info)...");
    await backupSession(); // This is for Baileys session

    // Close WhatsApp Socket
    if (sockInstance) {
        logger.info("[Shutdown] Closing WhatsApp socket connection...");
        try {
            await sockInstance?.sendPresenceUpdate('unavailable').catch(e => logger.warn("Presence update failed during shutdown:", e?.message));
            sockInstance?.ws?.close();
        } catch (e) {
            logger.error("Error during socket close steps:", e?.message || e);
        }
        sockInstance = null; // Clear instance
    }

    logger.info(`--- Shutdown complete. Exiting process with code ${isCrash ? 1 : 0}. ---`);
    setTimeout(() => process.exit(isCrash ? 1 : 0), 1500);
} 


// ================== Render Health Check Server ================== //
/**
 * Starts a simple HTTP server for health checks (e.g., for Render).
 */
function startHealthCheckServer() {
    // Use PORT from environment or default to 3000
    const port = process.env.PORT || 3000;
    try {
        const server = http.createServer((req, res) => {
            // Respond with basic status information
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
                status: 'ok',
                bot: config.BOT_NAME,
                uptimeSeconds: Math.floor(process.uptime()) // Process uptime in seconds
            }));
        });

        // Listen on the specified port
        server.listen(port, () => {
            logger.info(`[Health Check] Server running and listening on port ${port}`);
        });

        // Handle server errors
        server.on('error', (error) => {
            logger.error('[Health Check] Server error:', error);
            // Depending on the error, you might want to attempt recovery or shut down
            // NOTE: No reference to 'isCrash' here.
        });

    } catch (e) {
         logger.error('[Health Check] Failed to start health check server:', e);
    }
} // <<< Closing brace for startHealthCheckServer


// ================== FINAL INITIALIZATION ================== //
// Start the bot execution sequence
startBot(); // Engage!

// <<< ENSURE NO CODE OR CHARACTERS EXIST BELOW THIS LINE >>>

