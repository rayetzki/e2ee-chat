import type { ViteDevServer } from "vite";
import { WebSocketServer, WebSocket } from "ws";
import type { GetPublicKeyPayload, SendPublicKeyPayload } from "../../../types";

const publicKeyCache = new Map<string, Map<string, SendPublicKeyPayload>>();
const clientChat = new WeakMap<WebSocket, string>();

function getCachedPublicKey(chatId: string, excludeSenderId: string): SendPublicKeyPayload[] {
    const chatMap = publicKeyCache.get(chatId);
    if (!chatMap) return [];
    return Array.from(chatMap.values()).filter((entry) => entry.senderId !== excludeSenderId);
}

function cachePublicKey(payload: SendPublicKeyPayload) {
    let chatMap = publicKeyCache.get(payload.chatId);
    if (!chatMap) {
        chatMap = new Map();
        publicKeyCache.set(payload.chatId, chatMap);
    }
    chatMap.set(payload.senderId, payload);
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

        ws.on('error', (error) => {
            console.error(error);
            ws.close();
        });
    });
}