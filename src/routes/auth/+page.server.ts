import { fail } from '@sveltejs/kit';
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import type { Actions } from './$types';
import { env } from '$env/dynamic/private';
import db from '$lib/server/database';
import { hashText } from '$lib/crypto';

export const actions = {
	default: async ({ request, cookies }) => {
        const errors = { name: "", password: "" };
        const data = await request.formData();
        const name = data.get('name');
        const password = data.get('password') as string | null;
        
        if (!name || !name.toString().trim()) {
            errors["name"] = "Ім'я обов'язкове";
        }

        if (!password || !password.toString().trim()) {
            errors["password"] = "Неправильний пароль";
        }

        if (Object.values(errors).some((value) => value)) {
            return fail(400, { errors });
        }

        if (!Object.hasOwn(env, 'SECRET_WORD_HASH')) {
            throw new Error('SECRET_WORD_HASH is required for auth verification');
        } else if (!Object.hasOwn(env, 'SECRET_WORD_SALT')) {
            throw new Error('SECRET_WORD_SALT is required for auth verification');
        }

        const submittedPassword = password?.toString().trim()!;
        const derivedSecret = scryptSync(submittedPassword, env['SECRET_WORD_SALT'], 64);
        const storedSecretBuffer = Buffer.from(env['SECRET_WORD_HASH'], 'hex');

        if (
            storedSecretBuffer.length !== derivedSecret.length ||
            !timingSafeEqual(derivedSecret, storedSecretBuffer)
        ) {
            errors["password"] = "Неправильний пароль";
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

        const chatId = await hashText(submittedPassword);

        cookies.set(chatCookieName, chatId, {
            path: '/',
            httpOnly: true,
            secure: isSecure,
            sameSite: 'strict',
            maxAge: 60 * 60 * 1,
        });

        db.prepare<[string, string, string]>(
            'INSERT INTO connections (id, chat_id, user_name) VALUES (?, ?, ?)'
        ).run(sessionId, chatId, name?.toString()!);

        return { id: chatId };
	}
} satisfies Actions;