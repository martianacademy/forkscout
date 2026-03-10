// hooks/useSettings.ts — Load/save settings from chrome.storage.local

import { useState, useEffect, useCallback } from "react";
import type { Settings } from "../types";
import { loadSettings, saveSettings } from "../store/storage";

export function useSettings() {
    const [settings, setSettings] = useState<Settings | null>(null);
    const [ready, setReady] = useState(false);

    useEffect(() => {
        loadSettings().then(s => { setSettings(s); setReady(true); });

        // React to changes from other parts of the extension (background, etc.)
        const listener = (changes: Record<string, chrome.storage.StorageChange>) => {
            if ("fw_settings" in changes) {
                setSettings(prev => ({ ...prev!, ...changes.fw_settings.newValue }));
            }
        };
        chrome.storage.local.onChanged.addListener(listener);
        return () => chrome.storage.local.onChanged.removeListener(listener);
    }, []);

    const update = useCallback(async (patch: Partial<Settings>) => {
        setSettings(prev => {
            if (!prev) return prev;
            const next = { ...prev, ...patch };
            // Persist async (fire-and-forget)
            saveSettings(next);
            return next;
        });
    }, []);

    return { settings, ready, update };
}
