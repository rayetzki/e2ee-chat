export type Connection = {
    id: string;
    chat_id: string;
    user_name: string;
    created_at: string;
}

export type Message = {
    senderId: string;
    senderName: string;
    chatId: string;
    message: string;
    status: MessageType;
    timestamp: number;
}

export enum MessageType {
    Pending,
    Read
}