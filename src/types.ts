export type Connection = {
    id: string;
    chat_id: string;
    user: string;
    created_at: string;
}

export type Message = {
    sender: string;
    chatId: string;
    message: string;
    status: MessageType;
    timestamp: number;
}

export enum MessageType {
    Pending,
    Read
}