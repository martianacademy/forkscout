// src/channels/types.ts — Channel contract
// Every channel must implement this interface.
// Drop a new channel anywhere in src/channels/, implement this, done.

import type { AppConfig } from "@/config.ts";

export interface Channel {
    /** Unique identifier — used for logging and selection */
    name: string;
    /** Start the channel. Should run indefinitely or until process exits. */
    start(config: AppConfig): Promise<void>;
}
