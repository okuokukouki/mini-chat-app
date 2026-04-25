'use client';

// チャット画面。AgentCore Runtime の /invocations エンドポイントを呼び出し、回答をリアルタイム表示する。

import { useState, useRef, useEffect } from 'react';
import styles from './page.module.css';

interface Message {
  role: 'user' | 'ai';
  content: string;
}

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8080';

export default function ChatPage() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  // セッションIDはページロード時に1度だけ生成
  const [sessionId] = useState(() => crypto.randomUUID());
  const chatRef = useRef<HTMLDivElement>(null);

  // メッセージ更新のたびに末尾へスクロール
  useEffect(() => {
    if (chatRef.current) {
      chatRef.current.scrollTop = chatRef.current.scrollHeight;
    }
  }, [messages]);

  async function sendMessage() {
    const message = input.trim();
    if (!message || isLoading) return;

    setMessages(prev => [...prev, { role: 'user', content: message }]);
    setInput('');
    setIsLoading(true);

    // AIメッセージの空バブルを先に追加してトークンを追記していく
    setMessages(prev => [...prev, { role: 'ai', content: '' }]);

    try {
      // AgentCore Runtime のエンドポイントは /invocations
      // リクエストボディは { prompt, session_id }
      const response = await fetch(`${API_URL}/invocations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: message, session_id: sessionId }),
      });

      const reader = response.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        // 完結した行だけ処理し、途中の行はバッファに残す
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          // AgentCore のSSEデータはJSON文字列としてエンコードされているためパースする
          // 例: data: "こんにちは" → "こんにちは"
          const token: string = JSON.parse(line.slice(6));

          // 末尾の AI メッセージにトークンを追記
          setMessages(prev => {
            const updated = [...prev];
            const last = updated[updated.length - 1];
            updated[updated.length - 1] = { ...last, content: last.content + token };
            return updated;
          });
        }
      }
    } catch (err) {
      setMessages(prev => {
        const updated = [...prev];
        updated[updated.length - 1] = {
          role: 'ai',
          content: `エラーが発生しました: ${err instanceof Error ? err.message : String(err)}`,
        };
        return updated;
      });
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <div className={styles.container}>
      <header className={styles.header}>Mini Chat App</header>

      <div className={styles.chat} ref={chatRef}>
        {messages.map((msg, i) => (
          <div
            key={i}
            className={[
              styles.message,
              msg.role === 'user' ? styles.user : styles.ai,
              isLoading && i === messages.length - 1 && msg.role === 'ai'
                ? styles.streaming
                : '',
            ].join(' ')}
          >
            {msg.content}
          </div>
        ))}
      </div>

      <div className={styles.inputArea}>
        <input
          className={styles.input}
          type="text"
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              sendMessage();
            }
          }}
          placeholder="メッセージを入力... (Enter で送信)"
          disabled={isLoading}
        />
        <button className={styles.sendBtn} onClick={sendMessage} disabled={isLoading}>
          送信
        </button>
      </div>
    </div>
  );
}
