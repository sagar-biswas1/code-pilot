-- Tool calls now execute on the user's machine, so a turn can be persisted
-- while it waits for results to come back from the CLI.
ALTER TYPE "MessageStatus" ADD VALUE 'PENDING_TOOLS';
