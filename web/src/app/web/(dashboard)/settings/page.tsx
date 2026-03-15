"use client";

import { useEffect, useState, useCallback } from "react";
import { motion } from "framer-motion";
import { Save, RefreshCw, Check, AlertCircle } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { apiFetch } from "@/lib/api-client";

export default function SettingsPage() {
    const [raw, setRaw] = useState("");
    const [saved, setSaved] = useState("");
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState("");
    const [success, setSuccess] = useState("");
    const [jsonError, setJsonError] = useState("");

    const load = useCallback(async () => {
        setLoading(true);
        setError("");
        try {
            const data = await apiFetch<Record<string, unknown>>("/api/config");
            const pretty = JSON.stringify(data, null, 2);
            setRaw(pretty);
            setSaved(pretty);
        } catch (e: unknown) {
            setError(e instanceof Error ? e.message : "Failed to load config");
        }
        setLoading(false);
    }, []);

    useEffect(() => {
        const timer = setTimeout(() => load(), 0);
        return () => clearTimeout(timer);
    }, [load]);

    // Validate JSON on change
    useEffect(() => {
        const timer = setTimeout(() => {
            if (!raw.trim()) { setJsonError(""); return; }
            try { JSON.parse(raw); setJsonError(""); }
            catch (e: unknown) { setJsonError(e instanceof Error ? e.message : String(e)); }
        }, 300);
        return () => clearTimeout(timer);
    }, [raw]);

    const save = async () => {
        if (jsonError) return;
        setSaving(true);
        setError("");
        setSuccess("");
        try {
            await apiFetch("/api/config", {
                method: "PUT",
                body: raw,
            });
            setSaved(raw);
            setSuccess("Config saved successfully");
            setTimeout(() => setSuccess(""), 3000);
        } catch (e: unknown) {
            setError(e instanceof Error ? e.message : "Failed to save");
        }
        setSaving(false);
    };

    const dirty = raw !== saved;

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-2xl font-bold tracking-tight">Settings</h1>
                    <p className="text-sm text-muted-foreground">Edit forkscout.config.json — changes take effect on next agent restart</p>
                </div>
                <div className="flex items-center gap-2">
                    <Button variant="outline" size="sm" onClick={load} disabled={loading} className="gap-2">
                        <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} /> Reload
                    </Button>
                    <Button size="sm" onClick={save} disabled={saving || !!jsonError || !dirty}
                        className="gap-2 bg-linear-to-r from-purple-600 to-cyan-500 text-white hover:from-purple-500 hover:to-cyan-400">
                        <Save className="h-3.5 w-3.5" /> {saving ? "Saving..." : "Save"}
                    </Button>
                </div>
            </div>

            {error && (
                <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}
                    className="flex items-center gap-2 rounded-lg border border-destructive/50 bg-destructive/5 px-4 py-3 text-sm text-destructive">
                    <AlertCircle className="h-4 w-4 shrink-0" /> {error}
                </motion.div>
            )}

            {success && (
                <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}
                    className="flex items-center gap-2 rounded-lg border border-emerald-500/50 bg-emerald-500/5 px-4 py-3 text-sm text-emerald-600 dark:text-emerald-400">
                    <Check className="h-4 w-4 shrink-0" /> {success}
                </motion.div>
            )}

            <Card className="border-border/40 bg-card/50 backdrop-blur-sm">
                <CardHeader className="flex flex-row items-center justify-between pb-3">
                    <CardTitle className="text-sm font-medium">forkscout.config.json</CardTitle>
                    <div className="flex items-center gap-2">
                        {dirty && <Badge variant="secondary" className="text-amber-500">Unsaved</Badge>}
                        {jsonError && <Badge variant="destructive" className="text-xs">Invalid JSON</Badge>}
                        {!jsonError && !dirty && <Badge variant="secondary" className="text-emerald-500">Valid</Badge>}
                    </div>
                </CardHeader>
                <CardContent>
                    <Textarea value={raw} onChange={(e) => setRaw(e.target.value)}
                        className="min-h-[500px] resize-y border-border/40 bg-background/50 font-mono text-sm leading-relaxed"
                        spellCheck={false} />
                    {jsonError && (
                        <p className="mt-2 text-xs text-destructive">{jsonError}</p>
                    )}
                </CardContent>
            </Card>
        </div>
    );
}
