import { useEffect, useRef, useState, type FormEvent } from "react";
import type { Conversation, Message } from "@mizaly/shared";
import { apiClient, ApiError } from "../lib/apiClient";
import { useAuth } from "../lib/authContext";
import { getSocket } from "../lib/socket";

export function WiadomosciPage() {
  const { accessToken } = useAuth();

  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [isLoadingConversations, setIsLoadingConversations] = useState(true);
  const [conversationsError, setConversationsError] = useState<string | null>(null);

  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoadingMessages, setIsLoadingMessages] = useState(false);
  const [messagesError, setMessagesError] = useState<string | null>(null);

  const [replyText, setReplyText] = useState("");
  const [isSending, setIsSending] = useState(false);

  // Keep the currently-open conversation id available inside the socket
  // listener without re-subscribing on every conversation switch.
  const activeConversationIdRef = useRef<string | null>(null);
  activeConversationIdRef.current = activeConversationId;

  useEffect(() => {
    apiClient
      .get<Conversation[]>("/api/conversations")
      .then(setConversations)
      .catch((err) =>
        setConversationsError(err instanceof ApiError ? err.message : "Nie udało się pobrać wiadomości.")
      )
      .finally(() => setIsLoadingConversations(false));
  }, []);

  // Connect to Socket.IO once authenticated and listen for live messages.
  useEffect(() => {
    if (!accessToken) return;
    const socket = getSocket(accessToken);

    const handleNewMessage = (message: Message) => {
      if (message.conversationId === activeConversationIdRef.current) {
        setMessages((prev) => [...prev, message]);
      }
      setConversations((prev) =>
        prev.map((c) =>
          c.id === message.conversationId ? { ...c, lastMessageAt: message.createdAt } : c
        )
      );
    };

    socket.on("new-message", handleNewMessage);
    return () => {
      socket.off("new-message", handleNewMessage);
    };
  }, [accessToken]);

  const openConversation = (conversationId: string) => {
    setActiveConversationId(conversationId);
    setMessages([]);
    setMessagesError(null);
    setIsLoadingMessages(true);
    apiClient
      .get<Message[]>(`/api/conversations/${conversationId}/messages`)
      .then(setMessages)
      .catch((err) =>
        setMessagesError(err instanceof ApiError ? err.message : "Nie udało się pobrać wiadomości.")
      )
      .finally(() => setIsLoadingMessages(false));
  };

  const handleReply = async (event: FormEvent) => {
    event.preventDefault();
    if (!activeConversationId || !replyText.trim()) return;
    setIsSending(true);
    try {
      const sent = await apiClient.post<Message>(`/api/messages/${activeConversationId}`, {
        body: replyText.trim(),
      });
      setMessages((prev) => [...prev, sent]);
      setReplyText("");
    } catch (err) {
      setMessagesError(err instanceof ApiError ? err.message : "Nie udało się wysłać wiadomości.");
    } finally {
      setIsSending(false);
    }
  };

  const activeConversation = conversations.find((c) => c.id === activeConversationId) || null;

  if (activeConversation) {
    return (
      <div>
        <button type="button" className="btn btn-secondary btn-small" onClick={() => setActiveConversationId(null)}>
          Wróć do listy
        </button>

        <h1 className="page-title">{activeConversation.participantName}</h1>
        <p className="hint-text" style={{ marginTop: -10, marginBottom: 16 }}>
          {activeConversation.platform}
        </p>

        {isLoadingMessages && <p className="hint-text">Ładowanie wiadomości…</p>}
        {messagesError && <p className="error-text">{messagesError}</p>}

        <div className="message-thread">
          {messages.map((message) => (
            <div key={message.id} className={`message-bubble ${message.direction}`}>
              {message.body}
            </div>
          ))}
          {!isLoadingMessages && messages.length === 0 && (
            <p className="empty-state">Brak wiadomości w tej konwersacji.</p>
          )}
        </div>

        <form className="reply-row" onSubmit={handleReply}>
          <input
            type="text"
            value={replyText}
            onChange={(e) => setReplyText(e.target.value)}
            placeholder="Napisz odpowiedź…"
          />
          <button type="submit" className="btn" disabled={isSending || !replyText.trim()}>
            Wyślij
          </button>
        </form>
      </div>
    );
  }

  return (
    <div>
      <h1 className="page-title">Wiadomości</h1>

      {isLoadingConversations && <p className="hint-text">Ładowanie…</p>}
      {conversationsError && <p className="error-text">{conversationsError}</p>}

      {!isLoadingConversations && !conversationsError && conversations.length === 0 && (
        <p className="empty-state">Brak wiadomości. Gdy podłączysz konta social media, pojawią się tutaj.</p>
      )}

      <div className="list">
        {conversations.map((conversation) => (
          <button
            key={conversation.id}
            type="button"
            className="conversation-list-item"
            onClick={() => openConversation(conversation.id)}
          >
            <span>
              <strong>{conversation.participantName}</strong>
              <br />
              <span className="hint-text">{conversation.platform}</span>
            </span>
            <span className="hint-text">
              {new Date(conversation.lastMessageAt).toLocaleDateString("pl-PL")}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
