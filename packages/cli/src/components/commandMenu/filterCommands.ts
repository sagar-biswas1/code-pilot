import { COMMANDS } from "./Commands";
import type { Command } from "./types";

/**
 * Filter the command list by a case-insensitive substring match on the command
 * name. An empty query returns every command.
 */
export function getFilteredCommands(query: string): Command[] {
    if(query.length === 0) return COMMANDS;
    const filtered = COMMANDS.filter((command) => command.name.toLowerCase().includes(query.toLowerCase()));
    
    return filtered;
}