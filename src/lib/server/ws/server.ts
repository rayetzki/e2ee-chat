import type { ViteDevServer } from "vite";
import { WebSocketServer, WebSocket } from "ws";
import type { GetPublicKeyPayload, SendPublicKeyPayload } from "../../../types";

type CachedPublicKeyPayload = SendPublicKeyPayload & { cachedAt: number };

const PUBLIC_KEY_CACHE_TTL = 5 * 60 * 1000; // 5 minutes
const publicKeyCache = new Map<string, Map<string, CachedPublicKeyPayload>>();
const clientChat = new WeakMap<WebSocket, string>();
const clientKeyOwner = new WeakMap<WebSocket, { chatId: string; senderId: string }>();

function isPublicKeyExpired(entry: CachedPublicKeyPayload) {
    return (Date.now() - entry.cachedAt) > PUBLIC_KEY_CACHE_TTL;
}

function pruneCachedPublicKeys(chatId: string) {
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

function getCachedPublicKey(chatId: string, excludeSenderId: string): SendPublicKeyPayload[] {
    pruneCachedPublicKeys(chatId);

    const chatMap = publicKeyCache.get(chatId);
    if (!chatMap) return [];
    return Array.from(chatMap.values())
        .filter((entry) => entry.senderId !== excludeSenderId)
        .map((entry) => entry);
}

function cachePublicKey(payload: SendPublicKeyPayload) {
    pruneCachedPublicKeys(payload.chatId);

    let chatMap = publicKeyCache.get(payload.chatId);
    if (!chatMap) {
        chatMap = new Map();
        publicKeyCache.set(payload.chatId, chatMap);
    }
    chatMap.set(payload.senderId, { ...payload, cachedAt: Date.now() });
}

function removeCachedPublicKey(chatId: string, senderId: string) {
    const chatMap = publicKeyCache.get(chatId);
    if (!chatMap) return;

    chatMap.delete(senderId);
    if (chatMap.size === 0) {
        publicKeyCache.delete(chatId);
    }
}

function broadcastToChat(chatId: string, message: string, wss: WebSocketServer) {
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

export default function(server: ViteDevServer) {
    const wss = new WebSocketServer({ noServer: true });

    server.httpServer?.on('upgrade', (request, socket, head) => {
        wss.handleUpgrade(request, socket, head, (ws) => {
            wss.emit('connection', ws, request);
        });
    });
    
    wss.on('connection', (ws) => {
        ws.on('message', (msg) => {
            const message = typeof msg === 'string' ? msg : msg.toString();

            try {
                const parsed = JSON.parse(message) as { type?: string; chatId?: string; senderId?: string };

                if (parsed.chatId) {
                    clientChat.set(ws, parsed.chatId);
                }

                if (parsed.type === 'send-public-key' && parsed.chatId && parsed.senderId) {
                    const payload = parsed as SendPublicKeyPayload;
                    cachePublicKey(payload);
                    clientKeyOwner.set(ws, { chatId: payload.chatId, senderId: payload.senderId });
                    broadcastToChat(payload.chatId, message, wss);
                    return;
                }

                if (parsed.type === 'get-public-key' && parsed.chatId && parsed.senderId) {
                    const payload = parsed as GetPublicKeyPayload;
                    const cached = getCachedPublicKey(payload.chatId, payload.senderId);
                    for (const cachedPayload of cached) {
                        if (ws.readyState === WebSocket.OPEN) {
                            ws.send(JSON.stringify(cachedPayload));
                        }
                    }
                    return;
                }

                if (parsed.type === 'message' && parsed.chatId) {
                    broadcastToChat(parsed.chatId, message, wss);
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
}