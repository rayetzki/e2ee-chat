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

export type PublicKeyPayload = {
    type: 'public-key';
    senderId: string;
    senderName: string;
    chatId: string;
    publicKey: string;
    timestamp: number;
}

export type EncryptedMessagePayload = {
    type: 'message';
    senderId: string;
    senderName: string;
    chatId: string;
    ciphertext: string;
    iv: string;
    timestamp: number;
}

export type NetworkPayload = PublicKeyPayload | EncryptedMessagePayload;