import db from "$lib/server/database";
import { error, type Actions } from "@sveltejs/kit";
import { env } from '$env/dynamic/private';
import { createHash } from 'node:crypto';
import type { Connection } from "../../../types.js";

export async function load({ cookies, params }) {
    const isSecure = env.NODE_ENV === 'production';
    const sessionCookieName = isSecure ? '__Host-sessionId' : 'sessionId';
    const sessionId = cookies.get(sessionCookieName);

    if (!sessionId) {
        error(404, `Session not found for the chat id: ${params.slug}`);
    }

    const connections = await db.execute(
        'SELECT * FROM connections WHERE chat_id = (SELECT chat_id FROM connections WHERE id = ?)',
        [sessionId],
    );

    if (!connections || connections.rows.length < 1) {
        error(404, `There is no session found for chat id: ${params.slug}`);
    }

    const fromConnection = connections.rows.find((connection) => connection['id'] === sessionId) as unknown as Connection;
    const toConnection = connections.rows.find((connection) => connection['id'] !== sessionId) as unknown as Connection;

    if (!fromConnection) {
        error(404, `You are not connected to the chat`);
    }

    const secret = env['CHAT_SALT_SECRET'] || 'dev-default-salt';
    const saltBase64 = createHash('sha256').update(`${fromConnection.chat_id}|${secret}`).digest('base64');

    return {
        sessionId,
        fromConnection,
        toConnection,
        chatId: fromConnection.chat_id,
        salt: saltBase64,
    };
}

export const actions = {
    logout: async ({ cookies }) => {
        const isSecure = env.NODE_ENV === 'production';
        const sessionCookieName = isSecure ? '__Host-sessionId' : 'sessionId';
        const chatCookieName = isSecure ? '__Host-chatId' : 'chatId';
        const sessionId = cookies.get(sessionCookieName);

        if (sessionId) {
            cookies.delete(sessionCookieName, { path: '/' });
            cookies.delete(chatCookieName, { path: '/' });
            await db.execute('DELETE FROM connections WHERE id = ?', [sessionId!]);
        }
    }
} satisfies Actions;