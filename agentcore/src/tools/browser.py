# AgentCoreのBrowserビルトインツール。リモートブラウザを操作してWebページを取得する。
# BrowserClientがセッションを管理し、PlaywrightのWebSocket経由でブラウザを制御する。

from playwright.sync_api import sync_playwright
from strands import tool
from bedrock_agentcore.tools import BrowserClient

from config import REGION
from skill.decorators import skill


@skill("browser")
@tool
def browse_web(url: str) -> str:
    """指定したURLのWebページにアクセスしてテキストコンテンツを返す。

    AgentCoreのBrowserサンドボックスセッションを起動し、Playwrightで操作する。
    セッションは呼び出しごとに開始・終了する。

    Args:
        url: アクセスするWebページのURL。

    Returns:
        ページ本文のテキストコンテンツ（最大5000文字）。
    """
    client = BrowserClient(REGION)
    client.start()
    try:
        ws_url, all_headers = client.generate_ws_headers()

        # PlaywrightのWebSocket接続にはAWS認証ヘッダーのみ渡す
        # （Upgrade/Connection等の標準WebSocketヘッダーはPlaywrightが付与する）
        auth_headers = {
            "Authorization": all_headers["Authorization"],
            "X-Amz-Date": all_headers["X-Amz-Date"],
        }
        if "X-Amz-Security-Token" in all_headers:
            auth_headers["X-Amz-Security-Token"] = all_headers["X-Amz-Security-Token"]

        with sync_playwright() as p:
            browser = p.chromium.connect_over_cdp(ws_url, headers=auth_headers)
            page = browser.new_page()
            page.goto(url, timeout=30000)
            content = page.inner_text("body")
            browser.close()

        return content[:5000]
    finally:
        client.stop()
