export type Connection = {
    id: string;
    chat_id: string;
    user_name: string;
    created_at: string;
}

export type Message = {
    id: string;
    senderId: string;
    senderName: string;
    chatId: string;
    message: string;
    status: MessageStatus;
    timestamp: number;
}

export enum MessageStatus {
    Pending,
    Read
}

export type GetPublicKeyPayload = {
    type: 'get-public-key';
    senderId: string;
    senderName: string;
    chatId: string;
    publicKey: string;
    ephemeralPublicKey?: string | undefined;
    timestamp: number;
}

export type SendPublicKeyPayload = {
    type: 'send-public-key';
    senderId: string;
    senderName: string;
    chatId: string;
    publicKey: string;
    ephemeralPublicKey?: string | undefined;
    timestamp: number;
}

export type EncryptedMessagePayload = {
    type: 'message';
    id: string;
    senderId: string;
    senderName: string;
    chatId: string;
    ciphertext: string;
    iv: string;
    status: MessageStatus;
    timestamp: number;
}

export type EncryptedMessage = Omit<EncryptedMessagePayload, 'type'>;

export type NetworkPayload = GetPublicKeyPayload | SendPublicKeyPayload | EncryptedMessagePayload;