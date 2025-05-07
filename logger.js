import pino from 'pino';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs/promises';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const logDir = path.join(__dirname, '../logs');

// Create log directory if not exists
await fs.mkdir(logDir, { recursive: true });

const transports = {
    file: {
        target: 'pino/file',
        options: { destination: path.join(logDir, 'combined.log') }
    },
    pretty: {
        target: 'pino-pretty',
        options: { 
            colorize: true,
            translateTime: 'SYS:dd-mm-yy HH:MM:ss',
            ignore: 'pid,hostname'
        }
    }
};

export const logger = pino({
    level: process.env.LOG_LEVEL || 'info',
    transport: {
        targets: [transports.pretty, transports.file]
    }
});

export const messageLogger = pino({
    level: 'info',
    transport: {
        targets: [{
            ...transports.file,
            options: { destination: path.join(logDir, 'messages.log') }
        }]
    }
});
