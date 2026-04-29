'use client';

// チャット画面。AgentCore Runtime の /invocations エンドポイントを呼び出し、回答をリアルタイム表示する。
// SSE で oauth_url イベントを受信した場合はポップアップを開き、oauth_complete で閉じる。
// Entra ID（MSAL）でリダイレクトログインし、取得した ID トークンを Authorization ヘッダーに付与する。

import { useState, useRef, useEffect } from 'react';
import { PublicClientApplication, InteractionRequiredAuthError, type AccountInfo } from '@azure/msal-browser';
import styles from './page.module.css';

const API_URL = process.env.NEXT_PUBLIC_AGENTCORE_ENDPOINT ?? 'http://localhost:8080';
const LOGIN_SCOPES = ['openid', 'profile', 'email'];

// React StrictMode の二重実行で複数インスタンスが生まれないようモジュールスコープでシングルトン管理
let _msalInitPromise: Promise<PublicClientApplication> | null = null;

function getMsalInstance(): Promise<PublicClientApplication> {
  if (_msalInitPromise) return _msalInitPromise;
  const instance = new PublicClientApplication({
    auth: {
      clientId: process.env.NEXT_PUBLIC_ENTRA_CLIENT_ID!,
      authority: `https://login.microsoftonline.com/${process.env.NEXT_PUBLIC_ENTRA_TENANT_ID}`,
      redirectUri: window.location.origin,
    },
    cache: { cacheLocation: 'sessionStorage' },
  });
  _msalInitPromise = instance.initialize().then(() => instance);
  return _msalInitPromise;
}

interface Message {
  role: 'user' | 'ai';
  content: string;
}

export default function ChatPage() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  // セッションIDはページロード時に1度だけ生成
  const [sessionId] = useState(() => crypto.randomUUID());
  const chatRef = useRef<HTMLDivElement>(null);
  // OAuth ポップアップ参照
  const oauthPopupRef = useRef<Window | null>(null);
  // MSAL インスタンス（ブラウザ側でのみ初期化）
  const msalRef = useRef<PublicClientApplication | null>(null);
  const [account, setAccount] = useState<AccountInfo | null>(null);
  const [msalReady, setMsalReady] = useState(false);

  // MSAL を初期化し、リダイレクトログイン後の結果を処理する
  // handleRedirectPromise() はページロードのたびに呼ぶ必要がある（リダイレクト後の認証情報を受け取るため）
  useEffect(() => {
    getMsalInstance().then(async instance => {
      msalRef.current = instance;
      // リダイレクトからの戻りを処理（通常ロード時は null が返る）
      const result = await instance.handleRedirectPromise();
      if (result?.account) {
        setAccount(result.account);
      } else {
        const accounts = instance.getAllAccounts();
        if (accounts.length > 0) setAccount(accounts[0]);
      }
      setMsalReady(true);
    });
  }, []);

  // メッセージ更新のたびに末尾へスクロール
  useEffect(() => {
    if (chatRef.current) {
      chatRef.current.scrollTop = chatRef.current.scrollHeight;
    }
  }, [messages]);

  // Entra ID リダイレクトでログイン（ブラウザごと Microsoft のログインページに遷移する）
  async function login() {
    if (!msalRef.current) return;
    await msalRef.current.loginRedirect({ scopes: LOGIN_SCOPES });
    // ここには到達しない（ページ遷移が発生するため）
  }

  // ID トークンを取得する（期限切れなら自動更新）
  async function getIdToken(): Promise<string> {
    const msal = msalRef.current;
    if (!msal || !account) throw new Error('未ログイン');
    try {
      const result = await msal.acquireTokenSilent({ scopes: LOGIN_SCOPES, account });
      return result.idToken;
    } catch (err) {
      // サイレント取得に失敗した場合はリダイレクトで再認証（ページ遷移が発生する）
      if (err instanceof InteractionRequiredAuthError) {
        await msal.acquireTokenRedirect({ scopes: LOGIN_SCOPES, account });
        // ここには到達しない（ページ遷移が発生するため）
      }
      throw err;
    }
  }

  // SSE の 1 イベントを処理する
  // AgentCore が JSON エンコードして送信するため JSON.parse が必要。
  // 文字列トークン → data: "hello" → parsed = "hello"
  // OAuth イベント → data: {"type":"oauth_url",...} → parsed = { type: "oauth_url", ... }
  function handleSseEvent(rawData: string) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(rawData);
    } catch {
      return;
    }

    if (typeof parsed === 'object' && parsed !== null && 'type' in parsed) {
      const evt = parsed as { type: string; url?: string };
      if (evt.type === 'oauth_url' && evt.url) {
        oauthPopupRef.current = window.open(
          evt.url,
          'oauth_popup',
          'width=500,height=600,menubar=no,toolbar=no,location=no',
        );
        appendToLastAiMessage('\n\n[Google の認証画面が開きました。承認後、再度メッセージを送信してください。]');
        return;
      }
      if (evt.type === 'oauth_complete') {
        oauthPopupRef.current?.close();
        oauthPopupRef.current = null;
        appendToLastAiMessage('\n[認証が完了しました。]');
        return;
      }
      return;
    }

    // 通常のテキストトークン（文字列）
    if (typeof parsed === 'string') {
      appendToLastAiMessage(parsed);
    }
  }

  function appendToLastAiMessage(text: string) {
    setMessages(prev => {
      const updated = [...prev];
      const last = updated[updated.length - 1];
      if (last?.role === 'ai') {
        updated[updated.length - 1] = { ...last, content: last.content + text };
      }
      return updated;
    });
  }

  async function sendMessage() {
    const message = input.trim();
    if (!message || isLoading) return;

    setMessages(prev => [...prev, { role: 'user', content: message }]);
    setInput('');
    setIsLoading(true);

    // AIメッセージの空バブルを先に追加してトークンを追記していく
    setMessages(prev => [...prev, { role: 'ai', content: '' }]);

    try {
      const idToken = await getIdToken();

      // AgentCore Runtime のエンドポイントは /invocations
      // リクエストボディは { prompt, session_id }
      const response = await fetch(`${API_URL}/invocations`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${idToken}`,
        },
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
          handleSseEvent(line.slice(6));
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
      <header className={styles.header}>
        Mini Chat App
        {msalReady && (
          <span className={styles.authArea}>
            {account ? (
              <span className={styles.accountName}>{account.username}</span>
            ) : (
              <button className={styles.loginBtn} onClick={login}>
                Entra ID でログイン
              </button>
            )}
          </span>
        )}
      </header>

      <div className={styles.chat} ref={chatRef}>
        {!msalReady && <p className={styles.hint}>認証を初期化中...</p>}
        {msalReady && !account && (
          <p className={styles.hint}>ログインするとチャットを開始できます。</p>
        )}
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
          placeholder={account ? 'メッセージを入力... (Enter で送信)' : 'ログインが必要です'}
          disabled={isLoading || !account}
        />
        <button className={styles.sendBtn} onClick={sendMessage} disabled={isLoading || !account}>
          送信
        </button>
      </div>
    </div>
  );
}