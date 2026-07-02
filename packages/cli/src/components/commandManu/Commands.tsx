import type { Command } from "./types";

export const COMMANDS:Command[] = [
  {
    name: "new",
    description: "Create a new conversation",
    value: "/new",
  },
  {
    name: "exit",
    description: "Exit the application",
    value: "/exit",
    action: (ctx) => {
      ctx.exit();
    },
  },
  {
    name: "help",
    description: "Show help",
    value: "/help",
  },
  {
    name: "clear",
    description: "Clear the screen",
    value: "/clear",
  },
  {
    name: "reset",
    description: "Reset the current conversation",
    value: "/reset",
  },
  {
    name: "model",
    description: "Switch the active model",
    value: "/model",
  },
  {
    name: "copy",
    description: "Copy the last response to the clipboard",
    value: "/copy",
  },
  {
    name: "retry",
    description: "Retry the last message",
    value: "/retry",
  },
  {
    name: "history",
    description: "Browse previous conversations",
    value: "/history",
  },
  {
    name: "config",
    description: "Open settings and preferences",
    value: "/config",
  },
  {
    name: "theme",
    description: "Change the color theme",
    value: "/theme",
  },
  {
    name: "login",
    description: "Sign in to your account",
    value: "/login",
  },
  {
    name: "logout",
    description: "Sign out of your account",
    value: "/logout",
  },
];
