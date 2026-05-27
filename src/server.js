// @ts-nocheck
import express from "express";
import http from "http";
import { handler } from '../build/handler.js';
import { WebSocketServer, WebSocket } from "ws";

const PUBLIC_KEY_CACHE_TTL = 5 * 60 * 1000; // 5 minutes
const publicKeyCache = new Map();
const clientChat = new WeakMap();
const clientKeyOwner = new WeakMap();

function isPublicKeyExpired(entry) {
    return (Date.now() - entry.cachedAt) > PUBLIC_KEY_CACHE_TTL;
}

function pruneCachedPublicKeys(chatId) {
    const chatMap = publicKeyCache.get(chatId);
    if (!chatMap) return;

    for (const [senderId, entry] of chatMap.entries()) {
        if (isPublicKeyExpired(entry)) {
            chatMap.delete(senderId);
        }
    }

    if (chatMap.size === 0) {
        publicKeyCache.delete(chatId);
    }
}

function getCachedPublicKey(chatId, excludeSenderId) {
    pruneCachedPublicKeys(chatId);

    const chatMap = publicKeyCache.get(chatId);
    if (!chatMap) return [];
    return Array.from(chatMap.values())
        .filter((entry) => entry.senderId !== excludeSenderId)
        .map((entry) => entry);
}

function cachePublicKey(payload) {
    pruneCachedPublicKeys(payload.chatId);

    let chatMap = publicKeyCache.get(payload.chatId);
    if (!chatMap) {
        chatMap = new Map();
        publicKeyCache.set(payload.chatId, chatMap);
    }
    chatMap.set(payload.senderId, { ...payload, cachedAt: Date.now() });
}

function removeCachedPublicKey(chatId, senderId) {
    const chatMap = publicKeyCache.get(chatId);
    if (!chatMap) return;

    chatMap.delete(senderId);
    if (chatMap.size === 0) {
        publicKeyCache.delete(chatId);
    }
}

function broadcastToChat(chatId, message, wss) {
    for (const client of wss.clients) {
        if (
            client.readyState !== WebSocket.OPEN || 
            clientChat.get(client) !== chatId
        ) {
            continue;
        }
        client.send(message);
    }
}

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ noServer: true });

server.on('upgrade', (request, socket, head) => {
    const { pathname } = new URL(request.url, `http://${request.headers.host}`);
    
    if (pathname === '/ws') {
        wss.handleUpgrade(request, socket, head, (ws) => {
            wss.emit('connection', ws, request);
        });
    } else {
        socket.destroy();
    }
});

wss.on('connection', (ws) => {
    ws.on('message', (msg) => {
        const message = typeof msg === 'string' ? msg : msg.toString();

        try {
            const payload = JSON.parse(message);

            if (payload.chatId) {
                clientChat.set(ws, payload.chatId);
            }

            if (payload.type === 'send-public-key' && payload.chatId && payload.senderId) {
                cachePublicKey(payload);
                clientKeyOwner.set(ws, { chatId: payload.chatId, senderId: payload.senderId });
                broadcastToChat(payload.chatId, message, wss);
                return;
            }

            if (payload.type === 'get-public-key' && payload.chatId && payload.senderId) {
                const cached = getCachedPublicKey(payload.chatId, payload.senderId);
                for (const cachedPayload of cached) {
                    if (ws.readyState === WebSocket.OPEN) {
                        ws.send(JSON.stringify(cachedPayload));
                    }
                }
                return;
            }

            if (payload.type === 'message' && payload.chatId) {
                broadcastToChat(payload.chatId, message, wss);
                return;
            }
        } catch (error) {
            console.warn('Failed to parse socket message for public key caching', error);
        }
    });

    ws.on('close', () => {
        const owner = clientKeyOwner.get(ws);
        if (owner) {
            removeCachedPublicKey(owner.chatId, owner.senderId);
        }
    });

    ws.on('error', (error) => {
        console.error(error);
        ws.close();
    });
});

app.use(handler);

const PORT = process.env['PORT'] || 3000;

server.listen(PORT, () => {
    console.log(`Application running on port ${PORT}`);
});