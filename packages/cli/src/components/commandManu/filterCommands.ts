import { COMMANDS } from "./Commands";
import type { Command } from "./types";

export function getFilteredCommands(query: string): Command[] {
    if(query.length === 0) return COMMANDS;
    const filtered = COMMANDS.filter((command) => command.name.toLowerCase().includes(query.toLowerCase()));
    
    return filtered;
}