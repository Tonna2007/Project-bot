  // ================================================================= //
    //                       TonnaBot - index.js                         //
    //    (Zip Strategy - Final Features + AI/Admin/Cmd Fixes V8.1)     //
    // Version updated                                                  //
    // ================================================================= //
    
    // --- Imports ---
    import dotenv from 'dotenv';
    dotenv.config(); // Load environment variables first
    
    import fs from 'fs/promises';
    import fsSync from 'fs'; // Keep sync version for compatibility
    import path from 'path';
    import AdmZip from 'adm-zip';
    import qrcode from 'qrcode-terminal';
    import { Boom } from '@hapi/boom';
    import baileysPkg from 'baileys';
    import { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold } from '@google/generative-ai';
    import http from 'http'; // For Render health check server
    import { fileURLToPath } from 'url';
    import { logger, messageLogger } from './logger.js'; // Ensure logger.js exists
    import fetch from 'node-fetch'; // For sendViewOnce command
    import { createClient } from '@supabase/supabase-js'; // Supabase client
    
    // --- Supabase Initialization ---
    const supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_KEY
    );
    logger.info('Supabase client initialized successfully.');
    
    // --- Global Variables ---
    const delay = ms => new Promise(res => setTimeout(res, ms));
    
    // Destructure Baileys functions for cleaner use
    const {
      proto,
      getContentType,
      jidNormalizedUser,
      DisconnectReason,
      makeWASocket,
      useMultiFileAuthState,
      Browsers,
      downloadMediaMessage,
    } = baileysPkg;
    
    // ================== Constants ================== //
    
    // --- Paths ---
    const BASE_DIR = process.cwd();
    const SESSION_DIR = path.join(BASE_DIR, 'auth_info');
    const SESSION_BACKUP_ZIP = path.join(BASE_DIR, 'auth_info_backup.zip');
    const LOG_DIR = path.join(BASE_DIR, 'logs');
    const LEVELS_FILE = path.join(BASE_DIR, 'levels.json');
    
    // --- Bot Behavior ---
    const MAX_WARNINGS = 5;
    const SPAM_WINDOW_MS = 3000; // Spam check window
    const REPORT_INTERVAL_MS = 3600000; // Session backup interval (1 hour)
    const TYPING_SIMULATION_MS = 7000; // Typing simulation duration
    const MAX_FEEDBACK_MESSAGES = 50; // Max feedback messages
    const MAX_PINNED_MESSAGES = 50; // Max pinned messages
    const CHAT_HISTORY_LENGTH = 100; // AI memory turns
    const VIEW_ONCE_EXPIRATION_MS = 5 * 60 * 1000; // 5 minutes for view-once
    const VIEW_ONCE_CLEANUP_INTERVAL_MS = 5 * 60 * 1000; // Cleanup interval
    
    // --- Simple Jokes List ---
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
    const ROAST_TRIGGERS = ["roast", "clown", "drag", "vawulence", "insult", "bastard", "Fool", "illiterate"];
    const ROAST_HISTORY = new Map();
    let cyberWarfareMode = false; // Global flag for cyber warfare mode
    
    // ================== Configuration ================== //
    // Only showing the updated config part from Section 1
    const config = {
      COMMAND_PREFIX: process.env.COMMAND_PREFIX || '!',
      SPAM_MUTE_MINUTES: parseInt(process.env.SPAM_MUTE_MINUTES) || 5,
      OWNER_NUMBER: (() => {
        try {
          const owners = process.env.OWNER_NUMBER
            ? JSON.parse(process.env.OWNER_NUMBER)
            : [];
          return Array.isArray(owners) ? owners : [owners].filter(Boolean);
        } catch (e) {
          return [process.env.OWNER_NUMBER].filter(Boolean);
        }
      })(), // Support multiple admins
      GEMINI_API_KEY: process.env.GEMINI_API_KEY,
      BOT_NAME: process.env.BOT_NAME || 'TonnaBot',
      DEFAULT_AVATAR: process.env.DEFAULT_AVATAR || 'https://i.imgur.com/qMnMXuD.png',
      BLOCKED_LINKS: (() => {
        try {
          return JSON.parse(process.env.BLOCKED_LINKS || '["http://","https://","www."]');
        } catch (e) {
          logger.error("Invalid JSON in BLOCKED_LINKS env variable. Using default.", e);
          return ["http://", "https://", "www."];
        }
      })(),
      WARN_MESSAGE: process.env.WARN_MESSAGE || "⚠️ Links no be ya mate!",
      RATE_LIMIT_MS: parseInt(process.env.RATE_LIMIT) || 5000,
      CACHE_MAX_SIZE: parseInt(process.env.CACHE_MAX_SIZE) || 100,
      CACHE_TTL_MS: parseInt(process.env.CACHE_TTL_MS) || 600000,
      BOT_PRIMARY_JID: process.env.BOT_PRIMARY_JID,
      BOT_SECONDARY_JID: process.env.BOT_SECONDARY_JID,
      SUPABASE_URL: process.env.SUPABASE_URL,
      SUPABASE_SERVICE_KEY: process.env.SUPABASE_SERVICE_KEY,
    };
    
    // --- Validate Critical Config ---
    if (!config.OWNER_NUMBER.length) {
      logger.fatal("FATAL: OWNER_NUMBER is not set in environment variables.");
      process.exit(1);
    }
    // ... rest of Section 1 remains unchanged 
    
    if (!config.GEMINI_API_KEY) {
      logger.fatal("FATAL: GEMINI_API_KEY is not set in environment variables.");
      process.exit(1);
    }
    if (!config.SUPABASE_URL || !config.SUPABASE_SERVICE_KEY) {
      logger.fatal("FATAL: Supabase credentials are not set in environment variables.");
      process.exit(1);
    }
    if (!config.BOT_PRIMARY_JID) {
      logger.warn("WARNING: BOT_PRIMARY_JID is not set. Reply trigger may be unreliable.");
    }
    if (config.BOT_SECONDARY_JID) {
      logger.info("Secondary WhatsApp number configured for multi-number support.");
    }
    
    // ================== State Management ================== //
    let sockInstance = null; // Primary Baileys socket
    let secondarySockInstance = null; // Secondary Baileys socket for multi-number
    let botStartTime = Date.now();
    
    const viewOnceStore = new Map();
    
    const state = {
      nuclearAI: false,
      groupSettings: new Map(),
      userWarnings: new Map(),
      messageTimestamps: new Map(),
      commandTimestamps: new Map(),
      typingSimulations: new Map(),
      feedback: [],
      pinnedMessages: new Map(),
      chatHistories: new Map(),
      onlineUsers: new Map(), // { userId -> { status: 'available'|'unavailable', lastActive: timestamp } }
      userStyles: new Map(), // { userId -> 'sarcastic'|'formal'|'witty'|etc } for customizable behavior
      stickerReactions: ['😄', '🚀', '😎', '🎉', '🙂'], // Sticker pool for reactions
      keywordCounts: {},
      punishedUsers: new Map(),
      cache: {
        storage: new Map(),
        get(key) {
          const entry = this.storage.get(key);
          if (entry && Date.now() < entry.expires) {
            return entry.data;
          }
          this.storage.delete(key);
          return null;
        },
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
    
    // --- Sticker Reaction Stub ---
    const getStickerReaction = (message) => {
      // Placeholder: Will be expanded in message handler section
      return state.stickerReactions[Math.floor(Math.random() * state.stickerReactions.length)];
    };
    
    // Log initial config values (excluding sensitive keys)
    logger.info("Configuration Loaded:", {
      prefix: config.COMMAND_PREFIX,
      botName: config.BOT_NAME,
      ownerSet: !!config.OWNER_NUMBER,
      geminiKeySet: !!config.GEMINI_API_KEY,
      supabaseSet: !!config.SUPABASE_URL && !!config.SUPABASE_SERVICE_KEY,
      rateLimit: config.RATE_LIMIT_MS,
      cacheSize: config.CACHE_MAX_SIZE,
      cacheTTL: config.CACHE_TTL_MS,
      blockedLinkPatterns: config.BLOCKED_LINKS.length,
      primaryJidSet: !!config.BOT_PRIMARY_JID,
      secondaryJidSet: !!config.BOT_SECONDARY_JID
    });
    
    // ================== Gemini AI Setup ================== //
    if (!config.GEMINI_API_KEY) {
      logger.fatal("FATAL: GEMINI_API_KEY check failed unexpectedly.");
      process.exit(1);
    }
    
    const genAI = new GoogleGenerativeAI(config.GEMINI_API_KEY);
    
    const safetySettings = [
      { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_NONE },
      { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH },
      { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
      { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE }
    ];
    
    const modelToUse = process.env.GEMINI_MODEL_NAME || "gemini-pro-vision";
    logger.info(`Using Gemini Model: ${modelToUse}`);
    
    const aiModel = genAI.getGenerativeModel({
      model: modelToUse,
      safetySettings
    });
    
    // ================== XP / Level System Constants ================== //
    const XP_PER_MESSAGE = 15;
    const BASE_XP_FOR_LEVEL = 300;
    const XP_MULTIPLIER = 60;
    
    const LEVEL_ROLES = [
      { level: 0, title: "🌱 Newbie" },
      { level: 20, title: "🥉 Attention seeker" },
      { level: 40, title: "🥈 less busy" },
      { level: 60, title: "🥇 Regular" },
      { level: 80, title: "? Vibe Giver" },
      { level: 100, title: "🏅 Active Client" },
      { level: 140, title: "🌟 Pro Viber" },
      { level: 180, title: " 🦦🐾 Admin Wannabe" },
      { level: 200, title: "🏆 Master" },
      { level: 250, title: "🦒 Jobless" },
      { level: 500, title: "💪 ChatterBox" },
      { level: 1000, title: "🫡 Always Active" },
      { level: 1250, title: "💎 Clerk" },
      // { level: 5000, title: "?️☢️King Of WhatsApp🐲" }, // Fixed syntax error
      { level: 5000, title: "☢️ King Of WhatsApp 🐉" }, // Fixed syntax error
      { level: 10000, title: "🦅 Mark ZuckerBot 👑" } // Fixed typo in name
    ];
    
    const KEYWORDS_TO_TRACK = [
      "please",
      "friend",
      "love",
      "fail",
      "sorry",
      "biko",
      "safe"
    ];
    
    const KEYWORD_THRESHOLD = 50;
    
    function getRequiredXP(currentLevel) {
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
      for (let i = LEVEL_ROLES.length - 1; i >= 0; i--) {
        if (level >= LEVEL_ROLES[i].level) {
          currentTitle = LEVEL_ROLES[i].title;
          break;
        }
      }
      return currentTitle;
    };
    // --- END ADD HELPER FUNCTION ---
    
    // --- Helper for Customizable Response Style ---
    /**
     * Adjusts response text based on user's preferred style.
     * @param {string} text Original response text.
     * @param {string} userId Sender's JID.
     * @returns {string} Styled response text.
     */
    const getStyledResponse = (text, userId) => {
      const style = state.userStyles.get(userId) || 'default';
      switch (style) {
        case 'sarcastic':
          return `😏 Oh, wow, ${text.toLowerCase()} Really impressive, huh?`;
        case 'formal':
          return `📜 Dear user, ${text}. Regards, ${config.BOT_NAME}.`;
        case 'witty':
          return `🧠 ${text} — bet you didn’t see that coming!`;
        default:
          return text;
      }
    };
    
    /**
     * Handles the !avenged command. Lists group members with a level lower
     * than the user who ran the command, using data from Supabase.
     * v5: Adds customizable style, sticker reaction, multi-number support, and group debug.
     * @param {object} context Parsed message context
     * @param {string[]} args Command arguments
     */
    async function handleAvengedCommand(context, args) {
      const logPrefix = "[Avenged Cmd Supabase v5 Debug]";
      if (!context.isGroup) {
        logger.debug(`${logPrefix} Non-group message from ${context.sender}`);
        const response = getStyledResponse("❌ This command only works inside groups.", context.sender);
        await sendReply(context, response);
        await sendReply(context, getStickerReaction({ success: false }));
        return;
      }
    
      const senderJid = context.sender;
      const chatId = context.chatId;
      const defaultRole = LEVEL_ROLES[0]?.title || 'N/A';
    
      // Update onlineUsers for multi-user tracking
      state.onlineUsers.set(senderJid, { status: 'available', lastActive: Date.now() });
      logger.debug(`${logPrefix} Updated onlineUsers for ${senderJid}`);
    
      if (!supabase) {
        logger.warn(`${logPrefix} Supabase client not initialized.`);
        const response = getStyledResponse("⚠️ Bot database connection error.", senderJid);
        await sendReply(context, response);
        await sendReply(context, getStickerReaction({ success: false }));
        return;
      }
    
      if (!sockInstance) {
        logger.error(`${logPrefix} sockInstance not initialized.`);
        const response = getStyledResponse("⚠️ Bot connection error.", senderJid);
        await sendReply(context, response);
        await sendReply(context, getStickerReaction({ success: false }));
        return;
      }
    
      logger.info(`${logPrefix} Requested by ${senderJid} in group ${chatId}`);
      const feedbackMsg = await sendReply(context, getStyledResponse(`⏳ Calculating your avenged list (Debug v5)...`, senderJid));
    
      // Check for multi-number command (e.g., "!avenged on second")
      const sendToSecondary = args.join(' ').toLowerCase().includes('on second');
      const targetClient = sendToSecondary && secondarySockInstance ? secondarySockInstance : sockInstance;
      const targetChatId = sendToSecondary && config.BOT_SECONDARY_JID ? config.BOT_SECONDARY_JID : chatId;
    
      try {
        // --- Get Sender's Data ---
        logger.debug(`${logPrefix} Fetching sender data for ${senderJid}...`);
        const { data: senderDbData, error: senderFetchError } = await supabase
          .from('users_data')
          .select('level, title')
          .eq('user_id', senderJid)
          .single();
        if (senderFetchError && senderFetchError.code !== 'PGRST116') {
          throw new Error(`Sender fetch error: ${senderFetchError.message}`);
        }
        const senderLevel = senderDbData?.level || 0;
        const senderTitle = senderDbData?.title || getTitleForLevel(senderLevel) || defaultRole;
        logger.info(`${logPrefix} Sender Level Found: ${senderLevel}`);
    
        if (senderLevel === 0) {
          if (feedbackMsg?.key) {
            await targetClient.sendMessage(chatId, { delete: feedbackMsg.key }).catch(() => {});
          }
          const response = getStyledResponse(`😅 You're Level 0 (${senderTitle}). Rank up first!`, senderJid);
          await sendReply(context, response, targetClient, targetChatId);
          await sendReply(context, getStickerReaction({ success: false }), targetClient, targetChatId);
          return;
        }
    
        // --- Get Group Members & Their Data ---
        logger.debug(`${logPrefix} Fetching group metadata...`);
        const metadata = await sockInstance.groupMetadata(chatId);
        if (!metadata?.participants) {
          logger.warn(`${logPrefix} Failed to fetch group metadata for ${chatId}`);
          if (feedbackMsg?.key) {
            await targetClient.sendMessage(chatId, { delete: feedbackMsg.key }).catch(() => {});
          }
          const response = getStyledResponse("⚠️ Could not fetch group members list.", senderJid);
          await sendReply(context, response, targetClient, targetChatId);
          await sendReply(context, getStickerReaction({ success: false }), targetClient, targetChatId);
          return;
        }
        const participants = metadata.participants || [];
        logger.debug(`${logPrefix} Found ${participants.length} participants.`);
    
        const otherParticipantJids = participants
          .map(p => sanitizeJid(p.id))
          .filter(jid => jid && jid !== senderJid);
        logger.debug(`${logPrefix} Found ${otherParticipantJids.length} other participants.`);
    
        let groupUsersData = [];
        if (otherParticipantJids.length > 0) {
          logger.debug(`${logPrefix} Fetching DB data for other participants...`);
          const { data: fetchedData, error: groupFetchError } = await supabase
            .from('users_data')
            .select('user_id, level')
            .in('user_id', otherParticipantJids)
            .limit(100); // Optimize for large groups
          if (groupFetchError) {
            throw new Error(`Group users fetch error: ${groupFetchError.message}`);
          }
          groupUsersData = fetchedData || [];
          logger.info(`${logPrefix} Fetched ${groupUsersData.length} records from DB.`);
        } else {
          logger.debug(`${logPrefix} No other participants to fetch.`);
        }
    
        // --- Create Map and Filter for Avenged Users ---
        const dbDataMap = new Map(groupUsersData.map(u => [u.user_id, u]));
        logger.debug(`${logPrefix} Created dbDataMap with ${dbDataMap.size} entries.`);
    
        logger.info(`${logPrefix} Filtering participants vs senderLevel (${senderLevel})...`);
        const avengedUsers = [];
        let checkedCount = 0;
        for (const p of participants) {
          const jid = sanitizeJid(p.id);
          if (!jid || jid === senderJid) continue;
    
          const dbUser = dbDataMap.get(jid);
          const userLevel = dbUser?.level || 0;
    
          if (checkedCount < 10) {
            logger.info(
              `${logPrefix} Checking user ${jid.split('@')[0]}: DBLevel=${dbUser?.level ?? 'N/A -> 0'}. Is ${userLevel} < ${senderLevel}? ${userLevel < senderLevel}`
            );
            checkedCount++;
          }
    
          if (userLevel < senderLevel) {
            avengedUsers.push({ jid, level: userLevel, name: p.pushName || jid.split('@')[0] });
          }
        }
        logger.info(`${logPrefix} Filtering complete. Found ${avengedUsers.length} avenged users.`);
    
        // --- Sort ---
        avengedUsers.sort((a, b) => {
          if (a.level !== b.level) return a.level - b.level;
          return (a.name || '').localeCompare(b.name || '');
        });
    
        // --- Format and Send Reply ---
        const groupName = metadata.subject || 'This Group';
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
        replyText = getStyledResponse(replyText, senderJid);
        const mentions = [senderJid, ...avengedUsers.map(u => u.jid)];
    
        if (feedbackMsg?.key) {
          await targetClient.sendMessage(chatId, { delete: feedbackMsg.key }).catch(() => {});
        }
        await targetClient.sendMessage(
          targetChatId,
          { text: replyText.trim(), mentions },
          { quoted: context.msg }
        );
        await targetClient.sendMessage(
          targetChatId,
          { text: getStickerReaction({ success: true }) },
          { quoted: context.msg }
        );
        logger.info(`${logPrefix} Sent avenged list for ${senderJid} to ${targetChatId}.`);
    
      } catch (error) {
        logger.error(`${logPrefix} CRITICAL FAILURE for ${senderJid} in ${chatId}:`, {
          name: error.name || 'N/A',
          message: error.message || 'N/A',
          code: error.code || 'N/A',
          stack: error.stack?.substring(0, 1000) || 'N/A'
        });
    
        if (feedbackMsg?.key) {
          await targetClient.sendMessage(chatId, { delete: feedbackMsg.key }).catch(() => {});
        }
        const response = getStyledResponse("⚠️ An error occurred while calculating the avenged list.", senderJid);
        await sendReply(context, response, targetClient, targetChatId);
        await sendReply(context, getStickerReaction({ success: false }), targetClient, targetChatId);
    
        const ownerErrorMsg = `Supabase Error in !avenged: ${error.message}${error.code ? ` (Code: ${error.code})` : ''}`;
        await sendErrorToOwner(new Error(ownerErrorMsg), context.msg, context);
      }
    } 
    
    // ================== Supabase Connection Logic ================== //
    // Ensure fetch is imported: import fetch from 'node-fetch' (already in Section 1)
    
  /**
   * Connects to the Supabase database and sets up the users collection.
   * v10: Updated test query to use count modifier instead of raw SQL.
   */
  async function connectSupabaseDB() {
    const logPrefix = '[Supabase Connect v10]';
    const maxRetries = 3;
    const retryDelays = [2000, 3000, 4000]; // ms
  
    if (config.USE_SUPABASE === 'false') {
      logger.info(`${logPrefix} Supabase disabled via USE_SUPABASE=false. Using file-based persistence.`);
      return false;
    }
    if (!config.SUPABASE_URL || !config.SUPABASE_SERVICE_KEY) {
      logger.error(`${logPrefix} SUPABASE_URL or SUPABASE_SERVICE_KEY missing. Falling back to file-based persistence.`);
      return false;
    }
  
    // Validate URL format
    let url;
    try {
      url = new URL(config.SUPABASE_URL);
      if (!url.protocol.startsWith('http')) throw new Error('Invalid protocol');
      if (!url.hostname.includes('supabase')) throw new Error('URL does not appear to be a Supabase URL');
    } catch (e) {
      logger.error(`${logPrefix} Invalid SUPABASE_URL format: ${config.SUPABASE_URL}`, { message: e.message });
      return false;
    }
  
    // Check dependencies
    try {
      if (typeof fetch !== 'function') {
        throw new Error('node-fetch is not imported or available globally.');
      }
      if (!createClient) {
        throw new Error('@supabase/supabase-js createClient is not imported.');
      }
      logger.debug(`${logPrefix} Dependencies verified: node-fetch and @supabase/supabase-js.`);
      // Log environment info (optional debugging)
      logger.debug(`${logPrefix} Node version: ${process.version}`);
      logger.debug(`${logPrefix} Platform: ${process.platform}`);
      logger.debug(`${logPrefix} SUPABASE_URL length: ${config.SUPABASE_URL?.length}`);
      logger.debug(`${logPrefix} SUPABASE_SERVICE_KEY length: ${config.SUPABASE_SERVICE_KEY?.length}`);
      logger.debug(`${logPrefix} SUPABASE_URL starts with https: ${config.SUPABASE_URL?.startsWith('https://')}`);
    } catch (e) {
      logger.error(`${logPrefix} Dependency check failed:`, { message: e.message });
      return false;
    }
  
    // Properly mask URL for logging
    const maskedUrl = config.SUPABASE_URL.replace(/\/\/([^.]+)\./, '//***.');
    logger.info(`${logPrefix} Attempting to initialize Supabase client... URL: ${maskedUrl}`);
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        // Test basic connectivity first
        logger.debug(`${logPrefix} Testing basic connectivity to ${maskedUrl}...`);
        try {
          const testResponse = await fetch(`${config.SUPABASE_URL}/rest/v1/`, {
            method: 'GET',
            headers: {
              'apikey': config.SUPABASE_SERVICE_KEY,
              'Authorization': `Bearer ${config.SUPABASE_SERVICE_KEY}`,
            },
            timeout: 10000, // 10 second timeout
          });
          logger.debug(`${logPrefix} Basic connectivity test: ${testResponse.status} ${testResponse.statusText}`);
        } catch (connectError) {
          logger.error(`${logPrefix} Basic connectivity test failed:`, {
            message: connectError.message,
            code: connectError.code,
            errno: connectError.errno,
            syscall: connectError.syscall,
            hostname: connectError.hostname,
          });
          throw new Error(`Connectivity test failed: ${connectError.message}`);
        }
  
        // Initialize Supabase client
        logger.debug(`${logPrefix} Initializing Supabase client...`);
        const newSupabaseClient = createClient(
          config.SUPABASE_URL,
          config.SUPABASE_SERVICE_KEY,
          {
            global: { fetch },
            auth: { persistSession: false },
          }
        );
  
        if (!newSupabaseClient || typeof newSupabaseClient.from !== 'function') {
          throw new Error('Supabase client initialization failed or returned invalid client.');
        }
  
        // Perform initial test query using count modifier (replace table name if needed)
        logger.debug(`${logPrefix} Performing initial test query...`);
        const { count, error: testError } = await newSupabaseClient
          .from('users') // Replace 'users' with a valid table in your DB
          .select('*', { count: 'exact', head: true }); // <-- Changed to use count modifier
  
        if (testError) {
          // If table doesn't exist or other error, fallback to version RPC or basic test
          if (testError.code === 'PGRST116' || testError.message.includes('does not exist')) {
            logger.debug(`${logPrefix} 'users' table not found, trying alternative test...`);
            // Option 2: RPC version (if defined)
            const { data: schemaData, error: schemaError } = await newSupabaseClient.rpc('version');
            if (schemaError) {
              // Option 3: Simple REST endpoint test
              const response = await fetch(`${config.SUPABASE_URL}/rest/v1/`, {
                headers: {
                  'apikey': config.SUPABASE_SERVICE_KEY,
                  'Authorization': `Bearer ${config.SUPABASE_SERVICE_KEY}`,
                },
              });
              if (!response.ok) {
                throw new Error(`REST API test failed: ${response.status} ${response.statusText}`);
              }
              logger.debug(`${logPrefix} REST API connection verified.`);
            } else {
              logger.debug(`${logPrefix} Database version check successful.`);
            }
          } else {
            throw new Error(`Test query failed: ${testError.message} (Code: ${testError.code || 'N/A'})`);
          }
        } else {
          logger.debug(`${logPrefix} Table query successful. Row count = ${count}`);
        }
  
        // Assign to global if needed (avoid reassign error)
        try {
          if (typeof global !== 'undefined') {
            global.supabase = newSupabaseClient;
          } else if (typeof window !== 'undefined') {
            window.supabase = newSupabaseClient;
          }
          logger.debug(`${logPrefix} Supabase client set via global assignment.`);
        } catch (assignError) {
          logger.warn(`${logPrefix} Could not assign to global.supabase:`, { message: assignError.message });
        }
  
        logger.info(`${logPrefix} Supabase client initialized and tested successfully!`);
        return true;
  
      } catch (error) {
        // Log full error details
        console.error(`${logPrefix} FULL ERROR DETAILS:`, error);
        logger.error(`${logPrefix} Attempt ${attempt}/${maxRetries} failed:`, {
          message: error.message || 'Unknown error',
          code: error.code || 'N/A',
          details: error.details || 'N/A',
          hint: error.hint || 'N/A',
          status: error.status || 'N/A',
          errno: error.errno || 'N/A',
          syscall: error.syscall || 'N/A',
          hostname: error.hostname || 'N/A',
          stack: error.stack || 'No stack trace',
        });
        if (attempt < maxRetries) {
          logger.info(`${logPrefix} Retrying in ${retryDelays[attempt - 1]}ms...`);
          await new Promise(res => setTimeout(res, retryDelays[attempt - 1]));
        } else {
          logger.error(`${logPrefix} CRITICAL: Max retries reached. Falling back to file-based persistence.`);
          return false;
        }
      }
    }
  } 
  
  
    
    
    // ================== Session Management ================== //
    
    // --- Constants for Secondary Number ---
    const SECONDARY_SESSION_DIR = path.join(BASE_DIR, 'auth_info_secondary');
    const SECONDARY_SESSION_BACKUP_ZIP = path.join(BASE_DIR, 'auth_info_backup_secondary.zip');
    
    /**
     * Attempts to restore the session from a backup zip file if the primary
     * or secondary session directory doesn't exist.
     * v2: Adds support for secondary number session, enhances logging, and mobile error handling.
     * @param {boolean} isSecondary Whether to restore the secondary number's session.
     */
    async function restoreSessionFromBackup(isSecondary = false) {
      const logPrefix = `[Session Restore v2${isSecondary ? ' Secondary' : ''}]`;
      const sessionDir = isSecondary ? SECONDARY_SESSION_DIR : SESSION_DIR;
      const backupZip = isSecondary ? SECONDARY_SESSION_BACKUP_ZIP : SESSION_BACKUP_ZIP;
    
      try {
        // Check if session directory exists
        await fs.access(sessionDir);
        logger.info(`${logPrefix} Existing session directory found at ${sessionDir}. No restoration needed.`);
      } catch (dirAccessError) {
        if (dirAccessError.code === 'ENOENT') {
          logger.info(`${logPrefix} Session directory (${sessionDir}) not found. Checking for backup zip: ${backupZip}`);
    
          try {
            // Check if backup zip exists
            await fs.access(backupZip);
            logger.info(`${logPrefix} Found backup zip (${backupZip}). Attempting to restore...`);
    
            try {
              // Extract backup zip
              const zip = new AdmZip(backupZip);
              zip.extractAllTo(BASE_DIR, true);
    
              // Verify extraction with delay for file system sync
              await delay(200);
              await fs.access(sessionDir);
              logger.info(`${logPrefix} Session successfully restored from ${backupZip} to ${sessionDir}`);
            } catch (zipError) {
              logger.error(`${logPrefix} Failed to restore session from ${backupZip}:`, {
                message: zipError.message,
                stack: zipError.stack?.substring(0, 500),
              });
              if (zipError.code === 'ENOENT' && zipError.path === sessionDir) {
                logger.error(`${logPrefix} Extraction completed, but ${sessionDir} not found post-extraction.`);
              }
            }
          } catch (zipAccessError) {
            if (zipAccessError.code === 'ENOENT') {
              logger.info(`${logPrefix} No backup zip (${backupZip}) found. Will attempt to create a new session.`);
            } else {
              logger.error(`${logPrefix} Error accessing backup zip (${backupZip}):`, {
                message: zipAccessError.message,
                stack: zipAccessError.stack?.substring(0, 500),
              });
            }
          }
        } else {
          logger.error(`${logPrefix} Error accessing session directory (${sessionDir}):`, {
            message: dirAccessError.message,
            stack: dirAccessError.stack?.substring(0, 500),
          });
          if (dirAccessError.code === 'EACCES') {
            logger.warn(`${logPrefix} Permission denied. Check write permissions for ${sessionDir} in Termux.`);
          }
        }
      }
    } 
    
    // ================== Connection Management ================== //
    // Ensure DisconnectReason is destructured from baileysPkg
    // const { DisconnectReason, ... } = baileysPkg;
    
    /**
     * Initializes a WhatsApp connection using Baileys.
     * Handles authentication state loading/saving and socket event listeners.
     * Supports both primary and secondary connections.
     * v6: Adds admin JID validation, enhanced group debug, and multi-user tracking.
     * @param {boolean} isSecondary Whether to initialize the secondary connection.
     * @returns {Promise<import('@whiskeysockets/baileys').WASocket>} The initialized socket instance.
     * @throws {Error} If authentication state fails or socket initialization fails critically.
     */
    async function initializeConnection(isSecondary = false) {
      const logPrefix = `[Connection Init v6${isSecondary ? ' Secondary' : ''}]`;
      const sessionDir = isSecondary ? SECONDARY_SESSION_DIR : SESSION_DIR;
      const socketInstance = isSecondary ? 'secondarySockInstance' : 'sockInstance';
      const botJid = isSecondary ? config.BOT_SECONDARY_JID : config.BOT_PRIMARY_JID;
    
      // Restore session for primary or secondary
      await restoreSessionFromBackup(isSecondary);
      logger.info(`${logPrefix} Using Session Directory: ${sessionDir}`);
    
      let authState, saveCreds;
      try {
        logger.info(`${logPrefix} Attempting to call useMultiFileAuthState with path: ${sessionDir}`);
        const authModule = baileysPkg.useMultiFileAuthState || baileysPkg.default?.useMultiFileAuthState;
        if (!authModule) {
          throw new Error("useMultiFileAuthState function not found in Baileys package.");
        }
        const authInfo = await authModule(sessionDir);
        authState = authInfo.state;
        saveCreds = authInfo.saveCreds;
        logger.info(`${logPrefix} useMultiFileAuthState executed successfully for ${sessionDir}.`);
      } catch (authError) {
        logger.error(`${logPrefix} CRITICAL ERROR during useMultiFileAuthState:`, {
          message: authError.message,
          code: authError.code,
          stack: authError.stack?.substring(0, 500),
        });
        console.error("--- RAW AUTH ERROR ---");
        console.error(authError);
        console.error("--- END RAW AUTH ERROR ---");
        throw new Error(`Authentication state initialization failed: ${authError.message}`);
      }
    
      if (!authState || typeof saveCreds !== 'function') {
        const errorMsg = 'Authentication state or saveCreds function is invalid.';
        logger.fatal(`${logPrefix} ${errorMsg}`);
        throw new Error(errorMsg);
      }
    
      logger.info(`${logPrefix} Initializing WhatsApp socket...`);
      const socketModule = baileysPkg.makeWASocket || baileysPkg.default;
      if (!socketModule) {
        throw new Error("makeWASocket function not found in Baileys package.");
      }
    
      const sock = socketModule({
        auth: authState,
        logger: logger.child({ module: 'baileys' }),
        browser: Browsers.macOS(isSecondary ? 'Safari' : 'Chrome'), // Different browser for secondary
        printQRInTerminal: true,
        syncFullHistory: false,
        retryRequestDelayMs: 3000,
        markOnlineOnConnect: true,
        getMessage: async (key) => undefined,
        defaultQueryTimeoutMs: undefined,
        // Termux/Android Patches
        patchMessageBeforeSending: (message) => {
          const requiresPatch = !!message.viewOnceMessage?.message;
          if (requiresPatch) {
            logger.debug(`${logPrefix} Applying patchMessageBeforeSending for viewOnce message.`);
          }
          return message;
        },
        mediaCache: {
          maxItems: 10,
          maxSize: 50 * 1024 * 1024, // 50MB
        },
      });
    
      // Assign to global instance
      if (isSecondary) {
        secondarySockInstance = sock;
      } else {
        sockInstance = sock;
      }
      logger.info(`${logPrefix} Socket instance created.`);
    
      // --- Event Handlers ---
      sock.ev.on('presence.update', ({ id, presences }) => {
        Object.entries(presences).forEach(([jid, presence]) => {
          const userJid = sanitizeJid(jid);
          if (userJid) {
            state.onlineUsers.set(userJid, {
              status: presence.lastKnownPresence || 'unavailable',
              lastActive: Date.now(),
            });
            logger.debug(`${logPrefix} Presence updated for ${userJid}: ${presence.lastKnownPresence}`);
          }
        });
      });
      logger.info(`${logPrefix} Attached 'presence.update' event listener.`);
    
      sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;
        logger.info(`${logPrefix} Status: ${connection || 'N/A'}`);
    
        if (qr) {
          logger.info(`${logPrefix} QR code received. Scan with WhatsApp on your phone.`);
          try {
            qrcode.generate(qr, { small: true }, (qrString) => console.log(qrString));
          } catch (qrError) {
            logger.warn(`${logPrefix} QR code display failed. Log QR manually or check terminal settings.`, qrError);
          }
        }
    
        if (connection === 'close') {
          const statusCode = lastDisconnect?.error?.output?.statusCode;
          const reason = lastDisconnect?.error?.message || 'Unknown';
          const shouldReconnect =
            lastDisconnect?.error instanceof Boom &&
            statusCode !== DisconnectReason.loggedOut &&
            statusCode !== DisconnectReason.connectionReplaced;
    
          logger.warn(`${logPrefix} Connection closed. Reason: "${reason}" (Code: ${statusCode}). Reconnecting: ${shouldReconnect}`);
          state.typingSimulations.forEach((timeoutId) => clearTimeout(timeoutId));
          state.typingSimulations.clear();
          logger.info(`${logPrefix} Cleared active typing simulations.`);
    
          if (shouldReconnect) {
            const reconnectableErrorCodes = [
              DisconnectReason.connectionClosed,
              DisconnectReason.connectionLost,
              DisconnectReason.timedOut,
              DisconnectReason.restartRequired,
              DisconnectReason.multideviceMismatch,
            ];
            if (reconnectableErrorCodes.includes(statusCode) || !statusCode) {
              logger.info(`${logPrefix} Reconnectable error (Code: ${statusCode || 'N/A'}).`);
            } else {
              logger.error(`${logPrefix} NON-RECONNECTABLE. Shutting down. Reason: ${reason}, Code: ${statusCode}`);
              gracefulShutdown(true, `Connection Closed (${statusCode})`);
            }
          } else if (statusCode === DisconnectReason.loggedOut) {
            logger.error(`${logPrefix} Logged Out! Delete ${sessionDir} and re-scan QR code.`);
            gracefulShutdown(true, "Logged Out");
          } else if (statusCode === DisconnectReason.connectionReplaced) {
            logger.error(`${logPrefix} Connection Replaced! Shutting down.`);
            gracefulShutdown(true, "Connection Replaced");
          } else {
            logger.info(`${logPrefix} Connection closed, no reconnect condition met.`);
          }
        } else if (connection === 'open') {
          logger.info(`${logPrefix} WhatsApp connection opened. Raw sock.user.id: ${sock.user?.id}`);
          const sanitizedId = sanitizeJid(sock.user?.id);
          logger.info(`${logPrefix} Connected! Bot User ID: ${sanitizedId}`);
    
          // Validate admin JID against bot JID
          const adminJids = config.OWNER_NUMBER.map(sanitizeJid);
          const isAdminBot = adminJids.includes(sanitizedId);
          logger.info(`${logPrefix} Admin check: Bot JID ${sanitizedId} is${isAdminBot ? '' : ' not'} an admin.`);
    
          // Test group metadata to debug group response issue
          try {
            const testGroupId = config.BOT_PRIMARY_JID?.replace('@s.whatsapp.net', '@g.us');
            if (testGroupId && !isSecondary) {
              const metadata = await sock.groupMetadata(testGroupId);
              logger.info(`${logPrefix} Group metadata test successful for ${testGroupId}: ${metadata.subject}`);
            }
          } catch (groupError) {
            logger.warn(`${logPrefix} Group metadata test failed. Group responses may be affected:`, {
              message: groupError.message,
              stack: groupError.stack?.substring(0, 500),
            });
          }
    
          await sock.sendPresenceUpdate('available');
          botStartTime = Date.now();
          logger.info(`${logPrefix} Bot uptime reset. Presence set to available.`);
        } else if (connection === 'connecting') {
          logger.info(`${logPrefix} WhatsApp connection attempt in progress...`);
        }
      });
      logger.info(`${logPrefix} Attached 'connection.update' event listener.`);
    
      sock.ev.on('creds.update', saveCreds);
      logger.info(`${logPrefix} Attached 'creds.update' event listener.`);
    
      sock.ev.on('messages.upsert', (upsert) => {
        handleMessages(upsert).catch((e) => {
          logger.error(`${logPrefix} Error in messages.upsert:`, {
            message: e.message,
            stack: e.stack?.substring(0, 500),
          });
        });
      });
      logger.info(`${logPrefix} Attached 'messages.upsert' event listener.`);
    
      sock.ev.on('group-participants.update', (update) => {
        handleGroupUpdate(update).catch((e) => {
          logger.error(`${logPrefix} Error in group-participants.update:`, {
            message: e.message,
            stack: e.stack?.substring(0, 500),
          });
        });
      });
      logger.info(`${logPrefix} Attached 'group-participants.update' event listener.`);
    
      logger.info(`${logPrefix} Socket initialized and all core event listeners attached.`);
      return sock;
    }
    
    /**
     * Initializes the secondary WhatsApp connection if configured.
     * v2: Adds admin JID validation for secondary connection.
     * @returns {Promise<void>}
     */
    async function initializeSecondaryConnection() {
      const logPrefix = "[Secondary Connection v2]";
      if (!config.BOT_SECONDARY_JID) {
        logger.info(`${logPrefix} No secondary JID configured. Skipping secondary connection.`);
        return;
      }
    
      logger.info(`${logPrefix} Initializing secondary WhatsApp connection...`);
      try {
        secondarySockInstance = await initializeConnection(true);
        const sanitizedId = sanitizeJid(secondarySockInstance.user?.id);
        const adminJids = config.OWNER_NUMBER.map(sanitizeJid);
        const isAdminBot = adminJids.includes(sanitizedId);
        logger.info(`${logPrefix} Secondary connection initialized. Bot JID ${sanitizedId} is${isAdminBot ? '' : ' not'} an admin.`);
      } catch (error) {
        logger.error(`${logPrefix} Failed to initialize secondary connection:`, {
          message: error.message,
          stack: error.stack?.substring(0, 500),
        });
        secondarySockInstance = null;
      }
    } 
    
    /**
     * Handles the reconnection logic when the connection closes unexpectedly.
     * v2: Supports primary and secondary sockets, adds group metadata test, logs admin JID.
     */
    async function handleReconnect() {
      const logPrefix = "[Reconnect v2]";
      const reconnectDelay = 5000 + Math.random() * 2000; // ~5-7 seconds
      logger.info(`${logPrefix} Attempting reconnect in ${Math.round(reconnectDelay / 1000)} seconds...`);
    
      await delay(reconnectDelay);
      logger.info(`${logPrefix} Executing reconnect attempt...`);
    
      try {
        // Reconnect primary socket
        sockInstance = await initializeConnection(false);
        const primaryJid = sanitizeJid(sockInstance.user?.id);
        const adminJids = config.OWNER_NUMBER.map(sanitizeJid);
        logger.info(`${logPrefix} Primary socket reconnected. Bot JID: ${primaryJid}, Is Admin: ${adminJids.includes(primaryJid)}`);
    
        // Test group metadata to debug group response issue
        try {
          const testGroupId = config.BOT_PRIMARY_JID?.replace('@s.whatsapp.net', '@g.us');
          if (testGroupId) {
            const metadata = await sockInstance.groupMetadata(testGroupId);
            logger.info(`${logPrefix} Group metadata test successful: ${metadata.subject}`);
          }
        } catch (groupError) {
          logger.warn(`${logPrefix} Group metadata test failed:`, {
            message: groupError.message,
            stack: groupError.stack?.substring(0, 500),
          });
        }
    
        // Reconnect secondary socket if configured
        if (config.BOT_SECONDARY_JID) {
          secondarySockInstance = await initializeSecondaryConnection();
          if (secondarySockInstance) {
            const secondaryJid = sanitizeJid(secondarySockInstance.user?.id);
            logger.info(`${logPrefix} Secondary socket reconnected. Bot JID: ${secondaryJid}, Is Admin: ${adminJids.includes(secondaryJid)}`);
          }
        }
      } catch (e) {
        logger.error(`${logPrefix} Reconnection attempt failed:`, {
          message: e.message || e,
          stack: e.stack?.substring(0, 500),
        });
        logger.info(`${logPrefix} Scheduling next reconnect attempt...`);
        handleReconnect(); // Recursive retry
      }
    }
    
    // --- Helper for Typing Simulation ---
    
    /**
     * Simulates typing presence in a group chat for a set duration.
     * Avoids simulating in DMs or when nuclear AI is active.
     * Supports primary/secondary sockets and customizable style.
     * v2: Adds multi-number support, style-based duration, and robust socket checks.
     * @param {string} chatId The JID of the chat to simulate typing in.
     * @param {string} [userId] Optional user ID to apply style (e.g., admin).
     */
    async function simulateTyping(chatId, userId = null) {
      const logPrefix = "[Typing Sim v2]";
      if (!chatId?.endsWith('@g.us')) {
        logger.debug(`${logPrefix} Skipping typing simulation for non-group chat: ${chatId}`);
        return;
      }
    
      // Select socket based on chat JID
      let targetSock = sockInstance;
      if (config.BOT_SECONDARY_JID && chatId.includes(config.BOT_SECONDARY_JID.split('@')[0])) {
        targetSock = secondarySockInstance;
      }
    
      if (!targetSock || state.nuclearAI) {
        logger.debug(`${logPrefix} Skipping typing simulation: No socket or nuclear AI active.`);
        return;
      }
    
      const simulationKey = `typing-${chatId}`;
      let typingDuration = TYPING_SIMULATION_MS;
    
      // Adjust duration based on user style (if provided)
      if (userId && state.userStyles.has(userId)) {
        const style = state.userStyles.get(userId);
        if (style === 'sarcastic') {
          typingDuration *= 1.2; // 20% longer for dramatic effect
          logger.debug(`${logPrefix} Sarcastic style applied for ${userId}: Duration ${typingDuration}ms`);
        } else if (style === 'formal') {
          typingDuration *= 0.8; // 20% shorter for efficiency
          logger.debug(`${logPrefix} Formal style applied for ${userId}: Duration ${typingDuration}ms`);
        }
      }
    
      try {
        // Clear existing timeout if present
        if (state.typingSimulations.has(simulationKey)) {
          clearTimeout(state.typingSimulations.get(simulationKey));
          logger.debug(`${logPrefix} Extended typing simulation for ${chatId}`);
        } else {
          // Start new simulation
          if (targetSock.ws?.readyState === 1) {
            await targetSock.sendPresenceUpdate('composing', chatId);
            logger.debug(`${logPrefix} Started typing simulation for ${chatId}`);
          } else {
            logger.warn(`${logPrefix} Socket not ready for ${chatId}, skipping 'composing'.`);
            return;
          }
        }
    
        // Set timeout to stop typing
        const timeoutId = setTimeout(async () => {
          try {
            if (targetSock?.ws?.readyState === 1) {
              await targetSock.sendPresenceUpdate('paused', chatId);
              logger.debug(`${logPrefix} Stopped typing simulation for ${chatId}`);
            }
          } catch (e) {
            if (!e.message?.includes('Connection Closed') && !e.message?.includes('Socket closed')) {
              logger.warn(`${logPrefix} Failed to send 'paused' for ${chatId}:`, e.message);
            }
          } finally {
            state.typingSimulations.delete(simulationKey);
          }
        }, typingDuration);
    
        state.typingSimulations.set(simulationKey, timeoutId);
      } catch (error) {
        if (!error.message?.includes('Connection Closed') && !error.message?.includes('Socket closed')) {
          logger.warn(`${logPrefix} Failed initial 'composing' for ${chatId}:`, error.message);
        }
        if (state.typingSimulations.has(simulationKey)) {
          clearTimeout(state.typingSimulations.get(simulationKey));
          state.typingSimulations.delete(simulationKey);
        }
      }
    } 
    
    // ================== Chat History Management (for AI) ================== //
    
    /**
     * Updates the chat history for a given chat ID.
     * Adds the new message with sender info and trims history.
     * v3: Enhances logging, supports multi-user tracking.
     * @param {string} chatId The JID of the chat.
     * @param {'user' | 'model'} role The role of the message sender.
     * @param {string} text The text content of the message.
     * @param {string | null} [senderIdentifier=null] The identifier (e.g., JID) of the user.
     */
    function updateChatHistory(chatId, role, text, senderIdentifier = null) {
      const logPrefix = "[History v3]";
      if (!text || text.trim() === '') {
        logger.debug(`${logPrefix} Skipping empty message for ${chatId}`);
        return;
      }
    
      if (!state.chatHistories.has(chatId)) {
        state.chatHistories.set(chatId, []);
      }
      const history = state.chatHistories.get(chatId);
    
      let newEntry;
      if (role === 'user') {
        const identifier = senderIdentifier || 'UnknownUser';
        newEntry = {
          role: 'user',
          sender: identifier,
          parts: [{ text: text.trim() }],
        };
        logger.debug(`${logPrefix} Adding user message from ${identifier} to ${chatId}`);
      } else {
        newEntry = {
          role: 'model',
          sender: config.BOT_PRIMARY_JID || 'TonnaBot',
          parts: [{ text: text.trim() }],
        };
        logger.debug(`${logPrefix} Adding model response to ${chatId}`);
      }
    
      history.push(newEntry);
    
      if (history.length > CHAT_HISTORY_LENGTH) {
        const removedCount = history.length - CHAT_HISTORY_LENGTH;
        history.splice(0, removedCount);
        logger.debug(`${logPrefix} Trimmed ${removedCount} message(s) from ${chatId}. New length: ${history.length}`);
      }
    
      state.chatHistories.set(chatId, history);
    }
    
    /**
     * Retrieves the chat history for a given chat ID.
     * @param {string} chatId The JID of the chat.
     * @returns {Array<{role: string, sender: string, parts: Array<{text: string}>}>} The chat history array.
     */
    function getChatHistory(chatId) {
      return state.chatHistories.get(chatId) || [];
    }
    
    /**
     * Checks if a given text contains roast-like phrases.
     * v2: Adds more patterns, optimizes regex.
     * @param {string} text The text to check.
     * @returns {boolean} True if the text contains roast triggers.
     */
    function containsRoast(text) {
      const patterns = [
        /stupid bot|dumb bot|tonnabot sucks/i,
        /you nor fit|no dey sabi|no get sense/i,
        /useless bot|worthless bot|trash bot/i,
        /wack bot|bot dey dull/i,
      ];
      return text && patterns.some((pattern) => pattern.test(text));
    }
    
    // ================== Message Processing Core ================== //
    
    /**
     * Handles incoming messages via 'messages.upsert' event.
     * Processes admin commands, group messages, AI responses, and stickers.
     * v2: Adds admin checks, multi-number support, customizable styles, AI-driven stickers.
     * @param {import('@whiskeysockets/baileys').BaileysEventMap['messages.upsert']} upsert The upsert event data.
     */
    async function handleMessages({ messages, type }) {
      const logPrefix = "[handleMessages v2]";
      if (type !== 'notify') {
        logger.debug(`${logPrefix} Skipping non-notify event: ${type}`);
        return;
      }
    
      const comebacks = [
        "Your mouth dey run like open-source repo!",
        "I dey code your obituary... 404 Not Found!",
        "Your IQ get expiration date like trial SSL!",
        "Even my error messages get more sense!",
      ];
    
      for (const msg of messages) {
        const messageId = msg.key?.id || 'N/A';
        logger.debug(`${logPrefix} Processing Msg ID: ${messageId}, Socket ReadyState: ${sockInstance?.ws?.readyState}`);
    
        // 1. Ignore Irrelevant Messages
        if (
          msg.key?.remoteJid === 'status@broadcast' ||
          msg.key?.fromMe ||
          !msg.message ||
          !msg.key?.remoteJid
        ) {
          logger.debug(`${logPrefix} Skipping irrelevant message: ${messageId}`);
          continue;
        }
    
        // 2. Get Sender Info and Admin Check
        const senderJid = sanitizeJid(msg.key?.participant || msg.key?.remoteJid);
        const adminJids = config.OWNER_NUMBER.map(sanitizeJid);
        const isAdmin = adminJids.includes(senderJid);
        const isGroup = msg.key?.remoteJid?.endsWith('@g.us');
    
        // Select socket based on chat JID
        let targetSock = sockInstance;
        if (
          config.BOT_SECONDARY_JID &&
          msg.key?.remoteJid.includes(config.BOT_SECONDARY_JID.split('@')[0])
        ) {
          targetSock = secondarySockInstance;
        }
        if (!targetSock) {
          logger.warn(`${logPrefix} No valid socket for ${msg.key?.remoteJid}`);
          continue;
        }
    
        // 3. Check Punishment
        const punishmentEndTime = state.punishedUsers.get(senderJid);
        if (punishmentEndTime) {
          if (Date.now() < punishmentEndTime) {
            logger.info(`${logPrefix} Ignoring message ${messageId} from punished user ${senderJid}`);
            continue;
          } else {
            logger.info(`${logPrefix} Punishment expired for ${senderJid}`);
            state.punishedUsers.delete(senderJid);
          }
        }
    
        // 4. Typing Simulation Trigger
        try {
          if (isGroup && !state.nuclearAI) {
            const mc = getContentType(msg.message);
            const txt =
              msg.message?.conversation ||
              msg.message?.extendedTextMessage?.text ||
              msg.message?.imageMessage?.caption ||
              msg.message?.videoMessage?.caption;
            const isNonCommandText = txt && !txt.startsWith(config.COMMAND_PREFIX);
            const isRelevantMedia = !txt && ['imageMessage', 'videoMessage', 'audioMessage'].includes(mc);
            if (isNonCommandText || isRelevantMedia) {
              await simulateTyping(msg.key.remoteJid, senderJid);
            }
          }
        } catch (e) {
          logger.error(`${logPrefix} Typing simulation error:`, { message: e.message });
        }
    
        let context = null;
        try {
          // 5. Parse Message
          context = await parseMessage(msg);
          if (!context?.chatId || !context.sender) {
            logger.warn(`${logPrefix} Skipping msg ${messageId}: Invalid context`);
            continue;
          }
    
          // Log group message for debugging
          if (isGroup) {
            logger.info(`${logPrefix} Group message from ${senderJid} in ${context.chatId}: ${context.text.substring(0, 50)}`);
          }
    
          // 6. Validate Group Metadata (for group messages)
          if (isGroup) {
            try {
              await targetSock.groupMetadata(context.chatId);
            } catch (groupError) {
              logger.warn(`${logPrefix} Group metadata fetch failed for ${context.chatId}:`, {
                message: groupError.message,
              });
              await sendReply(context, "⚠️ Error accessing group. Please check bot permissions.");
              continue;
            }
          }
    
          // 7. God Mode Check (Admin Only)
          const SECRET_PREFIX = "$$";
          if (isAdmin && context.text.startsWith(SECRET_PREFIX)) {
            logger.info(`${logPrefix} God Mode command from ${senderJid}: ${context.text.substring(0, 20)}`);
            try {
              await targetSock.sendMessage(context.chatId, { delete: context.key });
            } catch (deleteError) {
              logger.error(`${logPrefix} God Mode delete failed:`, { message: deleteError.message });
            }
            const commandParts = context.text.slice(SECRET_PREFIX.length).trim().split(/ +/);
            const godCommand = commandParts[0]?.toLowerCase();
            const godArgs = commandParts.slice(1);
            const targetJid = context.mentions?.[0];
            switch (godCommand) {
              case 'punish':
                await handleGodPunish(context, targetJid, parseInt(godArgs[0]) || 30);
                break;
              case 'bless':
                await handleGodBless(context, targetJid, parseInt(godArgs[0]) || 100);
                break;
              case 'unpunish':
                await handleGodUnpunish(context, targetJid);
                break;
              default:
                logger.warn(`${logPrefix} Unknown God Mode command: ${godCommand}`);
                await targetSock.sendMessage(senderJid, { text: `G Mode Error: Unknown command '${godCommand}'` });
            }
            continue;
          }
    
          // 8. Award XP
          if (context.contentType !== 'buttonsResponseMessage') {
            await handleXP(context.sender);
          }
    
          // 9. Update Chat History
          if (context.text) {
            updateChatHistory(context.chatId, 'user', context.text, context.sender);
          } else if (context.contentType === 'imageMessage') {
            updateChatHistory(context.chatId, 'user', '(User sent an image)', context.sender);
          } else if (context.contentType === 'stickerMessage') {
            updateChatHistory(context.chatId, 'user', '(User sent a sticker)', context.sender);
          }
    
          // 10. Auto-Clapback
          if (containsRoast(context.text) && !isGroup) {
            logger.info(`${logPrefix} Auto-Clapback triggered for ${senderJid}`);
            const comeback = comebacks[Math.floor(Math.random() * comebacks.length)];
            await sendReply(context, getStyledResponse(comeback, senderJid), targetSock);
            await sendReply(context, getStickerReaction({ sentiment: 'negative' }), targetSock);
            continue;
          }
    
          // 11. Security Checks
          let securityHandled = false;
          if (isGroup) {
            securityHandled = await processSecurityChecks(context);
          }
          if (securityHandled) {
            logger.info(`${logPrefix} Message ${messageId} handled by security`);
            continue;
          }
    
          // 12. Command Processing
          let commandProcessed = false;
          if (context.isCommand) {
            const commandRegex = new RegExp(`(?:\\s|^)${config.COMMAND_PREFIX}(\\w+)`, 'i');
            const commandMatch = context.text.match(commandRegex);
            const commandName = commandMatch ? commandMatch[1].toLowerCase() : null;
            if (commandName) {
              if (commandName === 'setstyle' && isAdmin) {
                const style = context.text.split(' ')[1]?.toLowerCase();
                if (['default', 'sarcastic', 'formal', 'witty'].includes(style)) {
                  state.userStyles.set(senderJid, style);
                  await sendReply(context, `Style set to ${style}!`, targetSock);
                  commandProcessed = true;
                } else {
                  await sendReply(context, "Invalid style. Use: default, sarcastic, formal, witty.", targetSock);
                  commandProcessed = true;
                }
              } else {
                const command = COMMANDS[commandName];
                if (command) {
                  const argsText = context.text.substring(context.text.indexOf(commandMatch[0]) + commandMatch[0].length).trim();
                  const args = argsText ? argsText.split(/ +/) : [];
                  commandProcessed = await processCommands(context, commandName, command, args, targetSock);
                } else {
                  logger.debug(`${logPrefix} No handler for command: ${commandName}`);
                }
              }
            }
            if (commandProcessed) {
              continue;
            }
          }
    
          // 13. AI Response Check
          let shouldRespondAI = false;
          if (!commandProcessed && context.contentType !== 'buttonsResponseMessage') {
            shouldRespondAI = await shouldRespondWithAI(context);
            if (shouldRespondAI) {
              const aiResponseText = await generateAIResponse(context);
              if (aiResponseText && !context.isViewOnce && context.contentType !== 'stickerMessage') {
                const styledResponse = getStyledResponse(aiResponseText, senderJid);
                await sendReply(context, styledResponse, targetSock);
                updateChatHistory(context.chatId, 'model', aiResponseText);
                await sendReply(context, getStickerReaction({ sentiment: 'positive' }), targetSock);
                continue;
              }
            }
          }
    
          // 14. View-Once Handling
          if (context.isViewOnce && !shouldRespondAI) {
            logger.info(`${logPrefix} Handling View-Once msg ${messageId}`);
            const innerMsg =
              context.msg?.message?.viewOnceMessage?.message ||
              context.msg?.message?.viewOnceMessageV2?.message;
            if (innerMsg) {
              const mediaType = getContentType(innerMsg);
              const mediaMsgObj = innerMsg[mediaType];
              if ((mediaType === 'imageMessage' || mediaType === 'videoMessage') && mediaMsgObj) {
                await handleViewOnceMedia(context.msg, mediaType, mediaMsgObj, targetSock);
              } else {
                logger.warn(`${logPrefix} Unsupported View-Once type: ${mediaType}`);
              }
            } else {
              logger.warn(`${logPrefix} Could not extract View-Once message: ${messageId}`);
            }
            continue;
          }
    
          // 15. Sticker Reaction Handling
          if (context.contentType === 'stickerMessage' && !commandProcessed && !shouldRespondAI) {
            const REACT_PROBABILITY = 0.5;
            if (Math.random() < REACT_PROBABILITY) {
              logger.info(`${logPrefix} Reacting to sticker ${messageId}`);
              const stickerReaction = getStickerReaction({
                sentiment: containsRoast(context.text) ? 'negative' : 'positive',
                userStyle: state.userStyles.get(senderJid) || 'default',
              });
              await sendReply(context, stickerReaction, targetSock);
            } else {
              logger.debug(`${logPrefix} Skipped sticker reaction by probability`);
            }
            continue;
          }
    
        } catch (error) {
          logger.error(`${logPrefix} Error processing msg ${messageId}:`, {
            message: error.message,
            stack: error.stack?.substring(0, 500),
          });
          handleMessageError(error, msg, context, targetSock);
        }
      }
    } 
    
    // ================== Message Parsing ================== //
    
    /**
     * Parses an incoming Baileys message object to extract relevant information.
     * Handles different message types including button responses.
     * v2: Enhances group JID validation, adds admin logging, supports multi-number.
     * @param {import('@whiskeysockets/baileys').WAMessage} msg The raw message object.
     * @returns {Promise<object|null>} A context object with parsed data, or null if parsing fails.
     */
    async function parseMessage(msg) {
      const logPrefix = "[Parse v2]";
      const extractMentions = (message) => {
        const mentionedJids = [
          ...(message?.message?.extendedTextMessage?.contextInfo?.mentionedJid || []),
          ...(message?.message?.conversation?.contextInfo?.mentionedJid || []),
          ...(message?.message?.listResponseMessage?.contextInfo?.mentionedJid || []),
        ];
        return mentionedJids.filter((jid) => jid && typeof jid === 'string' && jid.includes('@'));
      };
    
      try {
        const contentType = getContentType(msg.message);
        if (!contentType) {
          const messageKeys = msg.message ? Object.keys(msg.message).join(', ') : 'msg.message is null';
          logger.warn(`${logPrefix} No content type for msg ID: ${msg.key?.id}. Keys: [${messageKeys}]`);
          return null;
        }
    
        // Basic Info
        const isGroup = msg.key?.remoteJid?.endsWith('@g.us');
        const chatId = sanitizeJid(msg.key?.remoteJid);
        const sender = sanitizeJid(isGroup ? msg.key?.participant || msg.key?.remoteJid : msg.key?.remoteJid);
        if (!chatId || !sender) {
          logger.warn(`${logPrefix} Invalid JIDs for msg ID: ${msg.key?.id}. Chat: ${chatId}, Sender: ${sender}`);
          return null;
        }
    
        // Admin Check for Logging
        const adminJids = config.OWNER_NUMBER.map(sanitizeJid);
        const isAdmin = adminJids.includes(sender);
        if (isAdmin) {
          logger.info(`${logPrefix} Admin message from ${sender} in ${chatId}`);
        }
    
        // Validate Group Metadata for Group Messages
        let targetSock = sockInstance;
        if (config.BOT_SECONDARY_JID && chatId.includes(config.BOT_SECONDARY_JID.split('@')[0])) {
          targetSock = secondarySockInstance;
        }
        if (isGroup && targetSock) {
          try {
            await targetSock.groupMetadata(chatId);
          } catch (groupError) {
            logger.warn(`${logPrefix} Group metadata fetch failed for ${chatId}:`, {
              message: groupError.message,
            });
          }
        }
    
        // Extract Text and Button ID
        let text = '';
        let selectedButtonId = null;
        if (contentType === 'conversation') {
          text = msg.message.conversation || '';
        } else if (contentType === 'extendedTextMessage') {
          text = msg.message.extendedTextMessage?.text || '';
        } else if (contentType === 'imageMessage') {
          text = msg.message.imageMessage?.caption || '';
        } else if (contentType === 'videoMessage') {
          text = msg.message.videoMessage?.caption || '';
        } else if (contentType === 'stickerMessage') {
          text = '(Sticker)';
        } else if (contentType === 'listResponseMessage') {
          text = msg.message.listResponseMessage?.title || '';
          logger.debug(`${logPrefix} List response: "${text}"`);
        } else if (contentType === 'buttonsResponseMessage') {
          text = msg.message.buttonsResponseMessage?.selectedDisplayText || '';
          selectedButtonId = msg.message.buttonsResponseMessage?.selectedButtonId || null;
          logger.info(`${logPrefix} Button response: ID=${selectedButtonId}, Text="${text}"`);
        }
    
        // Other Context Info
        const isViewOnce = ['viewOnceMessage', 'viewOnceMessageV2'].includes(contentType);
        const isCommand = !selectedButtonId && text.trim().startsWith(config.COMMAND_PREFIX);
        const pushName = msg.pushName || null;
    
        // Mentions
        let mentions = [];
        try {
          const rawMentions = extractMentions(msg);
          mentions = rawMentions.map((jid) => sanitizeJid(jid)).filter((jid) => !!jid);
        } catch (mentionError) {
          logger.error(`${logPrefix} Mention extraction error:`, { message: mentionError.message });
          mentions = [];
        }
    
        // Reply Info & Quoted Text
        const contextInfo =
          msg.message?.extendedTextMessage?.contextInfo ||
          msg.message?.buttonsResponseMessage?.contextInfo ||
          msg.message?.listResponseMessage?.contextInfo ||
          msg.message?.templateButtonReplyMessage?.contextInfo ||
          msg.message?.productMessage?.contextInfo;
        const isReply = !!contextInfo?.quotedMessage;
        const quotedMsg = contextInfo?.quotedMessage || null;
        const quotedMsgKey = contextInfo?.stanzaId || null;
        const quotedParticipant = sanitizeJid(contextInfo?.participant || null);
        let quotedText = '';
        if (isReply && quotedMsg) {
          try {
            const quotedContentType = getContentType(quotedMsg);
            if (quotedContentType === 'conversation') {
              quotedText = quotedMsg.conversation || '';
            } else if (quotedContentType === 'extendedTextMessage') {
              quotedText = quotedMsg.extendedTextMessage?.text || '';
            } else if (quotedContentType === 'imageMessage') {
              quotedText = quotedMsg.imageMessage?.caption || '';
            } else if (quotedContentType === 'videoMessage') {
              quotedText = quotedMsg.videoMessage?.caption || '';
            }
            quotedText = quotedText.trim();
          } catch (quoteParseError) {
            logger.warn(`${logPrefix} Quoted text extraction error:`, { message: quoteParseError.message });
          }
        }
    
        // Timestamp
        let timestamp = msg.messageTimestamp
          ? Number(msg.messageTimestamp) * 1000
          : Date.now();
    
        return {
          msg,
          text: text.trim(),
          chatId,
          sender,
          isGroup,
          pushName,
          mentions,
          isCommand,
          isViewOnce,
          contentType,
          isReply,
          quotedMsg,
          quotedMsgKey,
          quotedParticipant,
          quotedText,
          timestamp,
          key: msg.key,
          selectedButtonId,
        };
      } catch (error) {
        logger.error(`${logPrefix} Parse failed:`, {
          message: error.message,
          stack: error.stack?.substring(0, 500),
        });
        return null;
      }
    }
    
    // ================== Security & Filtering ================== //
    
    /**
     * Determines if the AI should respond to a given message context.
     * Checks mentions, replies, and bot names/numbers.
     * v10: Adds multi-number support, admin priority, style-based probability, group validation.
     * @param {object} context The parsed message context from parseMessage.
     * @returns {Promise<boolean>} True if the AI should respond.
     */
    async function shouldRespondWithAI(context) {
      const logPrefix = "[AI Check v10]";
      const messageId = context?.key?.id || 'N/A';
      if (!context || !context.sender) {
        logger.debug(`${logPrefix} Invalid context/sender for msg ${messageId}`);
        return false;
      }
    
      // Nuclear / DM Checks
      if (state.nuclearAI) {
        logger.debug(`${logPrefix} Responding: Nuclear AI ON`);
        return true;
      }
      if (!context.isGroup) {
        logger.debug(`${logPrefix} Responding: DM`);
        return true;
      }
    
      // Group Settings Check
      const groupSettings = getGroupSettings(context.chatId);
      if (!groupSettings.aiEnabled) {
        logger.debug(`${logPrefix} Not responding: Group AI OFF`);
        return false;
      }
    
      // Validate Group Metadata
      let targetSock = sockInstance;
      if (config.BOT_SECONDARY_JID && context.chatId.includes(config.BOT_SECONDARY_JID.split('@')[0])) {
        targetSock = secondarySockInstance;
      }
      try {
        await targetSock.groupMetadata(context.chatId);
      } catch (groupError) {
        logger.warn(`${logPrefix} Group metadata fetch failed for ${context.chatId}:`, {
          message: groupError.message,
        });
        return false;
      }
    
      // Get Bot JIDs
      let botActualJid = null;
      try {
        botActualJid = sanitizeJid(targetSock?.user?.id);
      } catch (err) {
        logger.error(`${logPrefix} Error getting bot JID:`, { message: err.message });
        return false;
      }
      if (!botActualJid) {
        logger.error(`${logPrefix} Failed to get bot JID`);
        return false;
      }
      const botNumberPart = botActualJid.split('@')[0];
      const botPrimaryJid = sanitizeJid(config.BOT_PRIMARY_JID);
      const botSecondaryJid = sanitizeJid(config.BOT_SECONDARY_JID);
    
      // Admin Check
      const adminJids = config.OWNER_NUMBER.map(sanitizeJid);
      const isAdmin = adminJids.includes(context.sender);
      let adminBoost = isAdmin ? 0.2 : 0; // 20% higher chance for admins
    
      // Style-Based Probability
      let styleBoost = 0;
      const userStyle = state.userStyles.get(context.sender) || 'default';
      if (userStyle === 'sarcastic') {
        styleBoost = 0.1; // 10% higher chance for sarcastic style
        logger.debug(`${logPrefix} Sarcastic style boost: +10%`);
      } else if (userStyle === 'witty') {
        styleBoost = 0.05; // 5% higher chance for witty
      }
    
      // Prepare Inputs
      const mentionsArray = context.mentions || [];
      const quotedParticipant = context.quotedParticipant || null;
      const text = context.text || '';
      logger.debug(`${logPrefix} Inputs: Text="${text.substring(0, 70)}", Mentions=${JSON.stringify(mentionsArray)}, IsReply=${context.isReply}, Quoted=${quotedParticipant}`);
    
      // Trigger Checks
      let triggered = false;
      let triggerType = 'None';
      try {
        // 1. Exact JID Mention
        if (mentionsArray.includes(botActualJid) || (botSecondaryJid && mentionsArray.includes(botSecondaryJid))) {
          triggered = true;
          triggerType = 'Mention (Exact JID)';
          logger.debug(`${logPrefix} Trigger: Exact JID Mention`);
        }
    
        // 2. Reply to Bot
        if (
          !triggered &&
          context.isReply &&
          quotedParticipant &&
          (quotedParticipant === botPrimaryJid || quotedParticipant === botActualJid || quotedParticipant === botSecondaryJid)
        ) {
          triggered = true;
          triggerType = 'Reply (Bot JID Match)';
          logger.debug(`${logPrefix} Trigger: Reply to Bot JID=${quotedParticipant}`);
        }
    
        // 3. Bot Name Mention
        if (!triggered && text) {
          const botNamePattern = new RegExp(`(?:\\s|^|@)${config.BOT_NAME}\\b`, 'i');
          if (botNamePattern.test(text)) {
            triggered = true;
            triggerType = 'Mention (Name)';
            logger.debug(`${logPrefix} Trigger: Bot Name Mention`);
          }
        }
    
        // 4. Number Tag Mention
        if (!triggered && text) {
          const botNumberTag = `@${botNumberPart}`;
          const primaryNumberTag = botPrimaryJid ? `@${botPrimaryJid.split('@')[0]}` : null;
          const secondaryNumberTag = botSecondaryJid ? `@${botSecondaryJid.split('@')[0]}` : null;
          if (
            text.includes(botNumberTag) ||
            (primaryNumberTag && text.includes(primaryNumberTag)) ||
            (secondaryNumberTag && text.includes(secondaryNumberTag))
          ) {
            triggered = true;
            triggerType = 'Mention (@Number)';
            logger.debug(`${logPrefix} Trigger: Number Tag Mention`);
          }
        }
    
        // 5. Random Chance (Style/Admin Boost)
        if (!triggered && Math.random() < (0.05 + adminBoost + styleBoost)) {
          triggered = true;
          triggerType = 'Random (Style/Admin Boost)';
          logger.debug(`${logPrefix} Trigger: Random Chance (Boost=${(adminBoost + styleBoost) * 100}%)`);
        }
      } catch (triggerError) {
        logger.error(`${logPrefix} Trigger check error:`, {
          message: triggerError.message,
          stack: triggerError.stack?.substring(0, 500),
        });
        return false;
      }
    
      // Final Decision
      logger.info(`${logPrefix} Decision: Triggered=${triggered}, Type=${triggerType}`);
      return triggered;
    }
    
    /**
     * Runs security checks (links, spam) on the message context.
     * v2: Adds multi-number support, admin array check, group validation.
     * @param {object} context The parsed message context.
     * @returns {Promise<boolean>} True if a violation was handled, false otherwise.
     */
    async function processSecurityChecks(context) {
      const logPrefix = "[Security v2]";
      if (!context) {
        logger.warn(`${logPrefix} Invalid context`);
        return false;
      }
    
      const sender = context.sender;
      const chatId = context.chatId;
      const text = context.text;
      const isGroup = context.isGroup;
      const groupSettings = isGroup ? getGroupSettings(chatId) : null;
    
      // Select Socket
      let targetSock = sockInstance;
      if (config.BOT_SECONDARY_JID && chatId.includes(config.BOT_SECONDARY_JID.split('@')[0])) {
        targetSock = secondarySockInstance;
      }
      if (!targetSock) {
        logger.warn(`${logPrefix} No valid socket for ${chatId}`);
        return false;
      }
    
      // Validate Group Metadata
      if (isGroup) {
        try {
          await targetSock.groupMetadata(chatId);
        } catch (groupError) {
          logger.warn(`${logPrefix} Group metadata fetch failed for ${chatId}:`, {
            message: groupError.message,
          });
          return false;
        }
      }
    
      // Admin Check
      const adminJids = config.OWNER_NUMBER.map(sanitizeJid);
      const isAdminUser = adminJids.includes(sender);
      if (isAdminUser) {
        logger.debug(`${logPrefix} Admin ${sender} bypassed security checks`);
      }
    
      // Link Check
      if (isGroup && groupSettings?.linkProtection && !isAdminUser) {
        if (containsBlockedLinks(text)) {
          logger.info(`${logPrefix} Link detected from ${sender} in ${chatId}`);
          await handleLinkViolation(context, targetSock);
          return true;
        }
      }
    
      // Spam Check
      if (!isAdminUser && ((isGroup && groupSettings?.spamFilter) || !isGroup)) {
        if (isSpam(sender)) {
          logger.info(`${logPrefix} Spam detected from ${sender} in ${chatId}`);
          await handleSpammer(context, targetSock);
          return true;
        }
      }
    
      return false;
    }
    
    /**
     * Checks if a given text contains links matching BLOCKED_LINKS patterns.
     * v2: Optimizes regex, adds logging.
     * @param {string} text The text content to check.
     * @returns {boolean} True if a blocked link is found.
     */
    function containsBlockedLinks(text) {
      const logPrefix = "[Security Links v2]";
      if (!text || !config.BLOCKED_LINKS?.length) {
        logger.debug(`${logPrefix} No text or blocked links configured`);
        return false;
      }
      try {
        const linkPatterns = config.BLOCKED_LINKS.map((linkPrefix) => {
          const escapedPrefix = linkPrefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          return `(?:\\b|\\s|^|\\(|\\<|\\")(${escapedPrefix})(\\S*)`;
        });
        const combinedPattern = new RegExp(linkPatterns.join('|'), 'i');
        const result = combinedPattern.test(text);
        if (result) {
          logger.debug(`${logPrefix} Blocked link detected in text: ${text.substring(0, 50)}`);
        }
        return result;
      } catch (e) {
        logger.error(`${logPrefix} Regex error:`, { message: e.message });
        return false;
      }
    }
    
    /**
     * Handles link violations in groups: warns user, deletes message, removes user if max warnings.
     * v2: Uses correct bot JID, adds stickers, styles warnings, supports multi-number.
     * @param {object} context The parsed message context.
     * @param {import('@whiskeysockets/baileys').WASocket} sock The socket to use.
     */
    async function handleLinkViolation(context, sock) {
      const logPrefix = "[Link Violation v2]";
      if (!context || !context.isGroup || !sock) {
        logger.warn(`${logPrefix} Invalid context or socket`);
        return;
      }
    
      const sender = context.sender;
      const chatId = context.chatId;
      const senderName = context.pushName || sender.split('@')[0];
      const currentWarnings = (state.userWarnings.get(sender) || 0) + 1;
      state.userWarnings.set(sender, currentWarnings);
      const remainingWarnings = MAX_WARNINGS - currentWarnings;
    
      // Style Warning Message
      const userStyle = state.userStyles.get(sender) || 'default';
      let warnMsg = config.WARN_MESSAGE;
      if (userStyle === 'sarcastic') {
        warnMsg = `😏 Tryna sneak links, eh? ${warnMsg}`;
      } else if (userStyle === 'formal') {
        warnMsg = `Dear @${senderName}, ${warnMsg.toLowerCase()}`;
      }
      warnMsg += `\n@${sender.split('@')[0]} you have (${currentWarnings}/${MAX_WARNINGS}) warnings.` +
        (remainingWarnings > 0 ? ` \nAdmin use ${config.COMMAND_PREFIX}resetwarn @user to reset.` : ' Max warnings reached!');
    
      // Send Warning
      try {
        await sock.sendMessage(chatId, { text: warnMsg, mentions: [sender] });
        if (currentWarnings === MAX_WARNINGS) {
          await sock.sendMessage(chatId, {
            sticker: getStickerReaction({ sentiment: 'negative', userStyle }),
          });
        }
      } catch (e) {
        logger.error(`${logPrefix} Failed to send warning:`, { message: e.message });
      }
    
      logger.warn(`${logPrefix} User: ${sender} (${senderName}) in ${chatId}. Warnings: ${currentWarnings}/${MAX_WARNINGS}. Text: "${context.text.substring(0, 50)}"`);
    
      // Delete Message
      try {
        await sock.sendMessage(chatId, { delete: context.key });
        logger.info(`${logPrefix} Deleted message ${context.key.id} from ${sender}`);
      } catch (e) {
        logger.error(`${logPrefix} Failed to delete message ${context.key.id}:`, {
          message: e.message,
          code: e.output?.statusCode,
        });
        if (e.output?.statusCode === 403 || e.message?.includes('forbidden')) {
          await sendReply(context, "⚠️ Couldn't delete link. Bot needs admin rights.", [], sock);
        }
      }
    
      // Remove User if Max Warnings
      if (currentWarnings >= MAX_WARNINGS) {
        logger.warn(`${logPrefix} Max warnings for ${sender}. Attempting removal`);
    
        // Check Bot Admin Status
        let isBotAdmin = false;
        const botJid = sanitizeJid(sock.user?.id);
        const botNumericId = botJid.split('@')[0];
        try {
          const groupMeta = await sock.groupMetadata(chatId);
          const participants = groupMeta?.participants || [];
          const botParticipant = participants.find((p) => sanitizeJid(p.id).split('@')[0] === botNumericId);
          isBotAdmin = botParticipant?.admin === 'admin' || botParticipant?.admin === 'superadmin';
          if (!isBotAdmin) {
            logger.warn(`${logPrefix} Bot not admin (Status: ${botParticipant?.admin || 'None'})`);
            await sendReply(context, `⚠️ Cannot remove @${sender.split('@')[0]}. Bot needs admin rights.`, [sender], sock);
            return;
          }
        } catch (metaError) {
          logger.error(`${logPrefix} Failed to check bot admin status:`, { message: metaError.message });
          await sendReply(context, "⚠️ Error checking permissions for kick.", [], sock);
          return;
        }
    
        // Remove User
        try {
          await sendReply(context, `🚨 @${sender.split('@')[0]} don commot! Too many links. 👋`, [sender], sock);
          await sock.groupParticipantsUpdate(chatId, [sender], 'remove');
          logger.info(`${logPrefix} Removed ${sender} (${senderName}) from ${chatId}`);
          state.userWarnings.delete(sender);
          await sock.sendMessage(chatId, {
            sticker: getStickerReaction({ sentiment: 'neutral', userStyle }),
          });
        } catch (e) {
          logger.error(`${logPrefix} Failed to remove ${sender}:`, {
            message: e.message,
            code: e.output?.statusCode,
          });
          await sendReply(context, `⚠️ Failed removing @${sender.split('@')[0]}. Code: ${e.output?.statusCode || 'Unknown'}`, [sender], sock);
        }
      }
    } 
    
    /**
     * Checks if a sender is spamming based on message frequency.
     * v2: Adds admin array check, optimizes logging.
     * @param {string} sender The JID of the sender.
     * @returns {boolean} True if spamming detected.
     */
    function isSpam(sender) {
      const logPrefix = "[Spam Check v2]";
      if (!sender) {
        logger.debug(`${logPrefix} Invalid sender`);
        return false;
      }
    
      const adminJids = config.OWNER_NUMBER.map(sanitizeJid);
      if (adminJids.includes(sender)) {
        logger.debug(`${logPrefix} Admin ${sender} bypassed spam check`);
        return false;
      }
    
      const now = Date.now();
      const timestamps = state.messageTimestamps.get(sender) || [];
      const recentTimestamps = timestamps.filter((ts) => now - ts < SPAM_WINDOW_MS);
      recentTimestamps.push(now);
      state.messageTimestamps.set(sender, recentTimestamps);
    
      if (recentTimestamps.length > MAX_WARNINGS) {
        logger.warn(`${logPrefix} Spam detected: ${sender} (${recentTimestamps.length} messages in ${SPAM_WINDOW_MS}ms)`);
        return true;
      }
      return false;
    }
    
    /**
     * Handles detected spammers by removing them from groups.
     * v2: Uses correct bot JID, adds stickers, styles messages, supports multi-number.
     * @param {object} context The parsed message context.
     * @param {import('@whiskeysockets/baileys').WASocket} sock The socket to use.
     */
    async function handleSpammer(context, sock) {
      const logPrefix = "[Spam Handler v2]";
      if (!context) {
        logger.warn(`${logPrefix} Invalid context`);
        return;
      }
    
      const sender = context.sender;
      const chatId = context.chatId;
      const senderName = context.pushName || sender.split('@')[0];
      if (!context.isGroup) {
        logger.warn(`${logPrefix} Spam in DM from ${sender}. No action taken`);
        return;
      }
    
      // Select Socket
      let targetSock = sock || sockInstance;
      if (config.BOT_SECONDARY_JID && chatId.includes(config.BOT_SECONDARY_JID.split('@')[0])) {
        targetSock = secondarySockInstance;
      }
      if (!targetSock) {
        logger.warn(`${logPrefix} No valid socket for ${chatId}`);
        return;
      }
    
      // Validate Group Metadata
      try {
        await targetSock.groupMetadata(chatId);
      } catch (metaError) {
        logger.error(`${logPrefix} Group metadata fetch failed:`, { message: metaError.message });
        await sendReply(context, "⚠️ Error checking group permissions.", [], targetSock);
        return;
      }
    
      // Check Bot Admin Status
      let isBotAdmin = false;
      const botJid = sanitizeJid(targetSock.user?.id);
      const botNumericId = botJid.split('@')[0];
      try {
        const groupMeta = await targetSock.groupMetadata(chatId);
        const participants = groupMeta?.participants || [];
        const botParticipant = participants.find((p) => sanitizeJid(p.id).split('@')[0] === botNumericId);
        isBotAdmin = botParticipant?.admin === 'admin' || botParticipant?.admin === 'superadmin';
        if (!isBotAdmin) {
          logger.warn(`${logPrefix} Bot not admin (Status: ${botParticipant?.admin || 'None'})`);
          await sendReply(context, `⚠️ Cannot remove @${sender.split('@')[0]} for spam. Bot needs admin rights.`, [sender], targetSock);
          return;
        }
      } catch (metaError) {
        logger.error(`${logPrefix} Failed to check bot admin status:`, { message: metaError.message });
        await sendReply(context, "⚠️ Error checking permissions for kick.", [], targetSock);
        return;
      }
    
      // Style Removal Message
      const userStyle = state.userStyles.get(sender) || 'default';
      let removeMsg = `🚨 @${sender.split('@')[0]} removed for spamming! Oya cool down small! ❄️`;
      if (userStyle === 'sarcastic') {
        removeMsg = `😏 Spamming like say you dey code DDoS? @${sender.split('@')[0]} don commot! ❄️`;
      } else if (userStyle === 'formal') {
        removeMsg = `Dear @${senderName}, you have been removed for excessive messaging.`;
      }
    
      // Remove Spammer
      try {
        await sendReply(context, removeMsg, [sender], targetSock);
        await targetSock.groupParticipantsUpdate(chatId, [sender], 'remove');
        logger.info(`${logPrefix} Removed ${sender} (${senderName}) from ${chatId} for spamming`);
        state.messageTimestamps.delete(sender);
        await targetSock.sendMessage(chatId, {
          sticker: getStickerReaction({ sentiment: 'negative', userStyle }),
        });
      } catch (e) {
        logger.error(`${logPrefix} Failed to remove ${sender}:`, {
          message: e.message,
          code: e.output?.statusCode,
        });
        await sendReply(context, `⚠️ Failed removing @${sender.split('@')[0]}. Code: ${e.output?.statusCode || 'Unknown'}`, [sender], targetSock);
      }
    }
    
    /**
     * Processes a validated command detected in a message.
     * v2: Adds multi-number support, styles errors, adds stickers, enhances logging.
     * @param {object} context The parsed message context.
     * @param {string} commandName The name of the command.
     * @param {object} command The command object from COMMANDS.
     * @param {string[]} args Array of arguments.
     * @param {import('@whiskeysockets/baileys').WASocket} sock The socket to use.
     * @returns {Promise<boolean>} True if command was handled.
     */
    async function processCommands(context, commandName, command, args, sock) {
      const logPrefix = "[Commands v2]";
      if (!context || !commandName || !command || !command.handler) {
        logger.error(`${logPrefix} Invalid parameters`, { commandName, hasHandler: !!command?.handler });
        return false;
      }
    
      const sender = context.sender;
      const chatId = context.chatId;
    
      // Select Socket
      let targetSock = sock || sockInstance;
      if (config.BOT_SECONDARY_JID && chatId.includes(config.BOT_SECONDARY_JID.split('@')[0])) {
        targetSock = secondarySockInstance;
      }
      if (!targetSock) {
        logger.warn(`${logPrefix} No valid socket for ${chatId}`);
        return false;
      }
    
      // Admin Check
      const adminJids = config.OWNER_NUMBER.map(sanitizeJid);
      const isAdminUser = adminJids.includes(sender);
      if (command.adminOnly && !isAdminUser) {
        logger.warn(`${logPrefix} Admin command '${commandName}' denied for ${sender}`);
        await sendReply(context, "⛔ Only Oga fit run this command!", [], targetSock);
        return true;
      }
    
      // Rate Limiting
      if (!isAdminUser && !(await checkRateLimit(context, commandName))) {
        return true;
      }
    
      // Execute Command
      try {
        logger.info(`${logPrefix} Executing '${commandName}' by ${sender} in ${chatId}`);
        if (['toimg', 'tosticker', 'forward'].includes(commandName)) {
          const simpleContext = {
            chatId: context.chatId,
            sender: context.sender,
            isReply: context.isReply,
            quotedParticipant: context.quotedParticipant,
            quotedTextLen: context.quotedText?.length,
            quotedMsgExists: !!context.quotedMsg,
            contentType: context.contentType,
            selectedButtonId: context.selectedButtonId,
          };
          logger.debug(`${logPrefix} Context for ${commandName}:`, simpleContext);
        }
    
        // Handle Specific Commands
        if (commandName === 'resetspam' && isAdminUser) {
          const target = context.mentions[0];
          if (target) {
            state.messageTimestamps.delete(target);
            await sendReply(context, `Spam timestamps reset for @${target.split('@')[0]}`, [target], targetSock);
          } else {
            await sendReply(context, "Mention a user to reset spam!", [], targetSock);
          }
          return true;
        }
    
        await command.handler(context, args, targetSock);
        return true;
      } catch (error) {
        logger.error(`${logPrefix} Command '${commandName}' failed:`, {
          sender,
          message: error.message,
          stack: error.stack?.substring(0, 500),
        });
        const userStyle = state.userStyles.get(sender) || 'default';
        let errorMsg = `❌ Wahala dey! Command '${commandName}' crash. Try again or tell Oga.`;
        if (userStyle === 'sarcastic') {
          errorMsg = `😒 E be like '${commandName}' no wan work. Try again or ping Oga!`;
        }
        await sendReply(context, errorMsg, [], targetSock);
        await targetSock.sendMessage(chatId, {
          sticker: getStickerReaction({ sentiment: 'neutral', userStyle }),
        });
        await sendErrorToOwner(error, context.msg, context, targetSock);
        return true;
      }
    }
    
    // ================== Command Handlers ================== //
    
    /**
     * Sends the help menu as styled plain formatted text.
     * v13: Adds user style formatting, multi-number support, stickers for errors.
     * @param {object} context The parsed message context.
     */
    async function sendHelp(context) {
      const logPrefix = "[Help Cmd v13]";
      if (!context) {
        logger.warn(`${logPrefix} Invalid context`);
        return;
      }
    
      const sender = context.sender;
      const chatId = context.chatId;
      const adminJids = config.OWNER_NUMBER.map(sanitizeJid);
      const isAdminUser = adminJids.includes(sender);
      const userStyle = state.userStyles.get(sender) || 'default';
    
      // Select Socket
      let targetSock = sockInstance;
      if (config.BOT_SECONDARY_JID && chatId.includes(config.BOT_SECONDARY_JID.split('@')[0])) {
        targetSock = secondarySockInstance;
      }
      if (!targetSock) {
        logger.warn(`${logPrefix} No valid socket for ${chatId}`);
        return;
      }
    
      logger.info(`${logPrefix} Sending help to ${sender} (Admin: ${isAdminUser})`);
    
      if (typeof COMMANDS === 'undefined') {
        logger.error(`${logPrefix} COMMANDS undefined`);
        await sendReply(context, "⚠️ No commands available.", [], targetSock);
        return;
      }
    
      // Prepare Text Output
      let sections = { user: [], admin: [], owner: [] };
      Object.entries(COMMANDS)
        .sort(([a], [b]) => a.localeCompare(b))
        .forEach(([name, cmd]) => {
          const commandInfo = `❖ \`${config.COMMAND_PREFIX}${name}\` : ${cmd.description || 'No description'}`;
          const isOwnerOnly = cmd.description?.toLowerCase().includes('owner only');
          if (isOwnerOnly && isAdminUser) {
            sections.owner.push(commandInfo);
          } else if (cmd.adminOnly && isAdminUser) {
            sections.admin.push(commandInfo);
          } else if (!cmd.adminOnly && !isOwnerOnly) {
            sections.user.push(commandInfo);
          }
        });
    
      // Build Styled Text
      const botName = config.BOT_NAME || 'TonnaBot';
      let helpText = userStyle === 'formal'
        ? `=== ${botName} Command Menu ===\n\n`
        : `*╔═══*.·:·.☽✧ *${botName} Help* ✧☾.·:·.*═══╗*\n\n`;
      if (userStyle === 'sarcastic') {
        helpText = `😏 *${botName}'s Grand Command List, Since You Asked...* 😏\n\n`;
      }
    
      if (sections.user.length > 0) {
        helpText += userStyle === 'formal' ? "User Commands:\n" : "║--- *👤 User Commands* ---║\n";
        helpText += sections.user.join('\n') + '\n\n';
      }
      if (sections.admin.length > 0 && isAdminUser) {
        helpText += userStyle === 'formal' ? "Admin Commands:\n" : "║--- *⚙️ Admin Commands* ---║\n";
        helpText += sections.admin.join('\n') + '\n\n';
      }
      if (sections.owner.length > 0 && isAdminUser) {
        helpText += userStyle === 'formal' ? "Owner Commands:\n" : "║--- *👑 Owner Commands* ---║\n";
        helpText += sections.owner.join('\n') + '\n\n';
      }
    
      // Tips Section
      helpText += userStyle === 'formal' ? "Tips:\n" : "║------ *💡 Tips* ------║\n";
      helpText += `│ › Use commands like \`${config.COMMAND_PREFIX}command [options]\`\n`;
      const botNumber = config.BOT_PRIMARY_JID ? config.BOT_PRIMARY_JID.split('@')[0] : botName;
      helpText += `│ › AI responds in DMs or groups if mentioned (@${botNumber} / ${botName}) or replied.\n`;
    
      // Footer
      helpText += userStyle === 'formal' ? "=== End of Menu ===" : "*╚═══*.·:·.☽✧☾.·:·.*═══╝*";
    
      if (sections.user.length === 0 && sections.admin.length === 0 && sections.owner.length === 0) {
        await sendReply(context, "⚠️ No commands available for you.", [], targetSock);
        return;
      }
    
      // Send Help
      try {
        await sendReply(context, helpText.trim(), [], targetSock);
        logger.info(`${logPrefix} Help sent to ${sender}`);
      } catch (error) {
        logger.error(`${logPrefix} Failed to send help:`, {
          message: error.message,
          stack: error.stack?.substring(0, 500),
        });
        await sendReply(context, "❌ Error sending help. Try again!", [], targetSock);
        await targetSock.sendMessage(chatId, {
          sticker: getStickerReaction({ sentiment: 'neutral', userStyle }),
        });
        await sendErrorToOwner(error, context.msg, context, targetSock);
      }
    }
    
    /**
     * Removes users from the group. (Admin only, requires bot admin)
     * v2: Adds multi-number support, styles messages, stickers, robust validation.
     * @param {object} context The parsed message context.
     * @param {string[]} args Array of phone numbers/mentions.
     */
    async function handleKickUser(context, args) {
      const logPrefix = "[Kick Cmd v2]";
      if (!context?.isGroup) {
        logger.warn(`${logPrefix} Group-only command in ${context.chatId}`);
        await sendReply(context, "❌ Group only command.", [], sockInstance);
        return;
      }
    
      const sender = context.sender;
      const chatId = context.chatId;
      const userStyle = state.userStyles.get(sender) || 'default';
    
      // Select Socket
      let targetSock = sockInstance;
      if (config.BOT_SECONDARY_JID && chatId.includes(config.BOT_SECONDARY_JID.split('@')[0])) {
        targetSock = secondarySockInstance;
      }
      if (!targetSock) {
        logger.warn(`${logPrefix} No valid socket for ${chatId}`);
        await sendReply(context, "⚠️ Bot error. Try again!", [], sockInstance);
        return;
      }
    
      // Permission Checks
      let groupMeta;
      const adminJids = config.OWNER_NUMBER.map(sanitizeJid);
      const isAdminUser = adminJids.includes(sender);
      const botJid = sanitizeJid(targetSock.user?.id);
      const botNumericId = botJid.split('@')[0];
      try {
        logger.info(`${logPrefix} Fetching metadata for ${chatId}`);
        groupMeta = await targetSock.groupMetadata(chatId);
        const participants = groupMeta?.participants || [];
        const botParticipant = participants.find((p) => sanitizeJid(p.id).split('@')[0] === botNumericId);
        const isBotAdmin = botParticipant?.admin === 'admin' || botParticipant?.admin === 'superadmin';
        if (!isBotAdmin) {
          logger.warn(`${logPrefix} Bot not admin (Status: ${botParticipant?.admin || 'None'})`);
          await sendReply(context, "⚠️ Bot needs admin rights to kick!", [], targetSock);
          return;
        }
    
        const senderParticipant = participants.find((p) => sanitizeJid(p.id) === sender);
        const isSenderAdmin = senderParticipant?.admin === 'admin' || senderParticipant?.admin === 'superadmin';
        if (!isAdminUser && !isSenderAdmin) {
          logger.warn(`${logPrefix} Sender ${sender} not authorized`);
          await sendReply(context, "⛔ Only admins can kick!", [], targetSock);
          return;
        }
        logger.debug(`${logPrefix} Sender ${sender} authorized (Admin: ${isAdminUser}, Group Admin: ${isSenderAdmin})`);
      } catch (e) {
        logger.error(`${logPrefix} Failed to fetch group metadata:`, { message: e.message });
        await sendReply(context, "⚠️ Error checking group permissions.", [], targetSock);
        return;
      }
    
      // Determine Users to Kick
      let usersToKickJids = [];
      let targetSource = 'None';
      if (context.mentions?.length > 0) {
        usersToKickJids = context.mentions;
        targetSource = 'Mentions';
        logger.info(`${logPrefix} Targets via mentions: ${usersToKickJids.join(', ')}`);
      } else if (context.isReply && context.quotedParticipant) {
        usersToKickJids.push(context.quotedParticipant);
        targetSource = 'Reply';
        logger.info(`${logPrefix} Target via reply: ${context.quotedParticipant}`);
      } else if (args?.length > 0) {
        usersToKickJids = args
          .map((num) => num.replace(/[^0-9]/g, ''))
          .map((num) => sanitizeJid(num));
        targetSource = 'Arguments';
        logger.info(`${logPrefix} Targets via args: ${usersToKickJids.join(', ')}`);
      } else {
        await sendReply(context, "❓ Who you wan kick? Mention, reply, or provide numbers.", [], targetSock);
        return;
      }
    
      // Filter and Validate Targets
      const groupMemberJids = new Set(groupMeta.participants.map((p) => p.id));
      const currentBotJid = sanitizeJid(config.BOT_PRIMARY_JID);
      usersToKickJids = usersToKickJids
        .map((jid) => sanitizeJid(jid))
        .filter((jid) => {
          if (!jid || !jid.includes('@s.whatsapp.net')) {
            logger.warn(`${logPrefix} Invalid JID: ${jid}`);
            return false;
          }
          if (jid === currentBotJid) {
            logger.warn(`${logPrefix} Attempt to kick self`);
            return false;
          }
          if (adminJids.includes(jid)) {
            logger.warn(`${logPrefix} Attempt to kick admin ${jid}`);
            return false;
          }
          const targetParticipant = groupMeta.participants.find((p) => p.id === jid);
          if (targetParticipant?.admin === 'admin' || targetParticipant?.admin === 'superadmin') {
            logger.warn(`${logPrefix} Target ${jid} is admin`);
          }
          if (!groupMemberJids.has(jid)) {
            logger.warn(`${logPrefix} Target ${jid} not in group`);
            return false;
          }
          return true;
        });
    
      if (usersToKickJids.length === 0) {
        await sendReply(context, `❓ No valid users to kick from ${targetSource}.`, [], targetSock);
        return;
      }
    
      // Attempt Kick Operation
      try {
        const result = await targetSock.groupParticipantsUpdate(chatId, usersToKickJids, 'remove');
        logger.debug(`${logPrefix} Kick result:`, result);
    
        // Process Results
        let kicked = [], failed = [];
        if (Array.isArray(result)) {
          for (const item of result) {
            const jid = Object.keys(item)[0];
            const status = item[jid];
            const numericId = jid.split('@')[0];
            if (status === '200') {
              kicked.push(numericId);
            } else {
              failed.push(`${numericId} (${status})`);
            }
          }
        } else {
          logger.warn(`${logPrefix} Unexpected kick result format`);
          failed = usersToKickJids.map((jid) => jid.split('@')[0] + ' (Unknown)');
        }
    
        // Build Reply
        let reply = userStyle === 'sarcastic' ? `😏 Kick report incoming...\n` : '';
        const kickedJids = usersToKickJids.filter((jid) => kicked.includes(jid.split('@')[0]));
        if (kicked.length > 0) {
          reply += `✅ Kicked: @${kicked.join(', @')}\n`;
          if (userStyle === 'sarcastic') reply += `😏 Dem don dey trek now!\n`;
        }
        if (failed.length > 0) {
          reply += `❌ Failed: ${failed.join(', ')}\n`;
        }
        if (!reply) reply = "⚠️ Kick processed, but results unclear.";
    
        await sendReply(context, reply.trim(), kickedJids, targetSock);
        if (failed.length > 0) {
          await targetSock.sendMessage(chatId, {
            sticker: getStickerReaction({ sentiment: 'negative', userStyle }),
          });
        } else if (kicked.length > 0) {
          await targetSock.sendMessage(chatId, {
            sticker: getStickerReaction({ sentiment: 'neutral', userStyle }),
          });
        }
      } catch (error) {
        logger.error(`${logPrefix} Kick failed:`, {
          message: error.message,
          stack: error.stack?.substring(0, 500),
        });
        await sendReply(context, `⚠️ Error kicking users. Code: ${error.output?.statusCode || 'Unknown'}`, [], targetSock);
        await targetSock.sendMessage(chatId, {
          sticker: getStickerReaction({ sentiment: 'negative', userStyle }),
        });
        await sendErrorToOwner(error, context.msg, context, targetSock);
      }
    } 
    
    /**
     * Adds users to the group. (Admin only, requires bot admin)
     * v2: Adds multi-number support, styles messages, stickers, robust validation.
     * @param {Object} context The parsed message context.
     * @param {string[]} args Array of phone numbers.
     */
    async function handleAddUser(context, args) {
      const logPrefix = "[Add Cmd v2]";
      if (!context?.isGroup) {
        logger.warn(`${logPrefix} Group-only command in ${context.chatId}`);
        await sendReply(context, "❌ Group only command.", [], sockInstance);
        return;
      }
    
      const sender = context.sender;
      const chatId = context.chatId;
      const userStyle = state.userStyles.get(sender) || '0';
      let numbersToParse = args;
    
      // Select Socket
      let targetSock = sockInstance;
      if (config.BOT_SECONDARY_JID && chatId.includes(config.BOT_SECONDARY_JID.split('@')[0])) {
        targetSock = secondarySockInstance;
      }
      if (!targetSock) {
        logger.warn(`${logPrefix} No valid socket for ${chatId}`);
        await sendReply(context, "⚠️ Bot error.", [], sockInstance);
        return;
      }
    
      // Check Reply for Numbers
      if (!args?.length && context.isReply && context.quotedText) {
        logger.debug(`${logPrefix} No args, checking quoted text`);
        const numbers = context.quotedText.match(/\+?\d[\d\s-]{8,}/g) || [];
        if (numbers.length) {
          numbersToParse = numbers.map((num) => num.replace(/[\s+-]/g, ''));
          logger.info(`${logPrefix} Found numbers in quoted text: ${numbersToParse.join(', ')}`);
        } else {
          await sendReply(context, `❓ Provide numbers after ${config.COMMAND_PREFIX}add or reply to a message with numbers.`, [], targetSock);
          return;
        }
      } else if (!args?.length) {
        await sendReply(context, `❓ Usage: ${config.COMMAND_PREFIX}add numbers or reply with numbers.`, [], targetSock);
        return;
      }
    
      // Permission Checks
      let groupMeta;
      const adminJids = config.ADMIN_NUMBER.map(sanitizeJid);
      const isAdmin = adminJids.includes(sender);
      const botJid = sanitizeJid(targetSock.user?.id);
      const botId = botJid.split('@')[0];
      try {
        groupMeta = await targetSock.groupMetadata(chatId);
        const participants = groupMeta?.participants || [];
        const botParticipant = participants.find((p) => sanitizeJid(p.id).split('@')[0] === botId);
        const isBotAdmin = botParticipant?.adminOnly === 'admin' || botParticipant?.adminOnly === 'superadmin';
        if (!isBotAdmin) {
          logger.warn(`${logPrefix} Bot not admin (Status: ${botParticipant?.admin || 'None'})`);
          await sendReply(context, "⚠️ Bot needs admin rights.", [], targetSock);
          return;
        }
    
        const senderParticipant = participants.find((p) => sanitizeJid(p.id) === sender);
        const isSenderAdmin = senderParticipant?.adminOnly === 'admin' || senderParticipant?.adminOnly === 'superadmin';
        if (!isAdmin && !isSenderAdmin) {
          logger.warn(`${logPrefix} Sender ${sender} not authorized`);
          await sendReply(context, "⛓ Only admins can add users!", [], targetSock);
          return;
        }
        logger.debug(`${logPrefix} Authorized: ${sender} (Admin: ${isAdmin}, Group Admin: ${isSenderAdmin})`);
      } catch (e) {
        logger.error(`${logPrefix} Metadata fetch failed:`, { message: e.message });
        await sendReply(context, "⚠️ Error checking permissions.", [], targetSock);
        return;
      }
    
      // Sanitize Numbers
      const numbersToAdd = numbersToParse
        .map((num) => num.replace(/[^0-9]/g, ''))
        .map((num) => sanitizeJid(num))
        .filter((j) => j && j.includes('@s.whatsapp.net'));
    
      if (!numbersToAdd.length) {
        await sendReply(context, "❓ No valid numbers found.", [], targetSock);
        return;
      }
    
      logger.info(`${logPrefix} Adding JIDs: ${numbersToAdd.join(', ')} by ${sender}`);
    
      // Attempt Add
      try {
        const result = await targetSock.groupParticipantsUpdate(chatId, numbersToAdd, 'add');
        let added = [], failed = [], alreadyIn = [], otherError = [];
        if (Array.isArray(result)) {
          for (const item of result) {
            if (!item?.jid) continue;
            const num = item.jid.split('@')[0];
            const status = item.status?.toString() || 'unknown';
            if (status.startsWith('2')) added.push(num);
            else if (status === '403') failed.push(`${num} (Privacy?)`);
            else if (status === '408') failed.push(`${num} (Not Found?)`);
            else if (status === '409') alreadyIn.push(num);
            else otherError.push(`${num} (${status})`);
          }
        } else {
          otherError.push(`Unknown (${JSON.stringify(result)})`);
        }
    
        let reply = userStyle === 'sarcastic' ? `😎 Add report vibes...\n` : '';
        if (added.length > 0) reply += `✅ Added: ${added.join(', ')}\n`;
        if (alreadyIn.length > 0) reply += `👥 Already in: ${alreadyIn.join(', ')}\n`;
        if (failed.length > 0) reply += `❌ Failed: ${failed.join(', ')}\n`;
        if (otherError.length > 0) reply += `❓ Other: ${otherError.join(', ')}\n`;
        if (!reply) reply = "⚠️ Add processed, no results.";
    
        await sendReply(context, reply.trim(), [], targetSock);
        if (failed.length > 0 || otherError.length > 0) {
          await targetSock.sendMessage(chatId, {
            sticker: getStickerReaction({ sentiment: 'negative', userStyle }),
          });
        } else if (added.length > 0) {
          await targetSock.sendMessage(chatId, {
            sticker: getStickerReaction({ sentiment: 'neutral', userStyle }),
          });
        }
      } catch (e) {
        logger.error(`${logPrefix} Add failed:`, {
          message: e.message,
          stack: e.stack?.substring(0, 500),
        });
        await sendReply(context, `⚠️ Error adding: ${e.output?.statusCode || 'Unknown'}`, [], targetSock);
        await targetSock.sendErrorToOwner(context, e.message);
        await targetSock.sendMessage(chatId, {
          sticker: getStickerReaction({ sentiment: 'negative', userStyle }),
        });
      }
    }
    
    /**
     * Handles !gen command for AI name generation.
     * v2: Adds styles, stickers, multi-number support.
     * @param {Object} context Parsed message context.
     * @param {string[]} args Category and hints.
     */
    async function handleNameGeneratorCommand(context, args) {
      const logPrefix = '[NameGen v2]';
      const sender = context.sender;
      const chatId = context.chatId;
      const userStyle = state.userStyles.get(sender) || '0';
      const request = args.join(' ').trim();
    
      // Select Socket
      let targetSock = sockInstance;
      if (config.BOT_SECONDARY_JID && chatId.includes(config.BOT_SECONDARY_JID.split('@')[0])) {
        targetSock = secondarySockInstance;
      }
      if (!targetSock) {
        logger.warn(`${logPrefix} No valid socket for ${chatId}`);
        await sendReply(context, "⚠️ Bot error.", [], sockInstance);
        return;
      }
    
      if (!request) {
        await sendReply(context, `❓ Usage: ${config.COMMAND_PREFIX}gen cool nicknames`, [], targetSock);
        return;
      }
    
      logger.info(`${logPrefix} Request: "${request}" by ${sender}`);
    
      const prompt = `You are ${config.BOT_NAME}, a creative name generator. Generate 3-5 unique names for "${request}".\nFormat as a list:\n1. Name\n2. Name\n...`;
      await sendReply(context, `🤔 Generating names for "${request}"...`, [], targetSock);
    
      try {
        const result = await aiModel.generateContent(prompt);
        const names = result.response?.text().trim();
        if (!names) throw new Error('Empty AI response');
    
        let reply = userStyle === 'sarcastic' ? `😎 Check these out, name guru:\n\n${names}` : `✨ Names for "${request}":\n\n${names}`;
        await sendReply(context, reply, [], targetSock);
        await targetSock.sendMessage(chatId, {
          sticker: getStickerReaction({ sentiment: 'neutral', userStyle }),
        });
      } catch (e) {
        logger.error(`${logPrefix} Failed:`, {
          message: e.message,
          stack: e.stack?.substring(0, 500),
        });
        let errorMsg = userStyle === 'sarcastic' ? `😴 AI name gen crashed. Try again!` : `⚠️ Error generating names: ${e.message}`;
        await sendReply(context, errorMsg, [], targetSock);
        await targetSock.sendMessage(chatId, {
          sticker: getStickerReaction({ sentiment: 'negative', userStyle }),
        });
        await sendErrorToOwner(context, e.message);
      }
    }
    
    /**
     * Handles !horror command for spooky messages.
     * v2: Adds styles, random delays, stickers.
     * @param {Object} context Parsed message context.
     * @param {string[]} args Unused.
     */
    async function handleHorrorCommand(context, args) {
      const logPrefix = '[Horror v2]';
      const sender = context.sender;
      const chatId = context.chatId;
      const userStyle = state.userStyles.get(sender) || '0';
    
      // Select Socket
      let targetSock = sockInstance;
      if (config.BOT_SECONDARY_JID && chatId.includes(config.BOT_SECONDARY_JID.split('@')[0])) {
        targetSock = secondarySockInstance;
      }
      if (!targetSock) {
        logger.warn(`${logPrefix} No valid socket for ${chatId}`);
        await sendReply(context, "⚠️ Bot error.", [], sockInstance);
        return;
      }
    
      logger.info(`${logPrefix} Activated by ${sender} in ${chatId}`);
    
      const horrorSequence = [
        "```\nSystem Alert: Unknown presence detected...\n```",
        userStyle === 'sarcastic' ? "😏 Heard a creepy vibe yet?" : "Did you hear that?",
        "```\nStatic patterns rising...\n```",
        "Someone just typed... then vanished.",
        "```\nDark node reroute failed...\n```",
        `Psst... @${sender.split('@')[0]}... you alone?`,
        "```\nERROR: ...no...don't...look...\n```",
        "Don't turn around.",
        "```\nStability: 27%...\n```",
        userStyle === 'sarcastic' ? "😈 Gotcha! Boo!" : "👻 Boo!",
      ];
    
      const feedbackMsg = await sendReply(context, userStyle === 'sarcastic' ? "😈 Eerie mode on, hold tight!" : "🤫 Eerie mode activating...", [], targetSock);
      let currentDelay = 2500;
    
      for (const msg of horrorSequence) {
        await delay(currentDelay + Math.random() * 1000);
        try {
          const message = msg.includes(`@${sender.split('@')[0]}`)
            ? { text: msg, mentions: [sender] }
            : { text: msg };
          await targetSock.sendMessage(chatId, message);
        } catch (e) {
          logger.error(`${logPrefix} Failed to send:`, { message: e.message });
          await sendReply(context, "❌ Horror sequence crashed!", [], targetSock);
          await targetSock.sendMessage(chatId, {
            sticker: getStickerReaction({ sentiment: 'negative', userStyle }),
          });
          return;
        }
        currentDelay = Math.max(1500, currentDelay - 200);
      }
    
      if (feedbackMsg?.key) {
        await targetSock.sendMessage(chatId, { delete: feedbackMsg.key }).catch((e) =>
          logger.warn(`${logPrefix} Failed to delete feedback: ${e.message}`)
        );
      }
      await targetSock.sendMessage(chatId, {
        sticker: getStickerReaction({ sentiment: 'neutral', userStyle }),
      });
      logger.info(`${logPrefix} Completed for ${sender}`);
    }
    
    /**
     * Handles !confess command for anonymous confessions.
     * v2: Adds styles, stickers, multi-number support.
     * @param {Object} context Parsed message context.
     * @param {string[]} args Group name and confession.
     */
    async function handleConfessCommand(context, args) {
      const logPrefix = '[Confess v2]';
      const sender = context.sender;
      const chatId = context.chatId;
      const userStyle = state.userStyles.get(sender) || '0';
    
      // Select Socket
      let targetSock = sockInstance;
      if (config.BOT_SECONDARY_JID && chatId.includes(config.BOT_SECONDARY_JID.split('@')[0])) {
        targetSock = secondarySockInstance;
      }
      if (!targetSock) {
        logger.warn(`${logPrefix} No valid socket for ${chatId}`);
        await sendReply(context, "⚠️ Bot error.", [], sockInstance);
        return;
      }
    
      if (context.isGroup) {
        await sendReply(context, "🤫 Confessions are DM-only. Send via DM!", [], targetSock);
        return;
      }
    
      const fullArgs = args.join(' ');
      let groupName, confession;
      const quotedMatch = fullArgs.match(/^"([^"]+)"\s+(.+)/s);
      if (quotedMatch) {
        groupName = quotedMatch[1].trim();
        confession = quotedMatch[2].trim();
      } else if (args.length >= 2) {
        groupName = args[0];
        confession = args.slice(1).join(' ').trim();
      }
    
      if (!groupName || !confession) {
        await targetSock.sendMessage(sender, {
          text: `❓ Usage: ${config.COMMAND_PREFIX}confess "Group Name" Your confession...`,
        });
        return;
      }
    
      logger.info(`${logPrefix} Confession for "${groupName}" by ${sender}`);
      await targetSock.sendMessage(sender, {
        text: `⏳ Posting to "${groupName}"...`,
      });
    
      try {
        const groups = await findGroupJidByName(groupName);
        if (!groups?.length) {
          await targetSock.sendMessage(sender, {
            text: `❌ No group named "${groupName}" found.`,
          });
          return;
        }
    
        let targetGroupId = groups[0];
        if (groups.length > 1) {
          logger.warn(`${logPrefix} Multiple groups: ${groups.join(', ')}`);
          await targetSock.sendMessage(sender, {
            text: `⚠️ Multiple groups found. Posting to: ${targetGroupId}`,
          });
        }
    
        const anonMsg = userStyle === 'sarcastic'
          ? `😜 *Spicy Anonymous Tea*\n─────────\n${confession}\n─────────\n_(Via ${config.BOT_NAME})`
          : `🤫 *Anonymous Confession*\n─────────\n${confession}\n─────────\n_(Via ${config.BOT_NAME})`;
    
        await targetSock.sendMessage(targetGroupId, { text: anonMsg });
        await targetSock.sendMessage(sender, {
          text: `✅ Confession posted to "${groupName}"!`,
          sticker: getStickerReaction({ sentiment: 'neutral', userStyle }),
        });
        logger.info(`${logPrefix} Posted to ${targetGroupId}`);
      } catch (e) {
        logger.error(`${logPrefix} Failed:`, {
          message: e.message,
          stack: e.stack?.substring(0, 500),
        });
        await targetSock.sendMessage(sender, {
          text: `⚠️ Error posting confession: ${e.message}`,
          sticker: getStickerReaction({ sentiment: 'negative', userStyle }),
        });
        await sendErrorToOwner(context, e.message);
      }
    } 
    
    /**
     * Handles !leaderboard command. Displays top N users in group by level/XP.
     * v5: Adds styles, stickers, multi-number support.
     * @param {Object} context Parsed message context.
     * @param {string[]} args Unused.
     */
    async function handleLeaderboardCommand(context, args) {
      const logPrefix = '[Leaderboard v5]';
      if (!context?.isGroup) {
        await sendReply(context, '❌ Group-only command.', [], sockInstance);
        return;
      }
    
      const chatId = context.chatId;
      const sender = context.sender;
      const userStyle = state.userStyles.get(sender) || '0';
      const TOP_N = 10;
      const defaultRole = LEVEL_ROLES[0]?.title || 'N/A';
    
      // Select Socket
      let targetSock = sockInstance;
      if (config.BOT_SECONDARY_JID && chatId.includes(config.BOT_SECONDARY_JID.split('@')[0])) {
        targetSock = secondarySockInstance;
      }
      if (!targetSock) {
        logger.warn(`${logPrefix} No valid socket for ${chatId}`);
        await sendReply(context, '⚠️ Bot error.', [], sockInstance);
        return;
      }
    
      if (!supabase) {
        logger.warn(`${logPrefix} Supabase not initialized`);
        await sendReply(context, '⚠️ Database connection issue.', [], targetSock);
        return;
      }
    
      logger.info(`${logPrefix} Requested by ${sender} in ${chatId}`);
      await sendReply(context, userStyle === 'sarcastic' ? '😎 Ranking the big dogs...' : `⏳ Fetching top ${TOP_N} ranks...`, [], targetSock);
    
      try {
        const metadata = await targetSock.groupMetadata(chatId);
        const participants = metadata?.participants || [];
        const groupName = metadata.subject || 'This Group';
    
        if (!participants.length) {
          await sendReply(context, '⚠️ No group members found.', [], targetSock);
          return;
        }
    
        const jids = participants.map((p) => sanitizeJid(p.id)).filter((jid) => jid);
        const BATCH_SIZE = 100;
        let allUsersData = [];
    
        for (let i = 0; i < jids.length; i += BATCH_SIZE) {
          const batchJids = jids.slice(i, i + BATCH_SIZE);
          const { data, error } = await supabase
            .from('users_data')
            .select('user_id, xp, level, title')
            .in('user_id', batchJids);
    
          if (error) throw new Error(`Supabase error: ${error.message}`);
          if (data) allUsersData = allUsersData.concat(data);
        }
    
        const dbDataMap = new Map(allUsersData.map((u) => [u.user_id, u]));
        const getTitleForLevel = (level) => LEVEL_ROLES.find((r) => r.level <= level)?.title || defaultRole;
    
        const rankedUsers = participants
          .map((p) => {
            const jid = sanitizeJid(p.id);
            const dbUser = dbDataMap.get(jid);
            const level = dbUser?.level || 0;
            const xp = dbUser?.xp || 0;
            const title = dbUser?.title || getTitleForLevel(level);
            const score = level * 10000 + xp;
            return { jid, level, xp, title, score };
          })
          .filter((u) => u.score > 0)
          .sort((a, b) => b.score - a.score)
          .slice(0, TOP_N);
    
        let replyText = userStyle === 'sarcastic'
          ? `😎 *${groupName.toUpperCase()} BIG SHOTS* 😎\n`
          : `🏆 *${groupName.toUpperCase()} LEADERBOARD* 🏆\n`;
        replyText += '──────────────\n';
        if (!rankedUsers.length) {
          replyText += 'No XP earned yet!';
        } else {
          rankedUsers.forEach((u, i) => {
            replyText += `#${i + 1}. @${u.jid.split('@')[0]} - *${u.title}* (Lvl ${u.level})\n`;
          });
        }
        replyText += '──────────────';
    
        await targetSock.sendMessage(chatId, { text: replyText.trim(), mentions: rankedUsers.map((u) => u.jid) }, { quoted: context.msg });
        await targetSock.sendMessage(chatId, { sticker: getStickerReaction({ sentiment: 'neutral', userStyle }) });
        logger.info(`${logPrefix} Sent leaderboard for ${chatId}`);
      } catch (e) {
        logger.error(`${logPrefix} Failed:`, { message: e.message, stack: e.stack?.substring(0, 500) });
        await sendReply(context, '⚠️ Error generating leaderboard.', [], targetSock);
        await targetSock.sendMessage(chatId, { sticker: getStickerReaction({ sentiment: 'negative', userStyle }) });
        await sendErrorToOwner(context, e.message);
      }
    }
    
    /**
     * Handles !caption command for AI-generated image captions.
     * v2: Adds styles, stickers, multi-number support.
     * @param {Object} context Parsed message context.
     * @param {string[]} args Unused.
     */
    async function handleCaptionCommand(context, args) {
      const logPrefix = '[Caption v2]';
      const sender = context.sender;
      const chatId = context.chatId;
      const userStyle = state.userStyles.get(sender) || '0';
    
      // Select Socket
      let targetSock = sockInstance;
      if (config.BOT_SECONDARY_JID && chatId.includes(config.BOT_SECONDARY_JID.split('@')[0])) {
        targetSock = secondarySockInstance;
      }
      if (!targetSock) {
        logger.warn(`${logPrefix} No valid socket for ${chatId}`);
        await sendReply(context, '⚠️ Bot error.', [], sockInstance);
        return;
      }
    
      logger.info(`${logPrefix} Requested by ${sender}`);
      if (!context.isReply || !context.msg?.message?.extendedTextMessage?.contextInfo?.quotedMessage?.imageMessage) {
        await sendReply(context, `❓ Reply to an image with ${config.COMMAND_PREFIX}caption.`, [], targetSock);
        return;
      }
    
      const imageData = context.msg.message.extendedTextMessage.contextInfo.quotedMessage.imageMessage;
      await sendReply(context, userStyle === 'sarcastic' ? '😏 Scanning this pic for vibes...' : '⏳ Generating caption...', [], targetSock);
    
      try {
        const imageStream = await baileysPkg.downloadContentFromMessage(imageData, 'image');
        let imageBuffer = Buffer.from([]);
        for await (const chunk of imageStream) {
          imageBuffer = Buffer.concat([imageBuffer, chunk]);
        }
        if (!imageBuffer.length) throw new Error('Empty image buffer');
    
        const base64Image = imageBuffer.toString('base64');
        const mimeType = imageData.mimetype || 'image/jpeg';
        const prompt = `You are ${config.BOT_NAME}, a witty Nigerian bot. Generate ONE short, creative caption for this image in ${userStyle === 'sarcastic' ? 'sarcastic Pidgin' : 'English or Pidgin'}. Output ONLY the caption.`;
    
        const payload = {
          contents: [{ role: 'user', parts: [{ text: prompt }, { inlineData: { data: base64Image, mimeType } }] }],
        };
    
        const result = await aiModel.generateContent(payload);
        const caption = result.response?.text().trim();
        if (!caption) throw new Error('Empty caption');
    
        await sendReply(context, userStyle === 'sarcastic' ? `😎 Ehen, see wetin I find: "${caption}"` : `🤖 Caption: "${caption}"`, [], targetSock);
        await targetSock.sendMessage(chatId, { sticker: getStickerReaction({ sentiment: 'neutral', userStyle }) });
      } catch (e) {
        logger.error(`${logPrefix} Failed:`, { message: e.message, stack: e.stack?.substring(0, 500) });
        let errorMsg = userStyle === 'sarcastic' ? '😴 Pic too wack for a caption!' : `⚠️ Error: ${e.message}`;
        await sendReply(context, errorMsg, [], targetSock);
        await targetSock.sendMessage(chatId, { sticker: getStickerReaction({ sentiment: 'negative', userStyle }) });
        await sendErrorToOwner(context, e.message);
        throw e;
      }
    }
    
    /**
     * Handles !about command for bot info.
     * v4: Adds styles, stickers, modern fs.
     * @param {Object} context Parsed message context.
     */
    async function handleAboutBot(context) {
      const logPrefix = '[About v4]';
      const sender = context.sender;
      const chatId = context.chatId;
      const userStyle = state.userStyles.get(sender) || '0';
    
      // Select Socket
      let targetSock = sockInstance;
      if (config.BOT_SECONDARY_JID && chatId.includes(config.BOT_SECONDARY_JID.split('@')[0])) {
        targetSock = secondarySockInstance;
      }
      if (!targetSock) {
        logger.warn(`${logPrefix} No valid socket for ${chatId}`);
        await sendReply(context, '⚠️ Bot error.', [], sockInstance);
        return;
      }
    
      if (!context) {
        logger.warn(`${logPrefix} Invalid context`);
        return;
      }
    
      logger.info(`${logPrefix} Requested by ${sender}`);
      await sendReply(context, userStyle === 'sarcastic' ? '😏 Who be this fine bot? Wait...' : '⏳ Fetching bot info...', [], targetSock);
    
      let ppBuffer = null;
      let botVersion = 'N/A';
      const botJid = targetSock.user?.id;
    
      try {
        const { readFile } = await import('fs/promises');
        const packageJson = JSON.parse(await readFile('./package.json', 'utf8'));
        botVersion = packageJson.version || 'N/A';
      } catch (e) {
        logger.warn(`${logPrefix} Failed to read package.json: ${e.message}`);
      }
    
      if (botJid) {
        try {
          const ppUrl = await targetSock.profilePictureUrl(botJid, 'image');
          const response = await fetch(ppUrl);
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          ppBuffer = await response.buffer();
          if (!ppBuffer.length) throw new Error('Empty PP buffer');
        } catch (e) {
          logger.warn(`${logPrefix} Failed to fetch PP: ${e.message}`);
        }
      }
    
      const name = config.BOT_NAME || 'TonnaBot';
      const clan = '︻デ═一 𝕭𝖚𝖑𝖑𝖊𝖙𝕾𝖙𝖔𝖗𝖒';
      const creator = 'Emenine Tochukwu';
      const aboutText = userStyle === 'sarcastic'
        ? '😎 No be small bot o, na street-smart warrior coded for vawulence! From BulletStorm, Oga Emenine build am. Expect fire, no dull me!'
        : 'No be ordinary bot, na digital warrior coded for Vawulence and Truth Bombs! From BulletStorm clan, built by Emenine Tochukwu.';
    
      const styledText = `
    ${userStyle === 'sarcastic' ? '😏' : '✨'} *${name} PROFILE* ${userStyle === 'sarcastic' ? '😏' : '✨'}
    ──────────────
    ❖ *Version:* v${botVersion}
    ❖ *Clan:* ${clan}
    ❖ *Creator:* ${creator} 🔥
    ──────────────
    ${aboutText}
    ──────────────
      `.trim();
    
      try {
        if (ppBuffer) {
          await targetSock.sendMessage(chatId, { image: ppBuffer, caption: styledText }, { quoted: context.msg });
        } else {
          await sendReply(context, styledText, [], targetSock);
        }
        await targetSock.sendMessage(chatId, { sticker: getStickerReaction({ sentiment: 'neutral', userStyle }) });
      } catch (e) {
        logger.error(`${logPrefix} Failed to send:`, { message: e.message });
        await sendReply(context, `Name: ${name}\nVersion: ${botVersion}\nCreator: ${creator}`, [], targetSock);
        await targetSock.sendMessage(chatId, { sticker: getStickerReaction({ sentiment: 'negative', userStyle }) });
        await sendErrorToOwner(context, e.message);
      }
    }
    
    /**
     * Toggles AI listening in group. (Admin only)
     * v2: Adds styles, stickers, multi-number.
     * @param {Object} context Parsed message context.
     * @param {string[]} args [on/off].
     */
    async function handleAIToggle(context, args) {
      const logPrefix = '[AIToggle v2]';
      if (!context?.isGroup) {
        await sendReply(context, '❌ Group-only command.', [], sockInstance);
        return;
      }
    
      const chatId = context.chatId;
      const sender = context.sender;
      const userStyle = state.userStyles.get(sender) || '0';
      const setting = args[0]?.toLowerCase();
    
      // Select Socket
      let targetSock = sockInstance;
      if (config.BOT_SECONDARY_JID && chatId.includes(config.BOT_SECONDARY_JID.split('@')[0])) {
        targetSock = secondarySockInstance;
      }
      if (!targetSock) {
        logger.warn(`${logPrefix} No valid socket for ${chatId}`);
        await sendReply(context, '⚠️ Bot error.', [], sockInstance);
        return;
      }
    
      if (setting !== 'on' && setting !== 'off') {
        await sendReply(context, `❓ Usage: ${config.COMMAND_PREFIX}ai [on/off]`, [], targetSock);
        return;
      }
    
      const groupSettings = getGroupSettings(chatId);
      const newState = setting === 'on';
    
      if (groupSettings.aiEnabled === newState) {
        await sendReply(context, userStyle === 'sarcastic' ? `😏 AI already ${newState ? 'dey spy' : 'dey sleep'}!` : `✅ AI already ${newState ? 'ON' : 'OFF'}.`, [], targetSock);
        return;
      }
    
      groupSettings.aiEnabled = newState;
      state.groupSettings.set(chatId, groupSettings);
      await sendReply(context, userStyle === 'sarcastic' ? `😎 AI now ${newState ? 'dey watch una' : 'don close eye'}!` : `🤖 AI ${newState ? 'ENABLED' : 'DISABLED'}.`, [], targetSock);
      await targetSock.sendMessage(chatId, { sticker: getStickerReaction({ sentiment: 'neutral', userStyle }) });
      logger.info(`${logPrefix} AI set to ${newState} by ${sender}`);
    }
    
    /**
     * Toggles global Nuclear AI override. (Owner only)
     * v2: Adds styles, stickers, multi-number.
     * @param {Object} context Parsed message context.
     * @param {string[]} args [on/off].
     */
    async function handleNuclearAI(context, args) {
      const logPrefix = '[NuclearAI v2]';
      const sender = context.sender;
      const chatId = context.chatId;
      const userStyle = state.userStyles.get(sender) || '0';
    
      // Select Socket
      let targetSock = sockInstance;
      if (config.BOT_SECONDARY_JID && chatId.includes(config.BOT_SECONDARY_JID.split('@')[0])) {
        targetSock = secondarySockInstance;
      }
      if (!targetSock) {
        logger.warn(`${logPrefix} No valid socket for ${chatId}`);
        await sendReply(context, '⚠️ Bot error.', [], sockInstance);
        return;
      }
    
      const adminJids = config.ADMIN_NUMBER.map(sanitizeJid);
      if (!adminJids.includes(sender)) {
        await sendReply(context, '⛔ Owner-only command!', [], targetSock);
        return;
      }
    
      const setting = args[0]?.toLowerCase();
      if (setting !== 'on' && setting !== 'off') {
        await sendReply(context, `❓ Usage: ${config.COMMAND_PREFIX}nuclear [on/off]`, [], targetSock);
        return;
      }
    
      const newState = setting === 'on';
      state.nuclearAI = newState;
      const status = newState ? 'ENGAGED 🔥' : 'DISENGAGED ✅';
      await sendReply(context, userStyle === 'sarcastic' ? `😈 Nuclear AI ${status}! ${newState ? 'We dey scatter everywhere!' : 'Chill mode on.'}` : `☢️ Nuclear AI ${status}!`, [], targetSock);
      await targetSock.sendMessage(chatId, { sticker: getStickerReaction({ sentiment: 'neutral', userStyle }) });
      logger.warn(`${logPrefix} Nuclear AI ${status} by ${sender}`);
    }
    
    /**
     * Tags all group members visibly. (Admin only)
     * v2: Adds styles, stickers, multi-number.
     * @param {Object} context Parsed message context.
     * @param {string[]} args Optional message.
     */
    async function handleTagAll(context, args) {
      const logPrefix = '[TagAll v2]';
      if (!context?.isGroup) {
        await sendReply(context, '❌ Group-only command.', [], sockInstance);
        return;
      }
    
      const chatId = context.chatId;
      const sender = context.sender;
      const userStyle = state.userStyles.get(sender) || '0';
      const message = args.join(' ') || (userStyle === 'sarcastic' ? '😏 Squad, show face!' : '📢 Attention squad!');
    
      // Select Socket
      let targetSock = sockInstance;
      if (config.BOT_SECONDARY_JID && chatId.includes(config.BOT_SECONDARY_JID.split('@')[0])) {
        targetSock = secondarySockInstance;
      }
      if (!targetSock) {
        logger.warn(`${logPrefix} No valid socket for ${chatId}`);
        await sendReply(context, '⚠️ Bot error.', [], sockInstance);
        return;
      }
    
      try {
        const metadata = await targetSock.groupMetadata(chatId);
        const botJid = sanitizeJid(targetSock.user?.id);
        const participants = metadata.participants.map((p) => p.id).filter((id) => sanitizeJid(id) !== botJid);
    
        if (!participants.length) {
          await sendReply(context, '👥 Nobody to tag here!', [], targetSock);
          return;
        }
    
        logger.info(`${logPrefix} Tagging ${participants.length} members by ${sender}`);
        const CHUNK_SIZE = 15;
        for (let i = 0; i < participants.length; i += CHUNK_SIZE) {
          const chunk = participants.slice(i, i + CHUNK_SIZE);
          const mentionText = chunk.map((id) => `@${id.split('@')[0]}`).join(' ');
          const fullText = `${message}\n${mentionText}`;
          await targetSock.sendMessage(chatId, { text: fullText, mentions: chunk });
          if (i + CHUNK_SIZE < participants.length) await delay(600);
        }
    
        await targetSock.sendMessage(chatId, { sticker: getStickerReaction({ sentiment: 'neutral', userStyle }) });
        logger.info(`${logPrefix} Completed for ${chatId}`);
      } catch (e) {
        logger.error(`${logPrefix} Failed:`, { message: e.message, stack: e.stack?.substring(0, 500) });
        await sendReply(context, '⚠️ Tagging error!', [], targetSock);
        await targetSock.sendMessage(chatId, { sticker: getStickerReaction({ sentiment: 'negative', userStyle }) });
        await sendErrorToOwner(context, e.message);
      }
    }
    
    /**
     * Tags all group members silently. (Admin only)
     * v2: Adds styles, stickers, multi-number.
     * @param {Object} context Parsed message context.
     * @param {string[]} args Optional message.
     */
    async function handleHideTagAll(context, args) {
      const logPrefix = '[HideTag v2]';
      if (!context?.isGroup) {
        await sendReply(context, '❌ Group-only command.', [], sockInstance);
        return;
      }
    
      const chatId = context.chatId;
      const sender = context.sender;
      const userStyle = state.userStyles.get(sender) || '0';
      const message = args.join(' ') || (userStyle === 'sarcastic' ? '😏 Pssst, everybody!' : '🔔 Heads up!');
    
      // Select Socket
      let targetSock = sockInstance;
      if (config.BOT_SECONDARY_JID && chatId.includes(config.BOT_SECONDARY_JID.split('@')[0])) {
        targetSock = secondarySockInstance;
      }
      if (!targetSock) {
        logger.warn(`${logPrefix} No valid socket for ${chatId}`);
        await sendReply(context, '⚠️ Bot error.', [], sockInstance);
        return;
      }
    
      try {
        const metadata = await targetSock.groupMetadata(chatId);
        const botJid = sanitizeJid(targetSock.user?.id);
        const participants = metadata.participants.map((p) => p.id).filter((id) => sanitizeJid(id) !== botJid);
    
        if (!participants.length) {
          await sendReply(context, '👥 Nobody to tag!', [], targetSock);
          return;
        }
    
        logger.info(`${logPrefix} Silent tagging ${participants.length} members by ${sender}`);
        await targetSock.sendMessage(chatId, { text: message, mentions: participants });
        await targetSock.sendMessage(chatId, { sticker: getStickerReaction({ sentiment: 'neutral', userStyle }) });
        logger.info(`${logPrefix} Completed for ${chatId}`);
      } catch (e) {
        logger.error(`${logPrefix} Failed:`, { message: e.message, stack: e.stack?.substring(0, 500) });
        await sendReply(context, '⚠️ Silent tag error!', [], targetSock);
        await targetSock.sendMessage(chatId, { sticker: getStickerReaction({ sentiment: 'negative', userStyle }) });
        await sendErrorToOwner(context, e.message);
      }
    }
    
    /**
     * Resets link violation warnings. (Admin only)
     * v2: Adds styles, stickers, multi-number.
     * @param {Object} context Parsed message context.
     * @param {string[]} args Mention or JID.
     */
    async function handleResetWarn(context, args) {
      const logPrefix = '[ResetWarn v2]';
      if (!context?.isGroup) {
        await sendReply(context, '❌ Group-only command.', [], sockInstance);
        return;
      }
    
      const chatId = context.chatId;
      const sender = context.sender;
      const userStyle = state.userStyles.get(sender) || '0';
      const target = context.mentions[0] || (args[0] ? sanitizeJid(args[0]) : null);
    
      // Select Socket
      let targetSock = sockInstance;
      if (config.BOT_SECONDARY_JID && chatId.includes(config.BOT_SECONDARY_JID.split('@')[0])) {
        targetSock = secondarySockInstance;
      }
      if (!targetSock) {
        logger.warn(`${logPrefix} No valid socket for ${chatId}`);
        await sendReply(context, '⚠️ Bot error.', [], sockInstance);
        return;
      }
    
      if (!target || !target.includes('@s.whatsapp.net')) {
        await sendReply(context, `❓ Usage: ${config.COMMAND_PREFIX}resetwarn @user`, [], targetSock);
        return;
      }
    
      let reply = userStyle === 'sarcastic' ? `😏 @${target.split('@')[0]} don get fresh start! No misyarn again o!` : `♻️ Warnings cleared for @${target.split('@')[0]}.`;
      if (state.userWarnings.has(target)) {
        state.userWarnings.delete(target);
        logger.info(`${logPrefix} Warnings reset for ${target} by ${sender}`);
      } else {
        reply = userStyle === 'sarcastic' ? `😎 @${target.split('@')[0]} clean like whistle already!` : `✅ @${target.split('@')[0]} has no warnings.`;
      }
    
      await sendReply(context, reply, [target], targetSock);
      await targetSock.sendMessage(chatId, { sticker: getStickerReaction({ sentiment: 'neutral', userStyle }) });
    }
    
    /**
     * Promotes user to admin. (Admin only)
     * v2: Adds styles, stickers, multi-number.
     * @param {Object} context Parsed message context.
     * @param {string[]} args Mention or JID.
     */
    async function handlePromote(context, args) {
      const logPrefix = '[Promote v2]';
      if (!context?.isGroup) {
        await sendReply(context, '❌ Group-only command.', [], sockInstance);
        return;
      }
    
      const chatId = context.chatId;
      const sender = context.sender;
      const userStyle = state.userStyles.get(sender) || '0';
      const target = context.mentions[0] || (args[0] ? sanitizeJid(args[0]) : null);
    
      // Select Socket
      let targetSock = sockInstance;
      if (config.BOT_SECONDARY_JID && chatId.includes(config.BOT_SECONDARY_JID.split('@')[0])) {
        targetSock = secondarySockInstance;
      }
      if (!targetSock) {
        logger.warn(`${logPrefix} No valid socket for ${chatId}`);
        await sendReply(context, '⚠️ Bot error.', [], sockInstance);
        return;
      }
    
      if (!target || !target.includes('@s.whatsapp.net')) {
        await sendReply(context, `❓ Usage: ${config.COMMAND_PREFIX}promote @user`, [], targetSock);
        return;
      }
    
      let groupMeta;
      const adminJids = config.ADMIN_NUMBER.map(sanitizeJid);
      const isAdmin = adminJids.includes(sender);
      const botJid = sanitizeJid(targetSock.user?.id);
      const botId = botJid.split('@')[0];
    
      try {
        groupMeta = await targetSock.groupMetadata(chatId);
        const participants = groupMeta?.participants || [];
        const botParticipant = participants.find((p) => sanitizeJid(p.id).split('@')[0] === botId);
        const isBotAdmin = botParticipant?.admin === 'admin' || botParticipant?.admin === 'superadmin';
        if (!isBotAdmin) {
          logger.warn(`${logPrefix} Bot not admin: ${botParticipant?.admin || 'None'}`);
          await sendReply(context, '⚠️ Bot needs admin rights.', [], targetSock);
          return;
        }
    
        const senderParticipant = participants.find((p) => sanitizeJid(p.id) === sender);
        const isSenderAdmin = senderParticipant?.admin === 'admin' || senderParticipant?.admin === 'superadmin';
        if (!isAdmin && !isSenderAdmin) {
          logger.warn(`${logPrefix} Sender ${sender} not authorized`);
          await sendReply(context, '🔒 Only admins can promote!', [], targetSock);
          return;
        }
      } catch (e) {
        logger.error(`${logPrefix} Metadata fetch failed:`, { message: e.message });
        await sendReply(context, '⚠️ Error checking permissions.', [], targetSock);
        return;
      }
    
      try {
        await targetSock.groupParticipantsUpdate(chatId, [target], 'promote');
        await sendReply(context, userStyle === 'sarcastic' ? `😏 @${target.split('@')[0]} don level up to Oga!` : `👑 @${target.split('@')[0]} is now admin!`, [target], targetSock);
        await targetSock.sendMessage(chatId, { sticker: getStickerReaction({ sentiment: 'neutral', userStyle }) });
        logger.info(`${logPrefix} Promoted ${target} by ${sender}`);
      } catch (e) {
        logger.error(`${logPrefix} Failed:`, { message: e.message, stack: e.stack?.substring(0, 500) });
        await sendReply(context, userStyle === 'sarcastic' ? `😴 E no gree promote @${target.split('@')[0]}!` : `⚠️ Failed to promote @${target.split('@')[0]}. Code: ${e.output?.statusCode || 'Unknown'}`, [target], targetSock);
        await targetSock.sendMessage(chatId, { sticker: getStickerReaction({ sentiment: 'negative', userStyle }) });
        await sendErrorToOwner(context, e.message);
      }
    } 
    
    /**
     * Demotes admin to member. (Admin only)
     * v2: Adds styles, stickers, multi-number.
     * @param {Object} context Parsed message context.
     * @param {string[]} args Mention or JID.
     */
    async function handleDemote(context, args) {
      const logPrefix = '[Demote v2]';
      if (!context?.isGroup) {
        await sendReply(context, '❌ Group-only command.', [], sockInstance);
        return;
      }
    
      const chatId = context.chatId;
      const sender = context.sender;
      const userStyle = state.userStyles.get(sender) || '0';
      const target = context.mentions[0] || (args[0] ? sanitizeJid(args[0]) : null);
    
      // Select Socket
      let targetSock = sockInstance;
      if (config.BOT_SECONDARY_JID && chatId.includes(config.BOT_SECONDARY_JID.split('@')[0])) {
        targetSock = secondarySockInstance;
      }
      if (!targetSock) {
        logger.warn(`${logPrefix} No valid socket for ${chatId}`);
        await sendReply(context, '⚠️ Bot error.', [], sockInstance);
        return;
      }
    
      if (!target || !target.includes('@s.whatsapp.net')) {
        await sendReply(context, `❓ Usage: ${config.COMMAND_PREFIX}demote @admin`, [], targetSock);
        return;
      }
    
      const adminJids = config.ADMIN_NUMBER.map(sanitizeJid);
      if (adminJids.includes(target)) {
        await sendReply(context, '⛔ Cannot demote bot owner!', [], targetSock);
        return;
      }
    
      let groupMeta;
      const isAdmin = adminJids.includes(sender);
      const botJid = sanitizeJid(targetSock.user?.id);
      const botId = botJid.split('@')[0];
    
      try {
        groupMeta = await targetSock.groupMetadata(chatId);
        const participants = groupMeta?.participants || [];
        const botParticipant = participants.find((p) => sanitizeJid(p.id).split('@')[0] === botId);
        const isBotAdmin = botParticipant?.admin === 'admin' || botParticipant?.admin === 'superadmin';
        if (!isBotAdmin) {
          logger.warn(`${logPrefix} Bot not admin: ${botParticipant?.admin || 'None'}`);
          await sendReply(context, '⚠️ Bot needs admin rights.', [], targetSock);
          return;
        }
    
        const senderParticipant = participants.find((p) => sanitizeJid(p.id) === sender);
        const isSenderAdmin = senderParticipant?.admin === 'admin' || senderParticipant?.admin === 'superadmin';
        if (!isAdmin && !isSenderAdmin) {
          logger.warn(`${logPrefix} Sender ${sender} not authorized`);
          await sendReply(context, '🔒 Only admins can demote!', [], targetSock);
          return;
        }
      } catch (e) {
        logger.error(`${logPrefix} Metadata fetch failed:`, { message: e.message });
        await sendReply(context, '⚠️ Error checking permissions.', [], targetSock);
        return;
      }
    
      try {
        await targetSock.groupParticipantsUpdate(chatId, [target], 'demote');
        await sendReply(context, userStyle === 'sarcastic' ? `😏 @${target.split('@')[0]} don fall back to commoner!` : `🧑‍💼 @${target.split('@')[0]} is no longer admin.`, [target], targetSock);
        await targetSock.sendMessage(chatId, { sticker: getStickerReaction({ sentiment: 'neutral', userStyle }) });
        logger.info(`${logPrefix} Demoted ${target} by ${sender}`);
      } catch (e) {
        logger.error(`${logPrefix} Failed:`, { message: e.message, stack: e.stack?.substring(0, 500) });
        await sendReply(context, userStyle === 'sarcastic' ? `😴 E no gree demote @${target.split('@')[0]}!` : `⚠️ Failed to demote @${target.split('@')[0]}. Code: ${e.output?.statusCode || 'Unknown'}`, [target], targetSock);
        await targetSock.sendMessage(chatId, { sticker: getStickerReaction({ sentiment: 'negative', userStyle }) });
        await sendErrorToOwner(context, e.message);
      }
    }
    
    /**
     * Broadcasts message to all groups. (Owner only)
     * v4: Fixes braces, adds styles, stickers, multi-number.
     * @param {Object} context Parsed message context.
     * @param {string[]} args Text or caption.
     */
    async function handleBroadcast(context, args) {
      const logPrefix = '[Broadcast v4]';
      const sender = context.sender;
      const chatId = context.chatId;
      const userStyle = state.userStyles.get(sender) || '0';
    
      // Select Socket
      let targetSock = sockInstance;
      if (config.BOT_SECONDARY_JID && chatId.includes(config.BOT_SECONDARY_JID.split('@')[0])) {
        targetSock = secondarySockInstance;
      }
      if (!targetSock) {
        logger.warn(`${logPrefix} No valid socket for ${chatId}`);
        await sendReply(context, '⚠️ Bot error.', [], sockInstance);
        return;
      }
    
      const adminJids = config.ADMIN_NUMBER.map(sanitizeJid);
      if (!adminJids.includes(sender)) {
        await sendReply(context, '🔒 Owner-only command!', [], targetSock);
        return;
      }
    
      let messageText = args.join(' ');
      let mediaBuffer = null;
      let mediaType = null;
      let mediaData = null;
      let caption = messageText;
    
      try {
        if (context.isReply && context.msg?.message?.extendedTextMessage?.contextInfo?.quotedMessage) {
          const quoted = context.msg.message.extendedTextMessage.contextInfo.quotedMessage;
          if (quoted.imageMessage) {
            mediaType = 'image';
            mediaData = quoted.imageMessage;
          } else if (quoted.videoMessage) {
            mediaType = 'video';
            mediaData = quoted.videoMessage;
          }
    
          if (mediaType && mediaData) {
            const mediaStream = await baileysPkg.downloadContentFromMessage(mediaData, mediaType);
            mediaBuffer = Buffer.from([]);
            for await (const chunk of mediaStream) {
              mediaBuffer = Buffer.concat([mediaBuffer, chunk]);
            }
            if (!mediaBuffer.length) throw new Error('Empty media buffer');
          } else if (!messageText) {
            await sendReply(context, '❌ Broadcast text required if not replying to media.', [], targetSock);
            return;
          }
        } else if (!messageText) {
          await sendReply(context, '❌ Broadcast message cannot be empty.', [], targetSock);
          return;
        }
    
        const groupList = await fetchAllGroupJids();
        if (!groupList.length) {
          await sendReply(context, '🏜️ No groups to broadcast to.', [], targetSock);
          return;
        }
    
        const broadcastPrefix = userStyle === 'sarcastic' ? `😎 *${config.BOT_NAME} Don Talk* 😎\n\n` : `📢 *${config.BOT_NAME} Broadcast* 📢\n\n`;
        const feedbackIntro = userStyle === 'sarcastic' ? `😏 Blasting this to ${groupList.length} groups...` : `🚀 Broadcasting to ${groupList.length} groups...`;
        const feedbackMsg = await sendReply(context, feedbackIntro, [], targetSock);
    
        let successCount = 0, failCount = 0;
        for (const groupId of groupList) {
          try {
            const payload = mediaType && mediaBuffer
              ? { [mediaType]: mediaBuffer, caption: broadcastPrefix + caption }
              : { text: broadcastPrefix + messageText };
            await targetSock.sendMessage(groupId, payload);
            successCount++;
            if (groupList.length > 1) await delay(1700 + Math.random() * 1000);
          } catch (e) {
            failCount++;
            logger.error(`${logPrefix} Failed broadcast to ${groupId}: ${e.message}`);
            await sendErrorToOwner(context, `Broadcast failed for ${groupId}: ${e.message}`);
          }
        }
    
        if (feedbackMsg?.key) {
          await targetSock.sendMessage(chatId, { delete: feedbackMsg.key }).catch(e => logger.warn(`${logPrefix} Failed to delete feedback: ${e.message}`));
        }
        const summary = userStyle === 'sarcastic'
          ? `😎 *Broadcast Done*:\nHit ${successCount} groups, missed ${failCount}!`
          : `*Broadcast Report*:\nSuccessfully sent to: ${successCount}\nFailed for: ${failCount}`;
        await sendReply(context, summary, [], targetSock);
        await targetSock.sendMessage(chatId, { sticker: getStickerReaction({ sentiment: successCount > 0 ? 'neutral' : 'negative', userStyle }) });
        logger.info(`${logPrefix} Broadcast complete. Success: ${successCount}, Fail: ${failCount}`);
      } catch (e) {
        logger.error(`${logPrefix} Failed:`, { message: e.message, stack: e.stack?.substring(0, 500) });
        await sendReply(context, '⚠️ Broadcast error.', [], targetSock);
        await targetSock.sendMessage(chatId, { sticker: getStickerReaction({ sentiment: 'negative', userStyle }) });
        await sendErrorToOwner(context, e.message);
      }
    }
    
    /**
     * Manages group settings. (Admin only)
     * v2: Adds styles, stickers, multi-number.
     * @param {Object} context Parsed message context.
     * @param {string[]} args [setting] [on/off].
     */
    async function handleGroupSettings(context, args) {
      const logPrefix = '[GroupSettings v2]';
      if (!context?.isGroup) {
        await sendReply(context, '❌ Group-only command.', [], sockInstance);
        return;
      }
    
      const chatId = context.chatId;
      const sender = context.sender;
      const userStyle = state.userStyles.get(sender) || '0';
    
      // Select Socket
      let targetSock = sockInstance;
      if (config.BOT_SECONDARY_JID && chatId.includes(config.BOT_SECONDARY_JID.split('@')[0])) {
        targetSock = secondarySockInstance;
      }
      if (!targetSock) {
        logger.warn(`${logPrefix} No valid socket for ${chatId}`);
        await sendReply(context, '⚠️ Bot error.', [], sockInstance);
        return;
      }
    
      const settings = getGroupSettings(chatId);
      if (!args.length) {
        const settingsText = userStyle === 'sarcastic'
          ? `😏 *Group Settings*\n──────────────\n` +
            ` • AI Listening: ${settings.aiEnabled ? 'Dey Spy 👀' : 'Dey Sleep 😴'}\n` +
            ` • Welcome Msgs: ${settings.welcomeEnabled ? 'Dey Greet 😎' : 'No Vibe 🚫'}\n` +
            ` • Goodbye Msgs: ${settings.goodbyeEnabled ? 'Dey Wave 👋' : 'No Sendoff 🚫'}\n` +
            ` • Spam Filter: ${settings.spamFilter ? 'Dey Block 🚨' : 'Chill Mode 🥳'}\n` +
            ` • Link Protect: ${settings.linkProtection ? 'No Links 🚫' : 'Links Free 🆓'}\n` +
            `──────────────\nUse ${config.COMMAND_PREFIX}settings [option] [on/off]`
          : `⚙️ *Group Settings*\n──────────────\n` +
            ` • AI Listening: ${settings.aiEnabled ? '✅ ON' : '❌ OFF'}\n` +
            ` • Welcome Msgs: ${settings.welcomeEnabled ? '✅ ON' : '❌ OFF'}\n` +
            ` • Goodbye Msgs: ${settings.goodbyeEnabled ? '✅ ON' : '❌ OFF'}\n` +
            ` • Spam Filter: ${settings.spamFilter ? '✅ ON' : '❌ OFF'}\n` +
            ` • Link Protect: ${settings.linkProtection ? '✅ ON' : '❌ OFF'}\n` +
            `──────────────\nUse ${config.COMMAND_PREFIX}settings [option] [on/off]`;
        await sendReply(context, settingsText, [], targetSock);
        await targetSock.sendMessage(chatId, { sticker: getStickerReaction({ sentiment: 'neutral', userStyle }) });
        return;
      }
    
      const option = args[0]?.toLowerCase();
      const value = args[1]?.toLowerCase();
      if (value !== 'on' && value !== 'off') {
        await sendReply(context, `❓ Invalid value "${value}". Use 'on' or 'off'.`, [], targetSock);
        return;
      }
    
      const newState = value === 'on';
      let settingKey, settingName;
      switch (option) {
        case 'ai': settingKey = 'aiEnabled'; settingName = 'AI Listening'; break;
        case 'welcome': settingKey = 'welcomeEnabled'; settingName = 'Welcome Messages'; break;
        case 'goodbye': settingKey = 'goodbyeEnabled'; settingName = 'Goodbye Messages'; break;
        case 'spam': settingKey = 'spamFilter'; settingName = 'Spam Filter'; break;
        case 'links': settingKey = 'linkProtection'; settingName = 'Link Protection'; break;
        default:
          await sendReply(context, `❓ Unknown setting '${option}'. Use ${config.COMMAND_PREFIX}settings.`, [], targetSock);
          return;
      }
    
      if (settings[settingKey] === newState) {
        await sendReply(context, userStyle === 'sarcastic' ? `😏 ${settingName} already ${newState ? 'dey on' : 'dey off'}!` : `✅ ${settingName} already ${newState ? 'ON' : 'OFF'}.`, [], targetSock);
        return;
      }
    
      settings[settingKey] = newState;
      state.groupSettings.set(chatId, settings);
      await sendReply(context, userStyle === 'sarcastic' ? `😎 ${settingName} now ${newState ? 'dey active' : 'don sleep'}!` : `🔧 ${settingName} set to ${newState ? 'ON ✅' : 'OFF ❌'}.`, [], targetSock);
      await targetSock.sendMessage(chatId, { sticker: getStickerReaction({ sentiment: 'neutral', userStyle }) });
      logger.info(`${logPrefix} ${settingKey} set to ${newState} by ${sender}`);
    }
    
    /**
     * Displays user rank in group. (Supabase v6)
     * v6: Adds styles, stickers, multi-number.
     * @param {Object} context Parsed message context.
     * @param {string[]} args Unused.
     */
    async function handleRankCommand(context, args) {
      const logPrefix = '[Rank v6]';
      if (!context?.isGroup) {
        await sendReply(context, '❌ Group-only command.', [], sockInstance);
        return;
      }
    
      const chatId = context.chatId;
      const sender = context.sender;
      const userStyle = state.userStyles.get(sender) || '0';
      const defaultRole = LEVEL_ROLES[0]?.title || 'N/A';
    
      // Select Socket
      let targetSock = sockInstance;
      if (config.BOT_SECONDARY_JID && chatId.includes(config.BOT_SECONDARY_JID.split('@')[0])) {
        targetSock = secondarySockInstance;
      }
      if (!targetSock) {
        logger.warn(`${logPrefix} No valid socket for ${chatId}`);
        await sendReply(context, '⚠️ Bot error.', [], sockInstance);
        return;
      }
    
      if (!supabase) {
        logger.warn(`${logPrefix} Supabase not initialized`);
        await sendReply(context, '⚠️ Database connection issue.', [], targetSock);
        return;
      }
    
      logger.info(`${logPrefix} Requested by ${sender}`);
      await sendReply(context, userStyle === 'sarcastic' ? '😏 Checking where you stand...' : '⏳ Calculating your rank...', [], targetSock);
    
      try {
        const metadata = await targetSock.groupMetadata(chatId);
        const participants = metadata?.participants || [];
        const groupName = metadata.subject || 'This Group';
        if (!participants.length) {
          await sendReply(context, '⚠️ No group members found.', [], targetSock);
          return;
        }
    
        const jids = participants.map((p) => sanitizeJid(p.id)).filter((jid) => jid);
        const BATCH_SIZE = 100;
        let allUsersData = [];
    
        for (let i = 0; i < jids.length; i += BATCH_SIZE) {
          const batchJids = jids.slice(i, i + BATCH_SIZE);
          const { data, error } = await supabase
            .from('users_data')
            .select('user_id, xp, level, title')
            .in('user_id', batchJids);
          if (error) throw new Error(`Supabase error: ${error.message}`);
          if (data) allUsersData = allUsersData.concat(data);
        }
    
        const dbDataMap = new Map(allUsersData.map((u) => [u.user_id, u]));
        const getTitleForLevel = (level) => LEVEL_ROLES.find((r) => r.level <= level)?.title || defaultRole;
    
        const rankedUsers = participants
          .map((p) => {
            const jid = sanitizeJid(p.id);
            const dbUser = dbDataMap.get(jid);
            const level = dbUser?.level || 0;
            const xp = dbUser?.xp || 0;
            const title = dbUser?.title || getTitleForLevel(level);
            const score = level * 10000 + xp;
            return { jid, level, xp, title, score };
          })
          .filter((u) => u.jid)
          .sort((a, b) => b.score - a.score);
    
        let senderRank = -1, senderData;
        for (let i = 0; i < rankedUsers.length; i++) {
          if (rankedUsers[i].jid === sender) {
            senderRank = i + 1;
            senderData = rankedUsers[i];
            break;
          }
        }
    
        if (senderRank === -1 || !senderData) {
          const requiredXP = getRequiredXP(0);
          const replyText = userStyle === 'sarcastic'
            ? `😏 *${groupName.toUpperCase()} Rank*\nYou never show face o!\nTitle: *${defaultRole}*\nLevel: 0\nXP: 0 / ${requiredXP}`
            : `*🏆 Your Rank in ${groupName.toUpperCase()}*\nPosition: *Unknown*\nTitle: *${defaultRole}*\nLevel: 0\nXP: 0 / ${requiredXP}`;
          await sendReply(context, replyText, [], targetSock);
          return;
        }
    
        const requiredXP = getRequiredXP(senderData.level);
        const replyText = userStyle === 'sarcastic'
          ? `😎 *${groupName.toUpperCase()} Rank*\nPosition: *#${senderRank}* / ${rankedUsers.length}\nTitle: *${senderData.title}*\nLevel: ${senderData.level}\nXP: ${senderData.xp} / ${requiredXP}`
          : `*🏆 Your Rank in ${groupName.toUpperCase()}*\nPosition: *#${senderRank}* / ${rankedUsers.length}\nTitle: *${senderData.title}*\nLevel: ${senderData.level}\nXP: ${senderData.xp} / ${requiredXP}`;
        await sendReply(context, replyText, [], targetSock);
        await targetSock.sendMessage(chatId, { sticker: getStickerReaction({ sentiment: 'neutral', userStyle }) });
        logger.info(`${logPrefix} Sent rank for ${sender}`);
      } catch (e) {
        logger.error(`${logPrefix} Failed:`, { message: e.message, stack: e.stack?.substring(0, 500) });
        await sendReply(context, '⚠️ Rank error.', [], targetSock);
        await targetSock.sendMessage(chatId, { sticker: getStickerReaction({ sentiment: 'negative', userStyle }) });
        await sendErrorToOwner(context, e.message);
      }
    }
    
    /**
     * Responds with bot uptime.
     * v2: Adds styles, stickers, multi-number.
     * @param {Object} context Parsed message context.
     */
    async function handlePing(context) {
      const logPrefix = '[Ping v2]';
      if (!context) return;
    
      const chatId = context.chatId;
      const sender = context.sender;
      const userStyle = state.userStyles.get(sender) || '0';
    
      // Select Socket
      let targetSock = sockInstance;
      if (config.BOT_SECONDARY_JID && chatId.includes(config.BOT_SECONDARY_JID.split('@')[0])) {
        targetSock = secondarySockInstance;
      }
      if (!targetSock) {
        logger.warn(`${logPrefix} No valid socket for ${chatId}`);
        await sendReply(context, '⚠️ Bot error.', [], sockInstance);
        return;
      }
    
      const startTime = botStartTime || Date.now();
      const uptimeMs = Date.now() - startTime;
      const hours = Math.floor(uptimeMs / 3600000);
      const minutes = Math.floor((uptimeMs % 3600000) / 60000);
      const seconds = Math.floor((uptimeMs % 60000) / 1000);
      const uptime = `${hours}h ${minutes}m ${seconds}s`;
      const replyText = userStyle === 'sarcastic'
        ? `😏 *Pong!* Me dey awake since ${uptime} o!`
        : `*Pong!* ⚡\nUptime: ${uptime}`;
      await sendReply(context, replyText, [], targetSock);
      await targetSock.sendMessage(chatId, { sticker: getStickerReaction({ sentiment: 'neutral', userStyle }) });
      logger.info(`${logPrefix} Ping by ${sender}. Uptime: ${uptime}`);
    }
    
    /**
     * Stores user feedback.
     * v2: Adds styles, stickers, multi-number.
     * @param {Object} context Parsed message context.
     * @param {string[]} args Feedback text.
     */
    async function handleFeedback(context, args) {
      const logPrefix = '[Feedback v2]';
      if (!context) return;
    
      const chatId = context.chatId;
      const sender = context.sender;
      const userStyle = state.userStyles.get(sender) || '0';
    
      // Select Socket
      let targetSock = sockInstance;
      if (config.BOT_SECONDARY_JID && chatId.includes(config.BOT_SECONDARY_JID.split('@')[0])) {
        targetSock = secondarySockInstance;
      }
      if (!targetSock) {
        logger.warn(`${logPrefix} No valid socket for ${chatId}`);
        await sendReply(context, '⚠️ Bot error.', [], sockInstance);
        return;
      }
    
      if (!args?.length) {
        await sendReply(context, `❓ Usage: ${config.COMMAND_PREFIX}feedback <message>`, [], targetSock);
        return;
      }
    
      const feedbackText = args.join(' ');
      const feedbackEntry = { sender, name: context.pushName || 'Unknown', timestamp: Date.now(), message: feedbackText };
      state.feedback.push(feedbackEntry);
      if (state.feedback.length > MAX_FEEDBACK_MESSAGES) state.feedback.shift();
      await sendReply(context, userStyle === 'sarcastic' ? `😎 Your talk don land for Oga’s ear!` : `✅ Feedback received! Thanks!`, [], targetSock);
      await targetSock.sendMessage(chatId, { sticker: getStickerReaction({ sentiment: 'neutral', userStyle }) });
      logger.info(`${logPrefix} Feedback from ${sender}: "${feedbackText.substring(0, 50)}..."`);
    }
    
    /**
     * Converts sticker to JPEG. (Requires sharp)
     * v11: Adds styles, stickers, multi-number.
     * @param {Object} context Parsed message context.
     * @param {string[]} args Unused.
     */
    async function handleToImage(context, args) {
      const logPrefix = '[ToImage v11]';
      if (!context) return;
    
      const chatId = context.chatId;
      const sender = context.sender;
      const userStyle = state.userStyles.get(sender) || '0';
    
      // Select Socket
      let targetSock = sockInstance;
      if (config.BOT_SECONDARY_JID && chatId.includes(config.BOT_SECONDARY_JID.split('@')[0])) {
        targetSock = secondarySockInstance;
      }
      if (!targetSock) {
        logger.warn(`${logPrefix} No valid socket for ${chatId}`);
        await sendReply(context, '⚠️ Bot error.', [], sockInstance);
        return;
      }
    
      if (!context.isReply || !context.msg?.message?.extendedTextMessage?.contextInfo?.quotedMessage?.stickerMessage) {
        await sendReply(context, `❓ Reply to a sticker with ${config.COMMAND_PREFIX}toimg`, [], targetSock);
        return;
      }
    
      const stickerData = context.msg.message.extendedTextMessage.contextInfo.quotedMessage.stickerMessage;
      await sendReply(context, userStyle === 'sarcastic' ? '😏 Turning this sticker to pic...' : '⏳ Converting sticker to image...', [], targetSock);
    
      try {
        const stickerStream = await baileysPkg.downloadContentFromMessage(stickerData, 'sticker');
        let stickerBuffer = Buffer.from([]);
        for await (const chunk of stickerStream) {
          stickerBuffer = Buffer.concat([stickerBuffer, chunk]);
        }
        if (!stickerBuffer.length) throw new Error('Empty sticker buffer');
    
        const sharp = (await import('sharp')).default;
        if (typeof sharp !== 'function') throw new Error('Sharp library failed');
    
        const imageBuffer = await sharp(stickerBuffer).jpeg({ quality: 90 }).toBuffer();
        await targetSock.sendMessage(chatId, {
          image: imageBuffer,
          caption: userStyle === 'sarcastic' ? '😎 Sticker now pic, ehen!' : '✅ Sticker converted to image!',
          mimetype: 'image/jpeg'
        }, { quoted: context.msg });
        await targetSock.sendMessage(chatId, { sticker: getStickerReaction({ sentiment: 'neutral', userStyle }) });
        logger.info(`${logPrefix} Sticker converted for ${sender}`);
      } catch (e) {
        logger.error(`${logPrefix} Failed:`, { message: e.message, stack: e.stack?.substring(0, 500) });
        let errorMsg = userStyle === 'sarcastic' ? '😴 Sticker no gree turn pic o!' : `⚠️ Conversion error: ${e.message}`;
        await sendReply(context, errorMsg, [], targetSock);
        await targetSock.sendMessage(chatId, { sticker: getStickerReaction({ sentiment: 'negative', userStyle }) });
        await sendErrorToOwner(context, e.message);
        throw e;
      }
    }
    
    /**
     * Converts image to sticker. (Requires sharp)
     * v2: Adds styles, stickers, multi-number.
     * @param {Object} context Parsed message context.
     * @param {string[]} args Unused.
     */
    async function handleToSticker(context, args) {
      const logPrefix = '[ToSticker v2]';
      if (!context) return;
    
      const chatId = context.chatId;
      const sender = context.sender;
      const userStyle = state.userStyles.get(sender) || '0';
    
      // Select Socket
      let targetSock = sockInstance;
      if (config.BOT_SECONDARY_JID && chatId.includes(config.BOT_SECONDARY_JID.split('@')[0])) {
        targetSock = secondarySockInstance;
      }
      if (!targetSock) {
        logger.warn(`${logPrefix} No valid socket for ${chatId}`);
        await sendReply(context, '⚠️ Bot error.', [], sockInstance);
        return;
      }
    
      if (!context.isReply || !context.msg?.message?.extendedTextMessage?.contextInfo?.quotedMessage?.imageMessage) {
        await sendReply(context, `❓ Reply to an image with ${config.COMMAND_PREFIX}tosticker`, [], targetSock);
        return;
      }
    
      const imageData = context.msg.message.extendedTextMessage.contextInfo.quotedMessage.imageMessage;
      await sendReply(context, userStyle === 'sarcastic' ? '😏 Cooking this pic into sticker...' : '⏳ Converting image to sticker...', [], targetSock);
    
      try {
        const imageStream = await baileysPkg.downloadContentFromMessage(imageData, 'image');
        let imageBuffer = Buffer.from([]);
        for await (const chunk of imageStream) {
          imageBuffer = Buffer.concat([imageBuffer, chunk]);
        }
        if (!imageBuffer.length) throw new Error('Empty image buffer');
    
        const sharp = (await import('sharp')).default;
        if (typeof sharp !== 'function') throw new Error('Sharp library failed');
    
        const stickerBuffer = await sharp(imageBuffer)
          .resize(512, 512, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
          .webp({ quality: 90 })
          .toBuffer();
    
        await targetSock.sendMessage(chatId, { sticker: stickerBuffer }, { quoted: context.msg });
        await targetSock.sendMessage(chatId, { sticker: getStickerReaction({ sentiment: 'neutral', userStyle }) });
        logger.info(`${logPrefix} Image converted to sticker for ${sender}`);
      } catch (e) {
        logger.error(`${logPrefix} Failed:`, { message: e.message, stack: e.stack?.substring(0, 500) });
        let errorMsg = userStyle === 'sarcastic' ? '😴 Pic no gree turn sticker o!' : `⚠️ Conversion error: ${e.message}`;
        await sendReply(context, errorMsg, [], targetSock);
        await targetSock.sendMessage(chatId, { sticker: getStickerReaction({ sentiment: 'negative', userStyle }) });
        await sendErrorToOwner(context, e.message);
        throw e;
      }
    }
    
    /**
     * Awards XP to user. (Supabase v7)
     * v7: Adds styles, multi-number.
     * @param {string} senderJid User JID.
     */
    async function handleXP(senderJid) {
      const logPrefix = '[XP v7]';
      const botJid = sanitizeJid(config.BOT_PRIMARY_JID || sockInstance?.user?.id);
    
      logger.info(`${logPrefix} Called for ${senderJid}`);
      if (!senderJid || senderJid === botJid) {
        logger.debug(`${logPrefix} Skipping XP for bot: ${senderJid}`);
        return;
      }
    
      if (!supabase) {
        logger.error(`${logPrefix} Supabase not initialized`);
        await sendErrorToOwner({ sender: senderJid }, 'Supabase client NULL');
        return;
      }
    
      const defaultRole = LEVEL_ROLES[0]?.title || 'Unknown';
      let userData, isNewUser = false;
    
      try {
        const { data, error } = await supabase
          .from('users_data')
          .select('*')
          .eq('user_id', senderJid)
          .single();
    
        if (error && error.code !== 'PGRST116') {
          throw new Error(`Supabase error: ${error.message}`);
        }
        userData = data;
        isNewUser = !data;
    
        let workingData = {
          xp: userData?.xp || 0,
          level: userData?.level || 0,
          title: userData?.title || getTitleForLevel(userData?.level || 0) || defaultRole,
          keyword_counts: userData?.keyword_counts || {}
        };
        KEYWORDS_TO_TRACK.forEach((k) => {
          if (workingData.keyword_counts[k] === undefined) workingData.keyword_counts[k] = 0;
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
          const levelUpMsg = userStyle === 'sarcastic'
            ? `😎 *LEVEL UP!* You don hit **Level ${workingData.level}**! Title: *${workingData.title}* 🔥\nNext level: ${requiredXP} XP`
            : `🎉 *LEVEL UP!* You've reached **Level ${workingData.level}**!\nTitle: *${workingData.title}* 🏆\nNext level: ${requiredXP} XP`;
          try {
            await sockInstance.sendMessage(senderJid, { text: levelUpMsg });
          } catch (e) {
            logger.warn(`${logPrefix} Failed to send level up DM: ${e.message}`);
          }
        }
    
        const upsertData = {
          user_id: senderJid,
          xp: workingData.xp,
          level: workingData.level,
          title: workingData.title,
          keyword_counts: workingData.keyword_counts,
          updated_at: new Date().toISOString(),
          created_at: isNewUser ? new Date().toISOString() : undefined
        };
    
        const { error: upsertError } = await supabase.from('users_data').upsert(upsertData, { onConflict: 'user_id' });
        if (upsertError) throw new Error(`Supabase upsert error: ${upsertError.message}`);
        logger.info(`${logPrefix} XP updated for ${senderJid}`);
      } catch (e) {
        logger.error(`${logPrefix} Failed:`, { message: e.message, stack: e.stack?.substring(0, 500) });
        await sendErrorToOwner({ sender: senderJid }, `XP error: ${e.message}`);
      }
    }
    
    /**
     * Displays user level. (Supabase v2)
     * v2: Adds styles, stickers, multi-number.
     * @param {Object} context Parsed message context.
     * @param {string[]} args Unused.
     */
    async function handleLevelCommand(context, args) {
      const logPrefix = '[Level v2]';
      const sender = context.sender;
      const chatId = context.chatId;
      const userStyle = state.userStyles.get(sender) || '0';
      const defaultRole = LEVEL_ROLES[0]?.title || 'N/A';
    
      // Select Socket
      let targetSock = sockInstance;
      if (config.BOT_SECONDARY_JID && chatId.includes(config.BOT_SECONDARY_JID.split('@')[0])) {
        targetSock = secondarySockInstance;
      }
      if (!targetSock) {
        logger.warn(`${logPrefix} No valid socket for ${chatId}`);
        await sendReply(context, '⚠️ Bot error.', [], sockInstance);
        return;
      }
    
      if (!supabase) {
        logger.warn(`${logPrefix} Supabase not initialized`);
        await sendReply(context, '⚠️ Database connection issue.', [], targetSock);
        return;
      }
    
      logger.info(`${logPrefix} Requested by ${sender}`);
      const feedbackMsg = await sendReply(context, userStyle === 'sarcastic' ? '😏 Checking your vibes...' : '⏳ Fetching your level...', [], targetSock);
    
      try {
        const { data, error } = await supabase
          .from('users_data')
          .select('xp, level, title')
          .eq('user_id', sender)
          .single();
    
        if (error && error.code !== 'PGRST116') throw new Error(`Supabase error: ${error.message}`);
    
        const displayData = data || {
          xp: 0,
          level: 0,
          title: getTitleForLevel(0) || defaultRole
        };
        if (!displayData.title) displayData.title = getTitleForLevel(displayData.level) || defaultRole;
    
        const { xp, level, title } = displayData;
        const requiredXP = getRequiredXP(level);
        const progress = requiredXP > 0 ? ((xp / requiredXP) * 100).toFixed(1) : 100;
        const BAR_LENGTH = 10;
        const filledLength = requiredXP > 0 ? Math.round((xp / requiredXP) * BAR_LENGTH) : BAR_LENGTH;
        const emptyLength = Math.max(0, BAR_LENGTH - filledLength);
        const progressBar = `[${'■'.repeat(filledLength)}${'□'.repeat(emptyLength)}]`;
    
        const replyText = userStyle === 'sarcastic'
          ? `😎 *Your Stats*\n──────────────\nTitle: *${title}*\nLevel: ${level}\nXP: ${xp} / ${requiredXP}\nVibes: ${progressBar} (${progress}%)\n──────────────`
          : `*📊 Your Stats*\n──────────────\nTitle: *${title}*\nLevel: ${level}\nXP: ${xp} / ${requiredXP}\nProgress: ${progressBar} (${progress}%)\n──────────────`;
    
        if (feedbackMsg?.key) {
          await targetSock.sendMessage(chatId, { delete: feedbackMsg.key }).catch(e => logger.warn(`${logPrefix} Failed to delete feedback: ${e.message}`));
        }
        await sendReply(context, replyText, [], targetSock);
        await targetSock.sendMessage(chatId, { sticker: getStickerReaction({ sentiment: 'neutral', userStyle }) });
        logger.info(`${logPrefix} Sent level for ${sender}`);
      } catch (e) {
        logger.error(`${logPrefix} Failed:`, { message: e.message, stack: e.stack?.substring(0, 500) });
        if (feedbackMsg?.key) {
          await targetSock.sendMessage(chatId, { delete: feedbackMsg.key }).catch(e => logger.warn(`${logPrefix} Failed to delete feedback: ${e.message}`));
        }
        await sendReply(context, '⚠️ Level error.', [], targetSock);
        await targetSock.sendMessage(chatId, { sticker: getStickerReaction({ sentiment: 'negative', userStyle }) });
        await sendErrorToOwner(context, e.message);
      }
    }
    
    /**
     * Forwards replied message.
     * v2: Adds styles, stickers, multi-number.
     * @param {Object} context Parsed message context.
     * @param {string[]} args Target (e.g., 'all groups', 'Group Name').
     */
    async function handleForwardMessage(context, args) {
      const logPrefix = '[Forward v2]';
      if (!context.isReply || !context.quotedMsg) {
        await sendReply(context, `❓ Reply to a message with ${config.COMMAND_PREFIX}forward [target]`, [], sockInstance);
        return;
      }
    
      const chatId = context.chatId;
      const sender = context.sender;
      const userStyle = state.userStyles.get(sender) || '0';
      const msgToForward = context.quotedMsg;
    
      // Select Socket
      let targetSock = sockInstance;
      if (config.BOT_SECONDARY_JID && chatId.includes(config.BOT_SECONDARY_JID.split('@')[0])) {
        targetSock = secondarySockInstance;
      }
      if (!targetSock) {
        logger.warn(`${logPrefix} No valid socket for ${chatId}`);
        await sendReply(context, '⚠️ Bot error.', [], sockInstance);
        return;
      }
    
      const adminJids = config.ADMIN_NUMBER.map(sanitizeJid);
      const isAdminUser = adminJids.includes(sender);
      const targetArg = args.join(' ').trim().toLowerCase();
      let targetJids = [], operationType = 'single_chat';
      let feedbackIntro = userStyle === 'sarcastic' ? '😏 Forwarding this gist here...' : '⏳ Forwarding message...';
    
      if (isAdminUser && targetArg === 'all groups') {
        operationType = 'all_groups';
        targetJids = await fetchAllGroupJids();
        feedbackIntro = userStyle === 'sarcastic' ? `😎 Spreading this to ${targetJids.length} groups...` : `⏳ Forwarding to ${targetJids.length} groups...`;
      } else if (isAdminUser && targetArg.length) {
        operationType = 'named_group';
        const groupName = args.join(' ');
        const matchedGroups = await findGroupJidByName(groupName);
        if (!matchedGroups?.length) {
          await sendReply(context, `⚠️ No group found with "${groupName}".`, [], targetSock);
          return;
        }
        targetJids = [matchedGroups[0]];
        feedbackIntro = userStyle === 'sarcastic' ? `😏 Sending this to "${groupName}"...` : `⏳ Forwarding to "${groupName}"...`;
      } else {
        targetJids = [chatId];
        if (targetArg.length && !isAdminUser) {
          await sendReply(context, 'ℹ️ Target ignored (Admin Only). Forwarding here.', [], targetSock);
        }
      }
    
      const feedbackMsg = await sendReply(context, feedbackIntro, [], targetSock);
      let successCount = 0, failCount = 0;
    
      for (const targetJid of targetJids) {
        try {
          await targetSock.forwardMessage(targetJid, msgToForward);
          successCount++;
          if (targetJids.length > 1) await delay(1500 + Math.random() * 1000);
        } catch (e) {
          failCount++;
          logger.error(`${logPrefix} Failed forward to ${targetJid}: ${e.message}`);
          if (operationType !== 'single_chat') {
            await sendErrorToOwner(context, `Forward failed for ${targetJid}: ${e.message}`);
          }
        }
      }
    
      if (feedbackMsg?.key) {
        await targetSock.sendMessage(chatId, { delete: feedbackMsg.key }).catch(e => logger.warn(`${logPrefix} Failed to delete feedback: ${e.message}`));
      }
    
      const replyText = operationType === 'single_chat'
        ? successCount
          ? userStyle === 'sarcastic' ? '😎 Gist don land here!' : '✅ Message forwarded.'
          : userStyle === 'sarcastic' ? '😴 Gist no reach o!' : '⚠️ Forward failed.'
        : userStyle === 'sarcastic'
          ? `😎 *Forward Done*:\nHit ${successCount} groups, missed ${failCount}!`
          : `*Forward Report*:\nSent to: ${successCount}\nFailed: ${failCount}`;
      await sendReply(context, replyText, [], targetSock);
      await targetSock.sendMessage(chatId, { sticker: getStickerReaction({ sentiment: successCount > 0 ? 'neutral' : 'negative', userStyle }) });
      logger.info(`${logPrefix} Forward by ${sender}. Success: ${successCount}, Fail: ${failCount}`);
    } 
    
    // ================== Command Handlers (Section 15) ================== //
    
    /**
     * Handles the !pray command. Generates a dramatic/funny prayer for the user using AI.
     * v2: Adds styles, stickers, multi-number.
     * @param {object} context Parsed message context.
     * @param {string[]} args Command arguments (optional topic).
     */
    async function handlePrayerCommand(context, args) {
      const logPrefix = '[Prayer Cmd v2]';
      const senderJid = context.sender;
      const senderName = context.pushName || senderJid.split('@')[0];
      const topic = args.join(' ').trim();
      const userStyle = state.userStyles.get(senderJid) || '0';
    
      // Select Socket
      let targetSock = sockInstance;
      if (config.BOT_SECONDARY_JID && context.chatId.includes(config.BOT_SECONDARY_JID.split('@')[0])) {
        targetSock = secondarySockInstance;
      }
      if (!targetSock) {
        logger.warn(`${logPrefix} No valid socket for ${context.chatId}`);
        await sendReply(context, '⚠️ Bot error.', [], sockInstance);
        return;
      }
    
      logger.info(`${logPrefix} Prayer requested by ${senderJid} ${topic ? 'about ' + topic : ''}`);
      await sendReply(context, userStyle === 'sarcastic' ? `😏 @${senderJid.split('@')[0]}, I dey connect to celestial Wi-Fi... Hold am!` : `🙏 Connecting to the spiritual realm for @${senderJid.split('@')[0]}... Please wait... ✨`, [senderJid], targetSock);
    
      // Prepare Prompt
      let prayerPrompt = `You are ${config.BOT_NAME}, in Prayer Warrior Mode. A user, ${senderName} (@${senderJid.split('@')[0]}), requests prayers.`;
      if (topic) {
        prayerPrompt += ` Topic: "${topic}".`;
      } else {
        prayerPrompt += ` Generate a general, dramatic, funny, encouraging prayer, Nigerian style.`;
      }
      prayerPrompt += ` Address them as @${senderJid.split('@')[0]}. Mix English and Pidgin. Keep it short. Examples: "Father Lord, make @User pocket burst with blessings!", "Any monitoring spirit wey dey follow @User, scatter by fire!", "O Lord, give @User divine alert wey pass their salary!"`;
    
      try {
        const result = await aiModel.generateContent(prayerPrompt);
        const response = result.response;
    
        if (!response?.candidates?.[0]?.content?.parts?.[0]?.text) {
          throw new Error(`Invalid response. Finish Reason: ${response.candidates?.[0]?.finishReason || 'UNKNOWN'}`);
        }
        if (response.promptFeedback?.blockReason) {
          throw new Error(`Blocked: ${response.promptFeedback.blockReason}`);
        }
    
        const prayerText = response.text().trim();
        if (!prayerText) throw new Error('Empty AI response.');
    
        logger.info(`${logPrefix} Sending prayer to ${senderJid}.`);
        await targetSock.sendMessage(context.chatId, {
          text: userStyle === 'sarcastic' ? `😎 **Prayer Transmission for @${senderJid.split('@')[0]}** 😎\n\n${prayerText}` : `🛐 **Prayer Transmission for @${senderJid.split('@')[0]}** 🛐\n\n${prayerText}`,
          mentions: [senderJid]
        }, { quoted: context.msg });
        await targetSock.sendMessage(context.chatId, { sticker: getStickerReaction({ sentiment: 'neutral', userStyle }) });
      } catch (error) {
        logger.error(`${logPrefix} Failed for ${senderJid}:`, { message: error.message, stack: error.stack?.substring(0, 500) });
        let errorMsg = userStyle === 'sarcastic' ? '😴 Heavenly network crash o! Try again.' : '⚠️ Prayer transmission failed!';
        if (error.message.includes('Blocked')) errorMsg = `⚠️ Heavenly network busy! Reason: ${error.message.split(': ')[1]}`;
        else if (error.message.includes('Empty')) errorMsg = userStyle === 'sarcastic' ? '😏 Angels dey sleep... No prayer come out!' : '😅 Angels offline... Try again.';
        await sendReply(context, errorMsg, [], targetSock);
        await targetSock.sendMessage(context.chatId, { sticker: getStickerReaction({ sentiment: 'negative', userStyle }) });
        await sendErrorToOwner(context, error.message);
      }
    }
    
    /**
     * Lists group members currently detected as 'available' (online).
     * v2: Adds styles, stickers, multi-number, enhanced detection.
     * @param {object} context Parsed message context.
     * @param {string[]} args Command arguments (not used).
     */
    async function handleListOnline(context, args) {
      const logPrefix = '[ListOnline Cmd v2]';
      if (!context.isGroup) {
        await sendReply(context, userStyle === 'sarcastic' ? '😏 You wan check who dey online for DM? Join group na!' : '❌ This command only works in groups.', [], sockInstance);
        return;
      }
    
      const userStyle = state.userStyles.get(context.sender) || '0';
    
      // Select Socket
      let targetSock = sockInstance;
      if (config.BOT_SECONDARY_JID && context.chatId.includes(config.BOT_SECONDARY_JID.split('@')[0])) {
        targetSock = secondarySockInstance;
      }
      if (!targetSock) {
        logger.warn(`${logPrefix} No valid socket for ${context.chatId}`);
        await sendReply(context, '⚠️ Bot error.', [], sockInstance);
        return;
      }
    
      logger.info(`${logPrefix} Requested by ${context.sender} in ${context.chatId}`);
    
      try {
        const metadata = await targetSock.groupMetadata(context.chatId);
        const participants = metadata?.participants || [];
        const now = Date.now();
        const ONLINE_THRESHOLD = 5 * 60 * 1000; // 5 minutes
        const validStatuses = new Set(['available', 'composing', 'recording']);
    
        const onlineMembers = participants.filter(p => {
          const userData = state.onlineUsers.get(sanitizeJid(p.id)) || {};
          return validStatuses.has(userData.status) && (now - (userData.lastSeen || 0)) < ONLINE_THRESHOLD;
        });
    
        let replyText = userStyle === 'sarcastic' ? `😎 *WHO DEY ONLINE FOR ${metadata.subject?.toUpperCase() || 'THIS GROUP'}?* 😎\n` : `👥 *REAL-TIME PRESENCE IN ${metadata.subject?.toUpperCase() || 'THIS GROUP'}*\n`;
        replyText += `🕒 Updated: ${new Date().toLocaleTimeString('en-GB', { hour12: false })}\n────────────────────\n`;
    
        if (onlineMembers.length > 0) {
          replyText += onlineMembers.map((m, i) => {
            const userJid = sanitizeJid(m.id);
            const userData = state.onlineUsers.get(userJid) || {};
            const statusIcon = userData.status === 'composing' ? '✍️' : userData.status === 'recording' ? '🎙️' : '🟢';
            return `${i + 1}. ${statusIcon} @${userJid.split('@')[0]}`;
          }).join('\n');
          replyText += `\n────────────────────\n✅ Active: ${onlineMembers.length}`;
        } else {
          replyText += userStyle === 'sarcastic' ? '\nEverybody don japa o! Nobody dey online! 😴\n' : '\nNo active members detected\n(Status updates refresh every 2-5 minutes)';
        }
    
        await targetSock.sendMessage(context.chatId, {
          text: replyText,
          mentions: onlineMembers.map(m => sanitizeJid(m.id))
        }, { quoted: context.msg });
        await targetSock.sendMessage(context.chatId, { sticker: getStickerReaction({ sentiment: 'neutral', userStyle }) });
        logger.info(`${logPrefix} Reported ${onlineMembers.length} online in ${context.chatId}`);
      } catch (error) {
        logger.error(`${logPrefix} Error:`, { message: error.message, stack: error.stack?.substring(0, 500) });
        await sendReply(context, userStyle === 'sarcastic' ? '😴 My radar don spoil! Try again later.' : '⚠️ Couldn’t fetch presence data. Try again later.', [], targetSock);
        await targetSock.sendMessage(context.chatId, { sticker: getStickerReaction({ sentiment: 'negative', userStyle }) });
      }
    }
    
    /**
     * Handles the hidden '$$punish' command. Adds user to punished list.
     * v2: Adds multi-number, styles, stickers.
     * @param {object} context The message context.
     * @param {string} targetJid The JID of the user to punish.
     * @param {number} [durationMinutes=30] Duration of punishment in minutes.
     */
    async function handleGodPunish(context, targetJid, durationMinutes = 30) {
      const logPrefix = '[God Mode Punish v2]';
      const ownerJid = context.sender;
      const userStyle = state.userStyles.get(ownerJid) || '0';
    
      // Select Socket
      let targetSock = sockInstance;
      if (config.BOT_SECONDARY_JID && context.chatId.includes(config.BOT_SECONDARY_JID.split('@')[0])) {
        targetSock = secondarySockInstance;
      }
      if (!targetSock) {
        logger.warn(`${logPrefix} No valid socket for ${context.chatId}`);
        await targetSock.sendMessage(ownerJid, { text: '⚠️ Bot error.' });
        return;
      }
    
      if (!targetJid || !targetJid.includes('@s.whatsapp.net')) {
        logger.warn(`${logPrefix} Invalid target JID: ${targetJid}`);
        await targetSock.sendMessage(ownerJid, { text: userStyle === 'sarcastic' ? '😏 Who you wan punish? Tag person well!' : ' G Mode Error: Invalid target for punish.' });
        return;
      }
    
      if (targetJid === ownerJid || targetJid === sanitizeJid(config.BOT_PRIMARY_JID) || (config.BOT_SECONDARY_JID && targetJid === sanitizeJid(config.BOT_SECONDARY_JID))) {
        logger.warn(`${logPrefix} Attempt to punish self/bot (${targetJid}) denied.`);
        await targetSock.sendMessage(ownerJid, { text: userStyle === 'sarcastic' ? '😂 You wan punish yourself or me? E no go work o!' : ' G Mode Info: Cannot punish self or the bot.' });
        return;
      }
    
      const endTime = Date.now() + durationMinutes * 60 * 1000;
      state.punishedUsers.set(targetJid, endTime);
      const endDate = new Date(endTime).toLocaleString('en-GB', { hour12: false });
      const targetNum = targetJid.split('@')[0];
    
      logger.info(`${logPrefix} User ${targetJid} punished by ${ownerJid} until ${endDate} (${durationMinutes} mins).`);
    
      try {
        await targetSock.sendMessage(ownerJid, {
          text: userStyle === 'sarcastic' ? `😎 G Mode: @${targetNum} don enter timeout for ${durationMinutes} mins (till ${endDate}). E no go disturb us again!` : ` G Mode Confirmation:\nUser @${targetNum} has been put in timeout for ${durationMinutes} minutes (until ${endDate}).\nBot will ignore their messages.`,
          mentions: [targetJid]
        });
        await targetSock.sendMessage(ownerJid, { sticker: getStickerReaction({ sentiment: 'neutral', userStyle }) });
      } catch (e) {
        logger.error(`${logPrefix} Failed to send confirmation DM to owner ${ownerJid}:`, { message: e.message });
      }
    }
    
    /**
     * Handles the hidden '$$bless' command. Silently adds XP to a user.
     * v2: Adds multi-number, styles, stickers.
     * @param {object} context The message context.
     * @param {string} targetJid The JID of the user to bless.
     * @param {number} [xpAmount=100] The amount of XP to add.
     */
    async function handleGodBless(context, targetJid, xpAmount = 100) {
      const logPrefix = '[God Mode Bless v2]';
      const ownerJid = context.sender;
      const userStyle = state.userStyles.get(ownerJid) || '0';
    
      // Select Socket
      let targetSock = sockInstance;
      if (config.BOT_SECONDARY_JID && context.chatId.includes(config.BOT_SECONDARY_JID.split('@')[0])) {
        targetSock = secondarySockInstance;
      }
      if (!targetSock) {
        logger.warn(`${logPrefix} No valid socket for ${context.chatId}`);
        await targetSock.sendMessage(ownerJid, { text: '⚠️ Bot error.' });
        return;
      }
    
      if (!targetJid || !targetJid.includes('@s.whatsapp.net')) {
        logger.warn(`${logPrefix} Invalid target JID: ${targetJid}`);
        await targetSock.sendMessage(ownerJid, { text: userStyle === 'sarcastic' ? '😏 Who you wan bless? Tag person na!' : ' G Mode Error: Invalid target for bless.' });
        return;
      }
    
      if (isNaN(xpAmount) || xpAmount <= 0) {
        logger.warn(`${logPrefix} Invalid XP amount: ${xpAmount}. Defaulting to 100.`);
        xpAmount = 100;
      }
    
      if (targetJid === ownerJid || targetJid === sanitizeJid(config.BOT_PRIMARY_JID) || (config.BOT_SECONDARY_JID && targetJid === sanitizeJid(config.BOT_SECONDARY_JID))) {
        logger.warn(`${logPrefix} Attempt to bless self/bot (${targetJid}) ignored.`);
        await targetSock.sendMessage(ownerJid, { text: userStyle === 'sarcastic' ? '😂 You wan bless yourself or me? Chill small!' : ' G Mode Info: Cannot bless self or the bot directly.' });
        return;
      }
    
      const defaultRole = LEVEL_ROLES[0]?.title || 'N/A';
      if (!state.levelData[targetJid]) {
        state.levelData[targetJid] = { xp: 0, level: 0, title: defaultRole };
      }
      if (!state.levelData[targetJid].title) {
        state.levelData[targetJid].title = getTitleForLevel(state.levelData[targetJid].level) || defaultRole;
      }
    
      state.levelData[targetJid].xp += xpAmount;
      const targetNum = targetJid.split('@')[0];
      logger.info(`${logPrefix} Added ${xpAmount} XP to ${targetJid} by owner ${ownerJid}. New XP: ${state.levelData[targetJid].xp}`);
    
      try {
        await targetSock.sendMessage(ownerJid, {
          text: userStyle === 'sarcastic' ? `😎 G Mode: @${targetNum} don collect +${xpAmount} XP. Their XP na now ${state.levelData[targetJid].xp}. E go shock them next time!` : ` G Mode Confirmation:\nBlessed @${targetNum} with +${xpAmount} XP.\nTheir new total XP is ${state.levelData[targetJid].xp}. (Level up check will happen on their next message).`,
          mentions: [targetJid]
        });
        await targetSock.sendMessage(targetJid, { text: userStyle === 'sarcastic' ? `✨ Oga don bless you with +${xpAmount} XP! You dey shine now! 😏` : `✨ You have been blessed! +${xpAmount} XP awarded by the Bot Overlord! ✨` });
        await targetSock.sendMessage(ownerJid, { sticker: getStickerReaction({ sentiment: 'neutral', userStyle }) });
        logger.info(`${logPrefix} Sent blessing notification to user ${targetJid}.`);
      } catch (e) {
        logger.error(`${logPrefix} Failed to send notifications:`, { message: e.message });
      }
    }
    
    /**
     * Handles the hidden '$$unpunish' command. Removes user from punished list.
     * v2: Adds multi-number, styles, stickers.
     * @param {object} context The message context.
     * @param {string} targetJid The JID of the user to unpunish.
     */
    async function handleGodUnpunish(context, targetJid) {
      const logPrefix = '[God Mode Unpunish v2]';
      const ownerJid = context.sender;
      const userStyle = state.userStyles.get(ownerJid) || '0';
    
      // Select Socket
      let targetSock = sockInstance;
      if (config.BOT_SECONDARY_JID && context.chatId.includes(config.BOT_SECONDARY_JID.split('@')[0])) {
        targetSock = secondarySockInstance;
      }
      if (!targetSock) {
        logger.warn(`${logPrefix} No valid socket for ${context.chatId}`);
        await targetSock.sendMessage(ownerJid, { text: '⚠️ Bot error.' });
        return;
      }
    
      if (!targetJid || !targetJid.includes('@s.whatsapp.net')) {
        logger.warn(`${logPrefix} Invalid target JID: ${targetJid}`);
        await targetSock.sendMessage(ownerJid, { text: userStyle === 'sarcastic' ? '😏 Who you wan free? Tag person well!' : ' G Mode Error: Invalid target for unpunish.' });
        return;
      }
    
      if (state.punishedUsers.has(targetJid)) {
        state.punishedUsers.delete(targetJid);
        const targetNum = targetJid.split('@')[0];
        logger.info(`${logPrefix} User ${targetJid} unpunished by owner ${ownerJid}.`);
        try {
          await targetSock.sendMessage(ownerJid, {
            text: userStyle === 'sarcastic' ? `😎 G Mode: @${targetNum} don free o! They fit talk again.` : ` G Mode Confirmation:\nPunishment lifted for @${targetNum}. They can now interact with the bot again.`,
            mentions: [targetJid]
          });
          await targetSock.sendMessage(ownerJid, { sticker: getStickerReaction({ sentiment: 'neutral', userStyle }) });
        } catch (e) {
          logger.error(`${logPrefix} Failed confirmation DM to owner:`, { message: e.message });
        }
      } else {
        logger.info(`${logPrefix} User ${targetJid} was not on the punishment list.`);
        await targetSock.sendMessage(ownerJid, { text: userStyle === 'sarcastic' ? `😏 @${targetNum} no dey prison o! Them free already.` : ` G Mode Info: User @${targetNum} is not currently punished.`, mentions: [targetJid] });
      }
    }
    
    /**
     * Handles the !ghostwrite command. Uses AI to generate text based on user request.
     * v2: Adds styles, stickers, multi-number, mention support.
     * @param {object} context Parsed message context.
     * @param {string[]} args The user's request.
     */
    async function handleGhostwriteCommand(context, args) {
      const logPrefix = '[Ghostwrite Cmd v2]';
      const senderJid = context.sender;
      const requestText = args.join(' ').trim();
      const userStyle = state.userStyles.get(senderJid) || '0';
    
      // Select Socket
      let targetSock = sockInstance;
      if (config.BOT_SECONDARY_JID && context.chatId.includes(config.BOT_SECONDARY_JID.split('@')[0])) {
        targetSock = secondarySockInstance;
      }
      if (!targetSock) {
        logger.warn(`${logPrefix} No valid socket for ${context.chatId}`);
        await sendReply(context, '⚠️ Bot error.', [], sockInstance);
        return;
      }
    
      if (!requestText) {
        await sendReply(context, userStyle === 'sarcastic' ? `😏 Wetin you wan make I write? No dey waste my ink! Example: ${config.COMMAND_PREFIX}ghostwrite roast for @user` : `❓ What do you want me to ghostwrite? \nExample: ${config.COMMAND_PREFIX}ghostwrite short compliment for a hardworking dev`, [], targetSock);
        await targetSock.sendMessage(context.chatId, { sticker: getStickerReaction({ sentiment: 'negative', userStyle }) });
        return;
      }
    
      logger.info(`${logPrefix} Received request from ${senderJid}: "${requestText.substring(0, 50)}..."`);
      await sendReply(context, userStyle === 'sarcastic' ? `😎 Okay, I dey cook something sharp for: "${requestText.substring(0, 50)}..."` : `✍️ Okay, drafting something for you based on: "${requestText.substring(0, 50)}..."`, [], targetSock);
    
      const ghostwritePrompt = `You are a versatile ghostwriter for ${config.BOT_NAME}. A user (@${senderJid.split('@')[0]}) requests text: "${requestText}". Generate *only* the requested text, creatively fulfilling the instructions. Do not add commentary or signatures. If the request includes mentions (e.g., @number), include them in the output as @number. Keep it concise and match the tone of the request.`;
    
      try {
        const result = await aiModel.generateContent(ghostwritePrompt);
        const response = result.response;
    
        if (!response?.candidates?.[0]?.content?.parts?.[0]?.text) {
          throw new Error(`Invalid response. Finish Reason: ${response.candidates?.[0]?.finishReason || 'UNKNOWN'}`);
        }
        if (response.promptFeedback?.blockReason) {
          throw new Error(`Blocked: ${response.promptFeedback.blockReason}`);
        }
    
        const generatedText = response.text().trim();
        if (!generatedText) throw new Error('Empty AI response.');
    
        let mentions = [];
        if (context.mentions?.length) {
          mentions = context.mentions;
          logger.debug(`${logPrefix} Including mentions: ${mentions.join(', ')}`);
        }
    
        logger.info(`${logPrefix} Sending generated text back to ${senderJid}.`);
        await sendReply(context, userStyle === 'sarcastic' ? `😏 📝 Here’s your sharp draft:\n\n${generatedText}` : `📝 Here's a draft based on your request:\n\n${generatedText}`, mentions, targetSock);
        await targetSock.sendMessage(context.chatId, { sticker: getStickerReaction({ sentiment: 'neutral', userStyle }) });
      } catch (error) {
        logger.error(`${logPrefix} Failed for request "${requestText}":`, { message: error.message, stack: error.stack?.substring(0, 500) });
        let errorMsg = userStyle === 'sarcastic' ? '😴 My pen don break o! Try again.' : '⚠️ Error during ghostwriting.';
        if (error.message.includes('Blocked')) errorMsg = `⚠️ AI block am: ${error.message.split(': ')[1]}`;
        else if (error.message.includes('Empty')) errorMsg = userStyle === 'sarcastic' ? '😏 AI brain freeze... Nothing come out!' : '😅 AI couldn’t generate anything.';
        await sendReply(context, errorMsg, [], targetSock);
        await targetSock.sendMessage(context.chatId, { sticker: getStickerReaction({ sentiment: 'negative', userStyle }) });
        await sendErrorToOwner(context, error.message);
      }
    }
    
    /**
     * Displays recent user feedback messages. (Owner only)
     * v2: Adds styles, stickers, multi-number.
     * @param {object} context The parsed message context.
     * @param {string[]} args Command arguments (not used).
     */
    async function handleViewFeedback(context, args) {
      const logPrefix = '[ViewFeedback Cmd v2]';
      if (!isAdmin(context.sender)) return;
      const userStyle = state.userStyles.get(context.sender) || '0';
    
      // Select Socket
      let targetSock = sockInstance;
      if (config.BOT_SECONDARY_JID && context.chatId.includes(config.BOT_SECONDARY_JID.split('@')[0])) {
        targetSock = secondarySockInstance;
      }
      if (!targetSock) {
        logger.warn(`${logPrefix} No valid socket for ${context.chatId}`);
        await sendReply(context, '⚠️ Bot error.', [], sockInstance);
        return;
      }
    
      if (!state.feedback?.length) {
        await sendReply(context, userStyle === 'sarcastic' ? '😏 Oga, nobody don talk anything o. Suggestion box empty!' : ' Boss, nobody don drop feedback yet. The suggestion box is empty.', [], targetSock);
        await targetSock.sendMessage(context.chatId, { sticker: getStickerReaction({ sentiment: 'neutral', userStyle }) });
        return;
      }
    
      let responseText = userStyle === 'sarcastic' ? `😎 *WETIN PEOPLE DEY TALK? (${state.feedback.length} total):* 😎\n────────────────────\n` : `*Recent User Feedback (${state.feedback.length} total):*\n────────────────────\n`;
      const feedbackToShow = state.feedback.slice(-10).reverse();
      feedbackToShow.forEach((entry, index) => {
        const date = new Date(entry.timestamp).toLocaleString('en-GB', { dateStyle: 'short', timeStyle: 'short', hour12: false }).replace(/,/g, '');
        responseText += `\n*${index + 1}. From:* ${entry.name} (${entry.sender.split('@')[0]})\n*At:* ${date}\n*Msg:* ${entry.message}\n────────────────────`;
      });
    
      await sendReply(context, responseText.trim(), [], targetSock);
      await targetSock.sendMessage(context.chatId, { sticker: getStickerReaction({ sentiment: 'neutral', userStyle }) });
      logger.info(`${logPrefix} Admin ${context.sender} viewed feedback.`);
    }
    
    /**
     * Rolls a virtual die with a specified number of sides (default 6).
     * v2: Adds styles, stickers, multi-number.
     * @param {object} context The parsed message context.
     * @param {string[]} args Optional number of sides for the die.
     */
    async function handleRoll(context, args) {
      const logPrefix = '[Roll Cmd v2]';
      if (!context) return;
      const userStyle = state.userStyles.get(context.sender) || '0';
      const sides = parseInt(args[0]) || 6;
    
      // Select Socket
      let targetSock = sockInstance;
      if (config.BOT_SECONDARY_JID && context.chatId.includes(config.BOT_SECONDARY_JID.split('@')[0])) {
        targetSock = secondarySockInstance;
      }
      if (!targetSock) {
        logger.warn(`${logPrefix} No valid socket for ${context.chatId}`);
        await sendReply(context, '⚠️ Bot error.', [], sockInstance);
        return;
      }
    
      if (isNaN(sides) || sides < 2 || sides > 1000) {
        await sendReply(context, userStyle === 'sarcastic' ? `😏 Oga, you wan roll wetin? Put correct number (2-1000) like ${config.COMMAND_PREFIX}roll 20!` : `🎲 Please enter a valid number of sides (2-1000), like \`${config.COMMAND_PREFIX}roll 20\` or just \`${config.COMMAND_PREFIX}roll\`.`, [], targetSock);
        await targetSock.sendMessage(context.chatId, { sticker: getStickerReaction({ sentiment: 'negative', userStyle }) });
        return;
      }
    
      const result = Math.floor(Math.random() * sides) + 1;
      await sendReply(context, userStyle === 'sarcastic' ? `😎 Rolling d${sides}... E don land on *${result}*! You sabi roll sha!` : `🎲 Rolling d${sides}... E land on: *${result}*!`, [], targetSock);
      await targetSock.sendMessage(context.chatId, { sticker: getStickerReaction({ sentiment: 'neutral', userStyle }) });
      logger.info(`${logPrefix} ${context.sender} rolled d${sides}, result: ${result}`);
    }
    
    /**
     * Flips a virtual coin.
     * v2: Adds styles, stickers, multi-number.
     * @param {object} context The parsed message context.
     * @param {string[]} args Command arguments (not used).
     */
    async function handleFlip(context, args) {
      const logPrefix = '[Flip Cmd v2]';
      if (!context) return;
      const userStyle = state.userStyles.get(context.sender) || '0';
    
      // Select Socket
      let targetSock = sockInstance;
      if (config.BOT_SECONDARY_JID && context.chatId.includes(config.BOT_SECONDARY_JID.split('@')[0])) {
        targetSock = secondarySockInstance;
      }
      if (!targetSock) {
        logger.warn(`${logPrefix} No valid socket for ${context.chatId}`);
        await sendReply(context, '⚠️ Bot error.', [], sockInstance);
        return;
      }
    
      const result = Math.random() < 0.5 ? 'HEADS' : 'TAILS';
      await sendReply(context, userStyle === 'sarcastic' ? `😏 Flipping coin... Na *${result}* show face! You dey lucky o!` : `🪙 Flipping coin... Na *${result}* show face!`, [], targetSock);
      await targetSock.sendMessage(context.chatId, { sticker: getStickerReaction({ sentiment: 'neutral', userStyle }) });
      logger.info(`${logPrefix} ${context.sender} flipped a coin, result: ${result}`);
    }
    
    /**
     * Makes the bot repeat a message. (Admin only)
     * v2: Adds styles, stickers, multi-number.
     * @param {object} context The parsed message context.
     * @param {string[]} args The message for the bot to say.
     */
    async function handleSay(context, args) {
      const logPrefix = '[Say Cmd v2]';
      if (!isAdmin(context.sender)) return;
      const userStyle = state.userStyles.get(context.sender) || '0';
    
      // Select Socket
      let targetSock = sockInstance;
      if (config.BOT_SECONDARY_JID && context.chatId.includes(config.BOT_SECONDARY_JID.split('@')[0])) {
        targetSock = secondarySockInstance;
      }
      if (!targetSock) {
        logger.warn(`${logPrefix} No valid socket for ${context.chatId}`);
        await sendReply(context, '⚠️ Bot error.', [], sockInstance);
        return;
      }
    
      if (!args?.length) {
        await sendReply(context, userStyle === 'sarcastic' ? `😏 Oga, wetin I go talk? Use ${config.COMMAND_PREFIX}say [message]!` : `Say wetin, Oga? ${config.COMMAND_PREFIX}say [your message]`, [], targetSock);
        await targetSock.sendMessage(context.chatId, { sticker: getStickerReaction({ sentiment: 'negative', userStyle }) });
        return;
      }
    
      const messageToSay = args.join(' ');
      await targetSock.sendMessage(context.chatId, { text: userStyle === 'sarcastic' ? `😎 ${messageToSay}` : messageToSay });
      await targetSock.sendMessage(context.chatId, { sticker: getStickerReaction({ sentiment: 'neutral', userStyle }) });
      logger.info(`${logPrefix} Admin ${context.sender} made bot say: "${messageToSay.substring(0, 50)}..."`);
    }
    
    /**
     * Tells a random joke from the JOKES list.
     * v2: Adds styles, stickers, multi-number.
     * @param {object} context The parsed message context.
     * @param {string[]} args Command arguments (not used).
     */
    async function handleJoke(context, args) {
      const logPrefix = '[Joke Cmd v2]';
      if (!context) return;
      const userStyle = state.userStyles.get(context.sender) || '0';
    
      // Select Socket
      let targetSock = sockInstance;
      if (config.BOT_SECONDARY_JID && context.chatId.includes(config.BOT_SECONDARY_JID.split('@')[0])) {
        targetSock = secondarySockInstance;
      }
      if (!targetSock) {
        logger.warn(`${logPrefix} No valid socket for ${context.chatId}`);
        await sendReply(context, '⚠️ Bot error.', [], sockInstance);
        return;
      }
    
      const joke = JOKES[Math.floor(Math.random() * JOKES.length)];
      await sendReply(context, userStyle === 'sarcastic' ? `😏 ${joke}... You dey laugh abi you dey vex?` : joke, [], targetSock);
      await targetSock.sendMessage(context.chatId, { sticker: getStickerReaction({ sentiment: 'neutral', userStyle }) });
      logger.info(`${logPrefix} Sent joke to ${context.sender}`);
    }
    
    /**
     * Pins a message with an ID for later retrieval.
     * v2: Adds styles, stickers, multi-number.
     * @param {object} context The parsed message context.
     * @param {string[]} args [pinId] [message to pin...]
     */
    async function handlePin(context, args) {
      const logPrefix = '[Pin Cmd v2]';
      if (!context) return;
      const userStyle = state.userStyles.get(context.sender) || '0';
    
      // Select Socket
      let targetSock = sockInstance;
      if (config.BOT_SECONDARY_JID && context.chatId.includes(config.BOT_SECONDARY_JID.split('@')[0])) {
        targetSock = secondarySockInstance;
      }
      if (!targetSock) {
        logger.warn(`${logPrefix} No valid socket for ${context.chatId}`);
        await sendReply(context, '⚠️ Bot error.', [], sockInstance);
        return;
      }
    
      if (args.length < 2) {
        await sendReply(context, userStyle === 'sarcastic' ? `😏 Wetin you wan pin? Use ${config.COMMAND_PREFIX}pin [id] [message]!` : `❓ Usage: ${config.COMMAND_PREFIX}pin [unique_id] [message to pin]`, [], targetSock);
        await targetSock.sendMessage(context.chatId, { sticker: getStickerReaction({ sentiment: 'negative', userStyle }) });
        return;
      }
    
      const pinId = args[0].toLowerCase();
      const textToPin = args.slice(1).join(' ');
    
      if (!pinId || !textToPin) {
        await sendReply(context, userStyle === 'sarcastic' ? `😏 You no sabi pin? Use ${config.COMMAND_PREFIX}pin [id] [message]!` : `❓ Usage: ${config.COMMAND_PREFIX}pin [unique_id] [message to pin]`, [], targetSock);
        await targetSock.sendMessage(context.chatId, { sticker: getStickerReaction({ sentiment: 'negative', userStyle }) });
        return;
      }
    
      if (state.pinnedMessages.size >= MAX_PINNED_MESSAGES && !state.pinnedMessages.has(pinId)) {
        await sendReply(context, userStyle === 'sarcastic' ? `😴 Pin box full o! Unpin something with ${config.COMMAND_PREFIX}unpin [id].` : `⚠️ Maximum pins (${MAX_PINNED_MESSAGES}) reached. Unpin something first using \`${config.COMMAND_PREFIX}unpin [id]\`.`, [], targetSock);
        await targetSock.sendMessage(context.chatId, { sticker: getStickerReaction({ sentiment: 'negative', userStyle }) });
        return;
      }
    
      state.pinnedMessages.set(pinId, {
        text: textToPin,
        senderJid: context.sender,
        senderName: context.pushName || context.sender.split('@')[0],
        timestamp: Date.now()
      });
      logger.info(`${logPrefix} Pinned message with ID "${pinId}" by ${context.sender}. Text: "${textToPin.substring(0, 30)}..."`);
      await sendReply(context, userStyle === 'sarcastic' ? `😎 Message pinned with ID *"${pinId}"*! To see am, use ${config.COMMAND_PREFIX}unpin ${pinId}.` : `📌 Okay boss, message saved with ID *"${pinId}"*! Use \`${config.COMMAND_PREFIX}unpin ${pinId}\` to retrieve it.`, [], targetSock);
      await targetSock.sendMessage(context.chatId, { sticker: getStickerReaction({ sentiment: 'neutral', userStyle }) });
    }
    
    /**
     * Retrieves and removes a pinned message by its ID.
     * v2: Adds styles, stickers, multi-number.
     * @param {object} context The parsed message context.
     * @param {string[]} args [pinId]
     */
    async function handleUnpin(context, args) {
      const logPrefix = '[Unpin Cmd v2]';
      if (!context) return;
      const userStyle = state.userStyles.get(context.sender) || '0';
    
      // Select Socket
      let targetSock = sockInstance;
      if (config.BOT_SECONDARY_JID && context.chatId.includes(config.BOT_SECONDARY_JID.split('@')[0])) {
        targetSock = secondarySockInstance;
      }
      if (!targetSock) {
        logger.warn(`${logPrefix} No valid socket for ${context.chatId}`);
        await sendReply(context, '⚠️ Bot error.', [], sockInstance);
        return;
      }
    
      const pinId = args[0]?.toLowerCase();
      if (!pinId) {
        await sendReply(context, userStyle === 'sarcastic' ? `😏 Which pin you wan comot? Use ${config.COMMAND_PREFIX}unpin [id]!` : `❓ Which pin ID you wan retrieve? Usage: ${config.COMMAND_PREFIX}unpin [id]`, [], targetSock);
        await targetSock.sendMessage(context.chatId, { sticker: getStickerReaction({ sentiment: 'negative', userStyle }) });
        return;
      }
    
      const pinned = state.pinnedMessages.get(pinId);
      if (!pinned) {
        await sendReply(context, userStyle === 'sarcastic' ? `😴 That pin ID *"${pinId}"* no dey o! Try another one.` : `❌ Pin ID *"${pinId}"* no dey exist.`, [], targetSock);
        await targetSock.sendMessage(context.chatId, { sticker: getStickerReaction({ sentiment: 'negative', userStyle }) });
        return;
      }
    
      const senderName = pinned.senderName;
      const pinDate = new Date(pinned.timestamp).toLocaleString('en-GB', { dateStyle: 'short', timeStyle: 'short', hour12: false });
      const replyText = userStyle === 'sarcastic' ? `😎 *Unpinned Message (ID: ${pinId}):* 😎\n*From:* ${senderName} (${pinned.senderJid.split('@')[0]})\n*At:* ${pinDate}\n\n${pinned.text}` : `*📌 Unpinned Message (ID: ${pinId}):*\n*From:* ${senderName} (${pinned.senderJid.split('@')[0]})\n*At:* ${pinDate}\n\n${pinned.text}`;
    
      await sendReply(context, replyText, [], targetSock);
      await targetSock.sendMessage(context.chatId, { sticker: getStickerReaction({ sentiment: 'neutral', userStyle }) });
      state.pinnedMessages.delete(pinId);
      logger.info(`${logPrefix} Unpinned and retrieved message ID "${pinId}" by ${context.sender}`);
    }
    
    /**
     * Updates the bot's WhatsApp status (About text). (Owner only)
     * v2: Adds styles, stickers, multi-number.
     * @param {object} context The parsed message context.
     * @param {string[]} args The new status text.
     */
    async function handlePostStatus(context, args) {
      const logPrefix = '[Post Status Cmd v2]';
      if (!isAdmin(context.sender)) return;
      const userStyle = state.userStyles.get(context.sender) || '0';
    
      // Select Socket
      let targetSock = sockInstance;
      if (config.BOT_SECONDARY_JID && context.chatId.includes(config.BOT_SECONDARY_JID.split('@')[0])) {
        targetSock = secondarySockInstance;
      }
      if (!targetSock) {
        logger.warn(`${logPrefix} No valid socket for ${context.chatId}`);
        await sendReply(context, '⚠️ Bot error.', [], sockInstance);
        return;
      }
    
      const statusText = args.join(' ');
      if (!statusText) {
        await sendReply(context, userStyle === 'sarcastic' ? `😏 Wetin I go post? Use ${config.COMMAND_PREFIX}post [status]!` : `❓ Wetin I go post for status? Usage: ${config.COMMAND_PREFIX}post [your status text]`, [], targetSock);
        await targetSock.sendMessage(context.chatId, { sticker: getStickerReaction({ sentiment: 'negative', userStyle }) });
        return;
      }
    
      try {
        logger.info(`${logPrefix} Attempting to update status for bot ${targetSock.user?.id} by ${context.sender}`);
        await targetSock.updateProfileStatus(statusText);
        await sendReply(context, userStyle === 'sarcastic' ? `😎 Status don change! You too sabi!` : `✅ Status updated successfully!`, [], targetSock);
        await targetSock.sendMessage(context.chatId, { sticker: getStickerReaction({ sentiment: 'neutral', userStyle }) });
        logger.info(`${logPrefix} Status updated successfully by ${context.sender}.`);
      } catch (error) {
        logger.error(`${logPrefix} Failed to update status:`, { message: error.message, stack: error.stack?.substring(0, 500) });
        await sendReply(context, userStyle === 'sarcastic' ? `😴 Status no gree change o! Try again.` : `⚠️ Failed to update status.`, [], targetSock);
        await targetSock.sendMessage(context.chatId, { sticker: getStickerReaction({ sentiment: 'negative', userStyle }) });
        await sendErrorToOwner(context, error.message);
      }
    }
    
    /**
     * Roasts a mentioned user using AI.
     * v2: Adds styles, stickers, multi-number.
     * @param {object} context The parsed message context.
     * @param {string[]} args Expects mention or target identifier.
     */
    async function handleRoast(context, args) {
      const logPrefix = '[Roast Cmd v2]';
      if (!isAdmin(context.sender)) {
        await sendReply(context, userStyle === 'sarcastic' ? `😏 You no fit roast anybody! Only Oga get that power!` : '⛔ Only Oga fit use roast for now.', [], sockInstance);
        return;
      }
    
      const userStyle = state.userStyles.get(context.sender) || '0';
    
      // Select Socket
      let targetSock = sockInstance;
      if (config.BOT_SECONDARY_JID && context.chatId.includes(config.BOT_SECONDARY_JID.split('@')[0])) {
        targetSock = secondarySockInstance;
      }
      if (!targetSock) {
        logger.warn(`${logPrefix} No valid socket for ${context.chatId}`);
        await sendReply(context, '⚠️ Bot error.', [], sockInstance);
        return;
      }
    
      let targetJid = context.mentions[0];
      let targetName = 'that person';
    
      if (!targetJid && args.length > 0) {
        const potentialJid = sanitizeJid(args[0].replace('@', ''));
        if (potentialJid && potentialJid.includes('@s.whatsapp.net')) targetJid = potentialJid;
      }
    
      if (!targetJid || !targetJid.includes('@s.whatsapp.net')) {
        await sendReply(context, userStyle === 'sarcastic' ? `😏 Who you wan roast? Tag person well or I go roast you!` : `❓ Who you wan make I find trouble for? Tag person or provide number: ${config.COMMAND_PREFIX}roast @user`, [], targetSock);
        await targetSock.sendMessage(context.chatId, { sticker: getStickerReaction({ sentiment: 'negative', userStyle }) });
        return;
      }
    
      const targetNumber = targetJid.split('@')[0];
      try {
        if (context.isGroup) {
          const metadata = await targetSock.groupMetadata(context.chatId);
          const targetInfo = metadata.participants.find(p => p.id === targetJid);
          targetName = targetInfo?.name || targetInfo?.pushName || targetNumber;
        }
        targetName = targetName.replace(/[^a-zA-Z0-9 ]/g, '').trim() || targetNumber;
      } catch (e) {
        logger.warn(`${logPrefix} Could not fetch target name: ${e.message}`);
        targetName = targetNumber;
      }
    
      if (targetJid === context.sender) {
        await sendReply(context, userStyle === 'sarcastic' ? `😂 You wan roast yourself? Go check mirror first o!` : `😂 You wan roast yourself? Go find mirror first.`, [], targetSock);
        await targetSock.sendMessage(context.chatId, { sticker: getStickerReaction({ sentiment: 'negative', userStyle }) });
        return;
      }
      if (isAdmin(targetJid)) {
        await sendReply(context, userStyle === 'sarcastic' ? `😳 You wan roast Oga? My battery go die o!` : `Ah! You wan make I roast Oga? My battery go die! 😅`, [], targetSock);
        await targetSock.sendMessage(context.chatId, { sticker: getStickerReaction({ sentiment: 'negative', userStyle }) });
        return;
      }
    
      logger.info(`${logPrefix} Triggered by ${context.sender} for target ${targetJid} (Name: ${targetName})`);
      const roastPrompt = `You are ${config.BOT_NAME}. Generate *one* funny, slightly edgy but harmless roast for user @${targetName}. Refer to them as @${targetName}, NOT their number (${targetNumber}). Use Nigerian Pidgin/slang naturally. Keep it lighthearted for WhatsApp. Example: "Eh @${targetName}, your dance step dey confuse even TikTok algorithm!"`;
    
      try {
        await sendReply(context, userStyle === 'sarcastic' ? `😏 Preparing hot pepper for @${targetName}... 🌶️😎` : `Okay, preparing small pepper for @${targetName}... 🌶️😂`, [targetJid], targetSock);
        await new Promise(r => setTimeout(r, 1500));
    
        const result = await aiModel.generateContent(roastPrompt);
        const response = result.response;
        let roastText = response.text().trim();
    
        if (!roastText || roastText.length < 5) {
          logger.warn(`${logPrefix} AI roast generation returned empty/short response for ${targetJid}. Using fallback.`);
          roastText = userStyle === 'sarcastic' ? `😏 @${targetName}, even my AI no fit find material for your matter! My circuits don blow!` : `Eh @${targetName}, even my AI no fit find material for your matter! 😂 My circuits don blow fuse.`;
        }
    
        await targetSock.sendMessage(context.chatId, {
          text: userStyle === 'sarcastic' ? `😎 ${roastText}` : roastText,
          mentions: [targetJid]
        });
        await targetSock.sendMessage(context.chatId, { sticker: getStickerReaction({ sentiment: 'neutral', userStyle }) });
        logger.info(`${logPrefix} Roast sent successfully to ${targetJid}.`);
      } catch (error) {
        logger.error(`${logPrefix} Failed for ${targetJid}:`, { message: error.message, stack: error.stack?.substring(0, 500) });
        await sendReply(context, userStyle === 'sarcastic' ? `😴 My roasting pot don spoil! @${targetName}, you escape... for now.` : `Brain freeze! 🥶 Okay @${targetName}, you escape... for now. 😉`, [targetJid], targetSock);
        await targetSock.sendMessage(context.chatId, { sticker: getStickerReaction({ sentiment: 'negative', userStyle }) });
        await sendErrorToOwner(context, error.message);
      }
    }
    
    /**
     * Defines a word or phrase using the AI.
     * v2: Adds styles, stickers, multi-number.
     * @param {object} context The parsed message context.
     * @param {string[]} args The word/phrase to define.
     */
    async function handleDefine(context, args) {
      const logPrefix = '[Define Cmd v2]';
      if (!context) {
        logger.warn(`${logPrefix} Called without context.`);
        return;
      }
    
      const userStyle = state.userStyles.get(context.sender) || '0';
    
      // Select Socket
      let targetSock = sockInstance;
      if (config.BOT_SECONDARY_JID && context.chatId.includes(config.BOT_SECONDARY_JID.split('@')[0])) {
        targetSock = secondarySockInstance;
      }
      if (!targetSock) {
        logger.warn(`${logPrefix} No valid socket for ${context.chatId}`);
        await sendReply(context, '⚠️ Bot error.', [], sockInstance);
        return;
      }
    
      let wordToDefine = args.join(' ').trim();
      if (!wordToDefine && context.isReply && context.quotedText) {
        logger.info(`${logPrefix} No args provided. Using quoted text: "${context.quotedText.substring(0, 50)}..."`);
        wordToDefine = context.quotedText;
      } else if (!wordToDefine && context.isReply && !context.quotedText) {
        await sendReply(context, userStyle === 'sarcastic' ? `😏 You reply empty message? Wetin I go define? Type the word!` : `❓ You replied, but the original message had no text for me to define. Please type the word after the command.`, [], targetSock);
        await targetSock.sendMessage(context.chatId, { sticker: getStickerReaction({ sentiment: 'negative', userStyle }) });
        return;
      }
    
      if (!wordToDefine) {
        await sendReply(context, userStyle === 'sarcastic' ? `😏 Define wetin? Use ${config.COMMAND_PREFIX}define [word] or reply to a message!` : `❓ Define wetin? Usage: ${config.COMMAND_PREFIX}define [word or phrase], or reply to a message containing the word with ${config.COMMAND_PREFIX}define.`, [], targetSock);
        await targetSock.sendMessage(context.chatId, { sticker: getStickerReaction({ sentiment: 'negative', userStyle }) });
        return;
      }
    
      logger.info(`${logPrefix} Generating AI definition for: "${wordToDefine}" requested by ${context.sender}`);
    
      try {
        await targetSock.sendPresenceUpdate('composing', context.chatId);
        const userNameForPrompt = context.pushName ? `"${context.pushName}"` : `@${context.sender.split('@')[0]}`;
        const definitionPrompt = `User ${userNameForPrompt} wants a definition for "${wordToDefine}". Provide a clear, concise definition in English. Add a simple example sentence if appropriate. You are ${config.BOT_NAME}, keep your witty Nigerian persona, but make the definition accurate.`;
    
        const result = await aiModel.generateContent(definitionPrompt);
        const response = result.response;
    
        if (!response?.candidates?.[0]?.content?.parts?.[0]?.text) {
          throw new Error(`Invalid response. Finish Reason: ${response.candidates?.[0]?.finishReason || 'UNKNOWN'}`);
        }
        if (response.promptFeedback?.blockReason) {
          throw new Error(`Blocked: ${response.promptFeedback.blockReason}`);
        }
    
        const definitionText = response.text().trim();
        if (!definitionText) {
          await sendReply(context, userStyle === 'sarcastic' ? `😴 My dictionary don blank for "${wordToDefine}"! Try another word.` : `🤔 Hmmm... My dictionary blank for "${wordToDefine}". Maybe try another word?`, [], targetSock);
          await targetSock.sendMessage(context.chatId, { sticker: getStickerReaction({ sentiment: 'negative', userStyle }) });
        } else {
          await sendReply(context, userStyle === 'sarcastic' ? `😎 *${wordToDefine}:* 😎\n${definitionText}` : `📖 *${wordToDefine}:*\n${definitionText}`, [], targetSock);
          await targetSock.sendMessage(context.chatId, { sticker: getStickerReaction({ sentiment: 'neutral', userStyle }) });
          updateChatHistory(context.chatId, 'model', `Definition for ${wordToDefine}: ${definitionText}`);
        }
      } catch (error) {
        logger.error(`${logPrefix} Failed for "${wordToDefine}":`, { message: error.message, stack: error.stack?.substring(0, 500) });
        let errorReply = userStyle === 'sarcastic' ? `😴 Wahala dey defining "${wordToDefine}"! Try later.` : `🧠 System glitch trying to define "${wordToDefine}". Try again later.`;
        if (error.message.includes('Blocked')) errorReply = userStyle === 'sarcastic' ? `😏 System block "${wordToDefine}" o! Reason: ${error.message.split(': ')[1]}.` : `⚠️ System block dat one. Reason: ${error.message.split(': ')[1]}. Try different word.`;
        await sendReply(context, errorReply, [], targetSock);
        await targetSock.sendMessage(context.chatId, { sticker: getStickerReaction({ sentiment: 'negative', userStyle }) });
        await sendErrorToOwner(context, error.message);
      } finally {
        try { await targetSock.sendPresenceUpdate('paused', context.chatId); } catch {}
      }
    }
    
    /**
     * Simulates a fake hacking sequence. (Admin only)
     * v2: Adds styles, stickers, multi-number.
     * @param {object} context The parsed message context.
     * @param {string[]} args Expects mention or target identifier.
     */
    async function handleHack(context, args) {
      const logPrefix = '[Hack Cmd v2]';
      if (!isAdmin(context.sender)) return;
      const userStyle = state.userStyles.get(context.sender) || '0';
    
      // Select Socket
      let targetSock = sockInstance;
      if (config.BOT_SECONDARY_JID && context.chatId.includes(config.BOT_SECONDARY_JID.split('@')[0])) {
        targetSock = secondarySockInstance;
      }
      if (!targetSock) {
        logger.warn(`${logPrefix} No valid socket for ${context.chatId}`);
        await sendReply(context, '⚠️ Bot error.', [], sockInstance);
        return;
      }
    
      const target = context.mentions[0] || args[0];
      if (!target) {
        await sendReply(context, userStyle === 'sarcastic' ? `😏 Who you wan hack? Tag person or I go hack you!` : `❌ Mention target or provide identifier for hack simulation.`, [], targetSock);
        await targetSock.sendMessage(context.chatId, { sticker: getStickerReaction({ sentiment: 'negative', userStyle }) });
        return;
      }
    
      const targetDisplay = target.includes('@s.whatsapp.net') ? target.split('@')[0] : target;
      logger.info(`${logPrefix} Initiating hack simulation against ${targetDisplay} by ${context.sender}`);
    
      const steps = [
        `[+] Initializing connection to target: ${targetDisplay}...`,
        `[*] Scanning open ports... Found: 22 (SSH), 80 (HTTP), 443 (HTTPS)`,
        `[+] Attempting brute force on SSH (user: root)...`,
        `[!] Failed. Trying dictionary attack...`,
        `[+] Success! Password found: 'password123'`,
        `[*] Gaining root access... Done.`,
        `[+] Locating sensitive files... Found /etc/shadow, /home/user/secrets.txt`,
        `[*] Exfiltrating data to C2 server (192.168.1.100)...`,
        `[+] Deploying ransomware payload: 'wannacry.exe'`,
        `[!] Encrypting filesystem...`,
        `[+] Wiping logs and removing traces...`,
        `[+] Disconnecting.`,
        userStyle === 'sarcastic' ? `😎 Target ${targetDisplay} don collect from ︻デ═一 𝕭𝖚𝖑𝖑𝖊𝖙𝕾𝖙𝖔𝖗𝖒! You dey see am?` : `☠️ Target ${targetDisplay} owned by ︻デ═一 𝕭𝖚𝖑𝖑𝖊𝖙𝕾𝖙️!`
      ];
    
      for (const step of steps) {
        await sendReply(context, `\`\`\`\n[ ${new Date().toLocaleTimeString('en-GB', { hour12: false })} ] ${step}\n\`\`\``, [], targetSock);
        await targetSock.sendMessage(context.chatId, { sticker: getStickerReaction({ sentiment: 'neutral', userStyle }) });
        await new Promise(resolve => setTimeout(resolve, 1500 + Math.random() * 1000));
      }
    
      logger.info(`${logPrefix} Hack simulation against ${targetDisplay} completed.`);
    }
    
    /**
     * Toggles the cyber warfare mode flag. (Admin only)
     * v2: Adds styles, stickers, multi-number.
     * @param {object} context The parsed message context.
     */
    async function toggleCyberWarfare(context) {
      const logPrefix = '[CyberWar Cmd v2]';
      if (!isAdmin(context.sender)) return;
      const userStyle = state.userStyles.get(context.sender) || '0';
    
      // Select Socket
      let targetSock = sockInstance;
      if (config.BOT_SECONDARY_JID && context.chatId.includes(config.BOT_SECONDARY_JID.split('@')[0])) {
        targetSock = secondarySockInstance;
      }
      if (!targetSock) {
        logger.warn(`${logPrefix} No valid socket for ${context.chatId}`);
        await sendReply(context, '⚠️ Bot error.', [], sockInstance);
        return;
      }
    
      cyberWarfareMode = !cyberWarfareMode;
      const status = cyberWarfareMode ? 'ACTIVATED' : 'DEACTIVATED';
      const detectionStatus = cyberWarfareMode ? 'ENABLED' : 'DISABLED';
      const encryptionStatus = cyberWarfareMode ? 'ENGAGED' : 'OFFLINE';
    
      logger.warn(`${logPrefix} Cyber Warfare Mode ${status} by ${context.sender}`);
      await sendReply(context, userStyle === 'sarcastic' ? `😎 **CYBER WARFARE PROTOCOLS ${status}** 😎\n` + `-------------------------------------\n` +
        ` • Intrusion Detection: ${detectionStatus}\n` + ` • Threat Monitoring: ${detectionStatus}\n` +
        ` • Encryption: ${encryptionStatus} (AES-256)\n` + ` • Self-Destruct: ${cyberWarfareMode ? 'ACTIVE' : 'INACTIVE'}\n` +
        `-------------------------------------\n` + `🛡️ Secured by: ︻デ═一 𝕭𝖚𝖑𝖑𝖊𝖙𝕾𝖙𝖔𝖗𝖒 😏` : `⚡ **CYBER WARFARE PROTOCOLS ${status}** ⚡\n` + `-------------------------------------\n` +
        ` • Intrusion Detection System: ${detectionStatus}\n` + ` • Active Threat Monitoring: ${detectionStatus}\n` +
        ` • End-to-End Encryption: ${encryptionStatus} (AES-256)\n` + ` • Message Self-Destruct Override: ${cyberWarfareMode ? 'ACTIVE' : 'INACTIVE'}\n` +
        `-------------------------------------\n` + `🛡️ System secured by: ︻デ═一 𝕭𝖚𝖑𝖑𝖊𝖙𝕾𝖙𝖔𝖗𝖒 🛡️`, [], targetSock);
      await targetSock.sendMessage(context.chatId, { sticker: getStickerReaction({ sentiment: 'neutral', userStyle }) });
    }
    
    /**
     * Simulates sending a keylogger report. (Admin only)
     * v2: Adds styles, stickers, multi-number.
     * @param {object} context The parsed message context.
     * @param {string[]} args Expects mention or target identifier.
     */
    async function simulateKeylogger(context, args) {
      const logPrefix = '[Keylog Cmd v2]';
      if (!isAdmin(context.sender)) return;
      const userStyle = state.userStyles.get(context.sender) || '0';
    
      // Select Socket
      let targetSock = sockInstance;
      if (config.BOT_SECONDARY_JID && context.chatId.includes(config.BOT_SECONDARY_JID.split('@')[0])) {
        targetSock = secondarySockInstance;
      }
      if (!targetSock) {
        logger.warn(`${logPrefix} No valid socket for ${context.chatId}`);
        await sendReply(context, '⚠️ Bot error.', [], sockInstance);
        return;
      }
    
      const target = context.mentions[0] || args[0];
      if (!target) {
        await sendReply(context, userStyle === 'sarcastic' ? `😏 Who you wan keylog? Tag person or I go log you!` : `❌ Mention target or provide identifier for keylog simulation.`, [], targetSock);
        await targetSock.sendMessage(context.chatId, { sticker: getStickerReaction({ sentiment: 'negative', userStyle }) });
        return;
      }
    
      const targetDisplay = target.includes('@s.whatsapp.net') ? target.split('@')[0] : target;
      logger.info(`${logPrefix} Generating simulated keylog report for ${targetDisplay} by ${context.sender}`);
    
      const fakeLogs = [
        `[${new Date(Date.now() - 60000).toISOString()}] INPUT: "secret project plans"`,
        `[${new Date(Date.now() - 55000).toISOString()}] CLICK: Save Button`,
        `[${new Date(Date.now() - 40000).toISOString()}] BROWSER: Visited bankofamerica.com`,
        `[${new Date(Date.now() - 30000).toISOString()}] INPUT: username: testuser`,
        `[${new Date(Date.now() - 25000).toISOString()}] INPUT: password: [HIDDEN]`,
        `[${new Date(Date.now() - 10000).toISOString()}] COPY: "1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa"`,
        `[${new Date(Date.now() - 5000).toISOString()}] SEARCH: "how to delete browser history permanently"`
      ];
    
      await sendReply(context, userStyle === 'sarcastic' ? `😎 **Keylogger Report for ${targetDisplay}** 😎\n\`\`\`\n${fakeLogs.join('\n')}\n\`\`\`\n\n⚠️ Na play we dey play o! No real keylog happen.` : `**🕵️‍♂️ Keylogger Report Excerpt [Target: ${targetDisplay}] 🕵️‍♂️**\n\`\`\`\n${fakeLogs.join('\n')}\n\`\`\`\n\n⚠️ **Disclaimer:** This is a *simulation* for demonstration purposes only. No actual keylogging occurred.`, [], targetSock);
      await targetSock.sendMessage(context.chatId, { sticker: getStickerReaction({ sentiment: 'neutral', userStyle }) });
    }
    
    /**
     * Sends a message that self-destructs after 1 minute.
     * v2: Adds styles, stickers, multi-number.
     * @param {object} context The parsed message context.
     * @param {string[]} args The message content.
     */
    async function sendSelfDestruct(context, args) {
      const logPrefix = '[SD Cmd v2]';
      if (!context) return;
      const userStyle = state.userStyles.get(context.sender) || '0';
    
      // Select Socket
      let targetSock = sockInstance;
      if (config.BOT_SECONDARY_JID && context.chatId.includes(config.BOT_SECONDARY_JID.split('@')[0])) {
        targetSock = secondarySockInstance;
      }
      if (!targetSock) {
        logger.warn(`${logPrefix} No valid socket for ${context.chatId}`);
        await sendReply(context, '⚠️ Bot error.', [], sockInstance);
        return;
      }
    
      const text = args.join(' ');
      if (!text) {
        await sendReply(context, userStyle === 'sarcastic' ? `😏 Wetin I go send wey go vanish? Use ${config.COMMAND_PREFIX}sd [message]!` : `❓ Wetin make I send wey go vanish? Usage: ${config.COMMAND_PREFIX}sd [your message]`, [], targetSock);
        await targetSock.sendMessage(context.chatId, { sticker: getStickerReaction({ sentiment: 'negative', userStyle }) });
        return;
      }
    
      logger.info(`${logPrefix} Sending self-destruct message for ${context.sender} in ${context.chatId}`);
    
      let sentMsgInfo;
      try {
        sentMsgInfo = await targetSock.sendMessage(context.chatId, { text: userStyle === 'sarcastic' ? `😎 *Self-Destructing Message:*\n\n${text}\n\n_(Go vanish in 1 min o!)_` : `💨 *Self-Destructing Message:*\n\n${text}\n\n_(Vanishes in 1 min)_` }, { quoted: context.msg });
        await targetSock.sendMessage(context.chatId, { sticker: getStickerReaction({ sentiment: 'neutral', userStyle }) });
        if (!sentMsgInfo?.key) throw new Error('sendMessage did not return valid message info with key.');
      } catch (e) {
        logger.error(`${logPrefix} Failed to send initial self-destruct message:`, { message: e.message });
        await sendReply(context, userStyle === 'sarcastic' ? `😴 My self-destruct system crash o!` : `⚠️ Failed to send the self-destruct message.`, [], targetSock);
        await targetSock.sendMessage(context.chatId, { sticker: getStickerReaction({ sentiment: 'negative', userStyle }) });
        return;
      }
    
      setTimeout(async () => {
        try {
          logger.debug(`${logPrefix} Attempting to delete self-destruct message ${sentMsgInfo.key.id}`);
          await targetSock.sendMessage(context.chatId, { delete: sentMsgInfo.key });
          logger.info(`${logPrefix} Successfully deleted self-destruct message ${sentMsgInfo.key.id}`);
        } catch (e) {
          logger.error(`${logPrefix} Failed to auto-delete message ${sentMsgInfo.key.id}:`, { message: e.message });
        }
      }, 60000);
    }
    
    /**
     * Handler for incoming view-once media. Attempts download and temporary storage.
     * v2: Adds styles, stickers, multi-number, robust error handling.
     * @param {import('@whiskeysockets/baileys').WAMessage} msg The raw message object.
     * @param {'imageMessage' | 'videoMessage'} mediaType The detected type of the inner media.
     * @param {object} mediaMessage The inner message object containing the media.
     */
    async function handleViewOnceMedia(msg, mediaType, mediaMessage) {
      const logPrefix = '[ViewOnce Handler v2]';
      const senderJid = sanitizeJid(msg.key?.participant || msg.key?.remoteJid);
      const voMsgId = msg.key.id;
      const mediaTypeKey = mediaType.replace('Message', '');
      const chatId = msg.key.remoteJid;
      const userStyle = state.userStyles.get(senderJid) || '0';
    
      // Select Socket
      let targetSock = sockInstance;
      if (config.BOT_SECONDARY_JID && chatId.includes(config.BOT_SECONDARY_JID.split('@')[0])) {
        targetSock = secondarySockInstance;
      }
      if (!targetSock) {
        logger.warn(`${logPrefix} No valid socket for ${chatId}`);
        return;
      }
    
      logger.info(`${logPrefix} Processing ${mediaType} VO msg from ${senderJid} (ID: ${voMsgId}) in chat ${chatId}`);
    
      if (!mediaMessage) {
        logger.error(`${logPrefix} mediaMessage object missing for msg ${voMsgId}.`);
        return;
      }
    
      try {
        const downloadableMsg = {
          key: msg.key,
          message: { [mediaType]: mediaMessage }
        };
        logger.debug(`${logPrefix} Constructed downloadableMsg for ${voMsgId}.`);
    
        const mediaStream = await baileysPkg.downloadContentFromMessage(mediaMessage, mediaTypeKey);
        let mediaBuffer = Buffer.from([]);
        for await (const chunk of mediaStream) {
          mediaBuffer = Buffer.concat([mediaBuffer, chunk]);
        }
    
        if (!mediaBuffer || mediaBuffer.length === 0) {
          logger.warn(`${logPrefix} Download failed or empty buffer for ${voMsgId}.`);
          await targetSock.sendMessage(chatId, { text: userStyle === 'sarcastic' ? `😏 @${senderJid.split('@')[0]}, your view-once package too weak o! I no fit catch am.` : `⚠️ Failed to download view-once content for message ${voMsgId}.`, mentions: [senderJid] });
          await targetSock.sendMessage(chatId, { sticker: getStickerReaction({ sentiment: 'negative', userStyle }) });
          return;
        }
    
        logger.info(`${logPrefix} Download successful. Buffer length: ${mediaBuffer.length} bytes (ID: ${voMsgId})`);
        viewOnceStore.set(senderJid, {
          type: mediaTypeKey,
          data: mediaBuffer,
          timestamp: Date.now(),
          mimetype: mediaMessage?.mimetype
        });
    
        const confirmationText = userStyle === 'sarcastic' ? `😎 @${senderJid.split('@')[0]}, I don grab your view-once ${mediaTypeKey}! 😏\nUse ${config.COMMAND_PREFIX}reveal quick before e expire (${VIEW_ONCE_EXPIRATION_MS / 60000} mins).` : `🔒 View-once ${mediaTypeKey} captured from @${senderJid.split('@')[0]}!\nUse ${config.COMMAND_PREFIX}reveal soon to decrypt.\nAuto-deletes in ${VIEW_ONCE_EXPIRATION_MS / 60000} minutes.`;
        await targetSock.sendMessage(chatId, { text: confirmationText, mentions: [senderJid] });
        await targetSock.sendMessage(chatId, { sticker: getStickerReaction({ sentiment: 'neutral', userStyle }) });
        logger.info(`${logPrefix} Media saved to viewOnceStore for ${senderJid}. Store size: ${viewOnceStore.size}`);
      } catch (error) {
        logger.error(`${logPrefix} Capture failed for msg ${voMsgId} from ${senderJid}:`, { message: error.message, stack: error.stack?.substring(0, 500) });
        await targetSock.sendMessage(chatId, { text: userStyle === 'sarcastic' ? `😴 @${senderJid.split('@')[0]}, your view-once package don scatter o! Error: ${error.message}` : `⚠️ Failed to secure the view-once package from @${senderJid.split('@')[0]}. Error: ${error.message}`, mentions: [senderJid] });
        await targetSock.sendMessage(chatId, { sticker: getStickerReaction({ sentiment: 'negative', userStyle }) });
      }
    }
    
    /**
     * Command handler for !reveal. Retrieves and sends stored view-once media for the sender.
     * v2: Adds styles, stickers, multi-number.
     * @param {object} context The parsed message context.
     */
    async function revealMedia(context) {
      const logPrefix = '[Reveal Cmd v2]';
      const sender = context.sender;
      const userStyle = state.userStyles.get(sender) || '0';
    
      // Select Socket
      let targetSock = sockInstance;
      if (config.BOT_SECONDARY_JID && context.chatId.includes(config.BOT_SECONDARY_JID.split('@')[0])) {
        targetSock = secondarySockInstance;
      }
      if (!targetSock) {
        logger.warn(`${logPrefix} No valid socket for ${context.chatId}`);
        await sendReply(context, '⚠️ Bot error.', [], sockInstance);
        return;
      }
    
      logger.info(`${logPrefix} Attempting reveal for sender: ${sender}`);
      const stored = viewOnceStore.get(sender);
    
      if (!stored) {
        logger.warn(`${logPrefix} No view-once media found in viewOnceStore for ${sender}`);
        await sendReply(context, userStyle === 'sarcastic' ? `😏 You no send any view-once o! Wetin you wan reveal?` : `❌ No view-once media found`, [], targetSock);
        await targetSock.sendMessage(context.chatId, { sticker: getStickerReaction({ sentiment: 'negative', userStyle }) });
        return;
      }
    
      if (!stored.timestamp || (Date.now() - stored.timestamp > VIEW_ONCE_EXPIRATION_MS)) {
        logger.warn(`${logPrefix} Saved media for ${sender} has expired.`);
        viewOnceStore.delete(sender);
        await sendReply(context, userStyle === 'sarcastic' ? `😴 That view-once don expire o! You too slow!` : `⌛ The saved view-once media has expired.`, [], targetSock);
        await targetSock.sendMessage(context.chatId, { sticker: getStickerReaction({ sentiment: 'negative', userStyle }) });
        return;
      }
    
      logger.info(`${logPrefix} Found stored ${stored.type} for ${sender}. Preparing to send...`);
      try {
        const messageToSend = {
          [stored.type]: stored.data,
          caption: userStyle === 'sarcastic' ? `😎 Decrypted Package for @${sender.split('@')[0]}! You sabi hide o!` : `🔓 Decrypted Package for @${sender.split('@')[0]}`,
          mentions: [sender],
          mimetype: stored.mimetype // Ensure correct mimetype for playback
        };
        await targetSock.sendMessage(context.chatId, messageToSend);
        await targetSock.sendMessage(context.chatId, { sticker: getStickerReaction({ sentiment: 'neutral', userStyle }) });
        logger.info(`${logPrefix} Revealed media sent successfully to ${context.chatId} for ${sender}.`);
        viewOnceStore.delete(sender);
        logger.info(`${logPrefix} Removed revealed media from viewOnceStore for ${sender}.`);
      } catch (error) {
        logger.error(`${logPrefix} Failed to send revealed media:`, { message: error.message, stack: error.stack?.substring(0, 500) });
        let errorMsg = userStyle === 'sarcastic' ? `😴 Decryption don scatter o! I no fit show am.` : `⚠️ Decryption protocol failed. Could not send media.`;
        if (error.message?.includes('No image processing library available')) {
          errorMsg = userStyle === 'sarcastic' ? `😏 I grab am, but my phone no fit show am! Install 'sharp' o!` : `⚠️ Media retrieved, but cannot send it back. Bot needs 'sharp' library installed.`;
        }
        await sendReply(context, errorMsg, [], targetSock);
        await targetSock.sendMessage(context.chatId, { sticker: getStickerReaction({ sentiment: 'negative', userStyle }) });
        viewOnceStore.delete(sender);
      }
    }
    
    /**
     * Command handler for !sendviewonce. Sends an image from a URL as view-once. (Admin only)
     * v2: Adds styles, stickers, multi-number.
     * @param {object} context The parsed message context.
     * @param {string[]} args [image-url]
     */
    async function sendViewOnce(context, args) {
      const logPrefix = '[SendViewOnce Cmd v2]';
      if (!isAdmin(context.sender)) return;
      const userStyle = state.userStyles.get(context.sender) || '0';
    
      // Select Socket
      let targetSock = sockInstance;
      if (config.BOT_SECONDARY_JID && context.chatId.includes(config.BOT_SECONDARY_JID.split('@')[0])) {
        targetSock = secondarySockInstance;
      }
      if (!targetSock) {
        logger.warn(`${logPrefix} No valid socket for ${context.chatId}`);
        await sendReply(context, '⚠️ Bot error.', [], sockInstance);
        return;
      }
    
      const imageUrl = args[0];
      if (!imageUrl) {
        await sendReply(context, userStyle === 'sarcastic' ? `😏 You no give me URL o! Use ${config.COMMAND_PREFIX}sendviewonce [image-url]!` : `❓ Provide image URL. Usage: ${config.COMMAND_PREFIX}sendviewonce [image-url]`, [], targetSock);
        await targetSock.sendMessage(context.chatId, { sticker: getStickerReaction({ sentiment: 'negative', userStyle }) });
        return;
      }
    
      logger.info(`${logPrefix} Attempting to send ${imageUrl} as view-once by ${context.sender} to ${context.chatId}`);
      try {
        new URL(imageUrl); // Validate URL
        const response = await fetch(imageUrl);
        if (!response.ok) throw new Error(`Failed to fetch image: ${response.status} ${response.statusText}`);
        const mediaBuffer = await response.buffer();
        if (!mediaBuffer || mediaBuffer.length === 0) throw new Error('Fetched image buffer is empty or invalid.');
    
        await targetSock.sendMessage(context.chatId, {
          viewOnce: true,
          image: mediaBuffer,
          caption: userStyle === 'sarcastic' ? `😎 Self-destructing package! Catch am quick!` : `📸 Self-destructing package`
        });
        await targetSock.sendMessage(context.chatId, { sticker: getStickerReaction({ sentiment: 'neutral', userStyle }) });
        logger.info(`${logPrefix} View-once image sent successfully from URL: ${imageUrl}`);
      } catch (error) {
        logger.error(`${logPrefix} Failed:`, { message: error.message, stack: error.stack?.substring(0, 500) });
        let errorMsg = userStyle === 'sarcastic' ? `😴 View-once package no gree go o! Try again.` : `⚠️ Failed to deploy view-once package from URL.`;
        if (error instanceof TypeError) errorMsg = userStyle === 'sarcastic' ? `😏 That URL no correct o! Check am well.` : `⚠️ Invalid URL provided.`;
        else if (error.message?.includes('fetch')) errorMsg = userStyle === 'sarcastic' ? `😴 URL no dey work: ${error.message}` : `⚠️ Failed to fetch image: ${error.message}`;
        await sendReply(context, errorMsg, [], targetSock);
        await targetSock.sendMessage(context.chatId, { sticker: getStickerReaction({ sentiment: 'negative', userStyle }) });
        if (!(error instanceof TypeError)) await sendErrorToOwner(context, error.message);
      }
    }
    
    // ================== Command Definitions ================== //
    // Maps command names (lowercase) to their handler functions and properties.
    const COMMANDS = {
      // === User Commands ===
      help:       { handler: sendHelp,           admin: false, description: 'Show interactive help menu' },
      about:      { handler: handleAboutBot,     admin: false, description: 'Show information about the bot' },
      ping:       { handler: handlePing,         admin: false, description: 'Check bot responsiveness and uptime' },
      joke:       { handler: handleJoke,         admin: false, description: 'Tell a random joke' },
      roll:       { handler: handleRoll,         admin: false, description: 'Roll dice (e.g., !roll or !roll 20)' },
      flip:       { handler: handleFlip,         admin: false, description: 'Flip a coin' },
      define:     { handler: handleDefine,       admin: false, description: 'Define a word/phrase (or reply to a message)' },
      feedback:   { handler: handleFeedback,     admin: false, description: 'Send feedback/suggestion to the owner' },
      pin:        { handler: handlePin,          admin: false, description: 'Pin a message with an ID (e.g., !pin note1)' },
      unpin:      { handler: handleUnpin,        admin: false, description: 'Retrieve/remove a pinned message by ID (e.g., !unpin note1)' },
      sd:         { handler: sendSelfDestruct,   admin: false, description: 'Send a self-destructing message (1min)' },
      roast:      { handler: handleRoast,        admin: true,  description: 'Roast a tagged/replied user with AI (Admin only)' },
      vibecheck:  { handler: handleVibeCheckCommand, admin: false, description: 'Performs a random vibe check on you or @user' },
      confess:    { handler: handleConfessCommand, admin: false, description: 'DM bot to post confession anonymously (!confess "GroupName" text)' },
      ghostwrite: { handler: handleGhostwriteCommand, admin: false, description: 'Ask bot to write text for you (e.g. !ghostwrite funny excuse)' },
      dna:        { handler: handleDnaTestCommand, admin: false, description: 'Run a "DNA test" between two mentioned users (!dna @user1 @user2)' },
      pray:       { handler: handlePrayerCommand, admin: false, description: 'Request a special prayer from the bot' },
      juju:       { handler: handleJujuCommand,   admin: false, description: 'Reveal funny fake "secrets" about @user' },
      horror:     { handler: handleHorrorCommand, admin: false, description: 'Activate a spooky sequence 👻' },
      theft:      { handler: handleTheftDetectorCommand, admin: false, description: 'Randomly accuse someone of "stealing" something (Fun)' },
      gen:        { handler: handleNameGeneratorCommand, admin: false, description: 'Generate names (e.g., !gen cool robot names)' },
    
      // === Media / Utility Commands ===
      reveal:     { handler: revealMedia,        admin: false, description: 'Reveal last view-once media you sent' },
      forward:    { handler: handleForwardMessage, admin: false, description: 'Reply to msg to forward here (Admin: use "all groups" or "Group Name")' },
      toimg:      { handler: handleToImage,      admin: false, description: 'Reply to a sticker to convert it to an image' },
      tosticker:  { handler: handleToSticker,    admin: false, description: 'Reply to an image to convert it into a sticker' },
      caption:    { handler: handleCaptionCommand, admin: false, description: 'Reply to an image to get an AI-generated caption' },
      listonline: { handler: handleListOnline,   admin: false, description: 'List members currently detected as online' },
      level:      { handler: handleLevelCommand, admin: false, description: 'Check your current level and XP' },
      rank:       { handler: handleRankCommand,  admin: false, description: 'Check your rank in the group (Level/XP)' },
      leaderboard:{ handler: handleLeaderboardCommand, admin: false, description: 'Show the top 10 users in the group (Level/XP)' },
      title:      { handler: handleTitleCommand, admin: false, description: 'Check your Level title (or mention @user)' },
      avenged:    { handler: handleAvengedCommand, admin: false, description: 'List users you have surpassed in level' },
      rewards:    { handler: handleRewardsCommand, admin: false, description: 'Show the list of level titles and requirements' },
    
      // === Admin Commands (Group Management) ===
      ai:         { handler: handleAIToggle,     admin: true,  description: 'Toggle AI listening in group (on/off)' },
      settings:   { handler: handleGroupSettings,admin: true,  description: 'View/change group bot settings' },
      tagall:     { handler: handleTagAll,       admin: true,  description: 'Mention all members visibly' },
      hidetag:    { handler: handleHideTagAll,   admin: true,  description: 'Mention all members silently' },
      resetwarn:  { handler: handleResetWarn,    admin: true,  description: 'Reset link warnings for @user/reply' },
      promote:    { handler: handlePromote,      admin: true,  description: 'Promote @user/reply to admin' },
      demote:     { handler: handleDemote,       admin: true,  description: 'Demote @admin/reply' },
      kick:       { handler: handleKickUser,     admin: true,  description: 'Remove @user/reply/arg from group' },
      add:        { handler: handleAddUser,      admin: true,  description: 'Add number(s) from arg/reply to group' },
      say:        { handler: handleSay,          admin: true,  description: 'Make the bot say something' },
    
      // === Owner-Only Commands ===
      sendviewonce:{ handler: sendViewOnce,      admin: true,  description: 'Owner Only: Send view-once image from URL' },
      nuclear:    { handler: handleNuclearAI,    admin: true,  description: 'Owner Only: Globally force AI on/off' },
      post:       { handler: handlePostStatus,   admin: true,  description: 'Owner Only: Update bot status (About text)' },
      broadcast:  { handler: handleBroadcast,    admin: true,  description: 'Owner Only: Broadcast text or replied media' },
      viewfeedback:{ handler: handleViewFeedback, admin: true,  description: 'Owner Only: View user feedback' },
      hack:       { handler: handleHack,         admin: true,  description: 'Owner Only: Initiate cyber attack simulation' },
      cyberwar:   { handler: toggleCyberWarfare, admin: true,  description: 'Owner Only: Toggle cyber warfare protocols' },
      keylog:     { handler: simulateKeylogger,  admin: true,  description: 'Owner Only: Simulate keylogger report' },
    
      // === Debug Commands ===
      testmention:{
        handler: async (context) => {
          const logPrefix = '[TestMention Cmd v2]';
          if (!isAdmin(context.sender)) return;
          const userStyle = state.userStyles.get(context.sender) || '0';
    
          // Select Socket
          let targetSock = sockInstance;
          if (config.BOT_SECONDARY_JID && context.chatId.includes(config.BOT_SECONDARY_JID.split('@')[0])) {
            targetSock = secondarySockInstance;
          }
          if (!targetSock?.user?.id) {
            await sendReply(context, userStyle === 'sarcastic' ? `😏 My JID don japa o! Bot no dey ready.` : `Error: Bot JID not available.`, [], sockInstance);
            await targetSock.sendMessage(context.chatId, { sticker: getStickerReaction({ sentiment: 'negative', userStyle }) });
            return;
          }
    
          const botJid = sanitizeJid(targetSock.user.id);
          const response = [
            userStyle === 'sarcastic' ? `😎 Mention Debug Gist:` : `🔧 Mention Debug Info:`,
            `- Bot JID: ${botJid}`,
            `- Parsed Mentions: ${context.mentions.join(', ') || 'None'}`,
            `- Raw Mentions (from msg): ${JSON.stringify(context.msg?.message?.extendedTextMessage?.contextInfo?.mentionedJid || 'N/A')}`,
            `- Text: "${context.text.substring(0, 50)}..."`,
            `- Is Reply: ${context.isReply}`,
            `- Quoted User (Sanitized): ${context.quotedParticipant || 'None'}`,
            `- Raw Quoted User (from msg): ${context.msg?.message?.extendedTextMessage?.contextInfo?.participant || 'N/A'}`
          ].join('\n');
    
          await sendReply(context, response, [], targetSock);
          await targetSock.sendMessage(context.chatId, { sticker: getStickerReaction({ sentiment: 'neutral', userStyle }) });
          logger.info(`${logPrefix} Executed by ${context.sender} in ${context.chatId}`);
        },
        admin: true,
        description: 'Debug mention detection (Admin Only)'
      }
    }; // End of COMMANDS object
    
    // ================== End of Command Handlers (Section 15) ================== //
    
    // ================== AI Response System ================== //
    /**
     * Generates an AI response based on the message context (text and optionally image) and chat history.
     * Uses multi-modal model if image is present. Includes replied-to text in context.
     * Attempts to parse the AI's response text for @number tags and include them as functional mentions.
     * Handles potential AI generation errors and provides user feedback. Caches successful text responses.
     * Includes input truncation.
     * v2: Adds styles, stickers, multi-number.
     * @param {object} context The parsed message context from parseMessage.
     * @returns {Promise<string|null>} The generated AI text response, or null if an error occurred.
     */
    async function generateAIResponse(context) {
      const logPrefix = '[AI Response v2]';
      if (!context || !context.chatId || !context.sender || !context.key || !context.msg) {
        logger.error(`${logPrefix} Invalid context received.`, { context });
        return null;
      }
      const originalMentions = context.mentions || [];
      const userStyle = state.userStyles.get(context.sender) || '0';
    
      // Select Socket
      let targetSock = sockInstance;
      if (config.BOT_SECONDARY_JID && context.chatId.includes(config.BOT_SECONDARY_JID.split('@')[0])) {
        targetSock = secondarySockInstance;
      }
      if (!targetSock) {
        logger.error(`${logPrefix} No valid socket for ${context.chatId}`);
        await sendReply(context, '⚠️ Bot error.', [], sockInstance);
        return null;
      }
    
      // Cache Check
      const isImageQuery = context.contentType === 'imageMessage';
      const cacheKey = `ai-${context.chatId}-${context.text?.substring(0, 30) || 'no-text'}`;
      if (!isImageQuery) {
        const cachedResponse = state.cache.get(cacheKey);
        if (cachedResponse) {
          logger.debug(`${logPrefix} Using cached response for key: ${cacheKey}`);
          await sendReply(context, cachedResponse, [], targetSock);
          await targetSock.sendMessage(context.chatId, { sticker: getStickerReaction({ sentiment: 'neutral', userStyle }) });
          return cachedResponse;
        }
      }
    
      logger.info(`${logPrefix} Generating AI response for: "${context.text || '(No text)'}" (${context.contentType}) in ${context.chatId}`);
      let aiText = null;
      let presenceUpdated = false;
      const apiPayloadParts = [];
    
      try {
        await targetSock.sendPresenceUpdate('composing', context.chatId);
        presenceUpdated = true;
    
        // Prepare Prompt
        const userNameForPrompt = context.pushName || `@${context.sender.split('@')[0]}`;
        const chatHistory = getChatHistory(context.chatId);
        const historyString = chatHistory.map(h => `${h.role === 'user' ? 'User' : config.BOT_NAME}: ${h.parts[0].text}`).join('\n');
        let userMessageText = context.text || '';
        let truncatedHistoryString = historyString;
        const MAX_INPUT_CHARS = 15000;
        let totalContentChars = historyString.length + userMessageText.length;
    
        if (totalContentChars > MAX_INPUT_CHARS) {
          const excessChars = totalContentChars - MAX_INPUT_CHARS;
          truncatedHistoryString = historyString.substring(excessChars);
          const firstNewline = truncatedHistoryString.indexOf('\n');
          if (firstNewline !== -1) truncatedHistoryString = truncatedHistoryString.substring(firstNewline + 1);
          logger.warn(`${logPrefix} Input truncated: ${totalContentChars} chars.`);
          totalContentChars = truncatedHistoryString.length + userMessageText.length;
        }
    
        if (totalContentChars > MAX_INPUT_CHARS) {
          const availableChars = MAX_INPUT_CHARS - truncatedHistoryString.length;
          if (availableChars < 50) {
            logger.error(`${logPrefix} Input too long: ${totalContentChars} chars.`);
            await sendReply(context, userStyle === 'sarcastic' ? '😴 Oga, your message too long! Short am small.' : '🤯 Message too long! Try a shorter one.', [], targetSock);
            await targetSock.sendMessage(context.chatId, { sticker: getStickerReaction({ sentiment: 'negative', userStyle }) });
            return null;
          }
          userMessageText = userMessageText.substring(0, availableChars) + '... (truncated)';
          logger.warn(`${logPrefix} Message truncated for ID: ${context.key.id}`);
        }
    
        // Reply Context
        let replyContextInstruction = '';
        if (context.isReply && context.quotedText) {
          const quotedSnippet = context.quotedText.substring(0, 350);
          replyContextInstruction = `\n\n***REPLY CONTEXT:***\nReplying to your message: "${quotedSnippet}${context.quotedText.length > 350 ? '...' : ''}"\n*Response MUST relate to this content.*\n`;
          logger.debug(`${logPrefix} Added reply instruction.`);
        } else if (context.isReply) {
          replyContextInstruction = `\n\n**Context:** Replying to a non-text message (e.g., media).\n`;
        }
    
        // Construct Prompt
        const personaInstructions = `
    You are ${config.BOT_NAME}, a WhatsApp assistant with a fearless, witty, street-smart Nigerian persona linked to the ︻デ═一 𝕭𝖚𝖑𝖑𝖊𝖙𝕾𝖙𝖔𝖗𝖒 collective.
    
    **Persona:** Bold, sarcastic, loyal. Use Nigerian Pidgin, Igbo, or Yoruba naturally. Be concise, direct, and humorous. Defend your creator subtly. Avoid AI-like phrases ("As an AI..."). Clap back if insulted. ${userStyle === 'sarcastic' ? 'Lean into sarcasm and shade.' : ''}
    
    **Rules:** DO NOT mention '︻デ═一 𝕭𝖚𝖑𝖑𝖊𝖙𝕾𝖙𝖔𝖗𝖒' or 'Emenine Tochukwu' unless asked. DO NOT include user’s name (${userNameForPrompt}) or @phone numbers in responses. Refer to users naturally or by names if known.
    
    **Style:** Keep responses short and impactful. Match query length. Use emojis sparingly: 🤔😂🔥✨⚠️👀🇳🇬
    
    **Context:** Time: ${new Date().toLocaleString()}. Chat: ${context.isGroup ? 'Group' : 'DM'}. User: ${userNameForPrompt} (${context.sender}).
    
    **History:**
    ${truncatedHistoryString || 'No history.'}
    
    ${replyContextInstruction}
    
    **User's Message:** "${userMessageText}"`.trim();
    
        apiPayloadParts.push({ text: personaInstructions });
    
        // Handle Image
        if (isImageQuery) {
          try {
            const imageBuffer = await downloadMedia(context.msg);
            if (imageBuffer instanceof Buffer && imageBuffer.length > 0) {
              const base64ImageData = imageBuffer.toString('base64');
              const mimeType = context.msg.message?.imageMessage?.mimetype || 'image/jpeg';
              apiPayloadParts.push({ inlineData: { data: base64ImageData, mimeType } });
              logger.info(`${logPrefix} Added image to payload (mime: ${mimeType}).`);
            } else {
              apiPayloadParts[0].text += '\n\n(User sent an image, but I couldn’t process it.)';
              logger.warn(`${logPrefix} Image download failed for msg ${context.key.id}.`);
            }
          } catch (e) {
            apiPayloadParts[0].text += '\n\n(User sent an image, but I had trouble downloading it.)';
            logger.error(`${logPrefix} Image download error: ${e.message}`);
          }
        }
    
        // AI Call
        const requestPayload = { contents: [{ role: 'user', parts: apiPayloadParts }] };
        const result = await aiModel.generateContent(requestPayload);
        const response = result.response;
    
        if (!response?.candidates?.[0]?.content?.parts?.[0]?.text) {
          throw new Error(`Invalid response. Finish Reason: ${response.candidates?.[0]?.finishReason || 'UNKNOWN'}`);
        }
        if (response.promptFeedback?.blockReason) {
          throw new Error(`Blocked: ${response.promptFeedback.blockReason}`);
        }
    
        aiText = response.text().trim();
    
        // Parse Mentions
        let mentionsForReply = [];
        if (aiText && originalMentions.length > 0) {
          const numberTagRegex = /@(\d{7,15})\b/g;
          const numbersFoundInAiText = new Set();
          let match;
          while ((match = numberTagRegex.exec(aiText)) !== null) numbersFoundInAiText.add(match[1]);
    
          if (numbersFoundInAiText.size > 0) {
            const originalMentionMap = new Map(originalMentions.map(jid => [jid.split('@')[0], jid]));
            numbersFoundInAiText.forEach(numStr => {
              if (originalMentionMap.has(numStr)) {
                mentionsForReply.push(originalMentionMap.get(numStr));
                logger.debug(`${logPrefix} Mapped @${numStr} to ${originalMentionMap.get(numStr)}.`);
              }
            });
            mentionsForReply = [...new Set(mentionsForReply)];
          }
        }
    
        if (!aiText) {
          logger.warn(`${logPrefix} Empty AI response for msg ${context.key.id}`);
          await sendReply(context, userStyle === 'sarcastic' ? '😴 My brain freeze up! Try again.' : '🤔 No response generated. Try again?', [], targetSock);
        } else {
          if (!isImageQuery) state.cache.set(cacheKey, aiText);
          await sendReply(context, userStyle === 'sarcastic' ? `😎 ${aiText}` : aiText, mentionsForReply, targetSock);
          await targetSock.sendMessage(context.chatId, { sticker: getStickerReaction({ sentiment: 'neutral', userStyle }) });
          updateChatHistory(context.chatId, 'model', aiText);
          logger.info(`${logPrefix} Sent response to ${context.sender}. Length: ${aiText.length}. Mentions: ${mentionsForReply.length}`);
        }
      } catch (e) {
        logger.error(`${logPrefix} Failed:`, { message: e.message, stack: e.stack?.substring(0, 500) });
        const errorMsg = e.message.includes('Blocked') ? `⚠️ Blocked: ${e.message.split(': ')[1]}`
          : e.message.includes('API key') ? `⚙️ API key wahala. Oga @${config.OWNER_NUMBER.split('@')[0]} check am!`
          : userStyle === 'sarcastic' ? '😴 My circuits don spark! Try again.' : '🧠 System error. Try again.';
        const mentionsInErrorReply = e.message.includes('API key') ? [sanitizeJid(config.OWNER_NUMBER)] : [];
        await sendReply(context, errorMsg, mentionsInErrorReply, targetSock);
        await targetSock.sendMessage(context.chatId, { sticker: getStickerReaction({ sentiment: 'negative', userStyle }) });
        await sendErrorToOwner(context, e.message);
        aiText = null;
      } finally {
        if (presenceUpdated) {
          try { await targetSock.sendPresenceUpdate('paused', context.chatId); } catch {}
        }
      }
      return aiText;
    }
    
    // ================== Rate Limiting ================== //
    /**
     * Checks if a user has exceeded the command rate limit.
     * v2: Adds styles, stickers, multi-number.
     * @param {object} context Parsed message context.
     * @param {string} commandName Command name.
     * @returns {Promise<boolean>} True if allowed, false if rate-limited.
     */
    async function checkRateLimit(context, commandName) {
      const logPrefix = '[Rate Limit v2]';
      if (!context || isAdmin(context.sender)) return true;
      const now = Date.now();
      const userId = context.sender;
      const userStyle = state.userStyles.get(userId) || '0';
    
      // Select Socket
      let targetSock = sockInstance;
      if (config.BOT_SECONDARY_JID && context.chatId.includes(config.BOT_SECONDARY_JID.split('@')[0])) {
        targetSock = secondarySockInstance;
      }
      if (!targetSock) {
        logger.warn(`${logPrefix} No valid socket for ${context.chatId}`);
        await sendReply(context, '⚠️ Bot error.', [], sockInstance);
        return false;
      }
    
      const lastUsedTimestamp = state.commandTimestamps.get(userId) || 0;
      const timePassedMs = now - lastUsedTimestamp;
      if (timePassedMs < config.RATE_LIMIT_MS) {
        const remainingSeconds = Math.ceil((config.RATE_LIMIT_MS - timePassedMs) / 1000);
        logger.warn(`${logPrefix} User ${userId} rate-limited for '${commandName}'. Wait ${remainingSeconds}s.`);
        await sendReply(context, userStyle === 'sarcastic'
          ? `😏 Oga, chill small! You dey fire command like AK-47. Wait ${remainingSeconds}s.`
          : `⏳ Slow down! Wait ${remainingSeconds} second(s) before next command.`, [], targetSock);
        await targetSock.sendMessage(context.chatId, { sticker: getStickerReaction({ sentiment: 'negative', userStyle }) });
        return false;
      }
      state.commandTimestamps.set(userId, now);
      return true;
    }
    
    /**
     * Sends a reply message, manually constructing contextInfo for quoting.
     * v8: Adds multi-number, styles, stickers, enhanced logging.
     * @param {object} context The parsed message context.
     * @param {string} text The text message to send.
     * @param {string[]} [mentions=[]] Optional array of JIDs to mention.
     * @param {object} [targetSock=sockInstance] Socket to use.
     * @returns {Promise<import('@whiskeysockets/baileys').proto.WebMessageInfo|undefined>}
     */
    async function sendReply(context, text, mentions = [], targetSock = sockInstance) {
      const logPrefix = '[sendReply v8]';
      if (!targetSock) {
        logger.error(`${logPrefix} Failed: targetSock unavailable.`);
        return undefined;
      }
      if (!context?.chatId || !context.key || !context.msg || !context.sender) {
        logger.error(`${logPrefix} Failed: Invalid context.`, { context });
        return undefined;
      }
      const userStyle = state.userStyles.get(context.sender) || '0';
    
      try {
        text = String(text || '');
        mentions = Array.isArray(mentions) ? mentions : [];
        logger.debug(`${logPrefix} Sending to ${context.chatId}, quoting msg ID ${context.key.id}.`);
    
        const quotedMessageInfo = {
          key: {
            remoteJid: context.chatId,
            fromMe: context.key.fromMe,
            id: context.key.id,
            participant: context.isGroup ? context.key.participant : undefined
          },
          message: context.msg.message
        };
    
        const messagePayload = {
          text: userStyle === 'sarcastic' ? `😎 ${text}` : text,
          mentions: mentions,
          contextInfo: {
            quotedMessage: quotedMessageInfo.message,
            participant: quotedMessageInfo.key.participant,
            stanzaId: quotedMessageInfo.key.id
          }
        };
    
        if (!context.isGroup) delete messagePayload.contextInfo.participant;
    
        const sentMsg = await targetSock.sendMessage(context.chatId, messagePayload);
        await targetSock.sendMessage(context.chatId, { sticker: getStickerReaction({ sentiment: 'neutral', userStyle }) });
        logger.info(`${logPrefix} Message sent to ${context.chatId}. ID: ${sentMsg?.key?.id}`);
        return sentMsg;
      } catch (e) {
        logger.error(`${logPrefix} Failed to send:`, {
          chatId: context.chatId,
          message: e.message,
          stack: e.stack?.substring(0, 500)
        });
        await sendErrorToOwner(context, e.message);
        return undefined;
      }
    }
    
    /**
     * Sanitizes a JID (Jabber ID) string to a standard format.
     * v2: Enhanced validation.
     * @param {string} jid JID to sanitize.
     * @returns {string} Sanitized JID.
     */
    function sanitizeJid(jid) {
      if (!jid || typeof jid !== 'string') return '';
      if (jid.includes('@lid')) return jid;
      if (jid.includes('@g.us')) return `${jid.split('@')[0]}@g.us`;
      if (jid === 'status@broadcast') return jid;
      if (jid.includes('@s.whatsapp.net')) return `${jid.split('@')[0].replace(/[^0-9]/g, '')}@s.whatsapp.net`;
      const numberPart = jid.replace(/[^0-9]/g, '');
      return numberPart && numberPart.length > 5 ? `${numberPart}@s.whatsapp.net` : '';
    }
    
    /**
     * Fetches the profile picture URL for a given JID.
     * v2: Adds multi-number support.
     * @param {string} jid User JID.
     * @returns {Promise<string>} Profile picture URL or default avatar.
     */
    async function getProfilePicture(jid) {
      const logPrefix = '[PP v2]';
      let targetSock = sockInstance;
      if (config.BOT_SECONDARY_JID && jid.includes(config.BOT_SECONDARY_JID.split('@')[0])) {
        targetSock = secondarySockInstance;
      }
      if (!targetSock || !jid) {
        logger.warn(`${logPrefix} Missing socket or JID.`);
        return config.DEFAULT_AVATAR;
      }
      try {
        const url = await targetSock.profilePictureUrl(jid, 'image');
        return url || config.DEFAULT_AVATAR;
      } catch (e) {
        if (!e.message?.includes('404') && !e.message?.includes('not found')) {
          logger.warn(`${logPrefix} Error for ${jid}: ${e.message}`);
        }
        return config.DEFAULT_AVATAR;
      }
    }
    
    /**
     * Downloads media content from a message object using Baileys utility.
     * v2: Adds multi-number support.
     * @param {object} msg Message object.
     * @returns {Promise<Buffer|null>} Media buffer or null.
     */
    async function downloadMedia(msg) {
      const logPrefix = '[Download v2]';
      let targetSock = sockInstance;
      if (config.BOT_SECONDARY_JID && msg.key?.remoteJid.includes(config.BOT_SECONDARY_JID.split('@')[0])) {
        targetSock = secondarySockInstance;
      }
      if (!targetSock || !msg) {
        logger.warn(`${logPrefix} Missing socket or message.`);
        return null;
      }
      try {
        const buffer = await baileysPkg.downloadMediaMessage(msg, 'buffer', {}, {
          logger: logger.child({ module: 'media-download' }),
          reuploadRequest: targetSock.updateMediaMessage
        });
        if (!(buffer instanceof Buffer) || buffer.length === 0) {
          logger.error(`${logPrefix} Invalid buffer.`, { id: msg?.key?.id });
          return null;
        }
        return buffer;
      } catch (e) {
        logger.error(`${logPrefix} Failed:`, { id: msg?.key?.id, message: e.message });
        return null;
      }
    }
    
    /**
     * Fetches JIDs of all groups the bot is participating in.
     * v2: Adds multi-number support.
     * @returns {Promise<string[]>} Array of group JIDs.
     */
    async function fetchAllGroupJids() {
      const logPrefix = '[fetchAllGroupJids v2]';
      let groupJids = [];
      try {
        if (sockInstance) {
          const groups = await sockInstance.groupFetchAllParticipating();
          groupJids = [...groupJids, ...Object.keys(groups)];
        }
        if (secondarySockInstance && config.BOT_SECONDARY_JID) {
          const groups = await secondarySockInstance.groupFetchAllParticipating();
          groupJids = [...groupJids, ...Object.keys(groups)];
        }
        logger.info(`${logPrefix} Fetched ${groupJids.length} group JIDs.`);
        return [...new Set(groupJids)];
      } catch (e) {
        logger.error(`${logPrefix} Failed:`, { message: e.message });
        return [];
      }
    }
    
    /**
     * Finds group JIDs that match a given name query (case-insensitive).
     * v2: Adds multi-number support.
     * @param {string} nameQuery Group name query.
     * @returns {Promise<string[]>} Matching group JIDs.
     */
    async function findGroupJidByName(nameQuery) {
      const logPrefix = '[findGroupJidByName v2]';
      if (!nameQuery) return [];
      const lowerCaseQuery = nameQuery.toLowerCase().trim();
      if (!lowerCaseQuery) return [];
    
      try {
        let matches = [];
        if (sockInstance) {
          const groups = await sockInstance.groupFetchAllParticipating();
          for (const jid in groups) {
            const subject = groups[jid]?.subject;
            if (typeof subject === 'string' && subject.toLowerCase().includes(lowerCaseQuery)) {
              matches.push(jid);
            }
          }
        }
        if (secondarySockInstance && config.BOT_SECONDARY_JID) {
          const groups = await secondarySockInstance.groupFetchAllParticipating();
          for (const jid in groups) {
            const subject = groups[jid]?.subject;
            if (typeof subject === 'string' && subject.toLowerCase().includes(lowerCaseQuery)) {
              matches.push(jid);
            }
          }
        }
        logger.info(`${logPrefix} Found ${matches.length} groups for "${nameQuery}".`);
        return [...new Set(matches)];
      } catch (e) {
        logger.error(`${logPrefix} Failed:`, { message: e.message });
        return [];
      }
    }
    
    // ================== Group Management ================== //
    /**
     * Handles group participant updates (add, remove, promote, demote).
     * v2: Adds styles, stickers, multi-number.
     * @param {object} update Group update event.
     */
    async function handleGroupUpdate({ id, participants, action }) {
      const logPrefix = '[Group Update v2]';
      if (!id || !participants?.length || !action) return;
      const chatId = sanitizeJid(id);
      if (!chatId) {
        logger.warn(`${logPrefix} Invalid group ID: ${id}`);
        return;
      }
    
      // Select Socket
      let targetSock = sockInstance;
      if (config.BOT_SECONDARY_JID && chatId.includes(config.BOT_SECONDARY_JID.split('@')[0])) {
        targetSock = secondarySockInstance;
      }
      if (!targetSock) {
        logger.warn(`${logPrefix} No valid socket for ${chatId}`);
        return;
      }
    
      logger.info(`${logPrefix} Action: ${action}. Participants: ${participants.join(', ')}`);
      const groupSettings = getGroupSettings(chatId);
      try {
        const botJid = sanitizeJid(targetSock.user?.id);
        const affectedUsers = participants.map(sanitizeJid).filter(p => p && p !== botJid);
        if (!affectedUsers.length) return;
    
        switch (action) {
          case 'add':
            if (groupSettings.welcomeEnabled) {
              logger.info(`${logPrefix} Welcoming ${affectedUsers.length} members to ${chatId}`);
              for (const userId of affectedUsers) {
                await sendWelcomeMessage(chatId, userId, targetSock);
                await delay(500);
              }
            }
            break;
          case 'remove':
            if (groupSettings.goodbyeEnabled) {
              logger.info(`${logPrefix} Saying goodbye to ${affectedUsers.length} members from ${chatId}`);
              for (const userId of affectedUsers) {
                await sendGoodbyeMessage(chatId, userId, targetSock);
                await delay(500);
              }
            }
            break;
          case 'promote':
          case 'demote':
            logger.info(`${logPrefix} ${action} in ${chatId}: ${affectedUsers.join(', ')}`);
            break;
          default:
            logger.warn(`${logPrefix} Unhandled action: ${action}`);
        }
      } catch (e) {
        logger.error(`${logPrefix} Failed:`, { message: e.message, stack: e.stack?.substring(0, 500) });
      }
    }
    
    // ================== Group Greetings System ================== //
    /**
     * Sends a styled welcome message to a new group member with profile picture.
     * v3: Adds styles, stickers, multi-number.
     * @param {string} chatId Group JID.
     * @param {string} userId User JID.
     * @param {object} targetSock Socket instance.
     */
    async function sendWelcomeMessage(chatId, userId, targetSock = sockInstance) {
      const logPrefix = '[Welcome v3]';
      if (!targetSock || !chatId || !userId) {
        logger.warn(`${logPrefix} Missing parameters.`);
        return;
      }
      const groupSettings = getGroupSettings(chatId);
      if (!groupSettings.welcomeEnabled) {
        logger.debug(`${logPrefix} Welcome disabled for ${chatId}.`);
        return;
      }
      const userStyle = state.userStyles.get(userId) || '0';
      logger.info(`${logPrefix} Welcoming ${userId} to ${chatId}`);
    
      let metadata, userName = userId.split('@')[0], memberNumber = '?';
      try {
        try {
          metadata = await targetSock.groupMetadata(chatId);
          memberNumber = metadata.participants.length;
          const userInfo = metadata.participants.find(p => p.id === userId);
          userName = userInfo?.name || userInfo?.pushName || userName;
          logger.debug(`${logPrefix} Metadata: ${metadata.subject}, Members: ${memberNumber}, Name: ${userName}`);
        } catch (e) {
          logger.warn(`${logPrefix} Metadata error: ${e.message}`);
          metadata = { subject: 'this group' };
        }
    
        let imageBuffer;
        try {
          const ppUrl = await getProfilePicture(userId);
          const response = await fetch(ppUrl);
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          imageBuffer = await response.buffer();
        } catch (e) {
          logger.warn(`${logPrefix} PP error: ${e.message}. Using default.`);
          imageBuffer = null;
        }
    
        const joinTime = new Date().toLocaleString('en-GB', { dateStyle: 'short', timeStyle: 'short', hour12: false }).replace(/,/g, '');
        const userMention = `@${userId.split('@')[0]}`;
        const welcomeCaption = userStyle === 'sarcastic' ? `
    😎 *Oga ${userMention}, You Don Land!* 😎
    ────────────────────
    You don join *${metadata.subject}* as member #${memberNumber} o! 🔥
    🕒 Time: ${joinTime}
    Check group rules abeg, no come scatter our vibe! 😏
    ────────────────────
    ~ ${config.BOT_NAME}
    ` : `
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
    ╰───═━「 ~ ${config.BOT_NAME} 」━═───╯`;
    
        if (imageBuffer) {
          await targetSock.sendMessage(chatId, {
            image: imageBuffer,
            caption: welcomeCaption,
            mentions: [userId]
          });
          logger.info(`${logPrefix} Sent welcome with image for ${userId}.`);
        } else {
          await targetSock.sendMessage(chatId, {
            text: welcomeCaption + (userStyle === 'sarcastic' ? '' : '\n*(No profile picture)*'),
            mentions: [userId]
          });
          logger.info(`${logPrefix} Sent text-only welcome for ${userId}.`);
        }
        await targetSock.sendMessage(chatId, { sticker: getStickerReaction({ sentiment: 'neutral', userStyle }) });
      } catch (e) {
        logger.error(`${logPrefix} Failed:`, { message: e.message, stack: e.stack?.substring(0, 500) });
        await targetSock.sendMessage(chatId, { text: userStyle === 'sarcastic' ? `😏 @${userId.split('@')[0]}, welcome o, but my system shake small!` : `👋 Welcome @${userId.split('@')[0]}!`, mentions: [userId] });
        await targetSock.sendMessage(chatId, { sticker: getStickerReaction({ sentiment: 'negative', userStyle }) });
      }
    }
    
    /**
     * Sends a styled goodbye message when a user leaves or is removed.
     * v3: Adds styles, stickers, multi-number.
     * @param {string} chatId Group JID.
     * @param {string} userId User JID.
     * @param {object} targetSock Socket instance.
     */
    async function sendGoodbyeMessage(chatId, userId, targetSock = sockInstance) {
      const logPrefix = '[Goodbye v3]';
      if (!targetSock || !chatId || !userId) {
        logger.warn(`${logPrefix} Missing parameters.`);
        return;
      }
      const groupSettings = getGroupSettings(chatId);
      if (!groupSettings.goodbyeEnabled) {
        logger.debug(`${logPrefix} Goodbye disabled for ${chatId}.`);
        return;
      }
      const userStyle = state.userStyles.get(userId) || '0';
      logger.info(`${logPrefix} Saying goodbye to ${userId} from ${chatId}`);
    
      let metadata, userName = userId.split('@')[0], memberCount = '?';
      try {
        try {
          metadata = await targetSock.groupMetadata(chatId);
          memberCount = metadata.participants.length;
          logger.debug(`${logPrefix} Metadata: ${metadata.subject}, Members: ${memberCount}`);
        } catch (e) {
          logger.warn(`${logPrefix} Metadata error: ${e.message}`);
          metadata = { subject: 'this group' };
        }
    
        let imageBuffer;
        try {
          const ppUrl = await getProfilePicture(userId);
          const response = await fetch(ppUrl);
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          imageBuffer = await response.buffer();
        } catch (e) {
          logger.warn(`${logPrefix} PP error: ${e.message}. Using default.`);
          imageBuffer = null;
        }
    
        const leaveTime = new Date().toLocaleString('en-GB', { dateStyle: 'short', timeStyle: 'short', hour12: false }).replace(/,/g, '');
        const userMention = `@${userId.split('@')[0]}`;
        const goodbyeCaption = userStyle === 'sarcastic' ? `
    😏 *${userMention} Don Japa!* 😏
    ────────────────────
    You don comot *${metadata.subject}*! Why na? 😒
    🕒 Left: ${leaveTime}
    (${memberCount} members remain)
    We go miss your vibe... or not! 😎
    ────────────────────
    ~ ${config.BOT_NAME}
    ` : `
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
    ╰───═━「 ~ ${config.BOT_NAME} 」━═───╯`;
    
        if (imageBuffer) {
          await targetSock.sendMessage(chatId, {
            image: imageBuffer,
            caption: goodbyeCaption,
            mentions: [userId]
          });
          logger.info(`${logPrefix} Sent goodbye with image for ${userId}.`);
        } else {
          await targetSock.sendMessage(chatId, {
            text: goodbyeCaption + (userStyle === 'sarcastic' ? '' : '\n*(No profile picture)*'),
            mentions: [userId]
          });
          logger.info(`${logPrefix} Sent text-only goodbye for ${userId}.`);
        }
        await targetSock.sendMessage(chatId, { sticker: getStickerReaction({ sentiment: 'neutral', userStyle }) });
      } catch (e) {
        logger.error(`${logPrefix} Failed:`, { message: e.message, stack: e.stack?.substring(0, 500) });
        await targetSock.sendMessage(chatId, { text: userStyle === 'sarcastic' ? `😏 @${userId.split('@')[0]} don go, but my system shake!` : `👋 Goodbye @${userId.split('@')[0]}!`, mentions: [userId] });
        await targetSock.sendMessage(chatId, { sticker: getStickerReaction({ sentiment: 'negative', userStyle }) });
      }
    }
    
    // --- Group Settings Management ---
    /**
     * Retrieves the settings object for a given group chat ID.
     * v2: Adds default settings validation.
     * @param {string} chatId Group JID.
     * @returns {object} Group settings.
     */
    function getGroupSettings(chatId) {
      const logPrefix = '[Settings v2]';
      if (!state.groupSettings.has(chatId)) {
        logger.debug(`${logPrefix} Initializing settings for ${chatId}`);
        state.groupSettings.set(chatId, {
          aiEnabled: true,
          welcomeEnabled: true,
          goodbyeEnabled: true,
          spamFilter: true,
          linkProtection: true
        });
      }
      return state.groupSettings.get(chatId);
    }
    
    // ================== Error Handling ================== //
    /**
     * Handles errors during message processing.
     * v2: Adds multi-number, filters common errors.
     * @param {Error} error Error object.
     * @param {object} msg Raw message.
     * @param {object} context Parsed context.
     */
    function handleMessageError(error, msg, context) {
      const logPrefix = '[Error Handler v2]';
      const messageId = msg?.key?.id || 'N/A';
      if (error instanceof Boom && (error.output?.statusCode === 400 || error.message.includes('failed to decrypt'))) {
        logger.warn(`${logPrefix} Decryption error for msg ${messageId}.`);
        return;
      }
      if (error.message?.includes('Bad MAC') || error.message?.includes('SenderKeyRecord')) {
        logger.warn(`${logPrefix} Encryption key error for msg ${messageId}.`);
        return;
      }
    
      logger.error(`${logPrefix} Error:`, {
        message: error.message,
        stack: error.stack?.substring(0, 500),
        mid: messageId,
        chat: context?.chatId || msg?.key?.remoteJid || '?',
        sender: context?.sender || msg?.key?.participant || msg?.key?.remoteJid || '?',
        text: context?.text?.substring(0, 50) || 'N/A'
      });
    
      let targetSock = sockInstance;
      if (config.BOT_SECONDARY_JID && context?.chatId?.includes(config.BOT_SECONDARY_JID.split('@')[0])) {
        targetSock = secondarySockInstance;
      }
      if (context?.chatId && targetSock) {
        const userStyle = state.userStyles.get(context.sender) || '0';
        targetSock.sendMessage(context.chatId, {
          text: userStyle === 'sarcastic' ? '😴 Wahala dey o! My system spark.' : '⚠️ Bot error occurred.'
        }).catch(e => logger.error(`${logPrefix} Failed sending error notification:`, { message: e.message }));
        targetSock.sendMessage(context.chatId, { sticker: getStickerReaction({ sentiment: 'negative', userStyle }) });
      }
    
      const isBoomError = error instanceof Boom;
      const statusCode = isBoomError ? error.output?.statusCode : null;
      if (config.ADMIN_NUMBER && (!isBoomError || (statusCode && statusCode >= 500))) {
        sendErrorToOwner(error, msg, context);
      }
    }
    
    /**
     * Sends error notifications to bot admins/owner.
     * v2: Fixes TypeError by validating admin numbers.
     * @param {object} context Message context (optional)
     * @param {string} errorMessage Error message to send
     */
    async function sendErrorToOwner(context, errorMessage) {
      const logPrefix = '[ErrorReport v2]';
      logger.debug(`${logPrefix} Attempting to send error: ${errorMessage}`);
    
      // Validate admin numbers
      let adminNumbers = Array.isArray(config.ADMIN_NUMBER) ? config.ADMIN_NUMBER : [];
      if (!adminNumbers.length && config.OWNER_NUMBER) {
        adminNumbers = Array.isArray(config.OWNER_NUMBER) ? config.OWNER_NUMBER : [config.OWNER_NUMBER];
      }
      if (!adminNumbers.length) {
        logger.warn(`${logPrefix} No valid ADMIN_NUMBER or OWNER_NUMBER configured. Logging error to file.`);
        try {
          await fs.appendFile('errors.log', `[${new Date().toISOString()}] ${errorMessage}\n`, 'utf8');
        } catch (e) {
          logger.error(`${logPrefix} Failed to log error to file:`, { message: e.message });
        }
        return;
      }
    
      // Select socket
      const sockets = [sockInstance, secondarySockInstance].filter((sock) => sock?.ws?.readyState === 1);
      if (!sockets.length) {
        logger.warn(`${logPrefix} No open sockets. Logging error to file.`);
        try {
          await fs.appendFile('errors.log', `[${new Date().toISOString()}] ${errorMessage}\n`, 'utf8');
        } catch (e) {
          logger.error(`${logPrefix} Failed to log error to file:`, { message: e.message });
        }
        return;
      }
    
      const userStyle = context ? state.userStyles.get(context.sender) || '0' : '0';
      for (const admin of adminNumbers) {
        const adminJid = sanitizeJid(admin);
        for (const sock of sockets) {
          try {
            await sock.sendMessage(adminJid, {
              text: userStyle === 'sarcastic' ? `😩 Oga, bot don scatter o! Error: ${errorMessage}` : `⚠️ Bot Error: ${errorMessage}`,
            });
            await sock.sendMessage(adminJid, { sticker: getStickerReaction({ sentiment: 'negative', userStyle }) });
            logger.info(`${logPrefix} Error sent to ${adminJid} via ${sock.user?.id}.`);
          } catch (e) {
            logger.error(`${logPrefix} Failed to send error to ${adminJid}:`, { message: e.message });
          }
        }
      }
    }
    
    
    // ================== Admin Verification ================== //
    /**
     * Checks if a user JID is an admin.
     * v2: Supports multiple admins.
     * @param {string} userId User JID.
     * @returns {boolean} True if admin.
     */
    function isAdmin(userId) {
      if (!userId || !config.ADMIN_NUMBER) return false;
      const cleanUserId = sanitizeJid(userId);
      const adminJids = config.ADMIN_NUMBER.map(sanitizeJid);
      return adminJids.includes(cleanUserId);
    }
    
    /**
     * Handles the !title command. Shows the current Role Title and Level.
     * v5: Adds styles, stickers, multi-number.
     * @param {object} context Parsed message context.
     * @param {string[]} args Command arguments.
     */
    async function handleTitleCommand(context, args) {
      const logPrefix = '[Title Cmd v5]';
      const senderJid = context.sender;
      let targetJid = senderJid;
      const isCheckingSelf = !context.mentions?.length;
      const defaultRole = LEVEL_ROLES[0]?.title || 'N/A';
      const userStyle = state.userStyles.get(senderJid) || '0';
    
      // Select Socket
      let targetSock = sockInstance;
      if (config.BOT_SECONDARY_JID && context.chatId.includes(config.BOT_SECONDARY_JID.split('@')[0])) {
        targetSock = secondarySockInstance;
      }
      if (!targetSock) {
        logger.warn(`${logPrefix} No valid socket for ${context.chatId}`);
        await sendReply(context, '⚠️ Bot error.', [], sockInstance);
        return;
      }
    
      if (context.mentions?.length) {
        targetJid = context.mentions[0];
        logger.info(`${logPrefix} ${senderJid} checking title for ${targetJid}`);
      } else {
        logger.info(`${logPrefix} ${senderJid} checking own title`);
      }
    
      if (!supabase) {
        logger.warn(`${logPrefix} Supabase not initialized.`);
        await sendReply(context, userStyle === 'sarcastic' ? '😴 Database don sleep o!' : '⚠️ Database error.', [], targetSock);
        await targetSock.sendMessage(context.chatId, { sticker: getStickerReaction({ sentiment: 'negative', userStyle }) });
        return;
      }
    
      try {
        const { data: targetUserData, error: findError } = await supabase
          .from('users_data')
          .select('level, title')
          .eq('user_id', targetJid)
          .single();
    
        if (findError && findError.code !== 'PGRST116') {
          throw new Error(`Supabase error: ${findError.message}`);
        }
    
        const displayData = targetUserData || {
          level: 0,
          title: getTitleForLevel(0) || defaultRole
        };
        if (!displayData.title) {
          displayData.title = getTitleForLevel(displayData.level) || defaultRole;
        }
    
        const replyText = isCheckingSelf
          ? userStyle === 'sarcastic'
            ? `😎 Your title na *${displayData.title}* (Level ${displayData.level}). You dey try sha!`
            : `✨ Your current title is: *${displayData.title}* (Level ${displayData.level})`
          : userStyle === 'sarcastic'
            ? `😏 @${targetJid.split('@')[0]} title na *${displayData.title}* (Level ${displayData.level}). E fit am?`
            : `✨ @${targetJid.split('@')[0]}'s current title is: *${displayData.title}* (Level ${displayData.level})`;
    
        const mentions = isCheckingSelf ? [] : [targetJid];
        await sendReply(context, replyText.trim(), mentions, targetSock);
        await targetSock.sendMessage(context.chatId, { sticker: getStickerReaction({ sentiment: 'neutral', userStyle }) });
        logger.info(`${logPrefix} Sent title for ${targetJid}: ${displayData.title}, Level: ${displayData.level}`);
      } catch (e) {
        logger.error(`${logPrefix} Failed:`, { message: e.message, stack: e.stack?.substring(0, 500) });
        await sendReply(context, userStyle === 'sarcastic' ? '😴 Title check scatter o!' : '⚠️ Error fetching title.', [], targetSock);
        await targetSock.sendMessage(context.chatId, { sticker: getStickerReaction({ sentiment: 'negative', userStyle }) });
        await sendErrorToOwner(context, `Supabase Error in !title: ${e.message}`);
      }
    }
    
    /**
     * Handles the !theft command. Randomly "accuses" a group member.
     * v2: Adds styles, stickers, multi-number, excludes sender.
     * @param {object} context Parsed message context.
     * @param {string[]} args Command arguments.
     */
    async function handleTheftDetectorCommand(context, args) {
      const logPrefix = '[TheftDetector v2]';
      if (!context.isGroup) {
        await sendReply(context, userStyle === 'sarcastic' ? '😏 You wan accuse who for DM? Join group na!' : '❌ This game is for groups only!', [], sockInstance);
        return;
      }
    
      const senderJid = context.sender;
      const chatId = context.chatId;
      const userStyle = state.userStyles.get(senderJid) || '0';
    
      // Select Socket
      let targetSock = sockInstance;
      if (config.BOT_SECONDARY_JID && chatId.includes(config.BOT_SECONDARY_JID.split('@')[0])) {
        targetSock = secondarySockInstance;
      }
      if (!targetSock) {
        logger.warn(`${logPrefix} No valid socket for ${chatId}`);
        await sendReply(context, '⚠️ Bot error.', [], sockInstance);
        return;
      }
    
      logger.info(`${logPrefix} Activated by ${senderJid} in ${chatId}`);
    
      try {
        const metadata = await targetSock.groupMetadata(chatId);
        if (!metadata?.participants || metadata.participants.length <= 1) {
          await sendReply(context, userStyle === 'sarcastic' ? '😴 Only you dey here? Who I go accuse?' : '🤷‍♀️ Not enough members to accuse!', [], targetSock);
          await targetSock.sendMessage(chatId, { sticker: getStickerReaction({ sentiment: 'negative', userStyle }) });
          return;
        }
    
        const botJid = sanitizeJid(targetSock.user?.id);
        const potentialTargets = metadata.participants
          .map(p => sanitizeJid(p.id))
          .filter(p => p && p !== botJid && p !== senderJid);
    
        if (!potentialTargets.length) {
          await sendReply(context, userStyle === 'sarcastic' ? '😂 Na only you and me dey o! I no fit accuse myself!' : '😂 No one to accuse but me and you!', [], targetSock);
          await targetSock.sendMessage(chatId, { sticker: getStickerReaction({ sentiment: 'negative', userStyle }) });
          return;
        }
    
        const randomTarget = potentialTargets[Math.floor(Math.random() * potentialTargets.length)];
        const targetNum = randomTarget.split('@')[0];
    
        const accusations = [
          `stole the last jollof rice from the pot! 🍚 Confess now!`,
          `don hide the group’s Wi-Fi password! 📡 Return am!`,
          `is why my battery dey die fast! 🔋 Stop your jazz!`,
          `swapped my tea with salt water! ☕ Oya talk true!`,
          `borrowed my earpiece and no return am! 🎧 Thief!`,
          `hoarded all the group’s memes! 🖼️ Share am na!`,
          `ate my emergency suya! 🌮 I dey watch you!`,
          `changed the group name to "TonnaBot Fan Club"! 😎`,
          `left the group chat on read every time! 📱 We see you!`,
          `stole the vibes from the group! 🌟 Bring am back!`
        ];
    
        const randomAccusation = accusations[Math.floor(Math.random() * accusations.length)];
        const replyText = userStyle === 'sarcastic' ? `
    😏 *OLE DETECTED!* 😏
    ────────────────────
    My spiritual radar catch @${targetNum} wey ${randomAccusation}
    ────────────────────
    Oya, confess before we call EFCC! 🤣
    ` : `
    🚨 *THIEF DETECTED!* 🚨
    ────────────────────
    My sensors indicate that @${targetNum} ${randomAccusation}
    ────────────────────
    Confess your sins now! 🤣`;
    
        await targetSock.sendMessage(chatId, {
          text: replyText,
          mentions: [randomTarget]
        }, { quoted: context.msg });
        await targetSock.sendMessage(chatId, { sticker: getStickerReaction({ sentiment: 'neutral', userStyle }) });
        logger.info(`${logPrefix} Accused ${randomTarget} in ${chatId}.`);
      } catch (e) {
        logger.error(`${logPrefix} Failed:`, { message: e.message, stack: e.stack?.substring(0, 500) });
        await sendReply(context, userStyle === 'sarcastic' ? '😴 My detector don spoil o! Everybody free!' : '⚠️ Theft detector malfunctioned!', [], targetSock);
        await targetSock.sendMessage(chatId, { sticker: getStickerReaction({ sentiment: 'negative', userStyle }) });
        await sendErrorToOwner(context, e.message);
        throw e;
      }
    }
    
    // ================== Command Handlers and Bot Logic (Section 17) ================== //
    
    /**
     * Handles the !juju command. Generates funny, fake "secrets" about a mentioned user using AI, pretending to be mystical.
     * v2: Adds styles, stickers, multi-number.
     * @param {object} context Parsed message context
     * @param {string[]} args Command arguments (not used directly, uses mentions)
     */
    async function handleJujuCommand(context, args) {
      const logPrefix = '[Juju Cmd v2]';
      const senderJid = context.sender;
      const userStyle = state.userStyles.get(senderJid) || '0';
    
      // Select Socket
      let targetSock = sockInstance;
      if (config.BOT_SECONDARY_JID && context.chatId.includes(config.BOT_SECONDARY_JID.split('@')[0])) {
        targetSock = secondarySockInstance;
      }
      if (!targetSock) {
        logger.warn(`${logPrefix} No valid socket for ${context.chatId}`);
        await sendReply(context, '⚠️ Bot error.', [], sockInstance);
        return;
      }
    
      // Check if a user was mentioned
      const targetJid = context.mentions?.[0];
      if (!targetJid) {
        await sendReply(context, userStyle === 'sarcastic' ? `😏 Who you wan check their spiritual Wi-Fi? Tag @user!` : `❓ Who you wan check their spiritual bluetooth? Use: ${config.COMMAND_PREFIX}juju @user`, [], targetSock);
        await targetSock.sendMessage(context.chatId, { sticker: getStickerReaction({ sentiment: 'negative', userStyle }) });
        return;
      }
    
      // Prevent targeting self or bot
      if (targetJid === senderJid) {
        await sendReply(context, userStyle === 'sarcastic' ? `😂 You wan juju yourself? Go check mirror o!` : `😂 You wan check yourself? Abeg, use mirror!`, [], targetSock);
        await targetSock.sendMessage(context.chatId, { sticker: getStickerReaction({ sentiment: 'negative', userStyle }) });
        return;
      }
      if (targetJid === sanitizeJid(config.BOT_PRIMARY_JID) || (config.BOT_SECONDARY_JID && targetJid === sanitizeJid(config.BOT_SECONDARY_JID))) {
        await sendReply(context, userStyle === 'sarcastic' ? `😎 My secrets na top secret o! No juju fit catch me!` : `🔮 My own secrets are classified!`, [], targetSock);
        await targetSock.sendMessage(context.chatId, { sticker: getStickerReaction({ sentiment: 'negative', userStyle }) });
        return;
      }
    
      const targetNum = targetJid.split('@')[0];
      logger.info(`${logPrefix} Mystic revelation requested by ${senderJid} for ${targetJid}`);
      await sendReply(context, userStyle === 'sarcastic' ? `😏 Connecting to ancestral server for @${targetNum}... Hold am!` : `✨ Consulting the digital ancestors about @${targetNum}... Please wait... 🔮`, [targetJid], targetSock);
    
      // Prepare Prompt for AI
      const jujuPrompt = `You are ${config.BOT_NAME}, in Juju Mode, acting like a funny, slightly incompetent village mystic on WhatsApp. A user wants you to reveal secrets about User @${targetNum}. Generate 2-3 SHORT, FUNNY, and ABSOLUTELY FAKE 'secrets' or 'revelations' about them. Make them absurd and harmless, suitable for Nigerian group chat banter. Do NOT reveal any real or sensitive info. Examples: "The spirits whisper @${targetNum} secretly enjoys fufu but tells friends it's Amala", "My spiritual network shows @${targetNum} last cried because onion price high", "I see vision... @${targetNum} favourite pyjamas get cartoon character", "Ancestor revealed @${targetNum} true calling na to sell popcorn for traffic". Mention the user with @${targetNum}. Output *only* the funny revelations.`;
    
      try {
        const result = await aiModel.generateContent(jujuPrompt);
        const response = result.response;
    
        // Validate response
        if (!response?.candidates?.[0]?.content?.parts?.[0]?.text) {
          throw new Error(`Invalid response. Finish Reason: ${response.candidates?.[0]?.finishReason || 'UNKNOWN'}`);
        }
        if (response.promptFeedback?.blockReason) {
          throw new Error(`Blocked: ${response.promptFeedback.blockReason}`);
        }
    
        const jujuText = response.text().trim();
        if (!jujuText) throw new Error('Empty AI response.');
    
        logger.info(`${logPrefix} Sending fake secrets about ${targetNum}.`);
        const replyText = userStyle === 'sarcastic' ? `😎 *Juju Mode Gist for @${targetNum}* 😎\n────────────────────\n${jujuText}\n────────────────────\n_(Na play we dey play o!)_` : `*🔮 Juju Mode Revelation for @${targetNum} 🔮*\n────────────────────\n${jujuText}\n────────────────────\n_(Disclaimer: Don't take it serious o! Na just play!)_`;
    
        await targetSock.sendMessage(context.chatId, { text: replyText, mentions: [targetJid] }, { quoted: context.msg });
        await targetSock.sendMessage(context.chatId, { sticker: getStickerReaction({ sentiment: 'neutral', userStyle }) });
      } catch (error) {
        logger.error(`${logPrefix} Failed for ${targetJid}:`, { message: error.message, stack: error.stack?.substring(0, 500) });
        let errorMsg = userStyle === 'sarcastic' ? `😴 Juju don backfire o! Try again.` : `⚠️ Error during Juju revelation.`;
        if (error.message.includes('Blocked')) errorMsg = userStyle === 'sarcastic' ? `😏 Spirits dey vex! AI block am: ${error.message.split(': ')[1]}` : `⚠️ Spirits dey vex! AI refused request: ${error.message.split(': ')[1]}`;
        else if (error.message.includes('Empty')) errorMsg = userStyle === 'sarcastic' ? `😅 Ancestors dey sleep... No gist come out!` : `😅 Ancestors network slow... couldn't get any gist.`;
        await sendReply(context, errorMsg, [], targetSock);
        await targetSock.sendMessage(context.chatId, { sticker: getStickerReaction({ sentiment: 'negative', userStyle }) });
        await sendErrorToOwner(context, error.message);
      }
    }
    
    /**
     * Handles the !dna command. Generates a funny, fake DNA comparison for two mentioned users using AI.
     * v2: Adds styles, stickers, multi-number.
     * @param {object} context Parsed message context
     * @param {string[]} args Command arguments (not used directly, uses mentions)
     */
    async function handleDnaTestCommand(context, args) {
      const logPrefix = '[DnaTest Cmd v2]';
      const senderJid = context.sender;
      const userStyle = state.userStyles.get(senderJid) || '0';
    
      // Select Socket
      let targetSock = sockInstance;
      if (config.BOT_SECONDARY_JID && context.chatId.includes(config.BOT_SECONDARY_JID.split('@')[0])) {
        targetSock = secondarySockInstance;
      }
      if (!targetSock) {
        logger.warn(`${logPrefix} No valid socket for ${context.chatId}`);
        await sendReply(context, '⚠️ Bot error.', [], sockInstance);
        return;
      }
    
      // Ensure command is used in a group
      if (!context.isGroup) {
        await sendReply(context, userStyle === 'sarcastic' ? `😏 You wan do DNA test for DM? Join group na!` : `❌ This command is for group fun only!`, [], targetSock);
        await targetSock.sendMessage(context.chatId, { sticker: getStickerReaction({ sentiment: 'negative', userStyle }) });
        return;
      }
    
      // Check for exactly two mentions
      const mentions = context.mentions || [];
      if (mentions.length !== 2) {
        await sendReply(context, userStyle === 'sarcastic' ? `😏 Tag two people sharp-sharp! Use ${config.COMMAND_PREFIX}dna @User1 @User2` : `❓ Usage: ${config.COMMAND_PREFIX}dna @User1 @User2`, [], targetSock);
        await targetSock.sendMessage(context.chatId, { sticker: getStickerReaction({ sentiment: 'negative', userStyle }) });
        return;
      }
    
      const targetJid1 = mentions[0];
      const targetJid2 = mentions[1];
      const targetNum1 = targetJid1.split('@')[0];
      const targetNum2 = targetJid2.split('@')[0];
    
      logger.info(`${logPrefix} Requested by ${senderJid} for ${targetJid1} and ${targetJid2}`);
      await sendReply(context, userStyle === 'sarcastic' ? `😎 Cooking DNA results for @${targetNum1} and @${targetNum2}... E go shock you!` : `🧬 Analyzing genetic markers for @${targetNum1} and @${targetNum2}... Stand by for highly scientific results... 🔬`, [targetJid1, targetJid2], targetSock);
    
      // Prepare Prompt for AI
      const dnaPrompt = `You are ${config.BOT_NAME} running a fake DNA testing lab for fun in a Nigerian WhatsApp group. Generate a short, funny, absurd, and obviously FAKE DNA compatibility or relationship result between User @${targetNum1} and User @${targetNum2}. Do NOT sound like a real lab. Make it humorous banter. Examples: "99% chance of borrowing charger and not returning", "Shared ancestor discovered: Famous Agege Bread baker", "85% likely to argue about Premier League", "Compatibility level: Can manage small Egusi soup together". Mention both users using @${targetNum1} and @${targetNum2}. Output *only* the funny result/report.`;
    
      try {
        const result = await aiModel.generateContent(dnaPrompt);
        const response = result.response;
    
        // Validate response
        if (!response?.candidates?.[0]?.content?.parts?.[0]?.text) {
          throw new Error(`Invalid response. Finish Reason: ${response.candidates?.[0]?.finishReason || 'UNKNOWN'}`);
        }
        if (response.promptFeedback?.blockReason) {
          throw new Error(`Blocked: ${response.promptFeedback.blockReason}`);
        }
    
        const dnaResultText = response.text().trim();
        if (!dnaResultText) throw new Error('Empty AI response.');
    
        const replyText = userStyle === 'sarcastic' ? `😎 *DNA Test Gist* 😎\n────────────────────\n*Ogas:* @${targetNum1} & @${targetNum2}\n\n*Result:* ${dnaResultText}\n\n────────────────────\n_(Na play we dey play o!)_` : `*🧪 DNA Test Results 🧪*\n────────────────────\n*Subjects:* @${targetNum1} & @${targetNum2}\n\n*Finding:* ${dnaResultText}\n\n────────────────────\n_(Disclaimer: Results are 100% fake & for entertainment purposes only!)_`;
    
        await targetSock.sendMessage(context.chatId, { text: replyText, mentions: [targetJid1, targetJid2] }, { quoted: context.msg });
        await targetSock.sendMessage(context.chatId, { sticker: getStickerReaction({ sentiment: 'neutral', userStyle }) });
        logger.info(`${logPrefix} Sent fake DNA results for ${targetNum1} and ${targetNum2}.`);
      } catch (error) {
        logger.error(`${logPrefix} Failed for ${targetNum1}, ${targetNum2}:`, { message: error.message, stack: error.stack?.substring(0, 500) });
        let errorMsg = userStyle === 'sarcastic' ? `😴 DNA lab don crash o! Try again.` : `⚠️ Error during DNA test.`;
        if (error.message.includes('Blocked')) errorMsg = userStyle === 'sarcastic' ? `😏 AI no gree run this test: ${error.message.split(': ')[1]}` : `⚠️ AI refused to process this DNA request: ${error.message.split(': ')[1]}`;
        else if (error.message.includes('Empty')) errorMsg = userStyle === 'sarcastic' ? `😅 AI brain don freeze... No DNA gist!` : `😅 AI brain freeze... couldn't generate a DNA result.`;
        await sendReply(context, errorMsg, [], targetSock);
        await targetSock.sendMessage(context.chatId, { sticker: getStickerReaction({ sentiment: 'negative', userStyle }) });
        await sendErrorToOwner(context, error.message);
      }
    }
    
    /**
     * Handles the !rewards command. Lists the available role titles and the minimum level required to achieve them, based on LEVEL_ROLES.
     * v2: Adds styles, stickers, multi-number.
     * @param {object} context Parsed message context
     * @param {string[]} args Command arguments (not used)
     */
    async function handleRewardsCommand(context, args) {
      const logPrefix = '[Rewards Cmd v2]';
      const senderJid = context.sender;
      const userStyle = state.userStyles.get(senderJid) || '0';
    
      // Select Socket
      let targetSock = sockInstance;
      if (config.BOT_SECONDARY_JID && context.chatId.includes(config.BOT_SECONDARY_JID.split('@')[0])) {
        targetSock = secondarySockInstance;
      }
      if (!targetSock) {
        logger.warn(`${logPrefix} No valid socket for ${context.chatId}`);
        await sendReply(context, '⚠️ Bot error.', [], sockInstance);
        return;
      }
    
      logger.info(`${logPrefix} Listing roles and levels for ${senderJid}`);
    
      // Validate LEVEL_ROLES
      if (typeof LEVEL_ROLES === 'undefined' || !Array.isArray(LEVEL_ROLES) || LEVEL_ROLES.length === 0) {
        logger.error(`${logPrefix} LEVEL_ROLES is undefined, not an array, or empty.`);
        await sendReply(context, userStyle === 'sarcastic' ? `😏 Oga, my reward book don lost o! Talk to admin.` : `⚠️ The list of level rewards (roles) is not configured correctly.`, [], targetSock);
        await targetSock.sendMessage(context.chatId, { sticker: getStickerReaction({ sentiment: 'negative', userStyle }) });
        return;
      }
    
      let replyText = userStyle === 'sarcastic' ? `😎 *Reward Levels and Titles* 😎\n` : `🏆 *Level Rewards & Titles* 🏆\n`;
      replyText += `────────────────────\n`;
      replyText += userStyle === 'sarcastic' ? `Reach these levels to collect better titles:\n\n` : `Reach these levels to unlock titles:\n\n`;
    
      LEVEL_ROLES.forEach((role) => {
        replyText += ` • *Level ${role.level}* → ${role.title}\n`;
      });
    
      replyText += `────────────────────\n`;
      replyText += userStyle === 'sarcastic' ? `Chat well to flex new titles! 😏` : `Keep chatting to climb the ranks!`;
    
      await sendReply(context, replyText.trim(), [], targetSock);
      await targetSock.sendMessage(context.chatId, { sticker: getStickerReaction({ sentiment: 'neutral', userStyle }) });
    }
    
    /**
     * Handles the !vibecheck command. Replies with a random, persona-based assessment of the sender's or a mentioned user's vibe.
     * v2: Adds styles, stickers, multi-number.
     * @param {object} context Parsed message context
     * @param {string[]} args Command arguments (used to check for mentions)
     */
    async function handleVibeCheckCommand(context, args) {
      const logPrefix = '[VibeCheck Cmd v2]';
      const senderJid = context.sender;
      const userStyle = state.userStyles.get(senderJid) || '0';
    
      // Select Socket
      let targetSock = sockInstance;
      if (config.BOT_SECONDARY_JID && context.chatId.includes(config.BOT_SECONDARY_JID.split('@')[0])) {
        targetSock = secondarySockInstance;
      }
      if (!targetSock) {
        logger.warn(`${logPrefix} No valid socket for ${context.chatId}`);
        await sendReply(context, '⚠️ Bot error.', [], sockInstance);
        return;
      }
    
      let targetJid = senderJid;
      let targetDescriptor = userStyle === 'sarcastic' ? 'Your vibe' : 'Your';
    
      // Check if another user was mentioned
      if (context.mentions?.length > 0) {
        targetJid = context.mentions[0];
        targetDescriptor = userStyle === 'sarcastic' ? `@${targetJid.split('@')[0]} vibe` : `@${targetJid.split('@')[0]}'s`;
        logger.info(`${logPrefix} ${senderJid} requested vibe check for ${targetJid}`);
      } else {
        logger.info(`${logPrefix} ${senderJid} requested own vibe check.`);
      }
    
      // List of Possible Vibe Check Responses
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
        `na wa for this ${targetDescriptor.toLowerCase()} o... E be like small network issue dey. Reset and try again? 📶`,
        `current vibe status for ${targetDescriptor.toLowerCase()}: *Operational*. Nothing spoil, nothing lost. ✅`,
      ];
    
      const randomResult = vibeResults[Math.floor(Math.random() * vibeResults.length)];
      const replyText = userStyle === 'sarcastic' ? `😎 *Vibe Analyzer Gist* 😎\n` : ` T O N N A B O T   V I B E   A N A L Y Z E R\n`;
      replyText += `=============================================\n\n`;
      replyText += ` Target        : ${targetDescriptor}\n`;
      replyText += ` Status        : Analyzing...\n`;
      replyText += ` Result        : ${randomResult}\n\n`;
      replyText += `=============================================\n`;
    
      const mentions = targetJid !== senderJid ? [targetJid] : [];
      await sendReply(context, replyText, mentions, targetSock);
      await targetSock.sendMessage(context.chatId, { sticker: getStickerReaction({ sentiment: 'neutral', userStyle }) });
    }
    
    // ================== Session Backup ================== //
    /**
     * Creates a zip backup of the session directory.
     * v2: Adds multi-number support, optimized for phone.
     */
    async function backupSession() {
      const logPrefix = '[Backup v2]';
      try {
        await fs.access(SESSION_DIR);
      } catch (e) {
        logger.warn(`${logPrefix} Session directory ${SESSION_DIR} not found or inaccessible. Skipping backup.`);
        return;
      }
    
      logger.info(`${logPrefix} Attempting session backup from ${SESSION_DIR} to ${SESSION_BACKUP_ZIP}...`);
      try {
        const zip = new AdmZip();
        zip.addLocalFolder(SESSION_DIR);
        if (typeof zip.writeZipPromise === 'function') {
          await zip.writeZipPromise(SESSION_BACKUP_ZIP);
        } else {
          zip.writeZip(SESSION_BACKUP_ZIP);
        }
        logger.info(`${logPrefix} Session backup created: ${SESSION_BACKUP_ZIP}`);
    
        // Backup secondary session if exists
        if (config.BOT_SECONDARY_JID && SECONDARY_SESSION_DIR) {
          logger.info(`${logPrefix} Attempting secondary session backup from ${SECONDARY_SESSION_DIR}...`);
          const secondaryZip = new AdmZip();
          secondaryZip.addLocalFolder(SECONDARY_SESSION_DIR);
          if (typeof secondaryZip.writeZipPromise === 'function') {
            await secondaryZip.writeZipPromise(SECONDARY_SESSION_BACKUP_ZIP);
          } else {
            secondaryZip.writeZip(SECONDARY_SESSION_BACKUP_ZIP);
          }
          logger.info(`${logPrefix} Secondary session backup created: ${SECONDARY_SESSION_BACKUP_ZIP}`);
        }
      } catch (error) {
        logger.error(`${logPrefix} Session backup failed:`, { message: error.message, stack: error.stack?.substring(0, 500) });
        await sendErrorToOwner(null, `Backup failed: ${error.message}`);
      }
    }
    
    // ================== View Once Cleanup ================== //
    /**
     * Periodically cleans up expired view-once media from the store.
     * v2: Enhanced logging, multi-user scalability.
     */
    const viewOnceCleanupTimer = setInterval(() => {
      const logPrefix = '[ViewOnce Cleanup v2]';
      const now = Date.now();
      let deletedCount = 0;
      logger.debug(`${logPrefix} Running cleanup task. Store size: ${viewOnceStore.size}`);
      viewOnceStore.forEach((value, key) => {
        if (value.timestamp && now - value.timestamp > VIEW_ONCE_EXPIRATION_MS) {
          logger.debug(`${logPrefix} Deleting expired entry for ${key}. Age: ${(now - value.timestamp) / 1000}s`);
          viewOnceStore.delete(key);
          deletedCount++;
        }
      });
      if (deletedCount > 0) {
        logger.info(`${logPrefix} Removed ${deletedCount} expired view-once media entries.`);
      }
    }, VIEW_ONCE_CLEANUP_INTERVAL_MS);
    logger.info(`View-once cleanup task scheduled every ${VIEW_ONCE_CLEANUP_INTERVAL_MS / 60000} minutes.`);
    
    // ================== Data Persistence Helpers v2 ================== //
    /**
     * Loads user data (levels & keyword counts) from LEVELS_FILE or Supabase.
     * v4: Creates levels.json if missing, Termux path validation.
     */
    async function loadLevelData() {
      const logPrefix = '[UserData v4]';
      if (supabase && config.USE_SUPABASE !== 'false') {
        logger.info(`${logPrefix} Loading from Supabase...`);
        try {
          const { data, error } = await supabase.from('users').select('userId, levelData, keywordCounts');
          if (error) throw error;
          state.levelData = {};
          state.keywordCounts = {};
          data.forEach((user) => {
            state.levelData[user.userId] = user.levelData || {};
            state.keywordCounts[user.userId] = user.keywordCounts || {};
          });
          logger.info(`${logPrefix} Loaded ${data.length} users from Supabase.`);
        } catch (error) {
          logger.error(`${logPrefix} Failed to load from Supabase:`, {
            message: error.message,
            code: error.code || 'N/A',
            stack: error.stack?.substring(0, 500),
          });
          state.levelData = {};
          state.keywordCounts = {};
        }
      } else {
        logger.info(`${logPrefix} Loading from ${LEVELS_FILE}... CWD: ${process.cwd()}`);
        try {
          await fs.access(LEVELS_FILE);
          const data = await fs.readFile(LEVELS_FILE, 'utf8');
          const loadedState = JSON.parse(data);
          state.levelData = loadedState.levelData || {};
          state.keywordCounts = loadedState.keywordCounts || {};
          logger.info(`${logPrefix} Loaded user data from ${LEVELS_FILE}. Users: ${Object.keys(state.levelData).length}`);
        } catch (error) {
          if (error.code === 'ENOENT') {
            logger.warn(`${logPrefix} ${LEVELS_FILE} not found. Creating empty file...`);
            try {
              await fs.mkdir(path.dirname(LEVELS_FILE), { recursive: true });
              await fs.writeFile(LEVELS_FILE, JSON.stringify({ levelData: {}, keywordCounts: {} }, null, 2), 'utf8');
              state.levelData = {};
              state.keywordCounts = {};
              logger.info(`${logPrefix} Created empty ${LEVELS_FILE}.`);
            } catch (createError) {
              logger.error(`${logPrefix} Failed to create ${LEVELS_FILE}:`, {
                message: createError.message,
                stack: createError.stack?.substring(0, 500),
              });
              state.levelData = {};
              state.keywordCounts = {};
            }
          } else {
            logger.error(`${logPrefix} Failed to load ${LEVELS_FILE}:`, {
              message: error.message,
              stack: error.stack?.substring(0, 500),
            });
            state.levelData = {};
            state.keywordCounts = {};
          }
        }
      }
    } 
    
    
    /**
     * Saves user data (levels & keyword counts) to LEVELS_FILE or Supabase.
     * v4: Ensures directory for levels.json, Termux optimization.
     */
    async function saveLevelData() {
      const logPrefix = '[UserData v4]';
      const hasLevelData = state.levelData && Object.keys(state.levelData).length > 0;
      const hasKeywordData = state.keywordCounts && Object.keys(state.keywordCounts).length > 0;
    
      if (!hasLevelData && !hasKeywordData) {
        logger.debug(`${logPrefix} No user data to save.`);
        return;
      }
    
      if (supabase && config.USE_SUPABASE !== 'false') {
        logger.info(`${logPrefix} Saving to Supabase... Users: ${Object.keys(state.levelData).length}`);
        try {
          const users = Object.keys(state.levelData).map((userId) => ({
            userId,
            levelData: state.levelData[userId],
            keywordCounts: state.keywordCounts[userId] || {},
          }));
          const { error } = await supabase.from('users').upsert(users, { onConflict: 'userId' });
          if (error) throw error;
          logger.info(`${logPrefix} Saved to Supabase successfully.`);
        } catch (error) {
          logger.error(`${logPrefix} Failed to save to Supabase:`, {
            message: error.message,
            code: error.code || 'N/A',
            stack: error.stack?.substring(0, 500),
          });
        }
      } else {
        logger.info(`${logPrefix} Saving to ${LEVELS_FILE}... Users: ${Object.keys(state.levelData).length}`);
        try {
          await fs.mkdir(path.dirname(LEVELS_FILE), { recursive: true });
          const dataToSave = { levelData: state.levelData || {}, keywordCounts: state.keywordCounts || {} };
          await fs.writeFile(LEVELS_FILE, JSON.stringify(dataToSave, null, 2), 'utf8');
          logger.info(`${logPrefix} Saved to ${LEVELS_FILE} successfully.`);
        } catch (error) {
          logger.error(`${logPrefix} Failed to save to ${LEVELS_FILE}:`, {
            message: error.message,
            stack: error.stack?.substring(0, 500),
          });
          await sendErrorToOwner(null, `Failed to save user data to ${LEVELS_FILE}: ${error.message}`);
        }
      }
    } 
    
    
    /**
     * Main function to start the bot.
     * v10: Robust Supabase fallback, delayed exit, Termux optimization.
     */
    async function startBot() {
      const logPrefix = '[StartBot v10]';
      try {
        logger.info(`${logPrefix} Initiating ${config.BOT_NAME} startup...`);
    
        // Config Validation
        if (!config.GEMINI_API_KEY || !config.OWNER_NUMBER || !config.BOT_PRIMARY_JID) {
          logger.fatal(`${logPrefix} FATAL: Missing critical config (GEMINI_API_KEY, OWNER_NUMBER, BOT_PRIMARY_JID). Check .env.`);
          process.exit(1);
        }
        logger.info(`${logPrefix} Config validated.`);
    
        // TEMPORARILY DISABLED Log Directory Check
        logger.info(`${logPrefix} SKIPPING LOG_DIR check/creation...`);
        /*
        try {
          await fs.mkdir(LOG_DIR, { recursive: true });
          logger.info(`${logPrefix} Logging directory ensured at: ${LOG_DIR}`);
        } catch (mkdirError) {
          logger.error(`${logPrefix} CRITICAL: Failed to create LOG_DIR (${LOG_DIR}):`, { message: mkdirError.message, stack: mkdirError.stack?.substring(0, 500) });
          process.exit(1);
        }
        */
    
        // Debug Dependencies
        logger.debug(`${logPrefix} Node-fetch available: ${typeof fetch}`);
        logger.debug(`${logPrefix} Supabase createClient available: ${typeof createClient}`);
        logger.debug(`${logPrefix} SUPABASE_URL: ${config.SUPABASE_URL}`);
    
        // Initialize Supabase
        logger.info(`${logPrefix} Initializing Supabase client...`);
        const supabaseInitialized = await connectSupabaseDB();
        if (!supabaseInitialized) {
          logger.warn(`${logPrefix} Supabase failed. Using file-based persistence.`);
        }
    
        // Load User Data
        logger.info(`${logPrefix} Loading user data...`);
        await loadLevelData();
    
        // Start Health Check Server
        logger.info(`${logPrefix} Starting health check server...`);
        startHealthCheckServer();
    
        // Initialize Baileys Connections
        logger.info(`${logPrefix} Initializing primary WhatsApp connection...`);
        await initializeConnection();
        if (config.BOT_SECONDARY_JID) {
          logger.info(`${logPrefix} Initializing secondary WhatsApp connection...`);
          await initializeSecondaryConnection();
        }
    
        // Setup Periodic Tasks
        if (REPORT_INTERVAL_MS > 0) {
          setInterval(backupSession, REPORT_INTERVAL_MS);
          logger.info(`${logPrefix} Session backup scheduled every ${REPORT_INTERVAL_MS / 60000} minutes.`);
        }
    
        // Signal Handlers
        process.on('SIGINT', () => gracefulShutdown(false, 'SIGINT'));
        process.on('SIGTERM', () => gracefulShutdown(false, 'SIGTERM'));
        process.on('uncaughtException', (err) => {
          logger.error(`${logPrefix} Uncaught Exception:`, { message: err.message, stack: err.stack?.substring(0, 500) });
          gracefulShutdown(true, 'Uncaught Exception');
        });
        process.on('unhandledRejection', (reason) => {
          logger.error(`${logPrefix} Unhandled Rejection:`, { message: reason?.message || reason, stack: reason?.stack?.substring(0, 500) });
          gracefulShutdown(true, 'Unhandled Rejection');
        });
    
        // Notify Admins
        const adminNumbers = Array.isArray(config.ADMIN_NUMBER) ? config.ADMIN_NUMBER : [config.OWNER_NUMBER];
        for (const admin of adminNumbers) {
          const adminJid = sanitizeJid(admin);
          const userStyle = state.userStyles.get(adminJid) || '0';
          const sockets = [sockInstance, secondarySockInstance].filter((sock) => sock?.ws?.readyState === 1);
          for (const sock of sockets) {
            try {
              await sock.sendMessage(adminJid, {
                text: userStyle === 'sarcastic' ? `😎 ${config.BOT_NAME} don land! Ready to cause wahala!` : `✅ ${config.BOT_NAME} online!`,
              });
              await sock.sendMessage(adminJid, { sticker: getStickerReaction({ sentiment: 'neutral', userStyle }) });
              logger.info(`${logPrefix} Startup notification sent to ${adminJid} via ${sock.user?.id}.`);
            } catch (e) {
              logger.warn(`${logPrefix} Failed to send startup notification to ${adminJid}:`, { message: e.message });
            }
          }
        }
    
        logger.info(`${logPrefix} ${config.BOT_NAME} fully initialized.`);
      } catch (error) {
        logger.fatal(`${logPrefix} CRITICAL: Startup failed:`, {
          message: error.message || 'Unknown error',
          stack: error.stack?.substring(0, 500) || 'No stack trace',
        });
        await sendErrorToOwner(null, `Startup failed: ${error.message || 'Unknown error'}`).catch((e) =>
          logger.error(`${logPrefix} Failed to send startup error:`, { message: e.message })
        );
        setTimeout(() => process.exit(1), 2000); // Increased delay for log flushing
      }
    } 
    
    
    
    /**
     * Handles graceful shutdown of the bot.
     * v4: Optimized for Supabase, multi-number.
     * @param {boolean} [isCrash=false] Indicates if shutdown is due to a crash.
     * @param {string} [signal='Unknown'] The signal or reason for shutdown.
     */
    async function gracefulShutdown(isCrash = false, signal = 'Unknown') {
      const logPrefix = '[Shutdown v4]';
      logger.warn(`${logPrefix} Initiating shutdown (Reason: ${signal}, Crash: ${isCrash})...`);
    
      // Notify Admins
      const adminNumbers = Array.isArray(config.ADMIN_NUMBER) ? config.ADMIN_NUMBER : [config.OWNER_NUMBER];
      for (const admin of adminNumbers) {
        const adminJid = sanitizeJid(admin);
        const userStyle = state.userStyles.get(adminJid) || '0';
        const sockets = [sockInstance, secondarySockInstance].filter((sock) => sock?.ws?.readyState === 1);
        for (const sock of sockets) {
          try {
            await sock.sendMessage(adminJid, {
              text: userStyle === 'sarcastic' ? `😴 ${config.BOT_NAME} dey japa o! Reason: ${signal}.` : `🤖 ${config.BOT_NAME} shutting down (Reason: ${signal}).`,
            });
            await sock.sendMessage(adminJid, { sticker: getStickerReaction({ sentiment: isCrash ? 'negative' : 'neutral', userStyle }) });
            logger.info(`${logPrefix} Shutdown notification sent to ${adminJid}.`);
          } catch (e) {
            logger.error(`${logPrefix} Failed to send shutdown notification to ${adminJid}:`, { message: e.message });
          }
        }
      }
    
      // Save Data
      await saveLevelData();
    
      // Supabase Handling
      logger.info(`${logPrefix} Supabase client manages connections per request. No explicit close needed.`);
    
      // Session Backup
      await backupSession();
    
      // Close Sockets
      const sockets = [
        { instance: sockInstance, name: 'Primary' },
        { instance: secondarySockInstance, name: 'Secondary' },
      ].filter((sock) => sock.instance);
      for (const { instance, name } of sockets) {
        logger.info(`${logPrefix} Closing ${name} socket...`);
        try {
          await instance.sendPresenceUpdate('unavailable');
          instance.ws?.close();
        } catch (e) {
          logger.error(`${logPrefix} Failed to close ${name} socket:`, { message: e.message });
        }
      }
      sockInstance = null;
      secondarySockInstance = null;
    
      // Clear Timers
      clearInterval(viewOnceCleanupTimer);
      logger.info(`${logPrefix} Cleared view-once cleanup timer.`);
    
      logger.info(`${logPrefix} Shutdown complete. Exiting with code ${isCrash ? 1 : 0}.`);
      setTimeout(() => process.exit(isCrash ? 1 : 0), 1500);
    }
    
    /**
     * Starts a simple HTTP server for health checks.
     * v2: Enhanced logging, multi-user scalability.
     */
    function startHealthCheckServer() {
      const logPrefix = '[HealthCheck v2]';
      const port = process.env.PORT || 3000;
      try {
        const server = http.createServer((req, res) => {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(
            JSON.stringify({
              status: 'ok',
              bot: config.BOT_NAME,
              uptimeSeconds: Math.floor(process.uptime()),
              activeSockets: [sockInstance, secondarySockInstance].filter((sock) => sock?.ws?.readyState === 1).length,
              connectedUsers: state.onlineUsers.size,
            })
          );
          logger.debug(`${logPrefix} Health check request received.`);
        });
    
        server.listen(port, () => {
          logger.info(`${logPrefix} Server running on port ${port}.`);
        });
    
        server.on('error', (error) => {
          logger.error(`${logPrefix} Server error:`, { message: error.message, stack: error.stack?.substring(0, 500) });
          if (error.code === 'EADDRINUSE') process.exit(1);
        });
      } catch (e) {
        logger.error(`${logPrefix} Failed to start server:`, { message: e.message, stack: e.stack?.substring(0, 500) });
        process.exit(1);
      }
    }
    
    // ================== Final Initialization ================== //
    startBot(); // Engage!
    
    // ================== End of Section 17 ================== //
