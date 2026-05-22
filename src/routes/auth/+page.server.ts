import { fail } from '@sveltejs/kit';
import { randomBytes } from 'node:crypto';
import type { Actions } from './$types';
import { env } from '$env/dynamic/private';
import db from '$lib/server/database';

export const actions = {
	default: async ({ request, cookies }) => {
        const errors = { name: "", password: "" };
        const data = await request.formData();
        const name = data.get('name');
        const password = data.get('password') as string | null;
        
        if (!name || !name.toString().trim()) {
            errors["name"] = "Ім'я обов'язкове";
        }

        if (
            !password ||
            !password.toString().trim() ||
            password?.toString().trim() !== env.SECRET_WORD
        ) {
            errors["password"] = "Неправильний пароль";
        }

        if (Object.values(errors).some((value) => value)) {
            return fail(400, { errors });
        }

        const sessionId = randomBytes(32).toString('hex');
        const isSecure = env.NODE_ENV === 'production' || (request.headers.get('x-forwarded-proto') === 'https');
        const sessionCookieName = isSecure ? '__Host-sessionId' : 'sessionId';
        const chatCookieName = isSecure ? '__Host-chatId' : 'chatId';

        cookies.set(sessionCookieName, sessionId, {
            path: '/',
            httpOnly: true,
            secure: isSecure,
            sameSite: 'strict',
            maxAge: 60 * 60 * 1,
        });

        const chatId = randomBytes(16).toString('hex');

        cookies.set(chatCookieName, chatId, {
            path: '/',
            httpOnly: true,
            secure: isSecure,
            sameSite: 'strict',
            maxAge: 60 * 60 * 1,
        });

        db.prepare<[string, string, string]>(
            'INSERT INTO connections (id, chat_id, user_name) VALUES (?, ?, ?)'
        ).run(sessionId, password?.toString()!, name?.toString()!);

        return chatId;
	}
} satisfies Actions;