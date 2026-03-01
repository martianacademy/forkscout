"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";
import { useSearchParams } from "next/navigation";

interface AuthContextValue {
    /** The bearer token from ?token= URL param, or empty string if missing */
    token: string;
    /** Whether a valid token is present */
    isAuthenticated: boolean;
    /** The current ?token= search param string to append to links, e.g. "?token=abc" */
    tokenParam: string;
}

const AuthContext = createContext<AuthContextValue>({
    token: "",
    isAuthenticated: false,
    tokenParam: "",
});

/**
 * Reads ?token= from the URL and provides it to all children.
 * Wrap this around all pages that need authenticated API access.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
    const searchParams = useSearchParams();
    const token = searchParams.get("token") ?? "";

    const value = useMemo<AuthContextValue>(
        () => ({
            token,
            isAuthenticated: token.length > 0,
            tokenParam: token ? `?token=${token}` : "",
        }),
        [token],
    );

    return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

/** Hook to access the auth token from URL */
export function useAuth(): AuthContextValue {
    return useContext(AuthContext);
}
