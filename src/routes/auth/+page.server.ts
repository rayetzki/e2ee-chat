import { fail, redirect } from '@sveltejs/kit';
import type { Actions } from './$types';

export const actions = {
	default: async ({ request }) => {
        const errors = { name: "", password: "" };
        const data = await request.formData();
        const name = data.get('name');
        const password = data.get('password');
        
        if (!name || !name.toString().trim()) {
            errors["name"] = "Ім'я обов'язкове";
        }

        if (!password || !password.toString().trim()) {
            errors["password"] = "Пароль обов'язковий";
        }

        if (Object.values(errors).some((value) => value)) {
            return fail(400, { errors });
        }

        return { success: true };
	}
} satisfies Actions;