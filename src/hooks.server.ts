import { fail, redirect } from '@sveltejs/kit';

export async function handle({ event, resolve }) {
  const chatId = event.cookies.get('chatId');
  const protectedRoutes = ['', 'chat'];

  if (!chatId) {
    const currentPathname = event.url.pathname.split('/')[1]!;
    if (protectedRoutes.includes(currentPathname)) {
        throw redirect(303, '/auth');
    }
  } else {
    if (event.url.pathname.startsWith('/chat')) {
        const [_, pageChatId] = event.url.pathname.split('/chat/');
        console.assert(pageChatId === chatId);
        if (pageChatId !== chatId) {
            throw fail(404);
        }
    } else {
        throw redirect(303, `/chat/${chatId}`);
    }
  }

  return resolve(event);
}