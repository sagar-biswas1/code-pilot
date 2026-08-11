import { textVariant } from "../../theme";
import { ThemeDialog } from "../ThemeDialog";
import type { Command } from "./types";

/**
 * The registry of slash commands available in the command menu.
 *
 * Each entry pairs a name/description (shown in the menu) with an optional
 * `action` that receives a {@link CommandContext} to affect the app. Commands
 * without an `action`, or whose action only shows a toast, are placeholders
 * for behavior that isn't wired up yet.
 */
export const COMMANDS: Command[] = [
  {
    name: "new",
    description: "Create a new conversation",
    value: "/new",
    action: (ctx) => {
      ctx.toast.show({
        variant: "success",
        message: "New conversation created",
      });
    },
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
    action: (ctx) => {
      ctx.toast.show({
        variant: "info",
        message: "Help",
      });
    },
  },
  {
    name: "clear",
    description: "Clear the screen",
    value: "/clear",
    action: (ctx) => {
      ctx.toast.show({
        variant: "info",
        message: "Screen cleared",
      });
    },
  },
  {
    name: "reset",
    description: "Reset the current conversation",
    value: "/reset",
    action: (ctx) => {
      ctx.toast.show({
        variant: "info",
        message: "Conversation reset",
      });
    },
  },
  {
    name: "model",
    description: "Switch the active model",
    value: "/model",
    action: (ctx) => {
      ctx.dialog.open({
        title: "Select model",
        children: (
          <text {...textVariant("body")}>Model selection coming soon</text>
        ),
      });
    },
  },
  {
    name: "copy",
    description: "Copy the last response to the clipboard",
    value: "/copy",
    action: (ctx) => {
      ctx.toast.show({
        variant: "info",
        message: "Response copied to clipboard",
      });
    },
  },
  {
    name: "retry",
    description: "Retry the last message",
    value: "/retry",
    action: (ctx) => {
      ctx.toast.show({
        variant: "info",
        message: "Response retried",
      });
    },
  },
  {
    name: "history",
    description: "Browse previous conversations",
    value: "/history",
    action: (ctx) => {
      ctx.toast.show({
        variant: "info",
        message: "Conversation history",
      });
    },
  },
  {
    name: "config",
    description: "Open settings and preferences",
    value: "/config",
    action: (ctx) => {
      ctx.toast.show({
        variant: "info",
        message: "Settings and preferences",
      });
    },
  },
  {
    name: "theme",
    description: "Change the color theme",
    value: "/theme",
    action: (ctx) => {
      ctx.dialog.open({
        title: "Select theme",
        children: <ThemeDialog />,
      });
    },
  },
  {
    name: "login",
    description: "Sign in to your account",
    value: "/login",
    action: (ctx) => {
      ctx.toast.show({
        variant: "success",
        message: "Opening login page in your browser",
      });
    },
  },
  {
    name: "logout",
    description: "Sign out of your account",
    value: "/logout",
    action: (ctx) => {
      ctx.toast.show({
        variant: "info",
        message: "Signed out of your account",
      });
    },
  },
  {
    name: "usage",
    description: "Show usage information",
    value: "/usage",
    action: (ctx) => {
      ctx.toast.show({
        variant: "info",
        message: "Opening usage information in your browser",
      });
    },
  },
  {
    name: "upgrade",
    description: "Buy more credits",
    value: "/upgrade",
    action: (ctx) => {
      ctx.toast.show({
        variant: "info",
        message: "Opening credit purchase page in your browser",
      });
    },
  },
  {
    name: "agents",
    description: "Select the agent mood",
    value: "/agents",
    action: (ctx) => {
      ctx.dialog.open({
        title: "Select mood",
        children: <text>Agent selection coming soon</text>,
      });
    },
  },
];
