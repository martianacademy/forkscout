// hooks/usePageContext.ts — Get page context from content script via background worker

import { useState, useEffect } from "react";
import type { PageContext } from "../types";

export function usePageContext() {
    const [pageCtx, setPageCtx] = useState<PageContext | null>(null);

    useEffect(() => {
        // Ask background to fetch current tab's context
        chrome.runtime.sendMessage({ type: "GET_PAGE_CONTEXT" }, (res) => {
            if (chrome.runtime.lastError) return;
            if (res?.url) setPageCtx(res as PageContext);
        });

        // Listen for live updates (selection change, navigation)
        const handler = (msg: { type: string } & Partial<PageContext>) => {
            if (msg.type === "PAGE_CONTEXT") {
                setPageCtx({ url: msg.url ?? "", title: msg.title ?? "", selectedText: msg.selectedText });
            }
        };
        chrome.runtime.onMessage.addListener(handler);
        return () => chrome.runtime.onMessage.removeListener(handler);
    }, []);

    return pageCtx;
}
