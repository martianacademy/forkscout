"use client";

import { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from "react";
import { getToken, setToken as storeToken, clearToken, validateToken } from "@/lib/api-client";

interface AuthCtx {
    token: string | null;
    isLoading: boolean;
    isAuthenticated: boolean;
    login: (token: string) => void;
    logout: () => void;
    refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthCtx>({
    token: null, isLoading: true, isAuthenticated: false,
    login: () => { }, logout: () => { }, refresh: async () => { },
});

export function AuthProvider({ children }: { children: ReactNode }) {
    const [token, setTokenState] = useState<string | null>(null);
    const [isLoading, setLoading] = useState(true);
    const [isAuthenticated, setAuth] = useState(false);

    const refresh = useCallback(async () => {
        setLoading(true);
        const t = getToken();
        if (!t) {
            setTokenState(null);
            setAuth(false);
            setLoading(false);
            return;
        }
        const valid = await validateToken();
        setTokenState(valid ? t : null);
        setAuth(valid);
        if (!valid) clearToken();
        setLoading(false);
    }, []);

    useEffect(() => {
        const timer = setTimeout(() => refresh(), 0);
        return () => clearTimeout(timer);
    }, [refresh]);

    const login = useCallback((t: string) => {
        storeToken(t);
        setTokenState(t);
        setAuth(true);
    }, []);

    const logout = useCallback(() => {
        clearToken();
        setTokenState(null);
        setAuth(false);
    }, []);

    return (
        <AuthContext.Provider value={{ token, isLoading, isAuthenticated, login, logout, refresh }}>
            {children}
        </AuthContext.Provider>
    );
}

export function useAuth() {
    return useContext(AuthContext);
}
