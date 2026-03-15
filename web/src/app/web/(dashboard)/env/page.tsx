"use client";

import { useEffect, useState, useCallback } from "react";
import { motion } from "framer-motion";
import { Plus, Trash2, KeyRound, RefreshCw, Check, AlertCircle, Eye, EyeOff } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { apiFetch } from "@/lib/api-client";

export default function EnvPage() {
    const [aliases, setAliases] = useState<string[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");
    const [success, setSuccess] = useState("");

    // Add dialog state
    const [dialogOpen, setDialogOpen] = useState(false);
    const [newAlias, setNewAlias] = useState("");
    const [newValue, setNewValue] = useState("");
    const [showValue, setShowValue] = useState(false);
    const [adding, setAdding] = useState(false);

    const load = useCallback(async () => {
        setLoading(true); setError("");
        try {
            const data = await apiFetch<{ aliases: string[] }>("/api/secrets");
            setAliases(data.aliases ?? []);
        } catch (e: unknown) { setError(e instanceof Error ? e.message : String(e)); }
        setLoading(false);
    }, []);

    useEffect(() => {
        const timer = setTimeout(() => load(), 0);
        return () => clearTimeout(timer);
    }, [load]);

    const addSecret = async () => {
        if (!newAlias.trim() || !newValue.trim()) return;
        setAdding(true); setError("");
        try {
            await apiFetch("/api/secrets", {
                method: "POST",
                body: JSON.stringify({ alias: newAlias.trim(), value: newValue.trim() }),
            });
            setSuccess(`Secret "${newAlias.trim()}" saved`);
            setTimeout(() => setSuccess(""), 3000);
            setNewAlias(""); setNewValue(""); setDialogOpen(false);
            await load();
        } catch (e: unknown) { setError(e instanceof Error ? e.message : String(e)); }
        setAdding(false);
    };

    const deleteSecret = async (alias: string) => {
        setError("");
        try {
            await apiFetch(`/api/secrets?alias=${encodeURIComponent(alias)}`, { method: "DELETE" });
            setSuccess(`Secret "${alias}" deleted`);
            setTimeout(() => setSuccess(""), 3000);
            await load();
        } catch (e: unknown) { setError(e instanceof Error ? e.message : String(e)); }
    };

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-2xl font-bold tracking-tight">Env &amp; Secrets</h1>
                    <p className="text-sm text-muted-foreground">Manage encrypted secrets — values never leave your machine</p>
                </div>
                <div className="flex items-center gap-2">
                    <Button variant="outline" size="sm" onClick={load} disabled={loading} className="gap-2">
                        <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} /> Reload
                    </Button>
                    <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
                        <DialogTrigger asChild>
                            <Button size="sm" className="gap-2 bg-linear-to-r from-purple-600 to-cyan-500 text-white hover:from-purple-500 hover:to-cyan-400">
                                <Plus className="h-3.5 w-3.5" /> Add Secret
                            </Button>
                        </DialogTrigger>
                        <DialogContent className="sm:max-w-md">
                            <DialogHeader>
                                <DialogTitle className="flex items-center gap-2">
                                    <KeyRound className="h-4 w-4 text-purple-500" /> Add Secret
                                </DialogTitle>
                            </DialogHeader>
                            <div className="space-y-4 pt-2">
                                <div className="space-y-2">
                                    <Label className="text-xs text-muted-foreground">Alias (alphanumeric, dashes, underscores)</Label>
                                    <Input value={newAlias} onChange={(e) => setNewAlias(e.target.value)}
                                        placeholder="OPENAI_API_KEY" className="font-mono text-sm" />
                                </div>
                                <div className="space-y-2">
                                    <Label className="text-xs text-muted-foreground">Value</Label>
                                    <div className="relative">
                                        <Input value={newValue} onChange={(e) => setNewValue(e.target.value)}
                                            type={showValue ? "text" : "password"}
                                            placeholder="sk-..." className="pr-10 font-mono text-sm" />
                                        <Button variant="ghost" size="icon" type="button"
                                            onClick={() => setShowValue(!showValue)}
                                            className="absolute right-1 top-1/2 h-7 w-7 -translate-y-1/2 text-muted-foreground">
                                            {showValue ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                                        </Button>
                                    </div>
                                </div>
                                <Button onClick={addSecret} disabled={adding || !newAlias.trim() || !newValue.trim()}
                                    className="w-full gap-2 bg-linear-to-r from-purple-600 to-cyan-500 text-white">
                                    {adding ? "Saving..." : "Save Secret"}
                                </Button>
                            </div>
                        </DialogContent>
                    </Dialog>
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
                <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-sm font-medium">
                        <KeyRound className="h-4 w-4 text-purple-500" />
                        Stored Secrets
                        <Badge variant="secondary" className="ml-auto">{aliases.length}</Badge>
                    </CardTitle>
                </CardHeader>
                <CardContent>
                    {aliases.length === 0 && !loading ? (
                        <div className="py-8 text-center text-sm text-muted-foreground">
                            No secrets stored yet. Click <strong>Add Secret</strong> to get started.
                        </div>
                    ) : (
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>Alias</TableHead>
                                    <TableHead>Value</TableHead>
                                    <TableHead className="w-[60px]" />
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {aliases.map((alias) => (
                                    <TableRow key={alias}>
                                        <TableCell className="font-mono text-sm">{alias}</TableCell>
                                        <TableCell className="text-muted-foreground">••••••••••</TableCell>
                                        <TableCell>
                                            <Button variant="ghost" size="icon" onClick={() => deleteSecret(alias)}
                                                className="h-8 w-8 text-muted-foreground hover:text-destructive">
                                                <Trash2 className="h-3.5 w-3.5" />
                                            </Button>
                                        </TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    )}
                </CardContent>
            </Card>

            <div className="rounded-lg border border-border/30 bg-muted/20 px-4 py-3">
                <p className="text-xs text-muted-foreground">
                    <strong>Note:</strong> Secrets are encrypted on disk at <code className="rounded bg-muted px-1 py-0.5 font-mono text-[10px]">.agents/secrets/</code>.
                    The agent accesses them via <code className="rounded bg-muted px-1 py-0.5 font-mono text-[10px]">secret_vault</code> tool.
                    Values are never sent to the frontend — only alias names are visible.
                </p>
            </div>
        </div>
    );
}
