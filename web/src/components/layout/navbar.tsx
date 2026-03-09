"use client";

import { useState, useEffect } from "react";
import { motion, AnimatePresence, useScroll, useSpring } from "framer-motion";
import { Menu, X } from "lucide-react";
import { ForkScoutLogo } from "@/components/forkscout-logo";
import { ThemeToggle } from "@/components/theme-toggle";

const navLinks = [
    { label: "Features", href: "#features" },
    { label: "Channels", href: "#channels" },
    { label: "Use Cases", href: "#use-cases" },
    { label: "Providers", href: "#providers" },
    { label: "Get Started", href: "#get-started" },
];

export function Navbar() {
    const [scrolled, setScrolled] = useState(false);
    const [mobileOpen, setMobileOpen] = useState(false);
    const [active, setActive] = useState("");
    const { scrollYProgress } = useScroll();
    const scaleX = useSpring(scrollYProgress, { stiffness: 200, damping: 30 });

    useEffect(() => {
        const onScroll = () => setScrolled(window.scrollY > 20);
        window.addEventListener("scroll", onScroll, { passive: true });
        return () => window.removeEventListener("scroll", onScroll);
    }, []);

    useEffect(() => {
        const ids = navLinks.map(l => l.href.replace("#", ""));
        const obs = new IntersectionObserver(
            (entries) => {
                for (const entry of entries) {
                    if (entry.isIntersecting) setActive(`#${entry.target.id}`);
                }
            },
            { rootMargin: "-40% 0px -40% 0px", threshold: 0 }
        );
        for (const id of ids) {
            const el = document.getElementById(id);
            if (el) obs.observe(el);
        }
        return () => obs.disconnect();
    }, []);

    return (
        <nav
            role="navigation"
            aria-label="Main navigation"
            className={`fixed left-0 right-0 top-0 z-50 transition-all duration-300 ${scrolled
                ? "border-b border-border/40 bg-background/80 shadow-sm backdrop-blur-xl"
                : "bg-transparent"
                }`}
        >
            <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3 sm:px-6">
                {/* Logo */}
                <a href="#hero" className="flex items-center gap-2.5" aria-label="ForkScout home">
                    <ForkScoutLogo size={28} className="drop-shadow-[0_0_8px_rgba(168,85,247,0.3)]" />
                    <span className="text-lg font-bold tracking-tight">
                        Fork
                        <span className="bg-linear-to-r from-purple-500 to-cyan-400 bg-clip-text text-transparent">
                            Scout
                        </span>
                    </span>
                </a>

                {/* Desktop links */}
                <ul className="hidden items-center gap-1 md:flex">
                    {navLinks.map((link) => (
                        <li key={link.href}>
                            <a
                                href={link.href}
                                className={`relative rounded-lg px-3 py-2 text-sm font-medium transition-colors hover:bg-purple-500/5 hover:text-foreground ${active === link.href ? "text-foreground" : "text-muted-foreground"}`}
                            >
                                {link.label}
                                {active === link.href && (
                                    <motion.div
                                        layoutId="nav-underline"
                                        className="absolute inset-x-1 -bottom-0.5 h-0.5 rounded-full bg-linear-to-r from-purple-500 to-cyan-400"
                                        transition={{ type: "spring", stiffness: 400, damping: 30 }}
                                    />
                                )}
                            </a>
                        </li>
                    ))}
                </ul>

                {/* Actions (desktop) */}
                <div className="hidden items-center gap-2 md:flex">
                    <ThemeToggle />
                    <a
                        href="https://github.com/Forkscout/forkscout"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="rounded-full border border-purple-500/20 bg-purple-500/5 px-4 py-1.5 text-sm font-medium text-purple-600 transition-colors hover:bg-purple-500/10 dark:text-purple-400"
                    >
                        GitHub
                    </a>
                </div>

                {/* Mobile actions */}
                <div className="flex items-center gap-1 md:hidden">
                    <ThemeToggle />
                    <button
                        onClick={() => setMobileOpen(!mobileOpen)}
                        className="rounded-lg p-2 text-muted-foreground hover:bg-muted"
                        aria-label="Toggle menu"
                    >
                        {mobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
                    </button>
                </div>
            </div>

            {/* Mobile menu */}
            <AnimatePresence>
                {mobileOpen && (
                    <motion.div
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: "auto" }}
                        exit={{ opacity: 0, height: 0 }}
                        className="overflow-hidden border-b border-border/40 bg-background/95 backdrop-blur-xl md:hidden"
                    >
                        <ul className="flex flex-col gap-1 px-4 pb-4">
                            {navLinks.map((link) => (
                                <li key={link.href}>
                                    <a
                                        href={link.href}
                                        onClick={() => setMobileOpen(false)}
                                        className="block rounded-lg px-3 py-2.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-purple-500/5 hover:text-foreground"
                                    >
                                        {link.label}
                                    </a>
                                </li>
                            ))}
                        </ul>
                    </motion.div>
                )}
            </AnimatePresence>

            {/* Scroll progress bar */}
            <motion.div
                className="absolute bottom-0 left-0 h-[2px] origin-left bg-linear-to-r from-purple-500 via-cyan-400 to-pink-500"
                style={{ scaleX }}
            />
        </nav>
    );
}
