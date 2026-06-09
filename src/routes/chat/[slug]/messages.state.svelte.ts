import { decryptText, encryptText } from "$lib/crypto";
import {
  loadMessages,
  saveMessage,
  updateMessageStatus,
} from "$lib/message-storage";
import type { EncryptedMessage, Message, MessageStatus } from "../../../types";

export class MessageManager {
  messages = $state<Message[]>([]);

  async decryptSaveMessage(
    payload: EncryptedMessage,
    messageKey: CryptoKey | null,
  ) {
    if (!messageKey) {
      console.warn("Encrypted message received before key exchange.");
      return;
    }

    await saveMessage(payload);

    let messageText = "";
    try {
      messageText = await decryptText(
        messageKey,
        payload.ciphertext,
        payload.iv,
      );
    } catch (err) {
      console.warn("Failed to decrypt incoming message", payload.id, err);
      messageText = "[Unable to decrypt]";
    }

    this.messages.push({
      id: payload.id,
      senderId: payload.senderId,
      senderName: payload.senderName,
      chatId: payload.chatId,
      message: messageText,
      status: payload.status,
      timestamp: payload.timestamp,
    });
  }

  async loadInitialMessages(
    chatId: string,
    {
      messageKey,
      transportKey,
    }: { messageKey: CryptoKey | null; transportKey: CryptoKey | null },
  ): Promise<void> {
    try {
      const encryptedMessages = await loadMessages(chatId);

      const decryptedMessagesPromises = encryptedMessages.map(
        async (message) => {
          if (!messageKey && !transportKey) return null;

          let decryptedMessage: string | null = null;

          if (messageKey) {
            try {
              decryptedMessage = await decryptText(
                messageKey,
                message.ciphertext,
                message.iv,
              );
            } catch (err) {
              decryptedMessage = null;
            }
          }

          if (!decryptedMessage && transportKey) {
            try {
              decryptedMessage = await decryptText(
                transportKey,
                message.ciphertext,
                message.iv,
              );
              // migrated message: re-encrypt with the persistent messageKey if available
              if (decryptedMessage && messageKey) {
                try {
                  const reEnc = await encryptText(messageKey, decryptedMessage);
                  await saveMessage({
                    ...message,
                    ciphertext: reEnc.ciphertext,
                    iv: reEnc.iv,
                  });
                } catch (e) {
                  console.warn(
                    "Failed to migrate stored message",
                    message.id,
                    e,
                  );
                }
              }
            } catch (err) {
              decryptedMessage = null;
            }
          }

          if (!decryptedMessage) {
            console.warn("Failed to decrypt stored message", message.id);
            return null;
          }

          return {
            id: message.id,
            senderId: message.senderId,
            senderName: message.senderName,
            chatId: message.chatId,
            message: decryptedMessage,
            status: message.status,
            timestamp: message.timestamp,
          };
        },
      );

      const decryptedMessages = await Promise.all(decryptedMessagesPromises);
      this.messages = decryptedMessages.filter((message) => message !== null);
    } catch (error) {
      console.error(`Could not load initial messages`, error);
    }
  }

  batchUpdateMessageStatus(ids: string[], status: MessageStatus) {
    for (const message of this.messages) {
      if (ids.includes(message.id)) {
        message.status = status;
        updateMessageStatus(message.id, status);
      }
    }
  }
}
