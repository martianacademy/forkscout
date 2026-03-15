"use client";

import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { ArrowRight, Github, Heart } from "lucide-react";



export function CtaSection() {
    return (
        <section id="get-started" className="relative mx-auto max-w-6xl px-6 py-24">
            <div className="mb-20 h-px bg-linear-to-r from-transparent via-purple-500/20 to-transparent" />

            {/* CTA card */}
            <div className="relative mx-auto max-w-2xl">
                <div className="relative flex flex-col items-center gap-6 rounded-3xl border border-border/50 bg-card/80 px-8 py-12 text-center sm:px-12">
                    {/* <motion.div
                        animate={{ y: [0, -8, 0] }}
                        transition={{ duration: 3, repeat: Infinity, ease: "easeInOut" }}
                        className="flex h-16 w-16 items-center justify-center rounded-2xl bg-linear-to-br from-purple-500/20 to-cyan-500/20"
                    >
                        <span className="text-3xl">🚀</span>
                    </motion.div> */}

                    <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">
                        Ready to deploy{" "}
                        <span className="bg-linear-to-r from-purple-500 via-cyan-400 to-pink-500 bg-clip-text text-transparent dark:from-purple-400 dark:via-cyan-300 dark:to-pink-400">
                            your own agent?
                        </span>
                    </h2>
                    <p className="max-w-md text-muted-foreground">
                        One command to install. Self-hosted. Full control. No vendor lock-in.
                    </p>

                    <div className="flex flex-col gap-3 sm:flex-row">
                        <motion.div whileHover={{ scale: 1.04 }} whileTap={{ scale: 0.97 }}>
                            <Button size="lg" className="gap-2 bg-linear-to-r from-purple-600 to-cyan-500 px-8 text-white shadow-lg shadow-purple-500/25 hover:from-purple-500 hover:to-cyan-400 hover:shadow-purple-500/40 dark:shadow-purple-500/15" asChild>
                                <a href="https://github.com/Forkscout/forkscout" target="_blank" rel="noopener noreferrer">
                                    Get Started <ArrowRight className="h-4 w-4" />
                                </a>
                            </Button>
                        </motion.div>
                        <motion.div whileHover={{ scale: 1.04 }} whileTap={{ scale: 0.97 }}>
                            <Button size="lg" variant="outline" className="gap-2 border-border/60 px-8 hover:border-purple-500/40 hover:bg-purple-500/5" asChild>
                                <a href="https://github.com/Forkscout/forkscout" target="_blank" rel="noopener noreferrer">
                                    <Github className="h-4 w-4" /> View Source
                                </a>
                            </Button>
                        </motion.div>
                    </div>
                </div>
            </div>

            {/* Footer */}
            <div className="mt-20 h-px bg-linear-to-r from-transparent via-border/40 to-transparent" />

            <footer className="flex flex-col items-center gap-4 py-10 text-center">
                <div className="flex items-center gap-6 text-sm text-muted-foreground">
                    <a href="https://github.com/Forkscout/forkscout" target="_blank" rel="noopener noreferrer"
                        className="transition-colors hover:text-foreground">GitHub</a>
                    <a href="https://github.com/Forkscout/forkscout/blob/main/README.md" target="_blank" rel="noopener noreferrer"
                        className="transition-colors hover:text-foreground">Docs</a>
                    <a href="https://github.com/Forkscout/forkscout/issues" target="_blank" rel="noopener noreferrer"
                        className="transition-colors hover:text-foreground">Issues</a>
                </div>
                <p className="flex flex-wrap items-center justify-center gap-1.5 text-sm text-muted-foreground">
                    Built with <Heart className="h-3.5 w-3.5 fill-pink-500 text-pink-500" /> by{" "}
                    <a href="https://github.com/martianacademy" target="_blank" rel="noopener noreferrer"
                        className="font-medium text-purple-600 underline-offset-4 hover:underline dark:text-purple-400">
                        Martian Academy
                    </a>
                    <span className="text-muted-foreground/40">·</span> Open source under MIT
                </p>
            </footer>
        </section>
    );
}
